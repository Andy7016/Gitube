import { createHash } from 'node:crypto'
import { ApiError } from './github.mjs'

const DAY = 86400000
const LIMITS = { starred: 1000, owned: 300 }
const TOPIC = /^[a-z0-9][a-z0-9-]{0,49}$/
const unauthorized = (error) => error?.status === 401 || error?.code === 'SESSION_EXPIRED'
const hasNext = (response) => /\brel\s*=\s*["']?next(?:["'\s;]|$)/i.test(response.headers.get('link') ?? '')

export function createRecommendationService({ request, now = () => Date.now() }) {
  if (typeof request !== 'function') throw new TypeError('request 必须是函数。')
  const cache = new Map()
  const pending = new Map()

  const keyFor = (login, token) => {
    if (typeof login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(login)) throw new ApiError(400, 'GitHub 账号无效。', 'INVALID_USER')
    if (typeof token !== 'string' || !token) throw new ApiError(401, '请先登录 GitHub。', 'LOGIN_REQUIRED')
    return `${login.toLowerCase()}:${createHash('sha256').update(token).digest('hex')}`
  }

  async function collect(source, login, token) {
    const repos = new Map()
    const maximumPages = source === 'starred' ? 10 : 3
    let truncated = false
    for (let page = 1; page <= maximumPages; page++) {
      const path = source === 'starred'
        ? `/user/starred?per_page=100&page=${page}&sort=created&direction=desc`
        : `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=${page}`
      const response = await request(path, token, source === 'starred' ? { headers: { Accept: 'application/vnd.github.star+json' } } : {})
      if (!response.ok) {
        if (response.status === 401) throw new ApiError(401, 'GitHub 登录已失效，请重新登录。', 'SESSION_EXPIRED')
        throw new ApiError(response.status >= 400 ? response.status : 502, 'GitHub 暂时无法读取推荐画像所需的数据。')
      }
      const entries = await response.json()
      if (!Array.isArray(entries)) throw new ApiError(502, 'GitHub 返回的推荐画像数据格式无效。')
      for (const entry of entries.slice(0, 100)) {
        const repo = source === 'starred' ? entry?.repo : entry
        if (!repo || !Number.isInteger(repo.id) || repo.id <= 0 || repo.private === true || typeof repo.full_name !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo.full_name)) continue
        if (source === 'owned' && (typeof repo.owner?.login !== 'string' || repo.owner.login.toLowerCase() !== login.toLowerCase())) continue
        if (!repos.has(repo.id)) repos.set(repo.id, { repo, starredAt: source === 'starred' ? entry.starred_at : null })
      }
      const next = hasNext(response)
      if (!next) break
      if (page === maximumPages) truncated = true
    }
    return { repos: [...repos.values()], truncated }
  }

  async function buildProfile(login, token) {
    const results = await Promise.allSettled([collect('starred', login, token), collect('owned', login, token)])
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
    const expired = errors.find(unauthorized)
    if (expired) throw expired
    if (errors.length === 2) throw errors[0]

    const timestamp = Number(now())
    const topics = new Map()
    const languages = new Map()
    const warnings = []
    const sources = ['starred', 'owned']
    const data = results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value
      warnings.push(index === 0
        ? '暂时无法读取 Star 历史，推荐画像已使用本人公开仓库生成。'
        : '暂时无法读取本人公开仓库，推荐画像已使用 Star 历史生成。')
      return { repos: [], truncated: false }
    })
    const add = (weights, name, contribution, source, repo) => {
      const previous = weights.get(name)
      if (!previous) weights.set(name, { name, weight: contribution, strongest: contribution, evidence: { source, repo } })
      else {
        previous.weight += contribution
        if (contribution > previous.strongest) {
          previous.strongest = contribution
          previous.evidence = { source, repo }
        }
      }
    }
    data.forEach(({ repos }, index) => {
      const source = sources[index]
      for (const { repo, starredAt } of repos) {
        // Old stars retain their full baseline. A recent star adds at most 35%,
        // while an owned project is a stronger signal of sustained involvement.
        const starredTime = Date.parse(starredAt)
        const age = Number.isFinite(starredTime) ? Math.max(0, (timestamp - starredTime) / DAY) : Infinity
        const base = (source === 'owned' ? 3 : 1 + 0.35 * Math.exp(-age / 180)) * (repo.fork ? 0.45 : 1)
        const names = [...new Set((Array.isArray(repo.topics) ? repo.topics : []).filter((name) => typeof name === 'string' && TOPIC.test(name)))]
        for (const name of names) add(topics, name, base / names.length, source, repo.full_name)
        const language = typeof repo.language === 'string' ? repo.language.trim() : ''
        if (language && language.length <= 40 && !/[\r\n"\\]/.test(language)) add(languages, language, base, source, repo.full_name)
      }
    })
    const ranked = (weights, maximum) => [...weights.values()]
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, 'en'))
      .slice(0, maximum)
      .map(({ name, weight, evidence }) => ({ name, weight: Math.round(weight * 1e6) / 1e6, evidence }))
    const profile = {
      login,
      generatedAt: new Date(timestamp).toISOString(),
      counts: { starred: data[0].repos.length, owned: data[1].repos.length },
      limits: { ...LIMITS },
      truncated: { starred: data[0].truncated, owned: data[1].truncated },
      topics: ranked(topics, 20),
      languages: ranked(languages, 15),
      starredIds: data[0].repos.map(({ repo }) => repo.id),
      ownedIds: data[1].repos.map(({ repo }) => repo.id),
      warnings,
    }
    return { profile, partial: errors.length > 0 }
  }

  function getProfile(login, token, { refresh = false } = {}) {
    const key = keyFor(login, token)
    if (pending.has(key)) return pending.get(key).promise
    const cached = cache.get(key)
    if (!refresh && cached && cached.expires > Number(now())) {
      cache.delete(key)
      cache.set(key, cached)
      return Promise.resolve(cached.profile)
    }
    cache.delete(key)
    const work = { promise: null }
    work.promise = buildProfile(login, token).then(({ profile, partial }) => {
      // invalidate removes this record. An earlier request must never overwrite
      // a fresh request's result or repopulate a deliberately invalidated entry.
      if (pending.get(key) === work) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value)
        cache.set(key, { profile, expires: Number(now()) + (partial ? 60000 : 15 * 60000) })
      }
      return profile
    }).finally(() => {
      if (pending.get(key) === work) pending.delete(key)
    })
    pending.set(key, work)
    return work.promise
  }

  function invalidate(login, token) {
    const key = keyFor(login, token)
    cache.delete(key)
    pending.delete(key)
  }

  return { getProfile, invalidate }
}
