import { create } from 'zustand'
import { searchRepos, isAbort } from '../api/github'
import type { FeedItem, FollowingStar, Repo } from '../api/types'
import { findChannel } from '../lib/channels'
import { getEngine } from '../lib/recommend'
import { useAuth } from './auth'
import { useLibrary, type DislikeReason, type LibraryData, type RecommendationMode } from './library'
import { useSeeds } from './seeds'
import { isStarredNow } from './stars'

/**
 * 每个频道的信息流状态。放在全局 store 里，
 * 这样从详情页返回首页时，列表和滚动位置都还在（和刷视频网站的体验一致）。
 */
export interface ChannelFeed {
  items: FeedItem[]
  status: 'idle' | 'loading' | 'error' | 'end'
  error: string | null
  cursor: string | null
  scrollY: number
}

export interface Dismissed {
  label: string
  reason: DislikeReason
}

const emptyChannel = (): ChannelFeed => ({ items: [], status: 'idle', error: null, cursor: null, scrollY: 0 })

/** A channel belongs to one account; only recommendations additionally vary by mode. */
export function feedKey(channelId: string, mode: RecommendationMode, account: string): string {
  return JSON.stringify([account.toLowerCase(), channelId, channelId === 'foryou' ? mode : null])
}

const runtime = `${Date.now()}:${Math.random()}`
export function feedSnapshotToken(key: string): string {
  return `${runtime}:${generation}:${channelGeneration[key] ?? 0}`
}

/** Dismissed cards retain their undo control, but never reveal the blocked repository. */
export function visibleFeedItems(items: FeedItem[], lib: Pick<LibraryData, 'dislikedRepos' | 'blockedTopics' | 'blockedLangs'>, starred: (repo: Repo) => boolean, dismissed: Record<string, Dismissed> = {}): FeedItem[] {
  const disliked = new Set(lib.dislikedRepos.map(name => name.toLowerCase()))
  const topics = new Set(lib.blockedTopics)
  const langs = new Set(lib.blockedLangs)
  return items.filter(({ repo }) => !!dismissed[repo.nameWithOwner] || (!disliked.has(repo.nameWithOwner.toLowerCase()) && !repo.topics.some(topic => topics.has(topic)) && !langs.has(repo.language ?? '') && !starred(repo)))
}

export function feedDisplayStatus(feed: ChannelFeed | undefined, visibleCount: number): ChannelFeed['status'] {
  const status = feed?.status ?? 'idle'
  return status === 'idle' && !!feed?.items.length && visibleCount === 0 ? 'end' : status
}

interface FeedState {
  channels: Record<string, ChannelFeed>
  /** 点了「不感兴趣」的仓库 -> 提示文字和原因（用于撤销） */
  dismissed: Record<string, Dismissed>
  loadMore: (channelId: string, mode?: RecommendationMode, account?: string) => Promise<void>
  refresh: (channelId: string, mode?: RecommendationMode, account?: string) => Promise<void>
  saveScroll: (key: string, y: number) => void
  cancelPending: (channelId: string, mode?: RecommendationMode, account?: string) => void
  restoreChannel: (key: string, feed: ChannelFeed, token?: string) => void
  clearChannel: (channelId: string) => void
  dismiss: (name: string, d: Dismissed) => void
  undismiss: (name: string) => void
  resetAll: (allowHistoryRestore?: boolean) => void
}

function groupFollowing(list: FollowingStar[]): FeedItem[] {
  const byRepo = new Map<string, { repo: Repo; users: FollowingStar[] }>()
  for (const f of list) {
    const e = byRepo.get(f.repo.nameWithOwner) ?? { repo: f.repo, users: [] }
    e.users.push(f)
    byRepo.set(f.repo.nameWithOwner, e)
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

let generation=0
let foreignSnapshotsAllowed=true
const channelGeneration:Record<string,number>={}
export const useFeed = create<FeedState>((set, get) => {
  const patch = (id: string, p: Partial<ChannelFeed>) =>
    set({ channels: { ...get().channels, [id]: { ...(get().channels[id] ?? emptyChannel()), ...p } } })

  return {
    channels: {},
    dismissed: {},

    async loadMore(channelId, mode = useLibrary.getState().recommendationMode, account = useAuth.getState().account) {
      if (account !== useAuth.getState().account) return
      const key = feedKey(channelId, mode, account)
      const cur = get().channels[key] ?? emptyChannel()
      if (cur.status === 'loading' || cur.status === 'end') return
      const version=generation, channelVersion=channelGeneration[key]??0
      const current=()=>version===generation&&channelVersion===(channelGeneration[key]??0)&&account===useAuth.getState().account
      patch(key, { status: 'loading', error: null })

      try {
        const lib = useLibrary.getState()
        let newItems: FeedItem[] = []
        let cursor: string | null = cur.cursor
        let end = false

        if (channelId === 'foryou') {
          const [seeds, following] = await Promise.all([
            mode === 'normal' ? useSeeds.getState().loadSeeds().catch(error=>{if(isAbort(error))throw error;return {starred:[],own:[]}}) : Promise.resolve(useSeeds.getState().seeds),
            mode === 'normal' ? useSeeds.getState().loadFollowing().catch(error=>{if(isAbort(error))throw error;return []}) : Promise.resolve([]),
          ])
          if(!current())return
          newItems = await getEngine(account, mode).next({
            seeds,
            following,
            lib: useLibrary.getState(),
            isStarred: isStarredNow,
          })
          if(!current())return
          useLibrary.getState().markSeen(newItems.map((i) => i.repo.nameWithOwner))
          end = newItems.length === 0
        } else if (channelId === 'following') {
          if(!useAuth.getState().viewer)throw new Error('登录 GitHub 后可查看关注动态')
          const following = await useSeeds.getState().loadFollowing()
          newItems = groupFollowing(following)
          end = true
        } else {
          const ch = findChannel(channelId, lib.interests)
          if (!ch.query) throw new Error('未知频道')
          const page = await searchRepos(ch.query(), cur.cursor, 18)
          const disliked = new Set(lib.dislikedRepos)
          newItems = page.repos
            .filter((r) => !disliked.has(r.nameWithOwner))
            .map((repo) => ({ key: `${channelId}:${repo.nameWithOwner}`, repo }))
          cursor = page.endCursor
          end = !page.hasNextPage
        }

        if(!current())return
        // 和已有列表去重
        const latest = get().channels[key] ?? emptyChannel()
        const existing = new Set(latest.items.map((i) => i.repo.nameWithOwner))
        const merged = [...latest.items, ...newItems.filter((i) => !existing.has(i.repo.nameWithOwner))]
        patch(key, { items: merged, cursor, status: end ? 'end' : 'idle' })
      } catch (err) {
        if(!current())return
        if(isAbort(err)){patch(key, {status:'idle'});return}
        patch(key, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    },

    async refresh(channelId, mode = useLibrary.getState().recommendationMode, account = useAuth.getState().account) {
      if(account !== useAuth.getState().account)return
      const key = feedKey(channelId, mode, account)
      if (channelId === 'foryou') getEngine(account, mode).invalidate()
      channelGeneration[key]=(channelGeneration[key]??0)+1
      patch(key, emptyChannel())
      if (channelId === 'following') useSeeds.setState({ following: null })
      await get().loadMore(channelId, mode, account)
    },

    saveScroll(key, y) {
      const ch = get().channels[key]
      if (ch && Number.isFinite(y)) ch.scrollY = Math.max(0, y) // 不触发重新渲染
    },

    cancelPending(channelId, mode = useLibrary.getState().recommendationMode, account = useAuth.getState().account) {
      const key = feedKey(channelId, mode, account)
      if (get().channels[key]?.status !== 'loading') return
      channelGeneration[key]=(channelGeneration[key]??0)+1
      if (channelId === 'foryou') getEngine(account, mode).invalidate()
      patch(key, {status:'idle', error:null})
    },

    restoreChannel(key, feed, token) {
      // A running SPA's newer batch always wins over a history entry. A reload may
      // restore the old entry, preserving the existing detail-page back contract.
      if (get().channels[key]) return
      if (token?.startsWith(`${runtime}:`) ? token !== feedSnapshotToken(key) : !foreignSnapshotsAllowed) return
      patch(key, {...feed, status:feed.status === 'loading' ? 'idle' : feed.status})
    },

    clearChannel(channelId) {
      const key = feedKey(channelId, useLibrary.getState().recommendationMode, useAuth.getState().account)
      channelGeneration[key]=(channelGeneration[key]??0)+1
      if(channelId === 'foryou')getEngine(useAuth.getState().account, useLibrary.getState().recommendationMode).invalidate()
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

    resetAll(allowHistoryRestore = false) {
      ++generation
      foreignSnapshotsAllowed = allowHistoryRestore
      set({ channels: {}, dismissed: {} })
    },
  }
})
