import { create } from 'zustand'
import { fetchFollowingStars, fetchSeeds, type Seeds } from '../api/github'
import type { FollowingStar } from '../api/types'

/** 构建推荐画像需要的数据（每次打开应用加载一次） */
interface SeedState {
  seeds: Seeds | null
  following: FollowingStar[] | null
  loadSeeds: () => Promise<Seeds>
  loadFollowing: () => Promise<FollowingStar[]>
  reset: () => void
}

let seedsPromise: Promise<Seeds> | null = null
let followingPromise: Promise<FollowingStar[]> | null = null

export const useSeeds = create<SeedState>((set, get) => ({
  seeds: null,
  following: null,

  loadSeeds() {
    const cur = get().seeds
    if (cur) return Promise.resolve(cur)
    if (!seedsPromise) {
      seedsPromise = fetchSeeds()
        .then((seeds) => {
          set({ seeds })
          return seeds
        })
        .finally(() => {
          seedsPromise = null
        })
    }
    return seedsPromise
  },

  loadFollowing() {
    const cur = get().following
    if (cur) return Promise.resolve(cur)
    if (!followingPromise) {
      followingPromise = fetchFollowingStars()
        .then((following) => {
          set({ following })
          return following
        })
        .catch((err) => {
          console.warn('加载关注动态失败', err)
          set({ following: [] })
          return [] as FollowingStar[]
        })
        .finally(() => {
          followingPromise = null
        })
    }
    return followingPromise
  },

  reset() {
    set({ seeds: null, following: null })
  },
}))
