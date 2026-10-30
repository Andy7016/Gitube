import { create } from 'zustand'
import { searchRepos } from '../api/github'
import type { FeedItem, FollowingStar, Repo } from '../api/types'
import { findChannel } from '../lib/channels'
import { getEngine } from '../lib/recommend'
import type { RecommendationMode } from '../lib/recommendationMode'
import { useAuth } from './auth'
import { useLibrary, type DislikeReason, type LibraryData } from './library'
import { useSeeds } from './seeds'
import { isStarredNow } from './stars'

/** 本次应用运行中的列表和滚动位置，按账号、频道、推荐模式隔离。 */
export interface ChannelFeed {
  items: FeedItem[]
  status: 'idle' | 'loading' | 'error' | 'end'
  error: string | null
  cursor: string | null
  scrollY: number
  /** 换批时让网格重新开始；普通分页不改变它。 */
  snapshot: number
}

export interface Dismissed {
  label: string
  reason: DislikeReason
}

export function feedKey(login: string, channelId: string, mode: RecommendationMode = 'normal'): string {
  return JSON.stringify([login.toLowerCase(), channelId, channelId === 'foryou' ? mode : 'normal'])
}

/** 保留刚操作的撤销卡片，同时立即隐藏缓存中的其他屏蔽和已 Star 内容。 */
export function visibleFeedItems(
  items: FeedItem[],
  lib: Pick<LibraryData, 'dislikedRepos' | 'blockedTopics' | 'blockedLangs'>,
  isStarred: (repo: Repo) => boolean,
  dismissed: Record<string, Dismissed> = {},
): FeedItem[] {
  const disliked = new Set(lib.dislikedRepos.map((name) => name.toLowerCase()))
  const topics = new Set(lib.blockedTopics)
  const langs = new Set(lib.blockedLangs)
  return items.filter(({ repo }) => !isStarred(repo) && (dismissed[repo.nameWithOwner] || (
    !disliked.has(repo.nameWithOwner.toLowerCase()) &&
    !(repo.language && langs.has(repo.language)) &&
    !repo.topics.some((topic) => topics.has(topic))
  )))
}

/** 整批被反馈筛除时显示空态，不能当成尚未加载的第一页。 */
export function feedDisplayStatus(feed: ChannelFeed | undefined, visibleCount: number): ChannelFeed['status'] {
  if (feed?.items.length && !visibleCount && feed.status === 'idle') return 'end'
  return feed?.status ?? 'idle'
}

let snapshot = 0
const emptyChannel = (): ChannelFeed => ({ items: [], status: 'idle', error: null, cursor: null, scrollY: 0, snapshot: ++snapshot })

interface FeedState {
  channels: Record<string, ChannelFeed>
  /** 刚点了不感兴趣的仓库 -> 提示和原因（用于撤销）。 */
  dismissed: Record<string, Dismissed>
  activate: (channelId: string, mode?: RecommendationMode) => void
  loadMore: (channelId: string, mode?: RecommendationMode) => Promise<void>
  refresh: (channelId: string, mode?: RecommendationMode) => Promise<void>
  saveScroll: (channelId: string, y: number, mode?: RecommendationMode, login?: string) => void
  clearChannel: (channelId: string, mode?: RecommendationMode) => void
  dismiss: (name: string, d: Dismissed) => void
  undismiss: (name: string) => void
  resetAll: () => void
}

function groupFollowing(list: FollowingStar[]): FeedItem[] {
  const byRepo = new Map<string, { repo: Repo; users: FollowingStar[] }>()
  for (const f of list) {
    const key = f.repo.nameWithOwner.toLowerCase()
    const e = byRepo.get(key) ?? { repo: f.repo, users: [] }
    e.users.push(f)
    byRepo.set(key, e)
  }
  return [...byRepo.values()].map(({ repo, users }) => ({
    key: `follow:${repo.nameWithOwner}`,
    repo,
    reason: {
      kind: 'following',
      text: users.length > 1 ? `@${users[0].login} 等 ${users.length} 人 Star 了` : `@${users[0].login} Star 了`,
      avatar: users[0].avatarUrl,
    },
  }))
}

export const useFeed = create<FeedState>((set, get) => {
  let generation = 0
  let activeKey: string | null = null
  const keyGenerations = new Map<string, number>()
  const currentMode = () => useLibrary.getState().recommendationMode
  const currentKey = (channelId: string, mode = currentMode()) =>
    feedKey(useAuth.getState().viewer?.login ?? '', channelId, mode)
  const patch = (key: string, p: Partial<ChannelFeed>) =>
    set({ channels: { ...get().channels, [key]: { ...(get().channels[key] ?? emptyChannel()), ...p } } })
  const invalidatePending = () => {
    generation++
    // 失效请求不会再写状态；缓存也不能永久留在 loading。
    const channels = { ...get().channels }
    let changed = false
    for (const [key, feed] of Object.entries(channels)) {
      if (feed.status !== 'loading') continue
      channels[key] = { ...feed, status: 'idle', error: null }
      changed = true
    }
    if (changed) set({ channels })
  }

  useAuth.subscribe((auth, prev) => {
    if (auth.viewer?.login.toLowerCase() === prev.viewer?.login.toLowerCase() && auth.token === prev.token) return
    activeKey = null
    invalidatePending()
    set({ dismissed: {} })
  })
  useLibrary.subscribe((lib, prev) => {
    if (lib.recommendationRevision !== prev.recommendationRevision) {
      get().resetAll()
    } else if (lib.recommendationMode !== prev.recommendationMode) {
      activeKey = null
      invalidatePending()
    }
  })

  return {
    channels: {},
    dismissed: {},

    activate(channelId, mode = currentMode()) {
      const key = currentKey(channelId, mode)
      if (key === activeKey) return
      activeKey = key
      invalidatePending()
    },

    async loadMore(channelId, mode = currentMode()) {
      // 已卸载网格排队的 observer 回调不能重新激活旧模式。
      if (channelId === 'foryou' && mode !== currentMode()) return
      get().activate(channelId, mode)
      const auth = useAuth.getState()
      const login = auth.viewer?.login
      const key = currentKey(channelId, mode)
      const cur = get().channels[key] ?? emptyChannel()
      if (cur.status === 'loading' || cur.status === 'end') return
      const requestGeneration = generation
      const keyGeneration = keyGenerations.get(key) ?? 0
      const revision = useLibrary.getState().recommendationRevision
      const isCurrent = () => generation === requestGeneration &&
        (keyGenerations.get(key) ?? 0) === keyGeneration &&
        useAuth.getState().viewer?.login.toLowerCase() === login?.toLowerCase() &&
        useAuth.getState().token === auth.token &&
        useLibrary.getState().recommendationRevision === revision &&
        (channelId !== 'foryou' || useLibrary.getState().recommendationMode === mode)
      patch(key, { ...cur, status: 'loading', error: null })

      try {
        if (!login) throw new Error('还没有登录')
        let newItems: FeedItem[]
        let cursor = cur.cursor
        let end = false

        if (channelId === 'foryou') {
          const [seeds, following] = await Promise.all([
            useSeeds.getState().loadSeeds(),
            useSeeds.getState().loadFollowing(),
          ])
          if (!isCurrent()) return
          newItems = await getEngine(login, mode).next({
            seeds,
            following,
            lib: useLibrary.getState(),
            isStarred: isStarredNow,
            isCurrent,
          })
          if (!isCurrent()) return
          useLibrary.getState().markSeen(newItems.map((item) => item.repo.nameWithOwner))
          end = newItems.length === 0
        } else if (channelId === 'following') {
          const following = await useSeeds.getState().loadFollowing()
          if (!isCurrent()) return
          newItems = groupFollowing(following)
          end = true
        } else {
          const ch = findChannel(channelId, useLibrary.getState().interests)
          if (!ch.query) throw new Error('未知频道')
          const page = await searchRepos(ch.query(), cur.cursor, 18)
          if (!isCurrent()) return
          newItems = page.repos.map((repo) => ({ key: `${channelId}:${repo.nameWithOwner}`, repo }))
          cursor = page.endCursor
          end = !page.hasNextPage
        }

        if (!isCurrent()) return
        const latest = get().channels[key] ?? cur
        const existing = new Set(latest.items.map((item) => item.repo.nameWithOwner.toLowerCase()))
        const merged = [...latest.items]
        for (const item of newItems) {
          const name = item.repo.nameWithOwner.toLowerCase()
          if (existing.has(name)) continue
          existing.add(name)
          merged.push(item)
        }
        patch(key, { items: merged, cursor, status: end ? 'end' : 'idle' })
      } catch (err) {
        if (!isCurrent()) return
        patch(key, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    },

    async refresh(channelId, mode = currentMode()) {
      if (channelId === 'foryou' && mode !== currentMode()) return
      const key = currentKey(channelId, mode)
      keyGenerations.set(key, (keyGenerations.get(key) ?? 0) + 1)
      patch(key, emptyChannel())
      if (channelId === 'following') useSeeds.getState().clearFollowing()
      await get().loadMore(channelId, mode)
    },

    saveScroll(channelId, y, mode = currentMode(), login = useAuth.getState().viewer?.login ?? '') {
      const ch = get().channels[feedKey(login, channelId, mode)]
      if (ch) ch.scrollY = y // 高频滚动不触发渲染。
    },

    clearChannel(channelId, mode = currentMode()) {
      const key = currentKey(channelId, mode)
      keyGenerations.set(key, (keyGenerations.get(key) ?? 0) + 1)
      const { [key]: _drop, ...rest } = get().channels
      set({ channels: rest })
    },

    dismiss(name, d) {
      set({ dismissed: { ...get().dismissed, [name]: d } })
    },
    undismiss(name) {
      const { [name]: _drop, ...rest } = get().dismissed
      set({ dismissed: rest })
    },

    resetAll() {
      generation++
      activeKey = null
      keyGenerations.clear()
      set({ channels: {}, dismissed: {} })
    },
  }
})
