/**
 * 推荐引擎（全部在浏览器里运行）
 *
 *  1. 画像：从「最近的 Star、自己的仓库、选择的兴趣、关注动态、在本应用里的行为」统计出
 *     每个 topic / 语言的权重。越新的行为权重越高（30 天半衰期）。
 *  2. 召回：按权重抽几个 topic / 语言，再加上「和你 Star 过的项目相似」「本周新星」
 *     「换换口味」等来源，拼成一次 GraphQL 请求里的多个搜索。
 *  3. 过滤：去掉已 Star、点过不感兴趣、屏蔽的 topic / 语言、最近 3 天推荐过的。
 *  4. 排序：兴趣匹配度 + 热度 + 活跃度 + 一点随机，再做打散（同作者、同语言、同来源不扎堆）。
 *  5. 插入「你关注的人 Star 了」的社交推荐。
 *  探索模式复用过滤，仅在实际检索候选内随机选择，换口味目标由明确手选兴趣划分。
 */
import { searchMany, type Seeds } from '../api/github'
import type { FeedItem, FollowingStar, Reason, Repo } from '../api/types'
import type { EventKind, LibraryData } from '../store/library'
import { daysSince, isoDaysAgo } from './format'
import { INTERESTS, INTEREST_BY_ID, TOPIC_STOPLIST } from './interests'
import { TASTE_FAMILIAR_SHARE, type RecommendationMode } from './recommendationMode'

/* ------------------------------------------------------------------ */
/* 1. 用户画像                                                           */
/* ------------------------------------------------------------------ */

export interface Profile {
  topicW: Map<string, number>
  langW: Map<string, number>
  maxT: number
  maxL: number
  blockedTopics: Set<string>
  blockedLangs: Set<string>
  disliked: Set<string>
  starred: Set<string>
  recentStars: Repo[]
  /** 兴趣标签展开后的 topic，对应的推荐理由会写成标签名 */
  interestTopicLabel: Map<string, string>
}

const EVENT_WEIGHT: Record<EventKind, number> = {
  star: 2.5,
  save: 2,
  later: 1,
  open: 0.6,
  dwell: 0.3,
  dislike: -3,
}
const HALF_LIFE_DAYS = 30

function bump(map: Map<string, number>, key: string, w: number) {
  map.set(key, (map.get(key) ?? 0) + w)
}

function followingWeight(lib: LibraryData, login: string): number {
  const value = lib.followingWeights?.[login.toLowerCase()]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3 ? value : 1
}

function followingFreshness(starredAt: string, now: number): number {
  const at = Date.parse(starredAt)
  if (!Number.isFinite(at)) return 0
  return Math.pow(0.5, Math.max(0, now - at) / 86_400_000 / HALF_LIFE_DAYS)
}

/** 仅用明确手选且未屏蔽的 topic 划定换口味的边界。 */
export function selectedInterestTopics(lib: LibraryData): Set<string> {
  const blocked = new Set(lib.blockedTopics)
  return new Set(lib.interests.flatMap((id) => INTEREST_BY_ID.get(id)?.topics ?? [])
    .filter((topic) => !blocked.has(topic)))
}

export function buildProfile(seeds: Seeds | null, lib: LibraryData, following: FollowingStar[] = []): Profile {
  const topicW = new Map<string, number>()
  const langW = new Map<string, number>()
  const interestTopicLabel = new Map<string, string>()

  // 最近的 Star：越新权重越高
  seeds?.starred.forEach((r, i) => {
    const w = Math.pow(0.985, i)
    for (const t of r.topics) if (!TOPIC_STOPLIST.has(t)) bump(topicW, t, w)
    if (r.language) bump(langW, r.language, w)
  })

  // 自己写的仓库
  for (const o of seeds?.own ?? []) {
    for (const t of o.topics) if (!TOPIC_STOPLIST.has(t)) bump(topicW, t, 0.5)
    if (o.language) bump(langW, o.language, 0.6)
  }

  // 每个人共享固定预算，去重后按其采样数归一；更多采样不会放大影响。
  const people = new Map<string, Map<string, FollowingStar>>()
  for (const item of following) {
    const login = item.login.toLowerCase()
    const repos = people.get(login) ?? new Map<string, FollowingStar>()
    const name = item.repo.nameWithOwner.toLowerCase()
    const prior = repos.get(name)
    if (!prior || item.starredAt > prior.starredAt) repos.set(name, item)
    people.set(login, repos)
  }
  const now = Date.now()
  for (const [login, repos] of people) {
    const multiplier = followingWeight(lib, login)
    if (multiplier === 0) continue
    for (const item of repos.values()) {
      const weight = 1.2 * multiplier / repos.size * followingFreshness(item.starredAt, now)
      const topics = [...new Set(item.repo.topics)].filter((topic) => !TOPIC_STOPLIST.has(topic))
      for (const topic of topics) bump(topicW, topic, weight / topics.length)
      if (item.repo.language) bump(langW, item.repo.language, weight * 0.5)
    }
  }

  // 主动选择的兴趣标签：权重最高
  for (const id of lib.interests) {
    const it = INTEREST_BY_ID.get(id)
    if (!it) continue
    it.topics.forEach((t, i) => {
      bump(topicW, t, i === 0 ? 5 : 3)
      interestTopicLabel.set(t, it.label)
    })
  }

  // 在本应用里的行为（Star、收藏、稍后再看、打开、不感兴趣）
  for (const e of lib.events) {
    const decay = Math.pow(0.5, (now - e.at) / 86_400_000 / HALF_LIFE_DAYS)
    const w = EVENT_WEIGHT[e.kind] * decay
    const n = Math.sqrt(e.topics.length || 1)
    for (const t of e.topics) if (!TOPIC_STOPLIST.has(t)) bump(topicW, t, w / n)
    if (e.lang) bump(langW, e.lang, w * 0.5)
  }

  const blockedTopics = new Set(lib.blockedTopics)
  const blockedLangs = new Set(lib.blockedLangs)
  blockedTopics.forEach((t) => topicW.delete(t))
  blockedLangs.forEach((l) => langW.delete(l))

  const maxPos = (m: Map<string, number>) => Math.max(1, ...[...m.values()].filter((v) => v > 0))

  return {
    topicW,
    langW,
    maxT: maxPos(topicW),
    maxL: maxPos(langW),
    blockedTopics,
    blockedLangs,
    disliked: new Set(lib.dislikedRepos.map((name) => name.toLowerCase())),
    starred: new Set(seeds?.starred.map((r) => r.nameWithOwner.toLowerCase()) ?? []),
    recentStars: seeds?.starred.slice(0, 30) ?? [],
    interestTopicLabel,
  }
}

/** 画像里权重最高的 topic，设置页里展示给用户看 */
export function topTopics(p: Profile, n = 12) {
  return [...p.topicW.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, n)
}

/* ------------------------------------------------------------------ */
/* 2. 召回来源                                                           */
/* ------------------------------------------------------------------ */

interface SourceSpec {
  key: string
  query: string
  reason: Reason
}

function weightedPick<T>(items: [T, number][], random: () => number): T | null {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0)
  if (total <= 0) return null
  let r = random() * total
  for (const [item, w] of items) {
    r -= Math.max(0, w)
    if (r <= 0) return item
  }
  return items[items.length - 1][0]
}

type Variant = 'best' | 'active' | 'rising'

/** 同一个 topic 的三种搜法：经典高星 / 最近活跃 / 一年内的新项目 */
function shuffledVariants(random: () => number): Variant[] {
  const r = random()
  return r < 0.45 ? ['best', 'active', 'rising'] : r < 0.75 ? ['active', 'rising', 'best'] : ['rising', 'best', 'active']
}

function topicSource(topic: string, p: Profile, v: Variant): SourceSpec {
  const label = p.interestTopicLabel.get(topic)
  const reason: Reason = { kind: 'topic', text: label ? `你感兴趣的${label}` : `因为你喜欢 #${topic}` }
  const q =
    v === 'best'
      ? `topic:${topic} stars:>=100 archived:false sort:stars`
      : v === 'active'
        ? `topic:${topic} stars:>=30 pushed:>=${isoDaysAgo(30)} archived:false sort:updated`
        : `topic:${topic} created:>=${isoDaysAgo(365)} stars:>=20 archived:false sort:stars`
  return { key: `topic:${topic}:${v}`, query: q, reason }
}

function similarSource(repo: Repo, random: () => number): SourceSpec | null {
  const topics = repo.topics.filter((t) => !TOPIC_STOPLIST.has(t)).slice(0, 4)
  if (topics.length < 2) return null
  const shuffled = shuffle(topics, random).slice(0, 2).sort()
  return {
    key: `sim:${shuffled.join('+')}`,
    query: `topic:${shuffled[0]} topic:${shuffled[1]} stars:>=10 archived:false sort:stars`,
    reason: { kind: 'similar', text: `因为你 Star 了 ${repo.name}` },
  }
}

function languageSource(lang: string): SourceSpec {
  return {
    key: `lang:${lang}`,
    query: `language:"${lang}" created:>=${isoDaysAgo(120)} stars:>=50 sort:stars`,
    reason: { kind: 'language', text: `${lang} 新秀` },
  }
}

function trendingSource(batch: number): SourceSpec {
  return batch % 2 === 0
    ? {
        key: 'trend:week',
        query: `created:>=${isoDaysAgo(7)} stars:>=20 sort:stars`,
        reason: { kind: 'trending', text: '本周新星' },
      }
    : {
        key: 'trend:month',
        query: `created:>=${isoDaysAgo(30)} stars:>=100 sort:stars`,
        reason: { kind: 'trending', text: '本月热门' },
      }
}

function exploreSource(p: Profile, random: () => number): SourceSpec | null {
  // 选一个用户画像里几乎没有的兴趣标签，帮他跳出信息茧房
  const fresh = INTERESTS.filter(
    (i) => (p.topicW.get(i.topics[0]) ?? 0) < 0.5 && !p.blockedTopics.has(i.topics[0]),
  )
  if (!fresh.length) return null
  const it = fresh[Math.floor(random() * fresh.length)]
  return {
    key: `explore:${it.topics[0]}`,
    query: `topic:${it.topics[0]} stars:>=500 pushed:>=${isoDaysAgo(90)} sort:stars`,
    reason: { kind: 'explore', text: `换换口味：${it.label}` },
  }
}

/* ------------------------------------------------------------------ */
/* 3~5. 引擎                                                             */
/* ------------------------------------------------------------------ */

interface Cursor {
  after: string | null
  done: boolean
  at: number
}

interface Candidate {
  repo: Repo
  reason: Reason
  src: string
  score: number
}

export interface EngineContext {
  seeds: Seeds | null
  lib: LibraryData
  following: FollowingStar[]
  isStarred: (repo: Repo) => boolean
  /** 账号、模式或本批依赖变化后，store 可以作废仍在请求的结果。 */
  isCurrent?: () => boolean
}

const BATCH_SIZE = 18
const CURSOR_TTL = 3 * 24 * 3600_000
const SEEN_TTL = 3 * 24 * 3600_000
const MAX_CURSORS = 256
const MAX_ROUNDS = 3
const MAX_SOURCES = 8

export interface RecommendationOptions {
  tasteFamiliarShare?: number
  searchMany?: typeof searchMany
  random?: () => number
}

/** 失效批次必须丢弃，不能作为“候选已耗尽”的有效空批处理。 */
export class StaleRecommendationRequest extends Error {
  constructor() {
    super('推荐请求已失效')
    this.name = 'StaleRecommendationRequest'
  }
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// 有界公开检索抽样，只承诺在返回的真实候选池中随机选择。
const STAR_BANDS = ['0..20', '21..99', '100..499', '500..1999', '2000..9999', '>=10000']
const SEARCH_SORTS = ['stars-asc', 'stars-desc', 'forks-asc', 'forks-desc', 'updated-asc', 'updated-desc']

function randomSource(random: () => number, slot: number, batch: number, round: number,
  topic?: string, excludedTopics: readonly string[] = []): SourceSpec {
  const now = new Date()
  const firstYear = 2008
  const yearCount = now.getUTCFullYear() - firstYear + 1
  const year = firstYear + (Math.floor(random() * yearCount) + slot + batch + round) % yearCount
  const end = year === now.getUTCFullYear() ? now.toISOString().slice(0, 10) : `${year}-12-31`
  const band = STAR_BANDS[(Math.floor(random() * STAR_BANDS.length) + slot) % STAR_BANDS.length]
  const sort = SEARCH_SORTS[(Math.floor(random() * SEARCH_SORTS.length) + slot + round) % SEARCH_SORTS.length]
  let query = `${topic ? `topic:${topic} ` : ''}created:${year}-01-01..${end} stars:${band} archived:false fork:false sort:${sort}`
  for (const excluded of excludedTopics) {
    const term = ` -topic:${excluded}`
    if (query.length + term.length <= 300) query += term
  }
  return { key: `sample:${query}`, query, reason: { kind: 'explore', text: '公开搜索候选池内随机探索' } }
}

export class RecommendEngine {
  private cursors: Record<string, Cursor> = {}
  private batch = 0
  private sessionSeen = new Set<string>()
  private generation = 0
  private readonly storageKey: string
  private readonly tasteFamiliarShare: number
  private readonly search: typeof searchMany
  private readonly random: () => number
  private readonly mode: RecommendationMode

  constructor(private readonly login: string, modeOrOptions: RecommendationMode | RecommendationOptions = 'normal', options: RecommendationOptions = {}) {
    this.mode = typeof modeOrOptions === 'string' ? modeOrOptions : 'normal'
    if (typeof modeOrOptions !== 'string') options = modeOrOptions
    this.storageKey = `gitube:cursors:${login.toLowerCase()}${this.mode === 'normal' ? '' : `:${this.mode}`}`
    const share = options.tasteFamiliarShare
    this.tasteFamiliarShare = typeof share === 'number' && Number.isFinite(share) && share >= 0 && share <= 1
      ? share : TASTE_FAMILIAR_SHARE
    this.search = options.searchMany ?? searchMany
    this.random = options.random ?? Math.random
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey) ?? '{}') as Record<string, Cursor>
      const now = Date.now()
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        this.cursors = Object.fromEntries(Object.entries(raw)
          .filter(([, c]) => c && typeof c === 'object' && (c.after === null || typeof c.after === 'string')
            && typeof c.done === 'boolean' && typeof c.at === 'number' && Number.isFinite(c.at)
            && c.at <= now && now - c.at < CURSOR_TTL)
          .sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CURSORS))
      }
    } catch {
      this.cursors = {}
    }
  }

  private saveCursors() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.cursors))
    } catch {
      /* ignore */
    }
  }

  /** 清空翻页进度（重置推荐时调用） */
  reset() {
    this.invalidate()
    this.cursors = {}
    this.sessionSeen.clear()
    this.batch = 0
    this.saveCursors()
  }

  /** 保留已完成游标，只使正在进行的批次失效。 */
  invalidate() {
    this.generation++
  }

  private pickSources(p: Profile, round: number, cursors: Record<string, Cursor>): SourceSpec[] {
    const specs: SourceSpec[] = []
    const used = new Set<string>()
    const add = (s: SourceSpec | null) => {
      if (!s || used.has(s.key) || cursors[s.key]?.done) return false
      used.add(s.key)
      specs.push(s)
      return true
    }

    // 兴趣 topic：从权重前 15 名里按权重抽 2~3 个（权重开 0.7 次方，避免永远是第一名）
    const topics = [...p.topicW.entries()]
      .filter(([t, w]) => w > 0 && !p.blockedTopics.has(t))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([t, w]) => [t, Math.pow(w, 0.7)] as [string, number])
    const nTopics = round === 0 ? 3 : 2
    let added = 0
    while (added < nTopics && topics.length) {
      const t = weightedPick(topics, this.random)
      if (!t) break
      topics.splice(topics.findIndex(([x]) => x === t), 1)
      // 这个 topic 的某种搜法翻到底了，就换另一种
      if (shuffledVariants(this.random).some((v) => add(topicSource(t, p, v)))) added++
    }

    // 和最近 Star 的某个项目相似
    if (p.recentStars.length) {
      const n = Math.min(p.recentStars.length, 15)
      for (let i = 0; i < 3; i++) {
        if (add(similarSource(p.recentStars[(this.batch * 3 + round + i) % n], this.random))) break
      }
    }

    // 常用语言的新项目（隔一屏来一次）
    if ((this.batch + round) % 2 === 0) {
      const langs = [...p.langW.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 5)
      const lang = weightedPick(langs, this.random)
      if (lang) add(languageSource(lang))
    }

    if (round === 0) add(trendingSource(this.batch)) || add(trendingSource(this.batch + 1))
    if (round === 0 && this.batch % 2 === 1) add(exploreSource(p, this.random))

    // 新用户没有画像，或者能翻的都翻完了：用热门和随机兴趣兜底
    if (specs.length < 2) {
      add(trendingSource(this.batch + 1))
      add(exploreSource(p, this.random))
      add(exploreSource(p, this.random))
    }
    return specs.slice(0, MAX_SOURCES)
  }

  private pickRandomSources(topics: Set<string>, round: number, cursors: Record<string, Cursor>, mode: RecommendationMode): SourceSpec[] {
    const specs: SourceSpec[] = []
    const used = new Set<string>()
    const selected = mode === 'taste' ? shuffle([...topics], this.random) : []
    for (let attempt = 0; attempt < 64 && specs.length < MAX_SOURCES; attempt++) {
      const familiar = mode === 'taste' && specs.length < MAX_SOURCES * this.tasteFamiliarShare
      const topic = familiar ? selected[(specs.length + attempt) % selected.length] : undefined
      const spec = randomSource(this.random, attempt, this.batch, round, topic, mode === 'taste' && !familiar ? selected : [])
      if (used.has(spec.key) || cursors[spec.key]?.done) continue
      specs.push(spec)
      used.add(spec.key)
    }
    return specs
  }

  private passes(repo: Repo, p: Profile, ctx: EngineContext) {
    const n = repo.nameWithOwner.toLowerCase()
    if (repo.isArchived || repo.owner.toLowerCase() === this.login.toLowerCase()) return false
    if (ctx.isStarred(repo) || p.starred.has(n)) return false
    if (p.disliked.has(n)) return false
    if (repo.language && p.blockedLangs.has(repo.language)) return false
    if (repo.topics.some((t) => p.blockedTopics.has(t))) return false
    if (this.sessionSeen.has(n)) return false
    const seenAt = ctx.lib.seen[n] ?? ctx.lib.seen[repo.nameWithOwner]
    if (seenAt && Date.now() - seenAt < SEEN_TTL) return false
    return true
  }

  private score(repo: Repo, p: Profile): number {
    let t = 0
    for (const topic of repo.topics) t += Math.max(-2, p.topicW.get(topic) ?? 0)
    t = t / p.maxT / Math.sqrt(Math.max(1, repo.topics.length)) * 2
    const l = repo.language ? (p.langW.get(repo.language) ?? 0) / p.maxL : 0
    const affinity = Math.max(-1, Math.min(1.5, t + 0.5 * l))
    const popularity = Math.min(1, Math.log10(repo.stars + 1) / 5)
    const freshness = Math.exp(-daysSince(repo.pushedAt) / 45)
    const noDesc = repo.description ? 0 : -0.15
    return 0.5 * affinity + 0.25 * popularity + 0.15 * freshness + noDesc + 0.12 * this.random()
  }

  /** 打散：同作者、同语言、同来源不要连在一起 */
  private diversify(cands: Candidate[], size: number): Candidate[] {
    const pool = [...cands]
    const picked: Candidate[] = []
    while (picked.length < size && pool.length) {
      let bestI = 0
      let best = -Infinity
      const recent = picked.slice(-4)
      const last = picked[picked.length - 1]
      pool.forEach((c, i) => {
        let s = c.score
        if (recent.some((x) => x.repo.owner === c.repo.owner)) s -= 0.35
        if (recent.slice(-2).some((x) => x.repo.language && x.repo.language === c.repo.language)) s -= 0.08
        if (last && last.src === c.src) s -= 0.12
        else if (recent.slice(-3).some((x) => x.src === c.src)) s -= 0.06
        if (s > best) {
          best = s
          bestI = i
        }
      })
      picked.push(pool.splice(bestI, 1)[0])
    }
    return picked
  }

  private followingPicks(p: Profile, ctx: EngineContext, exclude: Set<string>): Candidate[] {
    const byRepo = new Map<string, { repo: Repo; users: Map<string, FollowingStar>; weight: number }>()
    const now = Date.now()
    for (const f of ctx.following) {
      const multiplier = followingWeight(ctx.lib, f.login)
      if (multiplier === 0 || followingFreshness(f.starredAt, now) === 0) continue
      const n = f.repo.nameWithOwner.toLowerCase()
      if (exclude.has(n) || !this.passes(f.repo, p, ctx)) continue
      const e = byRepo.get(n) ?? { repo: f.repo, users: new Map<string, FollowingStar>(), weight: 0 }
      const login = f.login.toLowerCase()
      const prior = e.users.get(login)
      if (prior && prior.starredAt >= f.starredAt) continue
      if (prior) e.weight -= multiplier * followingFreshness(prior.starredAt, now)
      e.users.set(login, f)
      e.weight += multiplier * followingFreshness(f.starredAt, now)
      byRepo.set(n, e)
    }
    return shuffle([...byRepo.values()], this.random)
      .sort((a, b) => b.weight - a.weight).slice(0, 2).map(({ repo, users, weight }) => {
        const people = [...users.values()].sort((a, b) => followingWeight(ctx.lib, b.login) * followingFreshness(b.starredAt, now)
          - followingWeight(ctx.lib, a.login) * followingFreshness(a.starredAt, now))
        return {
          repo,
          src: 'following',
          score: weight,
          reason: {
            kind: 'following',
            text: people.length > 1 ? `@${people[0].login} 等 ${people.length} 人 Star 了` : `@${people[0].login} Star 了`,
            avatar: people[0].avatarUrl,
          },
        }
      })
  }

  async next(ctx: EngineContext): Promise<FeedItem[]> {
    const generation = ++this.generation
    const assertCurrent = () => {
      if (generation !== this.generation || ctx.isCurrent?.() === false) throw new StaleRecommendationRequest()
    }
    assertCurrent()
    const topics = selectedInterestTopics(ctx.lib)
    // UI 同时禁用无有效手选兴趣的换口味；直接调用引擎也回到正常排序。
    const mode = this.mode === 'taste' && !topics.size ? 'normal' : this.mode
    const p = buildProfile(ctx.seeds, ctx.lib, mode === 'normal' ? ctx.following : [])
    // 请求期间只修改副本；失败或失效不会提交部分游标。
    const cursors = Object.fromEntries(Object.entries(this.cursors).map(([key, value]) => [key, { ...value }]))
    const cands = new Map<string, Candidate>()
    const familiarTarget = Math.round(BATCH_SIZE * this.tasteFamiliarShare)
    const isFamiliar = (repo: Repo) => repo.topics.some((topic) => topics.has(topic))
    const enough = () => {
      if (mode !== 'taste') return cands.size >= BATCH_SIZE
      const familiarCount = [...cands.values()].filter((candidate) => isFamiliar(candidate.repo)).length
      return familiarCount >= familiarTarget && cands.size - familiarCount >= BATCH_SIZE - familiarTarget
    }
    let recycled = false

    for (let round = 0; round < MAX_ROUNDS && !enough(); round++) {
      let specs = mode === 'normal' ? this.pickSources(p, round, cursors) : this.pickRandomSources(topics, round, cursors, mode)
      if (!specs.length && mode === 'normal' && !recycled) {
        recycled = true
        for (const cursor of Object.values(cursors)) { cursor.after = null; cursor.done = false }
        specs = this.pickSources(p, round, cursors)
      }
      if (!specs.length) break
      let pages
      try {
        pages = await this.search(specs.map((s) => ({ query: s.query, after: cursors[s.key]?.after ?? null, first: 12 })))
      } catch (error) {
        assertCurrent()
        throw error
      }
      assertCurrent()
      pages.forEach((page, i) => {
        const spec = specs[i]
        if (!page || !spec) return
        cursors[spec.key] = { after: page.endCursor, done: !page.hasNextPage, at: Date.now() }
        for (const repo of page.repos) {
          const n = repo.nameWithOwner.toLowerCase()
          const existing = cands.get(n)
          if (existing) {
            if (mode === 'normal') existing.score += 0.05 // 正常模式保留多源召回加分
            continue
          }
          if (!this.passes(repo, p, ctx)) continue
          const reason: Reason = mode === 'taste'
            ? { kind: 'explore', text: isFamiliar(repo) ? '已选兴趣内随机探索' : '已选兴趣外随机探索' }
            : spec.reason
          cands.set(n, { repo, reason, src: spec.key, score: mode === 'normal' ? this.score(repo, p) : 0 })
        }
      })
    }
    let ranked: Candidate[]
    if (mode === 'normal') {
      ranked = this.diversify([...cands.values()], BATCH_SIZE)
      const social = this.followingPicks(p, ctx, new Set(ranked.map((c) => c.repo.nameWithOwner.toLowerCase())))
      // 正常模式保留第 3 和第 10 个位置附近的社交插槽。
      social.forEach((s, i) => ranked.splice(Math.min(ranked.length, i === 0 ? 2 : 9), 0, s))
    } else if (mode === 'random') {
      ranked = shuffle([...cands.values()], this.random).slice(0, BATCH_SIZE)
    } else {
      const familiar = shuffle([...cands.values()].filter((candidate) => isFamiliar(candidate.repo)), this.random)
      const unfamiliar = shuffle([...cands.values()].filter((candidate) => !isFamiliar(candidate.repo)), this.random)
      const chosen = [...familiar.slice(0, familiarTarget), ...unfamiliar.slice(0, BATCH_SIZE - familiarTarget)]
      const remaining = [...familiar.slice(familiarTarget), ...unfamiliar.slice(BATCH_SIZE - familiarTarget)]
      ranked = shuffle([...chosen, ...shuffle(remaining, this.random).slice(0, BATCH_SIZE - chosen.length)], this.random)
    }
    assertCurrent()
    this.cursors = Object.fromEntries(Object.entries(cursors).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CURSORS))
    this.saveCursors()
    this.batch++
    for (const c of ranked) this.sessionSeen.add(c.repo.nameWithOwner.toLowerCase())

    return ranked.map((c) => ({ key: `${c.repo.nameWithOwner}#${this.mode}:${this.batch}`, repo: c.repo, reason: c.reason }))
  }
}

const engines = new Map<string, RecommendEngine>()
export function getEngine(login: string, mode: RecommendationMode = 'normal') {
  const key = `${login.toLowerCase()}:${mode}`
  let e = engines.get(key)
  if (!e) {
    e = new RecommendEngine(login, mode)
    engines.set(key, e)
  }
  return e
}

/** 清理某账号所有模式的曝光、在途请求和持久游标，保留其他账号。 */
export function resetEngines(login: string) {
  const account = login.toLowerCase()
  for (const [key, engine] of engines) {
    if (!key.startsWith(`${account}:`)) continue
    engine.reset()
    engines.delete(key)
  }
  try {
    for (const suffix of ['', ':taste', ':random']) localStorage.removeItem(`gitube:cursors:${account}${suffix}`)
  } catch {
    /* 存储不可用时，内存状态仍已清理。 */
  }
}
