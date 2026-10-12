import { create } from 'zustand'
import { setStarred } from '../api/github'
import type { Repo } from '../api/types'
import { useLibrary } from './library'
import { toast, toastError } from './toast'

/**
 * Star 状态的「覆盖层」：同一个仓库可能同时出现在推荐流、详情页、相关推荐里，
 * 在任意位置 Star 之后，所有位置都要立刻变成已 Star。
 */
interface StarEntry {
  starred: boolean
  stars: number
}

interface StarState {
  overrides: Record<string, StarEntry>
  pending: Record<string, boolean>
  toggle: (repo: Repo) => Promise<boolean>
  ensureStarred: (repo: Repo) => Promise<boolean>
  reset: () => void
}

export const useStars = create<StarState>((set, get) => {
  let generation = 0
  const apply = async (repo: Repo, want: boolean, silent = false) => {
    const requestGeneration = generation
    const { overrides, pending } = get()
    if (pending[repo.id]) return want
    const prev = overrides[repo.id] ?? { starred: repo.viewerHasStarred, stars: repo.stars }
    if (prev.starred === want) return want

    // 乐观更新：先把界面改了，再请求 GitHub
    set({
      overrides: { ...overrides, [repo.id]: { starred: want, stars: prev.stars + (want ? 1 : -1) } },
      pending: { ...pending, [repo.id]: true },
    })
    try {
      const res = await setStarred(repo.id, want)
      if (requestGeneration !== generation) return prev.starred
      set({ overrides: { ...get().overrides, [repo.id]: { starred: res.starred, stars: res.stars } } })
      if (want) useLibrary.getState().addEvent('star', repo)
      if (!silent) toast(want ? `已 Star ${repo.name}` : `已取消 Star ${repo.name}`)
      return res.starred
    } catch (err) {
      if (requestGeneration !== generation) return prev.starred
      set({ overrides: { ...get().overrides, [repo.id]: prev } })
      toastError(err)
      return prev.starred
    } finally {
      if (requestGeneration === generation) {
        const { [repo.id]: _drop, ...rest } = get().pending
        set({ pending: rest })
      }
    }
  }

  return {
    overrides: {},
    pending: {},
    toggle: (repo) => {
      const cur = get().overrides[repo.id]?.starred ?? repo.viewerHasStarred
      return apply(repo, !cur)
    },
    ensureStarred: (repo) => apply(repo, true, true),
    reset: () => {
      generation++
      set({ overrides: {}, pending: {} })
    },
  }
})

export function useStarState(repo: Repo) {
  const o = useStars((s) => s.overrides[repo.id])
  const pending = useStars((s) => !!s.pending[repo.id])
  return {
    starred: o?.starred ?? repo.viewerHasStarred,
    stars: o?.stars ?? repo.stars,
    pending,
  }
}

export function isStarredNow(repo: Repo) {
  return useStars.getState().overrides[repo.id]?.starred ?? repo.viewerHasStarred
}
