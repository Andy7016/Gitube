import { INTEREST_BY_ID } from './interests'
import { isoDaysAgo } from './format'

/** 首页顶部的频道（类似 B 站的分区 / YouTube 的筛选条） */
export interface Channel {
  id: string
  label: string
  /** 普通频道用搜索语句分页；推荐和关注两个频道有自己的逻辑 */
  query?: () => string
}

export const BASE_CHANNELS: Channel[] = [
  { id: 'foryou', label: '推荐' },
  { id: 'following', label: '关注' },
  { id: 'week', label: '本周新星', query: () => `created:>=${isoDaysAgo(7)} stars:>=10 sort:stars` },
  { id: 'month', label: '本月热门', query: () => `created:>=${isoDaysAgo(30)} stars:>=50 sort:stars` },
]

export function interestChannel(id: string): Channel | null {
  const it = INTEREST_BY_ID.get(id)
  if (!it) return null
  return {
    id: `i:${id}`,
    label: it.label,
    query: () => `topic:${it.topics[0]} stars:>=50 pushed:>=${isoDaysAgo(90)} archived:false sort:stars`,
  }
}

export function channelsFor(interests: string[]): Channel[] {
  return [...BASE_CHANNELS, ...interests.map(interestChannel).filter((c): c is Channel => !!c)]
}

export function findChannel(id: string, interests: string[]): Channel {
  return channelsFor(interests).find((c) => c.id === id) ?? interestChannel(id.replace(/^i:/, '')) ?? BASE_CHANNELS[0]
}
