/** 项目里统一使用的仓库数据结构（从 GitHub GraphQL 返回值整理而来） */
export interface Repo {
  /** GraphQL node id，用于 Star / 取消 Star */
  id: string
  nameWithOwner: string
  name: string
  owner: string
  ownerId: string
  ownerType: 'User' | 'Organization'
  ownerAvatar: string
  description: string | null
  url: string
  homepageUrl: string | null
  stars: number
  forks: number
  language: string | null
  languageColor: string | null
  topics: string[]
  pushedAt: string | null
  createdAt: string
  viewerHasStarred: boolean
  /** 仅当仓库设置了自定义社交预览图时才有值，用作封面 */
  coverImage: string | null
  isArchived: boolean
  license: string | null
  defaultBranch: string | null
}

export interface RepoDetail extends Repo {
  watchers: number
  openIssues: number
  latestRelease: { tagName: string; publishedAt: string } | null
}

export interface Viewer {
  id: string
  login: string
  name: string | null
  avatarUrl: string
}

/** 推荐理由，显示在卡片上，类似「因为你看过……」 */
export interface Reason {
  kind: 'topic' | 'similar' | 'following' | 'trending' | 'language' | 'explore' | 'channel'
  text: string
  avatar?: string
}

export interface FeedItem {
  key: string
  repo: Repo
  reason?: Reason
}

export interface FollowingStar {
  login: string
  avatarUrl: string
  starredAt: string
  repo: Repo
}

export interface SearchPage {
  repos: Repo[]
  endCursor: string | null
  hasNextPage: boolean
  total: number
}
