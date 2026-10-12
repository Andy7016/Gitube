import { createHash } from 'node:crypto'
import { ApiError } from './github.mjs'

const ownerValid = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,39}$/.test(value)
const repoValid = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) && !['.', '..'].includes(value)
const topicValid = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,49}$/.test(value)
const number = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null
const string = (value) => typeof value === 'string' ? value : null
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const authError = (error) => error?.status === 401 || error?.code === 'SESSION_EXPIRED'
const rateError = (error) => error?.status === 429 || error?.code === 'RATE_LIMITED'
const invalid = (message = 'Gitube 请求格式无效。') => new ApiError(400, message, 'INVALID_GITUBE_REQUEST')
const dataError = () => new ApiError(502, 'GitHub 返回的数据格式无效，请稍后重试。', 'INVALID_GITHUB_DATA')
const hasNext = (response) => /\brel\s*=\s*["']?next(?:["'\s;]|$)/i.test(response.headers.get('link') ?? '')
function url(value) {
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null } catch { return null }
}
function publicRepo(value) {
  const parts = typeof value?.full_name === 'string' ? value.full_name.split('/') : []
  return value?.private === false && parts.length === 2 && ownerValid(parts[0]) && repoValid(parts[1]) && typeof value.owner?.login === 'string' && parts[0].toLowerCase() === value.owner.login.toLowerCase()
}
function toRepo(value, starred = false) {
  if (number(value.stargazers_count) === null || number(value.forks_count) === null || !date(value.created_at) || !['User', 'Organization'].includes(value.owner.type)) throw dataError()
  const [owner, name] = value.full_name.split('/')
  return {
    id: string(value.node_id) || `repo:${value.full_name.toLowerCase()}`,
    nameWithOwner: value.full_name, name, owner,
    ownerId: string(value.owner.node_id) || `user:${owner.toLowerCase()}`,
    ownerType: ['User', 'Organization'].includes(value.owner.type) ? value.owner.type : null,
    ownerAvatar: url(value.owner.avatar_url) || '', description: string(value.description),
    url: `https://github.com/${value.full_name}`, homepageUrl: url(value.homepage),
    stars: number(value.stargazers_count), forks: number(value.forks_count),
    language: string(value.language), languageColor: null,
    topics: [...new Set((Array.isArray(value.topics) ? value.topics : []).filter(topicValid))],
    pushedAt: date(value.pushed_at), createdAt: date(value.created_at),
    viewerHasStarred: starred, coverImage: null, isArchived: value.archived === true,
    license: value.license?.spdx_id && value.license.spdx_id !== 'NOASSERTION' ? string(value.license.spdx_id) : null,
    defaultBranch: string(value.default_branch),
  }
}
function keys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key))
}

export function compileGitubeSearch(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300 || /[\x00-\x1f\\]/.test(query) || (query.match(/"/g)?.length ?? 0) % 2) throw invalid('搜索词应为 1–300 个有效字符。')
  const parts = ['is:public']
  let sort
  let order = 'desc'
  for (const token of query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    if (/^(OR|AND|NOT)$/i.test(token)) throw invalid('搜索暂不支持布尔运算符。')
    const match = token.match(/^(-?)([a-zA-Z][a-zA-Z_-]*):(.*)$/)
    if (!match) { parts.push(token); continue }
    const [, negative, rawKey, raw] = match
    const key = rawKey.toLowerCase()
    const value = raw.replace(/^"|"$/g, '')
    if (['is', 'visibility'].includes(key)) {
      if (negative || value !== 'public') throw invalid('此应用仅搜索公开仓库。')
      continue
    }
    if (key === 'sort') {
      if (negative || !/^(stars|forks|updated)(-asc|-desc)?$/.test(value)) throw invalid('排序方式无效。')
      sort = value.replace(/-(asc|desc)$/, '')
      order = value.endsWith('-asc') ? 'asc' : 'desc'
      continue
    }
    let valid = false
    if (key === 'topic') valid = topicValid(value)
    if (key === 'language') valid = Boolean(value && value.length <= 40 && !/["\r\n]/.test(value))
    if (['user', 'org'].includes(key)) valid = ownerValid(value)
    if (key === 'repo') { const names = value.split('/'); valid = names.length === 2 && ownerValid(names[0]) && repoValid(names[1]) }
    if (['stars', 'forks', 'size'].includes(key)) valid = /^(?:[<>]=?\d{1,10}|\d{1,10}(?:\.\.\d{1,10})?)$/.test(value)
    if (['created', 'pushed', 'updated'].includes(key)) valid = /^(?:[<>]=?)?\d{4}-\d{2}-\d{2}(?:\.\.\d{4}-\d{2}-\d{2})?$/.test(value)
    if (['archived', 'fork'].includes(key)) valid = ['true', 'false', 'only'].includes(value)
    if (key === 'license') valid = /^[a-zA-Z0-9.-]{1,80}$/.test(value)
    if (key === 'in') valid = /^(?:name|description|readme)(?:,(?:name|description|readme))*$/.test(value)
    if (!valid) throw invalid(`搜索限定词 ${key} 不受支持或格式无效。`)
    parts.push(`${negative}${key}:${key === 'language' ? JSON.stringify(value) : value}`)
  }
  return { query: parts.join(' '), sort, order }
}
const digest = (value) => createHash('sha256').update(value).digest('base64url').slice(0, 24)
function cursor(page, context, first) { return Buffer.from(JSON.stringify({ v: 1, p: page, c: digest(context), n: first })).toString('base64url') }
function pageFor(after, context, first, maximum) {
  if (after === null || after === undefined) return 1
  if (typeof after !== 'string' || after.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(after)) throw invalid('分页游标无效，请重新开始。')
  let value
  try { const bytes = Buffer.from(after, 'base64url'); if (bytes.toString('base64url') !== after) throw new Error(); value = JSON.parse(bytes.toString('utf8')) } catch { throw invalid('分页游标无效，请重新开始。') }
  if (!keys(value, ['v', 'p', 'c', 'n']) || value.v !== 1 || value.c !== digest(context) || value.n !== first || !Number.isInteger(value.p) || value.p < 2 || value.p > maximum) throw invalid('分页游标与当前查询不匹配，请重新开始。')
  return value.p
}

export function createGitubeApi({ request, recommendations, deadlineMs = 60000 }) {
  if (typeof request !== 'function' || typeof recommendations?.getProfile !== 'function') throw new TypeError('Gitube API 需要请求和画像服务。')
  async function run(input, { user, token, starred, signal } = {}) {
    const operations = { searchMany: ['operation', 'specs'], repository: ['operation', 'owner', 'name'], seeds: ['operation'], myStars: ['operation', 'after'], followingStars: ['operation'] }
    if (!input || !Object.hasOwn(operations, input.operation) || !keys(input, operations[input.operation])) throw invalid()
    if (!['searchMany', 'repository'].includes(input.operation) && (!token || !ownerValid(user?.login))) throw new ApiError(401, '请先登录 GitHub。', 'LOGIN_REQUIRED')
    const meta = { rateRemaining: null, rateLimit: null, rateReset: null }
    const warnings = []
    const warn = (message) => { if (!warnings.includes(message)) warnings.push(message) }
    let fatal
    function failResponse(response) {
      if (response.status === 401) return new ApiError(401, 'GitHub 登录已失效，请重新登录。', 'SESSION_EXPIRED')
      if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) return new ApiError(429, 'GitHub 请求额度暂时用尽，请稍后重试。', 'RATE_LIMITED')
      return new ApiError([403, 404, 422].includes(response.status) ? response.status : 502, 'GitHub 暂时无法完成此请求，请稍后重试。', 'GITHUB_UNAVAILABLE')
    }
    async function read(path, credential = token, options = {}) {
      if (fatal) throw fatal
      if (signal.aborted) throw new ApiError(504, 'Gitube 请求已达到处理期限，请稍后重试。', 'GITUBE_TIMEOUT')
      let response
      try {
        response = await request(path, credential, { ...options, signal })
        if (!response.ok) throw failResponse(response)
      } catch (error) { if (authError(error) || rateError(error)) fatal = error; throw error }
      for (const [key, header] of [['rateRemaining', 'x-ratelimit-remaining'], ['rateLimit', 'x-ratelimit-limit'], ['rateReset', 'x-ratelimit-reset']]) {
        const raw = response.headers.get(header)
        if (raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) meta[key] = Number(raw) * (key === 'rateReset' ? 1000 : 1)
      }
      let data
      try { data = await response.json() } catch { throw dataError() }
      return { data, response }
    }
    async function pool(items, worker, concurrency = 2) {
      const values = new Array(items.length)
      let index = 0
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) { if (fatal) throw fatal; const at = index++; values[at] = await worker(items[at], at) }
      }))
      return values
    }
    async function viewerStates(repos, knownStarred = false) {
      if (!token) return repos
      if (knownStarred) { repos.forEach((repo) => { repo.viewerHasStarred = true }); return repos }
      const unique = [...new Map(repos.map((repo) => [repo.id, repo])).values()]
      const ids = unique.filter((repo) => !repo.id.startsWith('repo:')).map((repo) => repo.id)
      const states = new Map()
      for (let start = 0; start < ids.length; start += 100) {
        const batch = ids.slice(start, start + 100)
        const { data } = await read('/graphql', token, { method: 'POST', body: JSON.stringify({ query: 'query GitubeStarState($ids: [ID!]!) { nodes(ids: $ids) { ... on Repository { id viewerHasStarred } } }', variables: { ids: batch } }), headers: { 'Content-Type': 'application/json' } })
        if (data?.errors?.length) {
          const kind = data.errors.some((error) => ['UNAUTHENTICATED', 'BAD_CREDENTIALS'].includes(error.type)) ? 'auth' : data.errors.some((error) => error.type === 'RATE_LIMITED') ? 'rate' : 'other'
          const error = kind === 'auth' ? new ApiError(401, 'GitHub 登录已失效，请重新登录。', 'SESSION_EXPIRED') : kind === 'rate' ? new ApiError(429, 'GitHub 请求额度暂时用尽，请稍后重试。', 'RATE_LIMITED') : dataError()
          if (kind !== 'other') fatal = error
          throw error
        }
        if (!Array.isArray(data?.data?.nodes)) throw dataError()
        for (const node of data.data.nodes) if (batch.includes(node?.id) && typeof node.viewerHasStarred === 'boolean') states.set(node.id, node.viewerHasStarred)
      }
      if (unique.filter((repo) => !states.has(repo.id)).length > 16) throw dataError()
      for (const repo of unique) {
        if (fatal) throw fatal
        if (signal.aborted) throw new ApiError(504, 'Gitube 请求已达到处理期限，请稍后重试。', 'GITUBE_TIMEOUT')
        if (!states.has(repo.id)) {
          if (typeof starred !== 'function') throw dataError()
          const value = await starred(repo.nameWithOwner, { signal })
          if (typeof value !== 'boolean') throw dataError()
          states.set(repo.id, value)
        }
      }
      for (const repo of repos) repo.viewerHasStarred = states.get(repo.id)
      return repos
    }
    const reposFrom = (items, wrapped = false, known = false) => {
      if (!Array.isArray(items)) throw dataError()
      return items.map((item) => wrapped ? item?.repo ?? item : item).filter(publicRepo).map((repo) => toRepo(repo, known))
    }
    let data
    if (input.operation === 'searchMany') {
      if (!Array.isArray(input.specs) || input.specs.length > 8) throw invalid('一次最多搜索 8 组条件。')
      const specs = input.specs.map((spec) => {
        if (!keys(spec, ['query', 'after', 'first']) || !Number.isInteger(spec.first) || spec.first < 1 || spec.first > 100) throw invalid('每组搜索应请求 1–100 个项目。')
        const compiled = compileGitubeSearch(spec.query)
        const context = JSON.stringify(['search', compiled, spec.first])
        return { ...spec, ...compiled, context, page: pageFor(spec.after, context, spec.first, Math.floor(1000 / spec.first)) }
      })
      data = await pool(specs, async (spec) => {
        const params = new URLSearchParams({ q: spec.query, per_page: String(spec.first), page: String(spec.page) })
        if (spec.sort) { params.set('sort', spec.sort); params.set('order', spec.order) }
        const { data: result } = await read(`/search/repositories?${params}`)
        if (!Array.isArray(result?.items) || number(result.total_count) === null) throw dataError()
        if (result.incomplete_results) warn('GitHub 搜索返回部分结果，项目总数和覆盖范围可能尚未完整。')
        const accessible = Math.floor(1000 / spec.first) * spec.first
        const next = spec.page * spec.first < Math.min(accessible, result.total_count)
        if (!next && result.total_count > accessible) warn('GitHub 搜索最多提供前 1000 项；当前分页大小达到可读取的末页，请缩小搜索范围。')
        return { repos: reposFrom(result.items.slice(0, spec.first)), endCursor: next ? cursor(spec.page + 1, spec.context, spec.first) : null, hasNextPage: next, total: result.total_count }
      })
      await viewerStates(data.flatMap((page) => page.repos))
    } else if (input.operation === 'repository') {
      if (!ownerValid(input.owner) || !repoValid(input.name)) throw invalid('项目地址无效。')
      const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`
      const { data: value } = await read(path)
      if (value?.private === true) throw new ApiError(403, '此页面只支持公开 GitHub 仓库。', 'PRIVATE_REPOSITORY')
      if (!publicRepo(value)) throw dataError()
      data = { ...toRepo(value), watchers: number(value.subscribers_count), openIssues: number(value.open_issues_count), latestRelease: null }
      try {
        let release
        try { release = (await read(`${path}/releases/latest`)).data }
        catch (error) { if (error?.status !== 403 || !token || authError(error) || rateError(error)) throw error; release = (await read(`${path}/releases/latest`, null)).data }
        if (typeof release?.tag_name !== 'string' || !date(release.published_at)) throw dataError()
        data.latestRelease = { tagName: release.tag_name, publishedAt: release.published_at }
      } catch (error) {
        if (authError(error) || rateError(error)) throw error
        warn(error?.status === 404 ? '未找到可公开读取的最新版本信息。' : '最新版本信息暂时无法读取，其余公开项目信息仍可查看。')
      }
      await viewerStates([data])
    } else if (input.operation === 'myStars') {
      const first = 24
      const context = `myStars:${user.login.toLowerCase()}`
      const page = pageFor(input.after, context, first, 1000)
      const { data: entries, response } = await read(`/user/starred?per_page=${first}&page=${page}&sort=created&direction=desc`, token, { headers: { Accept: 'application/vnd.github.star+json' } })
      const next = page < 1000 && hasNext(response)
      if (!Array.isArray(entries)) throw dataError()
      data = { repos: reposFrom(entries.slice(0, first), true, true), endCursor: next ? cursor(page + 1, context, first) : null, hasNextPage: next, total: null }
    } else if (input.operation === 'seeds') {
      const [recent, owned, profile] = await Promise.all([
        read('/user/starred?per_page=100&page=1&sort=created&direction=desc', token, { headers: { Accept: 'application/vnd.github.star+json' } }),
        read(`/users/${encodeURIComponent(user.login)}/repos?type=owner&sort=pushed&direction=desc&per_page=40&page=1`),
        recommendations.getProfile(user.login, token),
      ])
      if (!Array.isArray(owned.data) || !Array.isArray(recent.data)) throw dataError()
      data = { starred: reposFrom(recent.data.slice(0, 100), true, true), own: owned.data.slice(0, 40).filter((repo) => publicRepo(repo) && !repo.fork && repo.owner.login.toLowerCase() === user.login.toLowerCase()).map((repo) => ({ language: string(repo.language), topics: (Array.isArray(repo.topics) ? repo.topics : []).filter(topicValid) })), profile }
    } else {
      warn('公开关注动态范围：最多检查前 12 位关注用户，每人最近 6 个公开 Star。')
      const { data: following } = await read(`/users/${encodeURIComponent(user.login)}/following?per_page=12&page=1`)
      if (!Array.isArray(following)) throw dataError()
      const people = [...new Map(following.slice(0, 12).filter((person) => ownerValid(person?.login) && person.type === 'User').map((person) => [person.login.toLowerCase(), person])).values()]
      let succeeded = 0
      let firstFailure
      const groups = await pool(people, async (person) => {
        try {
          const { data: entries } = await read(`/users/${encodeURIComponent(person.login)}/starred?per_page=6&page=1&sort=created&direction=desc`, token, { headers: { Accept: 'application/vnd.github.star+json' } })
          if (!Array.isArray(entries)) throw dataError()
          succeeded++
          return entries.slice(0, 6).filter((item) => publicRepo(item?.repo) && date(item.starred_at)).map((item) => ({ login: person.login, avatarUrl: url(person.avatar_url) || '', starredAt: item.starred_at, repo: toRepo(item.repo) }))
        } catch (error) { if (authError(error) || rateError(error)) throw error; firstFailure ??= error; warn(`暂时无法读取 @${person.login} 的公开 Star，关注动态覆盖不完整。`); return [] }
      })
      if (people.length && !succeeded) throw firstFailure
      data = groups.flat().sort((a, b) => b.starredAt.localeCompare(a.starredAt) || a.repo.nameWithOwner.localeCompare(b.repo.nameWithOwner, 'en'))
      await viewerStates(data.map((entry) => entry.repo))
    }
    if (warnings.length) meta.warnings = warnings
    return { data, meta }
  }
  async function execute(input, context = {}) {
    const controller = new AbortController()
    const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal
    let timer
    let listener
    const stopped = new Promise((_, reject) => {
      listener = () => reject(new ApiError(504, 'Gitube 请求已达到处理期限或已取消，请稍后重试。', 'GITUBE_TIMEOUT'))
      signal.addEventListener('abort', listener, { once: true })
      timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(60000, deadlineMs)))
      if (signal.aborted) listener()
    })
    try { return await Promise.race([run(input, { ...context, signal }), stopped]) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', listener); controller.abort() }
  }
  return { execute }
}
