import { INTEREST_BY_ID } from './interests'

export type RecommendationMode = 'normal' | 'taste' | 'random'

/** 换口味的实验目标；一侧候选不足时由另一侧补足。 */
export const TASTE_FAMILIAR_SHARE = 0.5

export const RECOMMENDATION_MODES: readonly {
  id: RecommendationMode
  label: string
  description: string
}[] = [
  { id: 'normal', label: '正常推荐', description: '根据兴趣、Star、关注动态和浏览反馈推荐' },
  { id: 'taste', label: '换换口味', description: '从实际搜索候选中随机探索，目标约一半来自已选兴趣、一半来自其他方向' },
  { id: 'random', label: '完全随机', description: '在公开搜索得到的候选池内随机选择，不代表 GitHub 全库等概率抽样' },
]

export function isRecommendationMode(value: unknown): value is RecommendationMode {
  return value === 'normal' || value === 'taste' || value === 'random'
}

export function hasTasteInterests(interests: readonly string[], blockedTopics: readonly string[] = []): boolean {
  const blocked = new Set(blockedTopics)
  return interests.some((id) => INTEREST_BY_ID.get(id)?.topics.some((topic) => !blocked.has(topic)))
}
