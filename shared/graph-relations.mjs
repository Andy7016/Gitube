// Relation is relative to the analyzed repository, not the discovery traversal.
export const GRAPH_SEMANTICS_VERSION = 2
const relations = new Set(['upstream', 'downstream', 'related', 'reference', 'ambiguous'])
const peopleKinds = new Set(['contributor', 'codeowner', 'readme-maintainer', 'owner'])

export function relationFromEvidence(items) {
  const found = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue
    if (relations.has(item.relation)) found.add(item.relation)
    else if (item.kind === 'dependency') found.add('upstream')
    else if (peopleKinds.has(item.kind) || item.kind === 'readme-related') found.add('related')
    else found.add('reference')
  }
  if (found.has('ambiguous') || (found.has('upstream') && found.has('downstream'))) return 'ambiguous'
  if (found.has('upstream')) return 'upstream'
  if (found.has('downstream')) return 'downstream'
  return found.has('related') ? 'related' : 'reference'
}
