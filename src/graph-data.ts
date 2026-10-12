import type { Repo } from './data';
import { GRAPH_SEMANTICS_VERSION, relationFromEvidence, type GraphRelation } from '../shared/graph-relations.mjs';

export type EvidenceKind = 'credit' | 'citation' | 'copyright' | 'dependency' | 'readme-reference' | 'readme-related' | 'contributor' | 'codeowner' | 'readme-maintainer' | 'owner';
export interface GraphEvidence { kind: EvidenceKind; url: string; label: string; excerpt?: string; person?: string; relation?: GraphRelation; relationReason?: string; targetUrl?: string }
export interface GraphPerson { login: string; avatar_url: string; html_url: string; roles: ('contributor' | 'codeowner' | 'readme-maintainer' | 'owner')[]; contributions: number | null; evidence: GraphEvidence[] }
export interface GraphNode { id: string; repo: Repo; tier: 0 | 1 | 2; overlap: { score: number; shared: string[]; method: 'topics' | 'language-fallback' | 'none' }; evidence: GraphEvidence[] }
export interface GraphEdge { source: string; target: string; kind: 'direct' | 'related'; evidence: GraphEvidence[]; relation?: GraphRelation }
export interface GraphResult {
  version: 1; semanticsVersion?: 2; root: string; generatedAt: string; nodes: GraphNode[]; edges: GraphEdge[]; people: GraphPerson[]; warnings: string[];
  counts: { referencesFound: number; referencesResolved: number; peopleFound: number; peopleScanned: number; candidatesScanned: number };
  limits: { references: number; people: number; reposPerPerson: number; requests: number };
}
export interface GraphJob {
  id: string; rootFullName: string; status: 'queued' | 'running' | 'complete' | 'partial' | 'failed';
  phase: 'queued' | 'repository' | 'references' | 'people' | 'related' | 'ranking' | 'done';
  progress: number; message: string; requests: number; requestLimit: number; updatedAt: string; result: GraphResult | null; error: { code: string; message: string } | null;
}
export interface WorkspaceNode extends GraphNode { depth: number; overlapRoot: string }
export interface GraphWorkspace { root: string; semanticsVersion?: 2; nodes: WorkspaceNode[]; edges: GraphEdge[]; people: GraphPerson[]; warnings: string[]; generatedAt: string; analyses: { root: string; generatedAt: string; counts: GraphResult['counts']; limits: GraphResult['limits'] }[] }
export const MAX_GRAPH_NODES = 120, MAX_GRAPH_DEPTH = 5;
export const phaseLabels: Record<GraphJob['phase'], string> = { queued: '等待分析', repository: '读取仓库', references: '解析直接来源', people: '核实开发者', related: '寻找开发者关联项目', ranking: '计算重合度与排序', done: '分析结束' };
export const evidenceLabels: Record<EvidenceKind, string> = { credit: '致谢', citation: '引用', copyright: '版权来源', dependency: '明确依赖', 'readme-reference': 'README 提及', 'readme-related': 'README 相关项目', contributor: '贡献者', codeowner: 'CODEOWNERS', 'readme-maintainer': 'README 维护者', owner: '仓库所有者' };
export const canonicalId = (value: string) => value.toLowerCase();
export function parseRepository(value: string): { owner: string; name: string; fullName: string } | null {
  let text = value.trim();
  if (/^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(text)) { try { const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null; text = url.pathname.replace(/^\/+|\/+$/g, ''); } catch { return null; } }
  const parts = text.replace(/\.git$/i, '').replace(/\/$/, '').split('/');
  if (parts.length !== 2 || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(parts[0]) || !/^[\w.-]{1,100}$/.test(parts[1]) || ['.', '..'].includes(parts[1])) return null;
  return { owner: parts[0], name: parts[1], fullName: parts.join('/') };
}
export function graphPath(fullName?: string) { const parsed = fullName ? parseRepository(fullName) : null; return parsed ? `/graph/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}` : '/graph'; }
export function compareGraphNodes(a: GraphNode, b: GraphNode) { return b.overlap.score - a.overlap.score || b.repo.stargazers_count - a.repo.stargazers_count || a.repo.full_name.localeCompare(b.repo.full_name, 'en'); }
function mergeEvidence(a: GraphEvidence[], b: GraphEvidence[]) { const key = (item: GraphEvidence) => JSON.stringify([item.kind, item.url, item.person, item.label, item.excerpt, item.relation, item.relationReason, item.targetUrl]); const values = new Map(a.map(item => [key(item), item])); for (const item of b) values.set(key(item), item); return [...values.values()]; }
function wouldCycle(edges: GraphEdge[], source: string, target: string) { const queue = [target], visited = new Set<string>(); while (queue.length) { const node = queue.shift()!; if (node === source) return true; if (visited.has(node)) continue; visited.add(node); for (const edge of edges) if (edge.source === node) queue.push(edge.target); } return false; }
export function mergeGraph(previous: GraphWorkspace | null, result: GraphResult): GraphWorkspace {
  const root = previous?.root || canonicalId(result.root), center = canonicalId(result.root);
  const nodes = new Map((previous?.nodes || []).map(node => [node.id, { ...node }]));
  const depth = nodes.get(center)?.depth || 0, warnings = [...(previous?.warnings || []), ...result.warnings];
  const sorted = [...result.nodes].sort((a, b) => a.tier - b.tier || compareGraphNodes(a, b));
  for (const node of sorted) {
    const id = canonicalId(node.id), existing = nodes.get(id), nextDepth = id === root ? 0 : id === center ? depth : depth + 1;
    if (!existing && nextDepth > MAX_GRAPH_DEPTH) { warnings.push(`已达到 ${MAX_GRAPH_DEPTH} 层上限，未加入更深的节点。`); continue; }
    if (!existing && nodes.size >= MAX_GRAPH_NODES) { warnings.push(`已达到 ${MAX_GRAPH_NODES} 个节点上限，其余节点未加入。`); continue; }
    if (existing) { const useIncoming = id !== center && node.overlap.score > existing.overlap.score; nodes.set(id, { ...(useIncoming ? node : existing), id, tier: id === root ? 0 : Math.min(existing.tier || node.tier, node.tier || existing.tier) as 1 | 2, depth: Math.min(existing.depth, nextDepth), overlapRoot: useIncoming ? center : existing.overlapRoot, evidence: mergeEvidence(existing.evidence, node.evidence) }); }
    else nodes.set(id, { ...node, id, tier: id === root ? 0 : node.tier === 0 ? 1 : node.tier, depth: nextDepth, overlapRoot: center });
  }
  // source/target describe discovery traversal. Technical flow is evidence-derived
  // presentation and must never rewrite the paths used for depth or expansion.
  const edges = [...(previous?.edges || [])].map(edge => ({ ...edge, relation: relationFromEvidence(edge.evidence) }));
  for (const incoming of result.edges) {
    const source = canonicalId(incoming.source), target = canonicalId(incoming.target);
    if (source === target || !nodes.has(source) || !nodes.has(target)) continue;
    const duplicate = edges.find(edge => edge.source === source && edge.target === target);
    if (duplicate) { duplicate.evidence = mergeEvidence(duplicate.evidence, incoming.evidence); duplicate.relation = relationFromEvidence(duplicate.evidence); if (incoming.kind === 'direct') duplicate.kind = 'direct'; }
    else if (!wouldCycle(edges, source, target)) edges.push({ ...incoming, source, target, relation: relationFromEvidence(incoming.evidence) });
  }
  const people = new Map((previous?.people || []).map(person => [canonicalId(person.login), person]));
  for (const person of result.people) { const key = canonicalId(person.login), existing = people.get(key); people.set(key, existing ? { ...person, roles: [...new Set([...existing.roles, ...person.roles])], evidence: mergeEvidence(existing.evidence, person.evidence), contributions: person.contributions ?? existing.contributions } : person); }
  const analysis = { root: center, generatedAt: result.generatedAt, counts: result.counts, limits: result.limits };
  return { root, semanticsVersion: GRAPH_SEMANTICS_VERSION, nodes: [...nodes.values()], edges, people: [...people.values()], warnings: [...new Set(warnings)], generatedAt: result.generatedAt, analyses: [...(previous?.analyses || []).filter(item => item.root !== center), analysis] };
}
export interface GraphPosition { x: number; y: number; radius: number; parentId?: string }
export function graphNodeRadius(node: GraphNode): number {
  if (node.tier === 0) return 17;
  const score = node.overlap.method === 'topics' && Number.isFinite(node.overlap.score) ? Math.max(0, Math.min(1, node.overlap.score)) : 0;
  // Area, rather than radius, is proportional to genuine topic overlap.
  return Math.sqrt(7 ** 2 + (15 ** 2 - 7 ** 2) * score);
}

interface LayoutBranch { node: WorkspaceNode; kind: GraphEdge['kind'] }
interface SubtreeLayout { positions: Map<string, GraphPosition>; centerX: number; radius: number }
const NODE_SPACE = 42, BRANCH_GAP = 28;
const compareIds = (a: string, b: string) => a.localeCompare(b, 'en');
const compareStableNodes = (a: GraphNode, b: GraphNode) => compareGraphNodes(a, b) || compareIds(a.id, b.id);

export function layoutGraph(nodes: WorkspaceNode[], edges: GraphEdge[] = []): Map<string, GraphPosition> {
  if (!nodes.length) return new Map();
  const ordered = [...nodes].sort((a, b) => a.tier - b.tier || a.depth - b.depth || compareStableNodes(a, b));
  const root = ordered.find(node => node.tier === 0) || ordered.find(node => node.depth === 0) || ordered[0];
  const byId = new Map(ordered.map(node => [node.id, node]));
  const incoming = new Map<string, Map<string, GraphEdge['kind']>>();
  const outgoing = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    const sources = incoming.get(edge.target) || new Map<string, GraphEdge['kind']>();
    if (!sources.has(edge.source) || edge.kind === 'direct') sources.set(edge.source, edge.kind);
    incoming.set(edge.target, sources);
    const targets = outgoing.get(edge.source) || new Set<string>();
    targets.add(edge.target); outgoing.set(edge.source, targets);
  }

  // The shortest root-reachable route supplies structure. overlapRoot describes
  // a score comparison and may change after merging; it is never a parent link.
  const distances = new Map<string, number>([[root.id, 0]]), queue = [root.id];
  for (let index = 0; index < queue.length; index++) {
    const source = queue[index];
    for (const target of [...(outgoing.get(source) || [])].sort(compareIds)) {
      if (distances.has(target)) continue;
      distances.set(target, distances.get(source)! + 1); queue.push(target);
    }
  }
  const parents = new Map<string, string>();
  const children = new Map<string, LayoutBranch[]>();
  for (const node of ordered) {
    if (node.id === root.id) continue;
    const candidates = [...(incoming.get(node.id) || [])]
      .filter(([source]) => distances.has(source) && distances.get(source)! + 1 === distances.get(node.id))
      .sort(([a, aKind], [b, bKind]) => Number(aKind === 'related') - Number(bKind === 'related') || compareStableNodes(byId.get(a)!, byId.get(b)!));
    // Missing edges get a deterministic root-level slot, not an invented lineage.
    const [parentId, kind] = candidates[0] || [root.id, node.tier === 2 ? 'related' : 'direct'];
    parents.set(node.id, parentId);
    const branches = children.get(parentId) || [];
    branches.push({ node, kind }); children.set(parentId, branches);
  }
  for (const branches of children.values()) branches.sort((a, b) => Number(a.kind === 'related') - Number(b.kind === 'related') || compareStableNodes(a.node, b.node));

  const pack = (node: WorkspaceNode, isRoot: boolean): SubtreeLayout => {
    const parentId = parents.get(node.id);
    const positions = new Map<string, GraphPosition>([[node.id, { x: 0, y: 0, radius: graphNodeRadius(node), ...(parentId ? { parentId } : {}) }]]);
    const branches = children.get(node.id) || [];
    if (!branches.length) return { positions, centerX: 0, radius: NODE_SPACE };
    const packed = branches.map(branch => ({ ...branch, layout: pack(branch.node, false) }));
    const weight = packed.reduce((sum, branch) => sum + Math.sqrt(branch.layout.radius), 0);
    const sweep = isRoot ? Math.PI * 2 : Math.PI * 4 / 3;
    let cursor = isRoot ? -Math.PI / 2 : -sweep / 2;
    const counts = { direct: branches.filter(branch => branch.kind === 'direct').length, related: branches.filter(branch => branch.kind === 'related').length };
    const ranks = { direct: 0, related: 0 };
    const slots = packed.map(branch => {
      const width = sweep * Math.sqrt(branch.layout.radius) / weight;
      const angle = packed.length === 1 ? 0 : cursor + width / 2; cursor += width;
      const rank = ranks[branch.kind]++, fraction = rank / Math.max(1, counts[branch.kind] - 1);
      const distance = (isRoot ? branch.kind === 'direct' ? 150 : 330 : branch.kind === 'direct' ? 95 : 165) + fraction * (isRoot ? 110 : 65);
      // Expanded parents move out with their occupied subtree. An offset circle
      // keeps long single-child chains compact instead of doubling every level.
      const anchor = distance + Math.max(0, branch.layout.radius - branch.layout.centerX);
      return { ...branch, angle, anchor, centerDistance: anchor + branch.layout.centerX };
    });

    // Solve the extra radial distance needed for every pair of complete subtree
    // circles. This gives a strict sibling separation guarantee, including all
    // descendants, rather than relying on individual node repulsion.
    let extra = 0;
    for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
      const first = slots[a], second = slots[b], cosine = Math.cos(first.angle - second.angle);
      const aa = 2 * (1 - cosine), bb = (first.centerDistance + second.centerDistance) * aa;
      const minimum = first.layout.radius + second.layout.radius + BRANCH_GAP;
      const cc = (first.centerDistance - second.centerDistance) ** 2 + first.centerDistance * second.centerDistance * aa - minimum ** 2;
      if (cc < 0) extra = Math.max(extra, -2 * cc / (bb + Math.sqrt(bb ** 2 - 4 * aa * cc)));
    }
    const circles: { x: number; y: number; radius: number }[] = [];
    let minX = -NODE_SPACE, maxX = NODE_SPACE;
    for (const slot of slots) {
      const cosine = Math.cos(slot.angle), sine = Math.sin(slot.angle), distance = slot.anchor + extra;
      for (const [id, point] of slot.layout.positions) positions.set(id, { ...point, x: cosine * (point.x + distance) - sine * point.y, y: sine * (point.x + distance) + cosine * point.y });
      const center = slot.centerDistance + extra, circle = { x: cosine * center, y: sine * center, radius: slot.layout.radius };
      circles.push(circle); minX = Math.min(minX, circle.x - circle.radius); maxX = Math.max(maxX, circle.x + circle.radius);
    }
    let centerX = (minX + maxX) / 2;
    const radius = Math.max(NODE_SPACE + Math.abs(centerX), ...circles.map(circle => Math.hypot(circle.x - centerX, circle.y) + circle.radius));
    // All enclosing circles have y=0, so the parent can rotate each complete
    // branch toward its own slot without recomputing descendant geometry.
    if (centerX < 0) { centerX = -centerX; for (const point of positions.values()) point.x = -point.x; }
    return { positions, centerX, radius };
  };
  return pack(root, true).positions;
}
export function graphTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知'; }
