export class ApiError extends Error {
  constructor(status, message, code = 'UPSTREAM_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function normalizeRepo(repo) {
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description ?? '',
    html_url: repo.html_url,
    owner: { login: repo.owner.login, avatar_url: repo.owner.avatar_url },
    stargazers_count: repo.stargazers_count ?? 0,
    forks_count: repo.forks_count ?? 0,
    language: repo.language ?? null,
    topics: repo.topics ?? [],
    updated_at: repo.pushed_at ?? repo.updated_at,
    license: repo.license ? { spdx_id: repo.license.spdx_id } : null,
    homepage: repo.homepage ?? '',
    open_issues_count: repo.open_issues_count ?? 0,
    created_at: repo.created_at ?? repo.updated_at,
    cover_url: `https://opengraph.githubassets.com/${new Date().toISOString().slice(0, 10)}/${repo.full_name.split('/').map(encodeURIComponent).join('/')}`,
  }
}

export function buildSearch(params, now = new Date()) {
  const pageText = String(params.page ?? '1')
  const page = Number(pageText)
  if (!/^\d+$/.test(pageText) || page < 1 || page > 83) {
    throw new ApiError(400, '页码应在 1–83 之间。', 'INVALID_QUERY')
  }
  const text = String(params.q ?? '').trim()
  if (text.length > 120) throw new ApiError(400, '搜索词最多 120 个字符。', 'INVALID_QUERY')
  const queryTopics = []
  let queryLanguage = ''
  const remaining = text.replace(/(?:^|\s)(topic|language):("[^"]+"|[^\s]+)/gi, (_match, kind, raw) => {
    const value = raw.replace(/^"|"$/g, '')
    if (kind.toLowerCase() === 'topic') queryTopics.push(value.toLowerCase())
    else queryLanguage = value
    return ' '
  })
  const topics = [...new Set(queryTopics.length ? queryTopics : String(params.topics ?? '').split(',').filter(Boolean))]
  if (topics.length > 5 || topics.some((x) => !/^[a-z0-9][a-z0-9-]{0,49}$/.test(x))) {
    throw new ApiError(400, '请选择最多 5 个有效兴趣主题。', 'INVALID_QUERY')
  }
  const language = queryLanguage || String(params.language ?? '')
  if (language.length > 40 || /[\r\n"\\]/.test(language)) {
    throw new ApiError(400, '编程语言格式无效。', 'INVALID_QUERY')
  }
  // Only topic/language qualifiers are parsed. Other text cannot override public scope.
  const words = remaining.replace(/[^\p{L}\p{N}_.\-\s/]/gu, ' ').split(/\s+/).filter(Boolean)
  const parts = ['is:public', 'archived:false', 'fork:false', 'stars:>20']
  if (words.length) parts.push(...words)
  if (language && language !== 'all') parts.push(`language:"${language}"`)
  if (params.range && !['week', 'month'].includes(params.range)) throw new ApiError(400, '时间范围无效。', 'INVALID_QUERY')
  if (params.range) {
    const start = new Date(new Date(now).getTime() - (params.range === 'week' ? 7 : 30) * 86400000).toISOString().slice(0, 10)
    parts.push(`${params.range === 'week' ? 'created' : 'pushed'}:>=${start}`)
  }
  const sort = params.sort === 'updated' ? 'updated' : params.sort === 'stars' ? 'stars' : null
  // Repository search does not support topic OR. Query topics independently,
  // then interleave results so one broad interest cannot crowd out the rest.
  const perPage = Math.ceil(12 / Math.max(1, topics.length))
  const queries = (topics.length ? topics : [null]).map((topic) => {
    const query = new URLSearchParams({ q: [...parts, ...(topic ? [`topic:${topic}`] : [])].join(' '), per_page: String(perPage), page: String(page) })
    if (sort) { query.set('sort', sort); query.set('order', 'desc') }
    return query
  })
  return { queries, page, perPage }
}

export async function githubRequest(fetchImpl, path, token, options = {}) {
  let response
  try {
    response = await fetchImpl(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'RepoFlow/0.1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    })
  } catch {
    throw new ApiError(502, '暂时无法连接 GitHub，请稍后重试。', 'GITHUB_UNAVAILABLE')
  }
  if (response.status === 401) throw new ApiError(401, 'GitHub 登录已失效，请重新登录。', 'SESSION_EXPIRED')
  if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
    throw new ApiError(429, 'GitHub 请求额度暂时用尽，请稍后重试或登录后再试。', 'RATE_LIMITED')
  }
  if (!response.ok && !(options.allow404 && response.status === 404)) {
    const status = [403, 404, 422].includes(response.status) ? response.status : 502
    const message = status === 403 ? 'GitHub 未授权此操作，请检查 OAuth 权限后重新登录。' : status === 404 ? '项目不存在，或当前账号无权访问。' : status === 422 ? 'GitHub 无法处理这个搜索，请减少筛选条件。' : 'GitHub 暂时无法处理请求，请稍后重试。'
    throw new ApiError(status, message)
  }
  return response
}

export async function mapConcurrent(items, limit, worker) {
  const result = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      result[index] = await worker(items[index])
    }
  }))
  return result
}
