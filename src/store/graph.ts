import { create } from 'zustand'
import { analyzeGraph, parseRepoInput } from '../api/graph'
import type { AnalyzeGraphOptions, GraphEvidence, GraphNode, GraphProgress, GraphResult } from '../api/graph'
import { relationFromEvidence } from '../lib/graph/relations'

export const MAX_GRAPH_NODES = 120
export const MAX_GRAPH_DEPTH = 5
export const MAX_GRAPH_ROOTS = 8
export type GraphMode = 'standalone' | 'embedded'
export interface WorkspaceNode extends GraphNode { depth: number; overlapRoot: string }
export interface GraphWorkspace extends Omit<GraphResult, 'nodes' | 'counts' | 'limits'> {
  nodes: WorkspaceNode[]
  analyses: { root: string; generatedAt: string; counts: GraphResult['counts']; limits: GraphResult['limits'] }[]
}
export interface GraphCamera { x: number; y: number; scale: number; mode: 'overview' | 'focus' | 'custom' }
export interface GraphView {
  root: string
  graph: GraphWorkspace | null
  selected: string
  expanded: string[]
  camera: GraphCamera | null
  canvasSize: { width: number; height: number } | null
  panel: 'evidence' | 'nodes' | 'people'
  status: 'idle' | 'loading' | 'ready' | 'error' | 'interrupted'
  progress: GraphProgress | null
  busyNode: string | null
  error: string | null
}

const canonical = (value: string) => value.toLowerCase()
export const graphKey = (mode: GraphMode, root: string) => `${mode}:${canonical(root)}`
export const graphPath = (root?: string) => root ? `/graph/${root.split('/').map(encodeURIComponent).join('/')}` : '/graph'
const initialView = (root: string): GraphView => ({ root, graph: null, selected: canonical(root), expanded: [], camera: null, canvasSize: null, panel: 'evidence', status: 'idle', progress: null, busyNode: null, error: null })
export const compareGraphNodes = (a: GraphNode, b: GraphNode) => b.overlap.score - a.overlap.score || b.repo.stars - a.repo.stars || a.id.localeCompare(b.id, 'en')
export function mergeEvidence(a: GraphEvidence[], b: GraphEvidence[]) {
  const key = (e: GraphEvidence) => JSON.stringify([e.kind, e.url, e.label, e.excerpt, e.person, e.relation, e.relationReason, e.targetUrl])
  return [...new Map([...a, ...b].map(e => [key(e), e])).values()]
}
export const evidenceRelation = relationFromEvidence
export function mergeGraph(previous: GraphWorkspace | null, result: GraphResult): GraphWorkspace {
  const root = previous?.root ?? canonical(result.root), center = canonical(result.root)
  const nodes = new Map((previous?.nodes ?? []).map(node => [node.id, { ...node }]))
  const depth = nodes.get(center)?.depth ?? 0
  const warnings = [...(previous?.warnings ?? []), ...result.warnings]
  for (const node of [...result.nodes].sort((a, b) => a.tier - b.tier || compareGraphNodes(a, b))) {
    const id = canonical(node.id), existing = nodes.get(id)
    const nextDepth = id === root ? 0 : id === center ? depth : depth + 1
    if (!existing && nextDepth > MAX_GRAPH_DEPTH) { warnings.push(`已达到 ${MAX_GRAPH_DEPTH} 层上限，未加入更深节点。`); continue }
    if (!existing && nodes.size >= MAX_GRAPH_NODES) { warnings.push(`已达到 ${MAX_GRAPH_NODES} 个节点上限，其余节点未加入。`); continue }
    if (existing) {
      const incoming = id !== center && node.overlap.method === 'topics' && (existing.overlap.method !== 'topics' || node.overlap.score > existing.overlap.score)
      nodes.set(id, { ...(incoming ? node : existing), id, tier: id === root ? 0 : id === center ? existing.tier : Math.min(existing.tier || 1, node.tier || 1) as 1 | 2, depth: Math.min(existing.depth, nextDepth), overlapRoot: incoming ? center : existing.overlapRoot, evidence: mergeEvidence(existing.evidence, node.evidence) })
    } else nodes.set(id, { ...node, id, tier: id === root ? 0 : node.tier === 0 ? 1 : node.tier, depth: nextDepth, overlapRoot: center })
  }
  const edges = (previous?.edges ?? []).map(edge => ({ ...edge }))
  for (const edge of result.edges) {
    const source = canonical(edge.source), target = canonical(edge.target)
    if (source === target || !nodes.has(source) || !nodes.has(target)) continue
    const existing = edges.find(e => e.source === source && e.target === target)
    if (existing) { existing.evidence = mergeEvidence(existing.evidence, edge.evidence); existing.relation = evidenceRelation(existing.evidence); if (edge.kind === 'direct') existing.kind = 'direct' }
    else edges.push({ ...edge, source, target, relation: evidenceRelation(edge.evidence) })
  }
  // Preserve cyclic evidence while computing an acyclic shortest discovery path.
  const distances = new Map<string, number>([[root, 0]]), queue = [root]
  for (let i = 0; i < queue.length; i++) for (const edge of edges) {
    if (edge.source !== queue[i] || distances.has(edge.target)) continue
    distances.set(edge.target, distances.get(edge.source)! + 1); queue.push(edge.target)
  }
  for (const [id, node] of nodes) node.depth = distances.get(id) ?? node.depth
  const people = new Map((previous?.people ?? []).map(p => [canonical(p.login), p]))
  for (const person of result.people) {
    const old = people.get(canonical(person.login))
    people.set(canonical(person.login), old ? { ...person, roles: [...new Set([...old.roles, ...person.roles])], evidence: mergeEvidence(old.evidence, person.evidence), contributions: person.contributions ?? old.contributions } : person)
  }
  const analysis = { root: center, generatedAt: result.generatedAt, counts: result.counts, limits: result.limits }
  return { version: 1, semanticsVersion: 2, incomplete: !!previous?.incomplete || !!result.incomplete, root, nodes: [...nodes.values()], edges, people: [...people.values()], warnings: [...new Set(warnings)], generatedAt: result.generatedAt, analyses: [...(previous?.analyses ?? []).filter(a => a.root !== center), analysis] }
}

type Analyzer = (root: string, options: AnalyzeGraphOptions) => Promise<GraphResult>
interface GraphState {
  views: Record<string, GraphView>
  lastStandalone: string | null
  scopeVersion: number
  setScope: (account: string | null, token: string | null) => void
  open: (mode: GraphMode, root?: string) => string | null
  retain: (key: string) => void
  release: (key: string) => void
  ensure: (key: string) => Promise<void>
  reanalyze: (key: string) => Promise<void>
  expand: (key: string, node: string) => Promise<void>
  cancel: (key: string) => void
  updateView: (key: string, changes: Partial<Pick<GraphView, 'selected' | 'camera' | 'canvasSize' | 'panel'>>) => void
  reset: () => void
}
export function createGraphStore(analyzer: Analyzer = analyzeGraph) {
  let scope: string | null = null, credential: string | null = null, generation = 0, clock = 0
  const usage = new Map<string, number>(), leases = new Map<string, number>()
  const pending = new Map<string, { controller: AbortController; generation: number }>()
  return create<GraphState>((set, get) => {
    const patch = (key: string, changes: Partial<GraphView>) => { const view = get().views[key]; if (view) set({ views: { ...get().views, [key]: { ...view, ...changes } } }) }
    const cancel = (key: string) => {
      const active = pending.get(key)
      if (!active) return
      pending.delete(key); active.controller.abort()
      patch(key, { status: 'interrupted', busyNode: null, progress: null, error: '分析已中断。可手动继续，已完成的图谱仍保留。' })
    }
    const run = async (key: string, node?: string) => {
      const view = get().views[key], token = credential
      if (!view || !token || pending.has(key)) return
      const target = canonical(node ?? view.root)
      if (node && (!view.graph?.nodes.some(n => n.id === target && n.depth < MAX_GRAPH_DEPTH) || target === view.graph.root || view.graph.nodes.length >= MAX_GRAPH_NODES || view.expanded.includes(target))) return
      const controller = new AbortController(), request = { controller, generation }
      pending.set(key, request)
      const current = () => pending.get(key) === request && generation === request.generation && credential === token
      patch(key, { status: 'loading', busyNode: target, error: null, progress: null })
      try {
        const result = await analyzer(target, { token, signal: controller.signal, onProgress: progress => { if (current()) patch(key, { progress }) } })
        if (!current()) return
        const latest = get().views[key]
        if (!node && latest.graph && result.incomplete) {
          patch(key, { status: 'error', busyNode: null, error: `本次分析覆盖不完整，已保留之前的图谱。${result.warnings.join('；')}` })
          return
        }
        const graph = mergeGraph(node ? latest.graph : null, result)
        const expanded = node ? result.incomplete ? latest.expanded : [...new Set([...latest.expanded, target])] : []
        const partialNotice = result.incomplete ? `${node ? '本次追溯获得部分结果，可再次继续追溯。' : '本次分析获得部分结果。'}${result.warnings.join('；')}` : null
        patch(key, { graph, expanded, selected: node ? latest.selected : canonical(result.root), camera: node ? latest.camera : null, status: 'ready', busyNode: null, error: partialNotice })
        // Share public analysis/expansions; each mode retains its own view controls.
        for (const [otherKey, other] of Object.entries(get().views)) if (otherKey !== key && canonical(other.root) === canonical(latest.root)) patch(otherKey, { graph, expanded, selected: graph.nodes.some(n => n.id === other.selected) ? other.selected : graph.root, ...(!pending.has(otherKey) ? { status: 'ready', error: partialNotice } : {}) })
      } catch (err) {
        if (!current()) return
        patch(key, { status: controller.signal.aborted ? 'interrupted' : 'error', busyNode: null, error: err instanceof Error ? err.message : String(err) })
      } finally { if (pending.get(key) === request) pending.delete(key) }
    }
    return {
      views: {}, lastStandalone: null, scopeVersion: 0,
      setScope(account, token) {
        if (scope === account && credential === token) return
        get().reset(); scope = account; credential = token
      },
      open(mode, input) {
        const root = input ? parseRepoInput(input) : mode === 'standalone' ? get().lastStandalone : null
        if (!root) return null
        const normalized = canonical(root), key = graphKey(mode, normalized)
        usage.set(normalized, ++clock)
        if (!get().views[key]) {
          const shared = Object.values(get().views).find(view => canonical(view.root) === normalized && view.graph)
          set({ views: { ...get().views, [key]: { ...initialView(root), ...(shared ? { graph: shared.graph, expanded: shared.expanded, status: 'ready' as const } : {}) } } })
        }
        if (mode === 'standalone') set({ lastStandalone: normalized })
        const roots = [...new Set(Object.values(get().views).map(v => canonical(v.root)))]
        while (roots.length > MAX_GRAPH_ROOTS) {
          const victim = roots.filter(r => r !== normalized && r !== get().lastStandalone).sort((a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0))[0]
          if (!victim) break
          const views = { ...get().views }
          for (const k of Object.keys(views)) if (canonical(views[k].root) === victim) { cancel(k); delete views[k]; leases.delete(k) }
          usage.delete(victim); roots.splice(roots.indexOf(victim), 1); set({ views })
        }
        return key
      },
      retain(key) { leases.set(key, (leases.get(key) ?? 0) + 1) },
      release(key) {
        leases.set(key, Math.max(0, (leases.get(key) ?? 1) - 1))
        // React StrictMode immediately acquires again; only a real departure aborts.
        queueMicrotask(() => { if (!leases.get(key)) cancel(key) })
      },
      async ensure(key) { if (get().views[key]?.status === 'idle') await run(key) },
      async reanalyze(key) { cancel(key); await run(key) },
      async expand(key, node) { await run(key, node) },
      cancel,
      updateView(key, changes) { patch(key, changes) },
      reset() {
        generation++
        for (const request of pending.values()) request.controller.abort()
        pending.clear(); leases.clear(); usage.clear(); set({ views: {}, lastStandalone: null, scopeVersion: generation })
      },
    }
  })
}
export const useGraph = createGraphStore()
