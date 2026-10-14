export type GraphRelation = 'upstream' | 'downstream' | 'related' | 'reference' | 'ambiguous'
export type EvidenceKind = 'credit' | 'citation' | 'dependency' | 'copyright' | 'readme-reference' | 'readme-related' | 'contributor' | 'codeowner' | 'readme-maintainer' | 'owner'

export interface GraphEvidence {
  kind: EvidenceKind
  url: string
  label: string
  excerpt?: string
  person?: string
  relation: GraphRelation
  relationReason: string
  targetUrl?: string
  path?: string
  line?: number
}

/** Deliberately independent from feed DTOs and viewer-specific Star state. */
export interface GraphRepo {
  id: string
  nameWithOwner: string
  description: string | null
  url: string
  stars: number
  language: string | null
  topics: string[]
  avatarUrl: string
}

export interface GraphNode {
  id: string
  repo: GraphRepo
  tier: 0 | 1 | 2
  overlap: { score: number; shared: string[]; method: 'topics' | 'language-fallback' | 'none' }
  evidence: GraphEvidence[]
}

/** source/target describe discovery. Only upstream/downstream support technical arrows. */
export interface GraphEdge {
  source: string
  target: string
  kind: 'direct' | 'related'
  relation: GraphRelation
  evidence: GraphEvidence[]
}

export interface GraphPerson {
  login: string
  avatarUrl: string
  url: string
  roles: ('contributor' | 'codeowner' | 'readme-maintainer' | 'owner')[]
  contributions: number | null
  evidence: GraphEvidence[]
}

export interface GraphResult {
  version: 1
  semanticsVersion: 2
  root: string
  generatedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  people: GraphPerson[]
  warnings: string[]
  /** Operational coverage failed; sampling limits alone do not make a result incomplete. */
  incomplete: boolean
  counts: { referencesFound: number; referencesResolved: number; peopleFound: number; peopleScanned: number; candidatesScanned: number; requests: number }
  limits: { references: number; people: number; reposPerPerson: number; requests: number; concurrency: number; requestTimeoutMs: number; totalTimeoutMs: number }
}

export interface GraphProgress {
  phase: 'repository' | 'references' | 'people' | 'related' | 'done'
  progress: number
  message: string
  requests: number
  requestLimit: number
}

export interface AnalyzeGraphOptions {
  token: string
  signal?: AbortSignal
  onProgress?: (progress: GraphProgress) => void
}
