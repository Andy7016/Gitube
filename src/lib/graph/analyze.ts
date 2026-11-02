import { extractCodeowners, extractDependencies, extractReadme, parseRepoInput, sortReferences } from './extract'
import type { GraphReference, PersonReference } from './extract'
import { compareGraphNodes, normalizedTopics, relationFromEvidence, topicOverlap } from './relations'
import type { AnalyzeGraphOptions, GraphEvidence, GraphNode, GraphPerson, GraphProgress, GraphRepo, GraphResult } from './types'

const API = 'https://api.github.com'
export const GRAPH_LIMITS: GraphResult['limits'] = Object.freeze({ references: 12, people: 2, reposPerPerson: 30, requests: 48, concurrency: 3, requestTimeoutMs: 20_000, totalTimeoutMs: 90_000 })
const MAX_BODY_BYTES = 2_000_000
const MAX_SOURCE_BYTES = 512_000
const REPOSITORY_QUERY = `query GraphRepository($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner isPrivate description stargazerCount isFork isArchived
    primaryLanguage { name }
    repositoryTopics(first: 100) { nodes { topic { name } } }
    owner { login avatarUrl __typename }
    defaultBranchRef { name }
  }
}`

export class GraphAnalysisError extends Error {
  constructor(public kind: 'auth' | 'rate' | 'network' | 'not_found' | 'timeout' | 'cancelled' | 'budget' | 'invalid' | 'other', message: string) {
    super(message)
    this.name = 'GraphAnalysisError'
  }
}

/** Injectable network/clock ports support deterministic tests without a GitHub account. */
export interface GraphPorts {
  fetch: typeof fetch
  now: () => number
  limits?: Partial<GraphResult['limits']>
}
type Json = Record<string, unknown>
const object = (value: unknown): Json | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

/** Trust API metadata, never a README's claimed URL or an unverified repository name. */
function publicRepo(value: unknown): { repo: GraphRepo; ownerType: string; owner: string; fork: boolean; archived: boolean } | null {
  const data = object(value)
  const owner = object(data?.owner)
  if (!data || data.private !== false || (data.visibility !== undefined && data.visibility !== 'public')) return null
  const id = parseRepoInput(string(data.full_name))
  if (!id) return null
  const fullName = string(data.full_name)
  return {
    repo: { id, nameWithOwner: fullName, description: typeof data.description === 'string' ? data.description.slice(0, 1000) : null, url: `https://github.com/${fullName}`, stars: typeof data.stargazers_count === 'number' && Number.isFinite(data.stargazers_count) ? Math.max(0, data.stargazers_count) : 0, language: typeof data.language === 'string' ? data.language.slice(0, 100) : null, topics: normalizedTopics(data.topics), avatarUrl: safeAvatar(string(owner?.avatar_url)) },
    ownerType: string(owner?.type), owner: string(owner?.login), fork: data.fork === true, archived: data.archived === true,
  }
}

function safeAvatar(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com' && !url.username && !url.password && !url.port ? url.href : ''
  } catch { return '' }
}

function graphQlRepository(value: unknown): unknown | null {
  const repository = object(object(object(value)?.data)?.repository)
  if (!repository) return null
  const owner = object(repository.owner)
  const topics = object(repository.repositoryTopics)?.nodes
  return {
    full_name: repository.nameWithOwner, private: repository.isPrivate,
    description: repository.description, stargazers_count: repository.stargazerCount,
    language: object(repository.primaryLanguage)?.name ?? null,
    topics: Array.isArray(topics) ? topics.map((entry) => object(object(entry)?.topic)?.name) : [],
    fork: repository.isFork, archived: repository.isArchived,
    owner: { login: owner?.login, avatar_url: owner?.avatarUrl, type: owner?.__typename },
    default_branch: object(repository.defaultBranchRef)?.name ?? 'HEAD',
  }
}

function sourceUrl(root: string, path: string, branch: string): string {
  return `https://github.com/${root}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

function decodeSource(value: unknown): { content: string; path: string } | null {
  const data = object(value)
  if (!data || data.encoding !== 'base64' || typeof data.content !== 'string' || data.content.length > MAX_SOURCE_BYTES * 1.4 || (typeof data.size === 'number' && data.size > MAX_SOURCE_BYTES)) return null
  let binary: string
  try { binary = atob(data.content.replace(/\s/g, '')) } catch { return null }
  if (binary.length > MAX_SOURCE_BYTES) return null
  const content = new TextDecoder().decode(Uint8Array.from(binary, (x) => x.charCodeAt(0)))
  return { content, path: string(data.path) }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new GraphAnalysisError('other', 'GitHub 返回的数据过大，已跳过此来源。')
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BODY_BYTES) throw new GraphAnalysisError('other', 'GitHub 返回的数据过大，已跳过此来源。')
      chunks.push(chunk.value)
    }
    const merged = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder().decode(merged)) as unknown } catch { throw new GraphAnalysisError('other', 'GitHub 返回了无法读取的数据。') }
  } finally { await reader.cancel().catch(() => undefined) }
}

class Requests {
  count = 0
  private active = 0
  private queue: (() => void)[] = []
  private controller = new AbortController()
  private totalTimer: ReturnType<typeof setTimeout>
  private fatal: GraphAnalysisError | null = null
  private onExternalAbort: () => void
  private deadline: number

  constructor(private ports: GraphPorts, private token: string, private external: AbortSignal | undefined, readonly limits: GraphResult['limits']) {
    this.deadline = ports.now() + limits.totalTimeoutMs
    this.onExternalAbort = () => this.stop(new GraphAnalysisError('cancelled', '图谱分析已取消。'))
    external?.addEventListener('abort', this.onExternalAbort, { once: true })
    this.totalTimer = setTimeout(() => this.stop(new GraphAnalysisError('timeout', '图谱分析已到 90 秒期限，已保留取得的数据。')), limits.totalTimeoutMs)
    if (external?.aborted) this.onExternalAbort()
  }
  get stopped() { return this.fatal }
  stop(error: GraphAnalysisError) {
    if (!this.fatal || error.kind === 'auth' || error.kind === 'cancelled') this.fatal = error
    this.controller.abort()
    while (this.queue.length) this.queue.shift()!()
  }
  close() {
    clearTimeout(this.totalTimer)
    this.external?.removeEventListener('abort', this.onExternalAbort)
  }
  async request(path: string, body?: string): Promise<unknown | null> {
    // Paths are built only by this module; guarding them also protects injected callers.
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new GraphAnalysisError('invalid', '无效的 GitHub API 路径。')
    if (body !== undefined && path !== '/graphql') throw new GraphAnalysisError('invalid', '无效的 GitHub API 请求。')
    if (this.active >= this.limits.concurrency) await new Promise<void>((resolve) => this.queue.push(resolve))
    if (this.fatal) throw this.fatal
    if (this.ports.now() >= this.deadline) { this.stop(new GraphAnalysisError('timeout', '图谱分析达到时间上限，已保留取得的数据。')); throw this.fatal }
    if (this.count >= this.limits.requests) { this.stop(new GraphAnalysisError('budget', '达到本次请求上限，已保留取得的数据。')); throw this.fatal }
    this.active++; this.count++
    const controller = new AbortController()
    let timedOut = false
    const abort = () => controller.abort()
    this.controller.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.limits.requestTimeoutMs)
    try {
      const response = await this.ports.fetch(API + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body }), signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' })
      if (this.fatal) throw this.fatal
      if (response.status === 404) return null
      if (response.status === 401) {
        const error = new GraphAnalysisError('auth', 'GitHub Token 无效或已过期，请重新登录后再分析图谱。')
        this.stop(error); throw error
      }
      if (response.status === 403 || response.status === 429) {
        const body = object(await boundedJson(response).catch(() => null))
        if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || /rate limit|abuse|secondary rate/i.test(string(body?.message))) {
          const reset = Number(response.headers.get('x-ratelimit-reset'))
          const retry = Number(response.headers.get('retry-after'))
          const at = reset > 0 ? new Date(reset * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null
          const error = new GraphAnalysisError('rate', `GitHub 接口限流${at ? `，${at} 后再试` : retry > 0 ? `，${retry} 秒后再试` : '，请稍后重试'}；已有图谱已保留。`)
          this.stop(error); throw error
        }
        throw new GraphAnalysisError('other', 'GitHub 拒绝读取公开数据，请检查 Token 的仓库读取权限后重试。')
      }
      if (!response.ok) throw new GraphAnalysisError('other', `GitHub 暂时无法读取此来源（HTTP ${response.status}）。`)
      const data = await boundedJson(response)
      if (path === '/graphql') {
        const errors = object(data)?.errors
        if (Array.isArray(errors) && errors.length) {
          if (errors.some((entry) => /RATE_LIMITED|rate limit|secondary rate/i.test(`${string(object(entry)?.type)} ${string(object(object(entry)?.extensions)?.type)} ${string(object(entry)?.message)}`))) {
            const error = new GraphAnalysisError('rate', 'GitHub GraphQL 接口限流，请稍后重试；已有图谱已保留。')
            this.stop(error); throw error
          }
          if (!object(object(data)?.data)?.repository) throw new GraphAnalysisError('other', 'GitHub 未能通过固定 GraphQL 接口验证此仓库。')
        }
      }
      return data
    } catch (error) {
      if (this.fatal) throw this.fatal
      if (timedOut) throw new GraphAnalysisError('timeout', '单个 GitHub 请求超过 20 秒，已跳过此来源。')
      if (isAbort(error)) throw new GraphAnalysisError('cancelled', '图谱分析已取消。')
      if (error instanceof GraphAnalysisError) throw error
      throw new GraphAnalysisError('network', '连不上 GitHub，请检查网络或代理后重试。')
    } finally {
      clearTimeout(timer)
      this.controller.signal.removeEventListener('abort', abort)
      this.active--
      this.queue.shift()?.()
    }
  }
}

/** Each run captures its own token and cancellation scope; it never consults mutable login state. */
export function createGraphAnalyzer(ports: GraphPorts) {
  return async function analyzeGraph(input: string, options: AnalyzeGraphOptions): Promise<GraphResult> {
    const requestedRoot = parseRepoInput(input)
    if (!requestedRoot) throw new GraphAnalysisError('invalid', '请输入有效的 owner/repo 或 GitHub 仓库网址。')
    if (!options.token.trim()) throw new GraphAnalysisError('auth', '请先登录 GitHub，再分析图谱。')
    const limits = { ...GRAPH_LIMITS, ...ports.limits }
    // A test port may lower limits, but never expand the production safety envelope.
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) limits[key] = Math.max(1, Math.min(GRAPH_LIMITS[key], Math.floor(limits[key])))
    const requests = new Requests(ports, options.token, options.signal, limits)
    const warnings = new Set<string>()
    let incomplete = false
    const failedSource = (message: string) => { incomplete = true; warnings.add(message) }
    const emit = (phase: GraphProgress['phase'], progress: number, message: string) => {
      if (!options.signal?.aborted) options.onProgress?.({ phase, progress, message, requests: requests.count, requestLimit: limits.requests })
    }
    const read = async (path: string, label: string): Promise<unknown | null> => {
      try { return await requests.request(path) } catch (error) {
        if (error instanceof GraphAnalysisError && ['auth', 'cancelled'].includes(error.kind)) throw error
        failedSource(`${label}：${error instanceof Error ? error.message : '无法读取。'}`)
        return null
      }
    }
    const metadata = async (id: string): Promise<unknown | null> => {
      try { return await requests.request(`/repos/${id}`) } catch (error) {
        // Browsers cannot safely inspect a REST redirect's Location header. A
        // fixed-origin GraphQL lookup resolves renamed repositories without
        // forwarding credentials to a response-supplied URL.
        if (!(error instanceof GraphAnalysisError) || error.kind !== 'network') throw error
        const [owner, name] = id.split('/')
        return graphQlRepository(await requests.request('/graphql', JSON.stringify({ query: REPOSITORY_QUERY, variables: { owner, name } })))
      }
    }
    const counts: GraphResult['counts'] = { referencesFound: 0, referencesResolved: 0, peopleFound: 0, peopleScanned: 0, candidatesScanned: 0, requests: 0 }
    try {
      emit('repository', 5, '正在验证公开仓库')
      const rootData = await metadata(requestedRoot)
      if (!rootData) throw new GraphAnalysisError('not_found', '找不到这个公开仓库，请检查地址及访问权限。')
      const rootMetadata = publicRepo(rootData)
      if (!rootMetadata) throw new GraphAnalysisError('not_found', '图谱仅支持经 GitHub 验证的公开仓库。')
      const rootRepo = rootMetadata.repo
      const root = rootRepo.id
      const branch = string(object(rootData)?.default_branch) || 'HEAD'
      const rootApi = `/repos/${root}`
      const nodes = new Map<string, GraphNode>([[root, { id: root, repo: rootRepo, tier: 0, overlap: { score: 1, shared: rootRepo.topics, method: rootRepo.topics.length ? 'topics' : 'none' }, evidence: [] }]])
      const edges: GraphResult['edges'] = []
      const references = new Map<string, GraphReference>()
      const people = new Map<string, GraphPerson>()
      const addReferences = (items: GraphReference[]) => items.forEach((item) => {
        if (!references.has(item.id)) references.set(item.id, { ...item, evidence: [] })
        references.get(item.id)!.evidence.push(...item.evidence)
      })
      const addPerson = (item: PersonReference, avatarUrl = '', contributions: number | null = null) => {
        const key = item.login.toLowerCase()
        if (!/^[a-zA-Z0-9-]{1,39}$/.test(item.login) || /(?:-bot|\[bot\])$/i.test(item.login)) return
        const roles = item.evidence.map((e) => e.kind).filter((kind): kind is GraphPerson['roles'][number] => ['contributor', 'codeowner', 'readme-maintainer', 'owner'].includes(kind))
        if (!people.has(key)) people.set(key, { login: item.login, avatarUrl, url: `https://github.com/${item.login}`, roles: [], contributions, evidence: [] })
        const person = people.get(key)!
        person.roles = [...new Set([...person.roles, ...roles])]
        person.evidence.push(...item.evidence)
        if (avatarUrl) person.avatarUrl = avatarUrl
        if (contributions !== null) person.contributions = contributions
      }
      const personEvidence = (kind: 'owner' | 'contributor', login: string): GraphEvidence => ({ kind, person: login, url: kind === 'owner' ? rootRepo.url : `${rootRepo.url}/graphs/contributors`, label: kind === 'owner' ? '个人仓库所有者' : '公开贡献者', relation: 'related', relationReason: '共同开发人员提供关联线索，不声明技术流向。' })
      if (rootMetadata.ownerType === 'User') addPerson({ login: rootMetadata.owner, evidence: [personEvidence('owner', rootMetadata.owner)] }, rootRepo.avatarUrl)
      emit('references', 15, '正在读取 README、依赖清单和代码负责人')
      const dependencyPaths = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml']
      const codeowners = async () => {
        for (const path of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
          let data: unknown | null
          try { data = await requests.request(`${rootApi}/contents/${path}`) } catch (error) {
            if (error instanceof GraphAnalysisError && ['auth', 'cancelled'].includes(error.kind)) throw error
            failedSource(`${path}：${error instanceof Error ? error.message : '无法读取。'} 未改用优先级更低的 CODEOWNERS。`)
            break
          }
          if (data === null) continue // Only a confirmed 404 permits the next priority.
          const source = decodeSource(data)
          if (source) extractCodeowners(source.content, sourceUrl(root, path, branch), path).forEach((person) => addPerson(person))
          else failedSource(`${path} 过大或格式不受支持，已跳过。`)
          break // GitHub priority: the first existing file is authoritative.
        }
      }
      const sources = await Promise.all([
        read(`${rootApi}/readme`, 'README'),
        ...dependencyPaths.map((path) => read(`${rootApi}/contents/${path}`, path)),
        read(`${rootApi}/contributors?per_page=30`, '贡献者'),
        codeowners(),
      ])
      if (sources[0]) {
        const readme = decodeSource(sources[0])
        if (readme) {
          const path = readme.path || 'README.md'
          const found = extractReadme(readme.content, root, sourceUrl(root, path, branch), path)
          addReferences(found.references); found.people.forEach((person) => addPerson(person))
        } else failedSource('README 过大或格式不受支持，已跳过；正文上限为 512 KB。')
      } else if (!requests.stopped) failedSource('未取得 README，图谱仅使用其他公开来源。')
      dependencyPaths.forEach((path, i) => {
        if (!sources[i + 1]) return
        const file = decodeSource(sources[i + 1])
        if (file) addReferences(extractDependencies(path, file.content, sourceUrl(root, path, branch), root))
        else failedSource(`${path} 过大或格式不受支持，已跳过。`)
      })
      const contributors = Array.isArray(sources[5]) ? sources[5].slice(0, 30) : []
      if (!Array.isArray(sources[5]) && !requests.stopped) failedSource('未取得公开贡献者列表，人员覆盖不完整。')
      contributors.forEach((value) => {
        const contributor = object(value)
        if (contributor?.type !== 'User') return
        const login = string(contributor.login)
        addPerson({ login, evidence: [personEvidence('contributor', login)] }, safeAvatar(string(contributor.avatar_url)), typeof contributor.contributions === 'number' ? contributor.contributions : null)
      })
      counts.referencesFound = references.size
      if (references.size > limits.references) warnings.add(`发现 ${references.size} 个直接引用，本次按来源优先级验证前 ${limits.references} 个。`)
      const targets = sortReferences([...references.values()]).slice(0, limits.references)
      emit('references', 40, `正在验证 ${targets.length} 个直接引用`)
      await Promise.all(targets.map(async (target) => {
        let data: unknown | null
        try { data = await metadata(target.id) } catch (error) {
          if (error instanceof GraphAnalysisError && ['auth', 'cancelled'].includes(error.kind)) throw error
          failedSource(`引用 ${target.fullName}：${error instanceof Error ? error.message : '无法读取。'}`)
          return
        }
        const targetMetadata = publicRepo(data)
        if (!targetMetadata) { if (!requests.stopped) failedSource(`引用 ${target.fullName} 未能验证为可访问的公开仓库。`); return }
        const id = targetMetadata.repo.id
        if (id === root) return
        counts.referencesResolved++
        const prior = nodes.get(id)
        if (prior) prior.evidence.push(...target.evidence)
        else nodes.set(id, { id, repo: targetMetadata.repo, tier: 1, overlap: topicOverlap(rootRepo, targetMetadata.repo), evidence: [...target.evidence] })
        const edge = edges.find((item) => item.source === root && item.target === id)
        if (edge) { edge.evidence.push(...target.evidence); edge.relation = relationFromEvidence(edge.evidence) }
        else edges.push({ source: root, target: id, kind: 'direct', relation: relationFromEvidence(target.evidence), evidence: [...target.evidence] })
      }))
      counts.peopleFound = people.size
      const roleRank = (person: GraphPerson) => person.roles.includes('owner') ? 0 : person.roles.includes('codeowner') ? 1 : person.roles.includes('readme-maintainer') ? 2 : 3
      const orderedPeople = [...people.values()].sort((a, b) => roleRank(a) - roleRank(b) || (b.contributions ?? 0) - (a.contributions ?? 0) || a.login.localeCompare(b.login, 'en'))
      const selectedPeople = orderedPeople.slice(0, limits.people)
      if (people.size > limits.people) warnings.add(`保留 ${people.size} 位人员线索，本次仅扫描前 ${limits.people} 位的公开自有仓库，每人最多 ${limits.reposPerPerson} 个。`)
      emit('people', 65, `正在验证 ${selectedPeople.length} 位关联人员`)
      await Promise.all(selectedPeople.map(async (person) => {
        const profile = object(await read(`/users/${encodeURIComponent(person.login)}`, `人员 ${person.login}`))
        if (!profile || profile.type !== 'User' || string(profile.login).toLowerCase() !== person.login.toLowerCase()) {
          if (!requests.stopped) failedSource(`未将 ${person.login} 验证为公开个人账号，未扫描其仓库。`)
          return
        }
        person.avatarUrl = safeAvatar(string(profile.avatar_url))
        const repos = await read(`/users/${encodeURIComponent(person.login)}/repos?type=owner&sort=updated&per_page=${limits.reposPerPerson}`, `${person.login} 的仓库`)
        if (!Array.isArray(repos)) { if (!requests.stopped) failedSource(`未取得 ${person.login} 的公开自有仓库列表。`); return }
        counts.peopleScanned++
        counts.candidatesScanned += Math.min(limits.reposPerPerson, repos.length)
        emit('related', 80, '正在比较公开自有仓库的主题重合度')
        for (const candidate of repos.slice(0, limits.reposPerPerson)) {
          const metadata = publicRepo(candidate)
          if (!metadata || metadata.fork || metadata.archived || metadata.repo.id === root || metadata.owner.toLowerCase() !== person.login.toLowerCase()) continue
          const overlap = topicOverlap(rootRepo, metadata.repo)
          if (!(overlap.score > 0 || overlap.method === 'language-fallback')) continue
          const evidence = person.evidence.map((item): GraphEvidence => ({ ...item, relation: 'related', relationReason: overlap.method === 'language-fallback' ? '同一开发人员的公开自有项目；中心无主题，按相同主要语言回退。' : '同一开发人员的公开自有项目，至少具有一个相同主题。', targetUrl: metadata.repo.url }))
          const existing = nodes.get(metadata.repo.id)
          if (existing) existing.evidence.push(...evidence)
          else nodes.set(metadata.repo.id, { id: metadata.repo.id, repo: metadata.repo, tier: 2, overlap, evidence })
          const edge = edges.find((item) => item.source === root && item.target === metadata.repo.id)
          if (edge) { edge.evidence.push(...evidence); edge.relation = relationFromEvidence(edge.evidence) }
          else edges.push({ source: root, target: metadata.repo.id, kind: 'related', relation: 'related', evidence })
        }
      }))
      if (requests.stopped) failedSource(requests.stopped.message)
      if (requests.stopped?.kind === 'auth' || requests.stopped?.kind === 'cancelled') throw requests.stopped
      counts.requests = requests.count
      const result: GraphResult = { version: 1, semanticsVersion: 2, root, generatedAt: new Date(ports.now()).toISOString(), nodes: [...nodes.values()].sort(compareGraphNodes), edges: edges.sort((a, b) => a.target.localeCompare(b.target, 'en')), people: orderedPeople, warnings: [...warnings], incomplete, counts, limits }
      emit('done', 100, warnings.size ? '分析完成，部分来源未覆盖' : '一级图谱分析完成')
      return result
    } finally { requests.close() }
  }
}

export const analyzeGraph = createGraphAnalyzer({ fetch: (...args) => fetch(...args), now: () => Date.now() })
