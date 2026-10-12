import { create } from 'zustand'
import type { FollowingStar, Repo, RepoDetail, SearchPage, Viewer } from './types'

const API = 'https://api.github.com'

/* ------------------------------------------------------------------ */
/* Token 与错误                                                         */
/* ------------------------------------------------------------------ */

let currentToken: string | null = null
export function setApiToken(token: string | null) {
  currentToken = token
}

export type GitHubErrorKind = 'auth' | 'scope' | 'rate' | 'network' | 'not_found' | 'other'

export class GitHubError extends Error {
  kind: GitHubErrorKind
  constructor(kind: GitHubErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** Token 失效时通知应用退出登录 */
type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

/** 最近一次响应里的配额信息和 token 权限，设置页会显示 */
interface ApiMeta {
  rateRemaining: number | null
  rateLimit: number | null
  rateReset: number | null
  /** classic token 才有；fine-grained token 为 null */
  scopes: string[] | null
}

export const useApiMeta = create<ApiMeta>(() => ({
  rateRemaining: null,
  rateLimit: null,
  rateReset: null,
  scopes: null,
}))

function readMeta(res: Response) {
  const next: Partial<ApiMeta> = {}
  const rem = res.headers.get('x-ratelimit-remaining')
  const lim = res.headers.get('x-ratelimit-limit')
  const reset = res.headers.get('x-ratelimit-reset')
  if (rem) next.rateRemaining = Number(rem)
  if (lim) next.rateLimit = Number(lim)
  if (reset) next.rateReset = Number(reset) * 1000
  const scopes = res.headers.get('x-oauth-scopes')
  if (scopes !== null) next.scopes = scopes.split(',').map((s) => s.trim()).filter(Boolean)
  useApiMeta.setState(next)
}

async function request(path: string, init: RequestInit = {}, token = currentToken) {
  if (!token) throw new GitHubError('auth', '还没有登录')
  let res: Response
  try {
    res = await fetch(path.startsWith('http') ? path : API + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    })
  } catch {
    throw new GitHubError('network', '连不上 GitHub，检查一下网络或代理')
  }
  readMeta(res)
  if (res.status === 401) {
    if (token === currentToken) unauthorizedListeners.forEach((fn) => fn())
    throw new GitHubError('auth', 'Token 无效或已过期，请重新登录')
  }
  if (res.status === 403 || res.status === 429) {
    const body = await res.clone().json().catch(() => ({}))
    const msg: string = body?.message ?? ''
    if (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(msg)) {
      const resetAt = useApiMeta.getState().rateReset
      const reset = resetAt ? new Date(resetAt) : null
      throw new GitHubError(
        'rate',
        `GitHub 接口次数用完了${reset ? `，${reset.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 后恢复` : '，稍后再试'}`,
      )
    }
    throw new GitHubError('scope', 'Token 权限不够：Star 需要 public_repo 权限（fine-grained token 需要 Starring 读写权限）')
  }
  if (res.status === 404) throw new GitHubError('not_found', '找不到这个仓库')
  return res
}

/* ------------------------------------------------------------------ */
/* GraphQL                                                             */
/* ------------------------------------------------------------------ */

interface GqlError {
  type?: string
  message: string
}

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<T> {
  const res = await request(
    '/graphql',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    token ?? currentToken,
  )
  const json = (await res.json()) as { data?: T; errors?: GqlError[] }
  if (json.errors?.length) {
    const first = json.errors[0]
    if (first.type === 'RATE_LIMITED') throw new GitHubError('rate', 'GitHub 接口次数用完了，稍后再试')
    if (first.type === 'INSUFFICIENT_SCOPES' || first.type === 'FORBIDDEN') {
      throw new GitHubError('scope', 'Token 权限不够：Star 需要 public_repo 权限（fine-grained token 需要 Starring 读写权限）')
    }
    if (first.type === 'NOT_FOUND' && !json.data) throw new GitHubError('not_found', first.message)
    // 部分字段出错但仍有数据时（例如某个搜索别名失败），继续使用已有数据
    if (!json.data) throw new GitHubError('other', first.message)
    console.warn('[GitHub GraphQL]', json.errors)
  }
  return json.data as T
}

const REPO_FIELDS = /* GraphQL */ `
  fragment RepoFields on Repository {
    id
    name
    nameWithOwner
    description
    url
    homepageUrl
    stargazerCount
    forkCount
    primaryLanguage { name color }
    repositoryTopics(first: 8) { nodes { topic { name } } }
    owner { __typename id login avatarUrl(size: 80) }
    pushedAt
    createdAt
    viewerHasStarred
    usesCustomOpenGraphImage
    openGraphImageUrl
    isArchived
    licenseInfo { spdxId }
    defaultBranchRef { name }
  }
`

interface RawRepo {
  id: string
  name: string
  nameWithOwner: string
  description: string | null
  url: string
  homepageUrl: string | null
  stargazerCount: number
  forkCount: number
  primaryLanguage: { name: string; color: string | null } | null
  repositoryTopics: { nodes: { topic: { name: string } }[] }
  owner: { __typename: 'User' | 'Organization'; id: string; login: string; avatarUrl: string }
  pushedAt: string | null
  createdAt: string
  viewerHasStarred: boolean
  usesCustomOpenGraphImage: boolean
  openGraphImageUrl: string
  isArchived: boolean
  licenseInfo: { spdxId: string | null } | null
  defaultBranchRef: { name: string } | null
}

/**
 * 最近拿到过的仓库数据缓存：从信息流点进详情页时，可以先用缓存把页面头部画出来，
 * 不用干等网络请求。
 */
export const repoCache = new Map<string, Repo>()

export function normalizeRepo(r: RawRepo): Repo {
  const repo = toRepo(r)
  repoCache.delete(repo.nameWithOwner)
  repoCache.set(repo.nameWithOwner, repo)
  if (repoCache.size > 1500) repoCache.delete(repoCache.keys().next().value!)
  return repo
}

function toRepo(r: RawRepo): Repo {
  const spdx = r.licenseInfo?.spdxId
  return {
    id: r.id,
    name: r.name,
    nameWithOwner: r.nameWithOwner,
    owner: r.owner.login,
    ownerId: r.owner.id,
    ownerType: r.owner.__typename,
    ownerAvatar: r.owner.avatarUrl,
    description: r.description,
    url: r.url,
    homepageUrl: r.homepageUrl || null,
    stars: r.stargazerCount,
    forks: r.forkCount,
    language: r.primaryLanguage?.name ?? null,
    languageColor: r.primaryLanguage?.color ?? null,
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    pushedAt: r.pushedAt,
    createdAt: r.createdAt,
    viewerHasStarred: r.viewerHasStarred,
    coverImage: r.usesCustomOpenGraphImage ? r.openGraphImageUrl : null,
    isArchived: r.isArchived,
    license: spdx && spdx !== 'NOASSERTION' ? spdx : null,
    defaultBranch: r.defaultBranchRef?.name ?? null,
  }
}

/** 搜索结果里可能混入非仓库节点（理论上不会），过滤掉 */
function toRepos(nodes: (RawRepo | Record<string, never> | null)[]): Repo[] {
  return nodes.filter((n): n is RawRepo => !!n && 'nameWithOwner' in n).map(normalizeRepo)
}

/* ------------------------------------------------------------------ */
/* 登录用户                                                              */
/* ------------------------------------------------------------------ */

export async function fetchViewer(token: string): Promise<Viewer> {
  const data = await gql<{ viewer: Viewer }>(
    `query { viewer { id login name avatarUrl(size: 96) } }`,
    {},
    token,
  )
  return data.viewer
}

export interface Seeds {
  /** 最近 Star 的仓库，越靠前越新 */
  starred: Repo[]
  /** 自己仓库里的语言和话题 */
  own: { language: string | null; topics: string[] }[]
}

/** 用来构建兴趣画像的原始数据：最近的 Star + 自己的仓库 */
export async function fetchSeeds(): Promise<Seeds> {
  const data = await gql<{
    viewer: {
      starredRepositories: { nodes: RawRepo[] }
      repositories: {
        nodes: { primaryLanguage: { name: string } | null; repositoryTopics: { nodes: { topic: { name: string } }[] } }[]
      }
    }
  }>(
    `query {
      viewer {
        starredRepositories(first: 100, orderBy: { field: STARRED_AT, direction: DESC }) {
          nodes { ...RepoFields }
        }
        repositories(first: 40, ownerAffiliations: [OWNER], isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
          nodes { primaryLanguage { name } repositoryTopics(first: 8) { nodes { topic { name } } } }
        }
      }
    }
    ${REPO_FIELDS}`,
  )
  return {
    starred: data.viewer.starredRepositories.nodes.map(normalizeRepo),
    own: data.viewer.repositories.nodes.map((n) => ({
      language: n.primaryLanguage?.name ?? null,
      topics: n.repositoryTopics.nodes.map((t) => t.topic.name),
    })),
  }
}

/** 你关注的人最近 Star 了什么 */
export async function fetchFollowingStars(): Promise<FollowingStar[]> {
  const data = await gql<{
    viewer: {
      following: {
        nodes: {
          login: string
          avatarUrl: string
          starredRepositories: { edges: { starredAt: string; node: RawRepo }[] }
        }[]
      }
    }
  }>(
    `query {
      viewer {
        following(first: 50) {
          nodes {
            login
            avatarUrl(size: 48)
            starredRepositories(first: 6, orderBy: { field: STARRED_AT, direction: DESC }) {
              edges { starredAt node { ...RepoFields } }
            }
          }
        }
      }
    }
    ${REPO_FIELDS}`,
  )
  const out: FollowingStar[] = []
  for (const u of data.viewer.following.nodes) {
    for (const e of u.starredRepositories.edges) {
      out.push({ login: u.login, avatarUrl: u.avatarUrl, starredAt: e.starredAt, repo: normalizeRepo(e.node) })
    }
  }
  return out.sort((a, b) => b.starredAt.localeCompare(a.starredAt))
}

/** 我的 Star（分页） */
export async function fetchMyStars(after: string | null): Promise<SearchPage> {
  const data = await gql<{
    viewer: {
      starredRepositories: {
        totalCount: number
        pageInfo: { endCursor: string | null; hasNextPage: boolean }
        nodes: RawRepo[]
      }
    }
  }>(
    `query($after: String) {
      viewer {
        starredRepositories(first: 24, after: $after, orderBy: { field: STARRED_AT, direction: DESC }) {
          totalCount
          pageInfo { endCursor hasNextPage }
          nodes { ...RepoFields }
        }
      }
    }
    ${REPO_FIELDS}`,
    { after },
  )
  const c = data.viewer.starredRepositories
  return { repos: c.nodes.map(normalizeRepo), endCursor: c.pageInfo.endCursor, hasNextPage: c.pageInfo.hasNextPage, total: c.totalCount }
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                 */
/* ------------------------------------------------------------------ */

interface RawSearch {
  repositoryCount: number
  pageInfo: { endCursor: string | null; hasNextPage: boolean }
  nodes: (RawRepo | Record<string, never> | null)[]
}

/**
 * 在一次 GraphQL 请求里同时执行多个搜索（用别名 s0, s1, ...）。
 * 推荐引擎每刷新一屏只发一个请求，省时间也省配额。
 */
export async function searchMany(
  specs: { query: string; after: string | null; first?: number }[],
): Promise<(SearchPage | null)[]> {
  if (specs.length === 0) return []
  const varDefs = specs.map((_, i) => `$q${i}: String!, $a${i}: String, $f${i}: Int!`).join(', ')
  const fields = specs
    .map(
      (_, i) => `s${i}: search(query: $q${i}, type: REPOSITORY, first: $f${i}, after: $a${i}) {
        repositoryCount
        pageInfo { endCursor hasNextPage }
        nodes { ...RepoFields }
      }`,
    )
    .join('\n')
  const variables: Record<string, unknown> = {}
  specs.forEach((s, i) => {
    variables[`q${i}`] = s.query
    variables[`a${i}`] = s.after
    variables[`f${i}`] = s.first ?? 10
  })
  const data = await gql<Record<string, RawSearch | null>>(
    `query(${varDefs}) {\n${fields}\n}\n${REPO_FIELDS}`,
    variables,
  )
  return specs.map((_, i) => {
    const s = data[`s${i}`]
    if (!s) return null
    return {
      repos: toRepos(s.nodes),
      endCursor: s.pageInfo.endCursor,
      hasNextPage: s.pageInfo.hasNextPage,
      total: s.repositoryCount,
    }
  })
}

export async function searchRepos(query: string, after: string | null, first = 20): Promise<SearchPage> {
  const [page] = await searchMany([{ query, after, first }])
  return page ?? { repos: [], endCursor: null, hasNextPage: false, total: 0 }
}

/* ------------------------------------------------------------------ */
/* 仓库详情 / README                                                    */
/* ------------------------------------------------------------------ */

export async function fetchRepo(owner: string, name: string): Promise<RepoDetail> {
  const data = await gql<{
    repository:
      | (RawRepo & {
          watchers: { totalCount: number }
          issues: { totalCount: number }
          latestRelease: { tagName: string; publishedAt: string } | null
        })
      | null
  }>(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ...RepoFields
        watchers { totalCount }
        issues(states: OPEN) { totalCount }
        latestRelease { tagName publishedAt }
      }
    }
    ${REPO_FIELDS}`,
    { owner, name },
  )
  if (!data.repository) throw new GitHubError('not_found', '找不到这个仓库')
  const r = data.repository
  return {
    ...normalizeRepo(r),
    watchers: r.watchers.totalCount,
    openIssues: r.issues.totalCount,
    latestRelease: r.latestRelease,
  }
}

/** GitHub 渲染好的 README HTML；没有 README 时返回 null */
export async function fetchReadmeHtml(owner: string, name: string): Promise<string | null> {
  try {
    const res = await request(`/repos/${owner}/${name}/readme`, {
      headers: { Accept: 'application/vnd.github.html+json' },
    })
    return await res.text()
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'not_found') return null
    throw e
  }
}

/* ------------------------------------------------------------------ */
/* Star / 关注                                                          */
/* ------------------------------------------------------------------ */

export async function setStarred(repoId: string, starred: boolean) {
  const field = starred ? 'addStar' : 'removeStar'
  const data = await gql<Record<string, { starrable: { stargazerCount: number; viewerHasStarred: boolean } }>>(
    `mutation($id: ID!) {
      ${field}(input: { starrableId: $id }) {
        starrable { stargazerCount viewerHasStarred }
      }
    }`,
    { id: repoId },
  )
  const s = data[field].starrable
  return { stars: s.stargazerCount, starred: s.viewerHasStarred }
}

/** 关注作者（需要 token 有 user:follow 权限） */
export async function followUser(login: string) {
  await request(`/user/following/${encodeURIComponent(login)}`, { method: 'PUT' })
}
