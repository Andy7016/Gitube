/**
 * 推荐引擎（全部在浏览器里运行）
 *
 *  1. 画像：从「最近的 Star、自己的仓库、选择的兴趣、在本应用里的行为」统计出
 *     每个 topic / 语言的权重。越新的行为权重越高（30 天半衰期）。
 *  2. 召回：按权重抽几个 topic / 语言，再加上「和你 Star 过的项目相似」「本周新星」
 *     「换换口味」等来源，拼成一次 GraphQL 请求里的多个搜索。
 *  3. 过滤：去掉已 Star、点过不感兴趣、屏蔽的 topic / 语言、最近 3 天推荐过的。
 *  4. 排序：兴趣匹配度 + 热度 + 活跃度 + 一点随机，再做打散（同作者、同语言、同来源不扎堆）。
 *  5. 插入「你关注的人 Star 了」的社交推荐。
 */
import { searchMany, type Seeds } from '../api/github'
import type { FeedItem, FollowingStar, Reason, Repo } from '../api/types'
import type { EventKind, LibraryData } from '../store/library'
import { daysSince, isoDaysAgo } from './format'
import { INTERESTS, INTEREST_BY_ID, TOPIC_STOPLIST } from './interests'

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

function weightedPick<T>(items: [T, number][]): T | null {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0)
  if (total <= 0) return null
  let r = Math.random() * total
  for (const [item, w] of items) {
    r -= Math.max(0, w)
    if (r <= 0) return item
  }
  return items[items.length - 1][0]
}

type Variant = 'best' | 'active' | 'rising'

/** 同一个 topic 的三种搜法：经典高星 / 最近活跃 / 一年内的新项目 */
function shuffledVariants(): Variant[] {
  const r = Math.random()
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

function similarSource(repo: Repo): SourceSpec | null {
  const topics = repo.topics.filter((t) => !TOPIC_STOPLIST.has(t)).slice(0, 4)
  if (topics.length < 2) return null
  const shuffled = [...topics].sort(() => Math.random() - 0.5).slice(0, 2).sort()
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

function exploreSource(p: Profile): SourceSpec | null {
  // 选一个用户画像里几乎没有的兴趣标签，帮他跳出信息茧房
  const fresh = INTERESTS.filter(
    (i) => (p.topicW.get(i.topics[0]) ?? 0) < 0.5 && !p.blockedTopics.has(i.topics[0]),
  )
  if (!fresh.length) return null
  const it = fresh[Math.floor(Math.random() * fresh.length)]
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
}

const BATCH_SIZE = 18
const CURSOR_TTL = 3 * 24 * 3600_000
const SEEN_TTL = 3 * 24 * 3600_000

export interface RecommendationOptions {
  searchMany?: typeof searchMany
  random?: () => number
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export class RecommendEngine {
  private cursors: Record<string, Cursor> = {}
  private batch = 0
  private sessionSeen = new Set<string>()
  private recycled = false
  private readonly storageKey: string

  private readonly search: typeof searchMany
  private readonly random: () => number

  constructor(private readonly login: string, options: RecommendationOptions = {}) {
    this.search = options.searchMany ?? searchMany
    this.random = options.random ?? Math.random
    this.storageKey = `gitube:cursors:${login.toLowerCase()}`
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey) ?? '{}') as Record<string, Cursor>
      const now = Date.now()
      this.cursors = Object.fromEntries(Object.entries(raw).filter(([, c]) => now - c.at < CURSOR_TTL))
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
    this.cursors = {}
    this.sessionSeen.clear()
    this.batch = 0
    this.saveCursors()
  }

  private isDone(key: string) {
    return !!this.cursors[key]?.done
  }

  private pickSources(p: Profile, round: number): SourceSpec[] {
    const specs: SourceSpec[] = []
    const used = new Set<string>()
    const add = (s: SourceSpec | null) => {
      if (!s || used.has(s.key) || this.isDone(s.key)) return false
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
      const t = weightedPick(topics)
      if (!t) break
      topics.splice(topics.findIndex(([x]) => x === t), 1)
      // 这个 topic 的某种搜法翻到底了，就换另一种
      if (shuffledVariants().some((v) => add(topicSource(t, p, v)))) added++
    }

    // 和最近 Star 的某个项目相似
    if (p.recentStars.length) {
      const n = Math.min(p.recentStars.length, 15)
      for (let i = 0; i < 3; i++) {
        if (add(similarSource(p.recentStars[(this.batch * 3 + round + i) % n]))) break
      }
    }

    // 常用语言的新项目（隔一屏来一次）
    if ((this.batch + round) % 2 === 0) {
      const langs = [...p.langW.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 5)
      const lang = weightedPick(langs)
      if (lang) add(languageSource(lang))
    }

    if (round === 0) add(trendingSource(this.batch)) || add(trendingSource(this.batch + 1))
    if (round === 0 && this.batch % 2 === 1) add(exploreSource(p))

    // 新用户没有画像，或者能翻的都翻完了：用热门和随机兴趣兜底
    if (specs.length < 2) {
      add(trendingSource(this.batch + 1))
      add(exploreSource(p))
      add(exploreSource(p))
    }
    return specs
  }

  /** 所有来源都翻到底时，把翻页进度清零重新来（已推荐过的仍会被过滤掉） */
  private recycle() {
    for (const c of Object.values(this.cursors)) {
      c.after = null
      c.done = false
    }
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
    return 0.5 * affinity + 0.25 * popularity + 0.15 * freshness + noDesc + 0.12 * Math.random()
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
    const p = buildProfile(ctx.seeds, ctx.lib, ctx.following)
    const cands = new Map<string, Candidate>()

    for (let round = 0; round < 3 && cands.size < BATCH_SIZE; round++) {
      const specs = this.pickSources(p, round)
      if (!specs.length) break
      const pages = await this.search(
        specs.map((s) => ({ query: s.query, after: this.cursors[s.key]?.after ?? null, first: 12 })),
      )
      pages.forEach((page, i) => {
        const spec = specs[i]
        if (!page) return
        this.cursors[spec.key] = { after: page.endCursor, done: !page.hasNextPage, at: Date.now() }
        for (const repo of page.repos) {
          const n = repo.nameWithOwner.toLowerCase()
          const existing = cands.get(n)
          if (existing) {
            existing.score += 0.05 // 多个来源都召回了它，稍微加分
            continue
          }
          if (!this.passes(repo, p, ctx)) continue
          cands.set(n, { repo, reason: spec.reason, src: spec.key, score: this.score(repo, p) })
        }
      })
    }
    if (cands.size === 0 && !this.recycled) {
      this.recycled = true
      this.recycle()
      this.saveCursors()
      return this.next(ctx)
    }
    this.recycled = false
    this.saveCursors()

    const ranked = this.diversify([...cands.values()], BATCH_SIZE)
    const social = this.followingPicks(p, ctx, new Set(ranked.map((c) => c.repo.nameWithOwner.toLowerCase())))
    // 把社交推荐插在第 3 和第 10 个位置附近
    social.forEach((s, i) => ranked.splice(Math.min(ranked.length, i === 0 ? 2 : 9), 0, s))

    this.batch++
    for (const c of ranked) this.sessionSeen.add(c.repo.nameWithOwner.toLowerCase())

    return ranked.map((c) => ({ key: `${c.repo.nameWithOwner}#${this.batch}`, repo: c.repo, reason: c.reason }))
  }
}

const engines = new Map<string, RecommendEngine>()
export function getEngine(login: string) {
  let e = engines.get(login)
  if (!e) {
    e = new RecommendEngine(login)
    engines.set(login, e)
  }
  return e
}
