import type { GraphEvidence, GraphRelation, GraphRepo, GraphNode } from './types'

export function relationFromEvidence(items: GraphEvidence[]): GraphRelation {
  const found = new Set(items.map((item) => item.relation))
  if (found.has('ambiguous') || (found.has('upstream') && found.has('downstream'))) return 'ambiguous'
  if (found.has('upstream')) return 'upstream'
  if (found.has('downstream')) return 'downstream'
  return found.has('related') ? 'related' : 'reference'
}

export function normalizedTopics(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()).filter((x) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(x)))].sort()
}

export function topicOverlap(root: GraphRepo, candidate: GraphRepo): GraphNode['overlap'] {
  const a = normalizedTopics(root.topics)
  const b = normalizedTopics(candidate.topics)
  if (a.length) {
    const shared = a.filter((topic) => b.includes(topic))
    return { score: shared.length / new Set([...a, ...b]).size, shared, method: 'topics' }
  }
  if (root.language && candidate.language && root.language.toLowerCase() === candidate.language.toLowerCase()) return { score: 0, shared: [], method: 'language-fallback' }
  return { score: 0, shared: [], method: 'none' }
}

export function compareGraphNodes(a: GraphNode, b: GraphNode): number {
  return a.tier - b.tier || b.overlap.score - a.overlap.score || b.repo.stars - a.repo.stars || a.id.localeCompare(b.id, 'en')
}
