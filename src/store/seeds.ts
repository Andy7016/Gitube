import { create } from 'zustand'
import { fetchFollowingStars, fetchSeeds, type Seeds } from '../api/github'
import type { FollowingStar } from '../api/types'
import { useAuth } from './auth'

/** 构建推荐画像需要的数据（每次打开应用加载一次）。 */
interface SeedState {
  seeds: Seeds | null
  following: FollowingStar[] | null
  loadSeeds: () => Promise<Seeds>
  loadFollowing: () => Promise<FollowingStar[]>
  clearFollowing: () => void
  reset: () => void
}

let seedsPromise: Promise<Seeds> | null = null
let followingPromise: Promise<FollowingStar[]> | null = null
let generation = 0
let followingGeneration = 0

export const useSeeds = create<SeedState>((set, get) => ({
  seeds: null,
  following: null,

  loadSeeds() {
    const cur = get().seeds
    if (cur) return Promise.resolve(cur)
    if (!seedsPromise) {
      const requestGeneration = generation
      const promise = fetchSeeds()
        .then((seeds) => {
          if (requestGeneration === generation) set({ seeds })
          return seeds
        })
        .finally(() => {
          if (seedsPromise === promise) seedsPromise = null
        })
      seedsPromise = promise
    }
    return seedsPromise
  },

  loadFollowing() {
    const cur = get().following
    if (cur) return Promise.resolve(cur)
    if (!followingPromise) {
      const requestGeneration = generation
      const requestFollowingGeneration = followingGeneration
      const isCurrent = () => requestGeneration === generation && requestFollowingGeneration === followingGeneration
      const promise = fetchFollowingStars()
        .then((following) => {
          if (isCurrent()) set({ following })
          return following
        })
        .catch((err) => {
          if (isCurrent()) {
            console.warn('加载关注动态失败', err)
            set({ following: [] })
          }
          return [] as FollowingStar[]
        })
        .finally(() => {
          if (followingPromise === promise) followingPromise = null
        })
      followingPromise = promise
    }
    return followingPromise
  },

  clearFollowing() {
    followingGeneration++
    followingPromise = null
    set({ following: null })
  },

  reset() {
    generation++
    seedsPromise = null
    followingPromise = null
    set({ seeds: null, following: null })
  },
}))

// 即使调用方未挂载 main.tsx，也不能在账号边界复用旧账号的缓存或 promise。
useAuth.subscribe((auth, prev) => {
  if (auth.viewer?.login.toLowerCase() !== prev.viewer?.login.toLowerCase() || auth.token !== prev.token) {
    useSeeds.getState().reset()
  }
})
