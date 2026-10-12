export type GraphRelation = 'upstream' | 'downstream' | 'related' | 'reference' | 'ambiguous';
export const GRAPH_SEMANTICS_VERSION: 2;
export function relationFromEvidence(items: readonly { kind?: string; relation?: string }[] | unknown): GraphRelation;
