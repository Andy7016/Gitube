import { randomUUID } from 'node:crypto'
import { ApiError, normalizeRepo } from './github.mjs'
import { compareGraphNodes, extractCodeowners, extractDependencies, extractReadme, topicOverlap, validRepository } from './graph-extract.mjs'
import { publicGraphResult } from './graph-store.mjs'
import { GRAPH_SEMANTICS_VERSION, relationFromEvidence } from '../shared/graph-relations.mjs'

const defaults = { requests: 40, deadlineMs: 90000, cacheWriteMs: 2000, concurrency: 2, queue: 16, sessionActive: 3, references: 24, people: 4, reposPerPerson: 100, cacheTtlMs: 86400000, partialTtlMs: 300000, refreshMs: 30000, jobTtlMs: 1800000, maxJobs: 128 }
const terminal = (job) => ['complete', 'partial', 'failed'].includes(job.status)
const unauthorized = (error) => error?.status === 401 || error?.code === 'SESSION_EXPIRED'
const limited = (error) => error?.code === 'RATE_LIMITED' || (error?.status === 429 && error?.code !== 'GRAPH_REQUEST_LIMIT')
const interrupted = (error) => unauthorized(error) || limited(error) || ['GRAPH_REQUEST_LIMIT', 'GRAPH_DEADLINE'].includes(error?.code)
const safeError = (error) => unauthorized(error) ? { code: 'SESSION_EXPIRED', message: 'GitHub 登录已失效，请重新登录。' }
  : limited(error) ? { code: 'RATE_LIMITED', message: 'GitHub 请求额度暂时用尽，请稍后重试。' }
    : error?.code === 'GRAPH_DEADLINE' ? { code: 'GRAPH_DEADLINE', message: '图谱处理已达到时间上限，请稍后重试。' }
      : error?.code === 'GRAPH_REQUEST_LIMIT' ? { code: 'GRAPH_REQUEST_LIMIT', message: '图谱已达到本次请求上限。' }
        : error?.code === 'PRIVATE_REPOSITORY' ? { code: 'PRIVATE_REPOSITORY', message: '图谱仅支持公开 GitHub 仓库。' }
          : error?.status === 404 ? { code: 'REPOSITORY_NOT_FOUND', message: '该公开 GitHub 仓库不存在或暂时无法读取。' }
            : { code: 'GRAPH_UNAVAILABLE', message: '暂时无法生成该项目的技术来源图谱，请稍后重试。' }

function responseError(response) {
  if (response.status === 401) return new ApiError(401, '', 'SESSION_EXPIRED')
  if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) return new ApiError(429, '', 'RATE_LIMITED')
  return new ApiError(response.status, '', 'UPSTREAM_ERROR')
}
function mergeEvidence(target, source) {
  const keyOf = (item) => JSON.stringify(['kind', 'url', 'label', 'excerpt', 'person', 'relation', 'relationReason', 'targetUrl'].map((key) => item[key]))
  const keys = new Set(target.map(keyOf))
  for (const item of source) { const key = keyOf(item); if (!keys.has(key)) { target.push(item); keys.add(key) } }
}
function mergeEdgeEvidence(edge, items) {
  mergeEvidence(edge.evidence, items)
  edge.relation = relationFromEvidence(edge.evidence)
}
function decodeFile(value) {
  if (value?.encoding !== 'base64' || typeof value.content !== 'string') throw new ApiError(502, '', 'INVALID_SOURCE_FILE')
  const encoded = value.content.replace(/\s/g, '')
  if (encoded.length > Math.ceil(2 * 1024 * 1024 / 3) * 4 || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw new ApiError(502, '', 'INVALID_SOURCE_FILE')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== encoded) throw new ApiError(502, '', 'INVALID_SOURCE_FILE')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ApiError(502, '', 'INVALID_SOURCE_FILE') }
}
function validPublicRepo(value) {
  const parts = typeof value?.full_name === 'string' ? value.full_name.split('/') : []
  return value?.private === false && parts.length === 2 && validRepository(...parts) && typeof value.owner?.login === 'string' && Number.isSafeInteger(value.id)
}

export function createGraphService({ request, getDetails, store, now = () => Date.now(), limits = {} }) {
  if (typeof request !== 'function' || typeof getDetails !== 'function') throw new TypeError('图谱服务需要 GitHub 请求与详情函数。')
  const config = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, Number.isFinite(limits[key]) ? Math.max(key === 'queue' ? 0 : 1, Math.min(value, Math.floor(limits[key]))) : value]))
  const memory = new Map()
  store ??= { get: async (key) => memory.get(key), set: async (key, value) => { memory.delete(key); memory.set(key, structuredClone(value)); while (memory.size > 64) memory.delete(memory.keys().next().value) } }
  const records = new Map()
  const starting = new Map()
  const queue = []
  const refreshed = new Map()
  let running = 0
  const time = () => Number(now())
  const timestamp = () => new Date(time()).toISOString()
  const snapshot = (record) => structuredClone(record.job)
  function cleanup(reserve = false) {
    for (const [id, record] of records) if (terminal(record.job) && time() - record.finishedAt >= config.jobTtlMs) records.delete(id)
    for (const [key, at] of refreshed) if (time() - at >= config.cacheTtlMs) refreshed.delete(key)
    while (records.size > config.maxJobs - (reserve ? 1 : 0)) {
      const oldest = [...records].find(([, record]) => terminal(record.job))
      if (!oldest) break
      records.delete(oldest[0])
    }
  }
  function stage(record, phase, progress, message) {
    Object.assign(record.job, { phase, progress, message, updatedAt: timestamp() })
  }
  function check(record) {
    if (record.controller.signal.aborted || time() >= record.deadline) throw new ApiError(504, '', 'GRAPH_DEADLINE')
  }
  async function bounded(record, work) {
    check(record)
    const signal = record.controller.signal
    let listener
    const abort = new Promise((_, reject) => { listener = () => reject(new ApiError(504, '', 'GRAPH_DEADLINE')); signal.addEventListener('abort', listener, { once: true }) })
    try { return await Promise.race([Promise.resolve().then(work), abort]) }
    finally { signal.removeEventListener('abort', listener) }
  }
  async function read(record, path, token = record.token, options = {}) {
    check(record)
    if (record.job.requests >= config.requests) throw new ApiError(429, '', 'GRAPH_REQUEST_LIMIT')
    record.job.requests++
    record.job.updatedAt = timestamp()
    return bounded(record, async () => {
      const response = await request(path, token, { ...options, signal: record.controller.signal })
      if (!response.ok) throw responseError(response)
      if (response.status === 204) return []
      try { return await response.json() } catch { throw new ApiError(502, '', 'INVALID_GITHUB_DATA') }
    })
  }
  const warning = (result, message) => { if (!result.warnings.includes(message)) result.warnings.push(message) }
  function sourceFailure(result, error, label) {
    if (interrupted(error)) throw error
    warning(result, `${label}暂时无法读取，本次图谱未覆盖该来源。`)
  }
  async function content(record, owner, repo, branch, filename) {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filename.split('/').map(encodeURIComponent).join('/')}?${new URLSearchParams({ ref: branch })}`
    let value
    try { value = await read(record, path) }
    catch (error) {
      // This helper is called only after getDetails verified a public root.
      if (error?.status !== 403 || !record.token || interrupted(error)) throw error
      value = await read(record, path, null)
    }
    return decodeFile(value)
  }
  function newResult(rootRepo) {
    const root = rootRepo.full_name.toLowerCase()
    return { version: 1, semanticsVersion: GRAPH_SEMANTICS_VERSION, root, generatedAt: timestamp(), nodes: [{ id: root, repo: normalizeRepo(rootRepo), tier: 0, overlap: topicOverlap(rootRepo, rootRepo), evidence: [] }], edges: [], people: [], warnings: [],
      counts: { referencesFound: 0, referencesResolved: 0, peopleFound: 0, peopleScanned: 0, candidatesScanned: 0 },
      limits: { references: config.references, people: config.people, reposPerPerson: config.reposPerPerson, requests: config.requests } }
  }
  async function execute(record) {
    let result
    record.deadline = time() + config.deadlineMs
    record.controller = new AbortController()
    const timer = setTimeout(() => record.controller.abort(), config.deadlineMs)
    record.job.status = 'running'
    stage(record, 'repository', 5, '正在读取公开项目与 README。')
    try {
      if (config.requests < 3) throw new ApiError(429, '', 'GRAPH_REQUEST_LIMIT')
      // Details owns its request wrapper. Reserve its worst case: metadata,
      // README and one anonymous Contents-permission retry, even on cache hits.
      record.job.requests = 3
      const details = await bounded(record, () => getDetails(record.owner, record.repo, record.token, { refresh: record.refresh }))
      if (!details?.repo || details.repo.private === true) throw new ApiError(403, '', 'PRIVATE_REPOSITORY')
      const rootParts = typeof details.repo.full_name === 'string' ? details.repo.full_name.split('/') : []
      if (rootParts.length !== 2 || !validRepository(...rootParts) || typeof details.defaultBranch !== 'string' || !details.defaultBranch || typeof details.repo.owner?.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(details.repo.owner.login)) throw new ApiError(502, '', 'INVALID_REPOSITORY')
      result = newResult(details.repo)
      if (details.readmeError) {
        warning(result, '项目 README 暂时无法读取，本次图谱未覆盖 README 来源。')
        if (details.readmeError.code === 'RATE_LIMITED') throw new ApiError(429, '', 'RATE_LIMITED')
      }
      stage(record, 'references', 20, '正在提取 README 与明确依赖来源。')
      const extracted = extractReadme(details.readme, result.root)
      const references = new Map(extracted.references.map((item) => [item.id, item]))
      result.counts.referencesFound = references.size
      const rootPath = `/repos/${encodeURIComponent(record.owner)}/${encodeURIComponent(record.repo)}`
      const blob = (filename) => `https://github.com/${details.repo.full_name}/blob/${encodeURIComponent(details.defaultBranch)}/${filename.split('/').map(encodeURIComponent).join('/')}`
      for (const filename of ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml']) {
        try {
          for (const item of extractDependencies(filename, await content(record, record.owner, record.repo, details.defaultBranch, filename), blob(filename), result.root)) {
            if (references.has(item.id)) mergeEvidence(references.get(item.id).evidence, item.evidence)
            else references.set(item.id, item)
            result.counts.referencesFound = references.size
          }
        } catch (error) { if (error?.status !== 404) sourceFailure(result, error, `${filename} 依赖声明`) }
      }
      result.counts.referencesFound = references.size
      const prioritized = [...references.values()].sort((a, b) => {
        const rank = (item) => Math.min(...item.evidence.map((entry) => ({ credit: 0, citation: 1, dependency: 2, copyright: 3, 'readme-reference': 4, 'readme-related': 5 })[entry.kind] ?? 6))
        return rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      })
      if (references.size > config.references) warning(result, `发现 ${references.size} 个直接引用，本次最多解析 ${config.references} 个。`)

      stage(record, 'people', 40, '正在核对贡献者、负责人和维护者来源。')
      const people = new Map()
      function person(profile, role, evidence, contributions = null) {
        if (profile?.type !== 'User' || !/^[a-zA-Z0-9-]{1,39}$/.test(profile.login) || /\[bot\]$/i.test(profile.login)) return
        const key = profile.login.toLowerCase()
        if (!people.has(key)) {
          people.set(key, { login: profile.login, avatar_url: typeof profile.avatar_url === 'string' ? profile.avatar_url : '', html_url: `https://github.com/${profile.login}`, roles: [], contributions: null, evidence: [] })
          result.people.push(people.get(key))
          result.counts.peopleFound = people.size
        }
        const value = people.get(key)
        if (!value.roles.includes(role)) value.roles.push(role)
        if (Number.isSafeInteger(contributions) && contributions >= 0) value.contributions = Math.max(value.contributions ?? 0, contributions)
        mergeEvidence(value.evidence, evidence)
      }
      try {
        const contributors = await read(record, `${rootPath}/contributors?per_page=100&anon=false`)
        if (!Array.isArray(contributors)) throw new ApiError(502, '', 'INVALID_GITHUB_DATA')
        for (const profile of contributors) person(profile, 'contributor', [{ kind: 'contributor', url: `https://github.com/${details.repo.full_name}/graphs/contributors`, label: '公开提交贡献者', person: profile.login }], profile.contributions)
      } catch (error) { sourceFailure(result, error, '公开贡献者') }
      let codeowners = []
      for (const filename of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
        try { codeowners = extractCodeowners(await content(record, record.owner, record.repo, details.defaultBranch, filename), blob(filename)); break }
        catch (error) { if (error?.status !== 404) { sourceFailure(result, error, 'CODEOWNERS 负责人'); break } }
      }
      const explicit = new Map()
      for (const [role, candidates] of [['codeowner', codeowners], ['readme-maintainer', extracted.people]]) {
        for (const candidate of candidates) {
          const key = candidate.login.toLowerCase()
          if (!explicit.has(key)) explicit.set(key, { login: candidate.login, roles: [], evidence: [] })
          explicit.get(key).roles.push(role)
          mergeEvidence(explicit.get(key).evidence, candidate.evidence)
        }
      }
      // Verify a bounded sample of explicit personal handles; contributors are
      // already typed by GitHub. Teams/emails never enter this map.
      const ownerLogin = details.repo.owner.login
      const ownerKey = ownerLogin.toLowerCase()
      const toVerify = [...explicit.values()].slice(0, config.people)
      if (!toVerify.some((item) => item.login.toLowerCase() === ownerKey)) toVerify.push({ login: ownerLogin, roles: [], evidence: [] })
      if (explicit.size > config.people) warning(result, `明确列出 ${explicit.size} 位负责人或维护者，本次核对前 ${config.people} 位个人账号。`)
      for (const candidate of toVerify) {
        try {
          let profile = people.has(candidate.login.toLowerCase()) ? { ...people.get(candidate.login.toLowerCase()), type: 'User' } : await read(record, `/users/${encodeURIComponent(candidate.login)}`)
          if (profile?.login?.toLowerCase() !== candidate.login.toLowerCase()) throw new ApiError(502, '', 'INVALID_GITHUB_DATA')
          for (const role of candidate.roles) person(profile, role, candidate.evidence.filter((item) => item.kind === role))
          if (candidate.login.toLowerCase() === ownerKey) person(profile, 'owner', [{ kind: 'owner', url: `https://github.com/${details.repo.full_name}`, label: '项目的个人所有者', person: profile.login }])
        } catch (error) { sourceFailure(result, error, `人员 ${candidate.login} 的公开账号资料`) }
      }
      result.people = [...people.values()].sort((a, b) => (b.contributions ?? -1) - (a.contributions ?? -1) || a.login.toLowerCase().localeCompare(b.login.toLowerCase(), 'en'))
      result.counts.peopleFound = result.people.length
      const chosen = []
      const choose = (value) => { if (value && chosen.length < config.people && !chosen.includes(value)) chosen.push(value) }
      // Reserve representation for explicit maintainers and major contributors.
      choose(result.people.find((value) => value.roles.includes('codeowner')))
      choose(result.people.find((value) => value.roles.includes('readme-maintainer')))
      choose(result.people.find((value) => value.roles.includes('contributor')))
      choose(result.people.find((value) => value.roles.includes('owner')))
      for (const value of result.people) choose(value)
      if (result.people.length > chosen.length) warning(result, `已发现 ${result.people.length} 位人类相关人员，本次仅展开 ${chosen.length} 位的公开自有仓库。`)

      // Resolve direct metadata only. Never read a referenced project's README.
      for (const reference of prioritized.slice(0, config.references)) {
        try {
          const value = await read(record, `/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}`)
          if (!validPublicRepo(value)) { warning(result, `引用 ${reference.fullName} 未返回明确的公开仓库资料，已跳过。`); continue }
          const id = value.full_name.toLowerCase()
          if (id === result.root) continue
          const existing = result.nodes.find((node) => node.id === id)
          if (existing) { mergeEvidence(existing.evidence, reference.evidence); mergeEdgeEvidence(result.edges.find((edge) => edge.target === id), reference.evidence); continue }
          result.nodes.push({ id, repo: normalizeRepo(value), tier: 1, overlap: topicOverlap(details.repo, value), evidence: [...reference.evidence] })
          result.edges.push({ source: result.root, target: id, kind: 'direct', relation: relationFromEvidence(reference.evidence), evidence: [...reference.evidence] })
          result.counts.referencesResolved++
        } catch (error) { sourceFailure(result, error, `直接引用 ${reference.fullName}`) }
      }
      stage(record, 'related', 70, '正在扫描相关人员的公开自有项目。')
      for (const value of chosen) {
        try {
          const query = new URLSearchParams({ type: 'owner', sort: 'updated', direction: 'desc', per_page: String(config.reposPerPerson), page: '1' })
          const repositories = await read(record, `/users/${encodeURIComponent(value.login)}/repos?${query}`)
          if (!Array.isArray(repositories)) throw new ApiError(502, '', 'INVALID_GITHUB_DATA')
          result.counts.peopleScanned++
          for (const repository of repositories.slice(0, config.reposPerPerson)) {
            result.counts.candidatesScanned++
            if (!validPublicRepo(repository) || repository.owner.login.toLowerCase() !== value.login.toLowerCase() || repository.fork || repository.archived || repository.full_name.toLowerCase() === result.root) continue
            const overlap = topicOverlap(details.repo, repository)
            if (overlap.score <= 0) continue
            const id = repository.full_name.toLowerCase()
            const evidence = value.roles.map((role) => ({ kind: role, url: `https://github.com/${value.login}?tab=repositories`, label: `相关人员 ${value.login} 的公开自有仓库`, person: value.login }))
            const existing = result.nodes.find((node) => node.id === id)
            if (existing) { mergeEvidence(existing.evidence, evidence); mergeEdgeEvidence(result.edges.find((edge) => edge.target === id), evidence) }
            else {
              result.nodes.push({ id, repo: normalizeRepo(repository), tier: 2, overlap, evidence })
              result.edges.push({ source: result.root, target: id, kind: 'related', relation: relationFromEvidence(evidence), evidence: [...evidence] })
            }
          }
        } catch (error) { sourceFailure(result, error, `人员 ${value.login} 的公开自有仓库`) }
      }
      stage(record, 'ranking', 95, '正在按来源层级、主题重合度和 Stars 排序。')
    } catch (error) {
      if (!result || unauthorized(error) || !interrupted(error)) {
        record.job.status = 'failed'
        record.job.error = safeError(error)
        result = null
      } else warning(result, `${safeError(error).message}已保留此前取得的公开结果，后续来源未继续扫描。`)
    } finally {
      if (result) {
        result.nodes.sort(compareGraphNodes)
        const order = new Map(result.nodes.map((node, index) => [node.id, index]))
        result.edges.sort((a, b) => order.get(a.target) - order.get(b.target))
        result.generatedAt = timestamp()
        record.job.result = publicGraphResult(result)
        let status = result.warnings.length ? 'partial' : 'complete'
        if (!record.controller.signal.aborted && time() < record.deadline) {
          let writeTimer
          try {
            await bounded(record, () => Promise.race([
              store.set(result.root, record.job.result),
              new Promise((_, reject) => { writeTimer = setTimeout(() => reject(new ApiError(504, '', 'GRAPH_CACHE_TIMEOUT')), config.cacheWriteMs) }),
            ]))
          }
          catch { warning(record.job.result, '本机图谱缓存暂时无法保存，下次可能需要重新读取。'); status = 'partial' }
          finally { clearTimeout(writeTimer) }
        }
        record.job.status = status
      }
      clearTimeout(timer)
      stage(record, 'done', 100, record.job.status === 'complete' ? '一级技术来源图谱已生成。' : record.job.status === 'partial' ? '已生成部分图谱，请查看来源覆盖说明。' : record.job.error?.message ?? '图谱处理失败。')
      record.finishedAt = time()
      delete record.token
      delete record.controller
    }
  }
  function pump() {
    while (running < config.concurrency && queue.length) {
      const record = queue.shift()
      running++
      execute(record).catch(() => { record.job.status = 'failed'; record.job.error = safeError(null); stage(record, 'done', 100, record.job.error.message); record.finishedAt = time(); delete record.token })
        .finally(() => { running--; pump() })
    }
  }
  function ongoing(root, sessionKey) { return [...records.values()].find((record) => record.root === root && record.sessionKey === sessionKey && !terminal(record.job)) }
  async function begin(owner, repo, token, sessionKey, { refresh = false } = {}) {
    if (!validRepository(owner, repo)) throw new ApiError(400, '项目地址无效。', 'INVALID_REPO')
    if (token != null && typeof token !== 'string') throw new ApiError(400, '登录凭据格式无效。', 'INVALID_TOKEN')
    if (typeof sessionKey !== 'string' || !sessionKey) throw new ApiError(400, '图谱会话无效。', 'INVALID_SESSION')
    cleanup(true)
    const root = `${owner}/${repo}`.toLowerCase()
    const merged = ongoing(root, sessionKey)
    if (merged) return snapshot(merged)
    let cached
    try {
      const value = await store.get(root)
      if (value) {
        const publicValue = publicGraphResult(value)
        const age = time() - Date.parse(publicValue.generatedAt)
        if (publicValue.semanticsVersion === GRAPH_SEMANTICS_VERSION && publicValue.root === root && age >= 0 && age < (publicValue.warnings.length ? config.partialTtlMs : config.cacheTtlMs)) cached = publicValue
      }
    } catch { /* An unavailable cache must not prevent a fresh public task. */ }
    // Recheck after the asynchronous store read: concurrent starts single-flight.
    const current = ongoing(root, sessionKey)
    if (current) return snapshot(current)
    const lastRefresh = refreshed.get(root)
    const throttled = refresh && lastRefresh != null && time() - lastRefresh < config.refreshMs
    if (throttled && !cached) throw new ApiError(429, '刷新过于频繁，请稍后重试。', 'GRAPH_REFRESH_THROTTLED')
    const cacheHit = cached && (!refresh || throttled)
    const active = [...records.values()].filter((record) => record.sessionKey === sessionKey && !terminal(record.job)).length
    if (!cacheHit && active >= config.sessionActive) throw new ApiError(429, '此会话已有多个图谱任务，请等待完成。', 'GRAPH_SESSION_LIMIT')
    if (!cacheHit && running >= config.concurrency && queue.length >= config.queue) throw new ApiError(429, '图谱任务队列已满，请稍后重试。', 'GRAPH_QUEUE_FULL')
    if (records.size >= config.maxJobs) throw new ApiError(429, '图谱任务暂时繁忙，请稍后重试。', 'GRAPH_QUEUE_FULL')
    const job = { id: randomUUID(), rootFullName: root, status: cacheHit ? (cached.warnings.length ? 'partial' : 'complete') : 'queued', phase: cacheHit ? 'done' : 'queued', progress: cacheHit ? 100 : 0, message: cacheHit ? (throttled ? '刷新间隔尚未到，已使用最近的公开图谱缓存。' : '已读取公开图谱缓存。') : '图谱任务已排队。', requests: 0, requestLimit: config.requests, updatedAt: timestamp(), result: cacheHit ? cached : null, error: null }
    const record = { job, root, owner, repo, token, sessionKey, refresh, finishedAt: cacheHit ? time() : null }
    records.set(job.id, record)
    if (!cacheHit) { if (refresh) refreshed.set(root, time()); queue.push(record); pump() }
    else delete record.token
    return snapshot(record)
  }
  async function start(owner, repo, token, sessionKey, options = {}) {
    if (!validRepository(owner, repo)) throw new ApiError(400, '项目地址无效。', 'INVALID_REPO')
    if (token != null && typeof token !== 'string') throw new ApiError(400, '登录凭据格式无效。', 'INVALID_TOKEN')
    if (typeof sessionKey !== 'string' || !sessionKey) throw new ApiError(400, '图谱会话无效。', 'INVALID_SESSION')
    const key = JSON.stringify([sessionKey, `${owner}/${repo}`.toLowerCase()])
    if (starting.has(key)) return starting.get(key)
    const work = begin(owner, repo, token, sessionKey, options)
    starting.set(key, work)
    try { return await work } finally { if (starting.get(key) === work) starting.delete(key) }
  }
  function getJob(id, sessionKey) {
    cleanup()
    const record = records.get(id)
    if (!record || record.sessionKey !== sessionKey) throw new ApiError(404, '图谱任务不存在。', 'GRAPH_JOB_NOT_FOUND')
    return snapshot(record)
  }
  return { start, getJob }
}
