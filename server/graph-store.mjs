import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { repositoryFromUrl, validRepository } from './graph-extract.mjs'
import { GRAPH_SEMANTICS_VERSION, relationFromEvidence } from '../shared/graph-relations.mjs'

const evidenceKinds = new Set(['credit', 'citation', 'dependency', 'copyright', 'readme-reference', 'readme-related', 'contributor', 'codeowner', 'readme-maintainer', 'owner'])
const relations = new Set(['upstream', 'downstream', 'related', 'reference', 'ambiguous'])
const roles = new Set(['contributor', 'codeowner', 'readme-maintainer', 'owner'])
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0
const string = (value, maximum = 500) => typeof value === 'string' ? value.slice(0, maximum) : ''
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : ''
function url(value, hosts) {
  if (typeof value !== 'string' || value.length > 2000) return ''
  try {
    const parsed = new URL(value)
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && (!hosts || (parsed.protocol === 'https:' && hosts.includes(parsed.hostname))) ? value : ''
  } catch { return '' }
}
function fullName(value) {
  if (typeof value !== 'string') return null
  const parts = value.split('/')
  return parts.length === 2 && validRepository(...parts) ? value.toLowerCase() : null
}
function targetUrl(value) {
  const target = repositoryFromUrl(value)
  return target && value === `https://github.com/${target.fullName}` ? value : ''
}
function evidence(items) {
  return (Array.isArray(items) ? items : []).filter((item) => evidenceKinds.has(item?.kind) && typeof item.url === 'string').slice(0, 100).map((item) => ({
    kind: item.kind, url: url(item.url, ['github.com', 'api.github.com']), label: string(item.label, 200),
    ...(typeof item.excerpt === 'string' ? { excerpt: string(item.excerpt, 180) } : {}),
    ...(typeof item.person === 'string' ? { person: string(item.person, 39) } : {}),
    ...(relations.has(item.relation) ? { relation: item.relation } : {}),
    ...(typeof item.relationReason === 'string' ? { relationReason: string(item.relationReason, 200) } : {}),
    ...(targetUrl(item.targetUrl) ? { targetUrl: item.targetUrl } : {}),
  }))
}

// Rebuild the DTO rather than serializing arbitrary caller/upstream properties.
// In particular, viewer_starred, tokens, raw README and private metadata never persist.
export function publicGraphResult(value) {
  if (value?.version !== 1 || !fullName(value.root) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.people) || !Number.isFinite(Date.parse(value.generatedAt))) throw new TypeError('图谱缓存格式无效。')
  const nodes = value.nodes.slice(0, 425).map((node) => {
    if (!fullName(node?.repo?.full_name) || node.repo.private === true || !node.repo.owner || ![0, 1, 2].includes(node.tier)) throw new TypeError('图谱缓存仅支持公开仓库。')
    const source = node.repo
    const repo = {
      id: count(source.id), name: string(source.name, 100) || source.full_name.split('/')[1], full_name: source.full_name,
      description: string(source.description, 2000), html_url: `https://github.com/${source.full_name}`,
      owner: { login: source.full_name.split('/')[0], avatar_url: url(source.owner.avatar_url, ['avatars.githubusercontent.com', 'github.com']) },
      stargazers_count: count(source.stargazers_count), forks_count: count(source.forks_count),
      language: typeof source.language === 'string' ? string(source.language, 100) : null,
      topics: (Array.isArray(source.topics) ? source.topics : []).filter((topic) => typeof topic === 'string').slice(0, 100),
      updated_at: date(source.pushed_at) || date(source.updated_at),
      license: typeof source.license?.spdx_id === 'string' ? { spdx_id: string(source.license.spdx_id, 100) } : null,
      homepage: url(source.homepage), open_issues_count: count(source.open_issues_count),
      created_at: date(source.created_at) || date(source.updated_at),
      cover_url: url(source.cover_url, ['opengraph.githubassets.com']) || `https://opengraph.githubassets.com/${source.full_name.split('/').map(encodeURIComponent).join('/')}`,
    }
    return { id: fullName(repo.full_name), repo, tier: node.tier, overlap: {
      score: Number.isFinite(node.overlap?.score) ? Math.max(0, Math.min(1, node.overlap.score)) : 0,
      shared: (Array.isArray(node.overlap?.shared) ? node.overlap.shared : []).filter((topic) => typeof topic === 'string').slice(0, 100),
      method: ['topics', 'language-fallback', 'none'].includes(node.overlap?.method) ? node.overlap.method : 'none',
    }, evidence: evidence(node.evidence) }
  })
  const ids = new Set(nodes.map((node) => node.id))
  if (!ids.has(value.root.toLowerCase())) throw new TypeError('图谱缓存缺少中心项目。')
  return {
    version: 1, ...(value.semanticsVersion === GRAPH_SEMANTICS_VERSION ? { semanticsVersion: GRAPH_SEMANTICS_VERSION } : {}), root: value.root.toLowerCase(), generatedAt: new Date(value.generatedAt).toISOString(), nodes,
    edges: value.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && ['direct', 'related'].includes(edge.kind)).slice(0, 425).map((edge) => {
      const items = evidence(edge.evidence)
      return { source: edge.source, target: edge.target, kind: edge.kind, relation: relationFromEvidence(items), evidence: items }
    }),
    people: value.people.filter((person) => /^[a-zA-Z0-9-]{1,39}$/.test(person?.login)).slice(0, 128).map((person) => ({
      login: person.login, avatar_url: url(person.avatar_url, ['avatars.githubusercontent.com', 'github.com']), html_url: `https://github.com/${person.login}`,
      roles: [...new Set((Array.isArray(person.roles) ? person.roles : []).filter((role) => roles.has(role)))],
      contributions: person.contributions == null ? null : count(person.contributions), evidence: evidence(person.evidence),
    })),
    warnings: (Array.isArray(value.warnings) ? value.warnings : []).filter((item) => typeof item === 'string').slice(0, 100).map((item) => string(item, 500)),
    counts: Object.fromEntries(['referencesFound', 'referencesResolved', 'peopleFound', 'peopleScanned', 'candidatesScanned'].map((key) => [key, count(value.counts?.[key])])),
    limits: Object.fromEntries(['references', 'people', 'reposPerPerson', 'requests'].map((key) => [key, count(value.limits?.[key])])),
  }
}

export function createGraphStore(root) {
  const directory = join(resolve(root), '.local')
  const path = join(directory, 'graph-cache.json')
  const entries = new Map()
  let loaded
  let writes = Promise.resolve()
  async function load() {
    loaded ??= (async () => {
      try {
        const document = JSON.parse(await readFile(path, 'utf8'))
        if (document?.version !== 1 || !Array.isArray(document.entries)) return
        for (const entry of document.entries.slice(-64)) {
          try {
            const result = publicGraphResult(entry.result)
            if (fullName(entry.key) === result.root) entries.set(result.root, result)
          } catch { /* Ignore an invalid persisted entry without exposing its content. */ }
        }
      } catch { /* A missing or damaged local cache is safe to rebuild. */ }
    })()
    await loaded
  }
  return {
    async get(name) {
      await load()
      const key = fullName(name)
      const value = entries.get(key)
      return value ? structuredClone(value) : undefined
    },
    async set(name, value) {
      const result = publicGraphResult(value)
      const key = fullName(name)
      if (key !== result.root) throw new TypeError('图谱缓存键与中心项目不一致。')
      const operation = writes.then(async () => {
        await load()
        entries.delete(key)
        entries.set(key, result)
        while (entries.size > 64) entries.delete(entries.keys().next().value)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const temporary = join(directory, `graph-cache.${randomUUID()}.tmp`)
        try {
          await writeFile(temporary, JSON.stringify({ version: 1, entries: [...entries].map(([entryKey, entryResult]) => ({ key: entryKey, result: entryResult })) }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
          await rename(temporary, path)
        } finally { await rm(temporary, { force: true }).catch(() => {}) }
      })
      writes = operation.catch(() => {})
      await operation
    },
  }
}
