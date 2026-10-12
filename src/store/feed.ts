import { create } from 'zustand'
import { searchRepos } from '../api/github'
import type { FeedItem, FollowingStar, Repo } from '../api/types'
import { findChannel } from '../lib/channels'
import { getEngine } from '../lib/recommend'
import { useAuth } from './auth'
import { useLibrary, type DislikeReason } from './library'
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

interface FeedState {
  channels: Record<string, ChannelFeed>
  /** 点了「不感兴趣」的仓库 -> 提示文字和原因（用于撤销） */
  dismissed: Record<string, Dismissed>
  loadMore: (channelId: string) => Promise<void>
  refresh: (channelId: string) => Promise<void>
  saveScroll: (channelId: string, y: number) => void
  clearChannel: (channelId: string) => void
  dismiss: (name: string, d: Dismissed) => void
  undismiss: (name: string) => void
  resetAll: () => void
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

export const useFeed = create<FeedState>((set, get) => {
  const patch = (id: string, p: Partial<ChannelFeed>) =>
    set({ channels: { ...get().channels, [id]: { ...(get().channels[id] ?? emptyChannel()), ...p } } })

  return {
    channels: {},
    dismissed: {},

    async loadMore(channelId) {
      const cur = get().channels[channelId] ?? emptyChannel()
      if (cur.status === 'loading' || cur.status === 'end') return
      patch(channelId, { status: 'loading', error: null })

      try {
        const lib = useLibrary.getState()
        let newItems: FeedItem[] = []
        let cursor: string | null = cur.cursor
        let end = false

        if (channelId === 'foryou') {
          const login = useAuth.getState().viewer?.login
          if (!login) throw new Error('还没有登录')
          const [seeds, following] = await Promise.all([
            useSeeds.getState().loadSeeds(),
            useSeeds.getState().loadFollowing(),
          ])
          newItems = await getEngine(login).next({
            seeds,
            following,
            lib: useLibrary.getState(),
            isStarred: isStarredNow,
          })
          useLibrary.getState().markSeen(newItems.map((i) => i.repo.nameWithOwner))
          end = newItems.length === 0
        } else if (channelId === 'following') {
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

        // 和已有列表去重
        const latest = get().channels[channelId] ?? emptyChannel()
        const existing = new Set(latest.items.map((i) => i.repo.nameWithOwner))
        const merged = [...latest.items, ...newItems.filter((i) => !existing.has(i.repo.nameWithOwner))]
        patch(channelId, { items: merged, cursor, status: end ? 'end' : 'idle' })
      } catch (err) {
        patch(channelId, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    },

    async refresh(channelId) {
      patch(channelId, { ...emptyChannel() })
      if (channelId === 'following') useSeeds.setState({ following: null })
      await get().loadMore(channelId)
    },

    saveScroll(channelId, y) {
      const ch = get().channels[channelId]
      if (ch) ch.scrollY = y // 不触发重新渲染
    },

    clearChannel(channelId) {
      const { [channelId]: _drop, ...rest } = get().channels
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
      set({ channels: {}, dismissed: {} })
    },
  }
})
