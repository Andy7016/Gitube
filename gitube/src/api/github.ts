import { create } from 'zustand'
import type { FollowingStar, Repo, RepoDetail, SearchPage } from './types'
import type { RecommendationProfile } from '../../../src/data'

export type GitHubErrorKind = 'auth' | 'scope' | 'rate' | 'network' | 'not_found' | 'other'
export class GitHubError extends Error {
  constructor(public kind: GitHubErrorKind, message: string, public status = 0, public code?: string) { super(message) }
}
const listeners = new Set<() => void>()
export function onUnauthorized(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) }
let session = { csrfToken: null as string | null, account: 'pending', version: 0 }
const requests = new Set<AbortController>()
export const repoCache = new Map<string, Repo>()
export const useApiMeta = create<{ rateRemaining: number | null; rateLimit: number | null; rateReset: number | null; warnings: string[] }>(() => ({ rateRemaining: null, rateLimit: null, rateReset: null, warnings: [] }))
export function setApiSession(csrfToken: string | null, account: string) {
  if (account !== session.account || csrfToken !== session.csrfToken) {
    requests.forEach((controller) => controller.abort()); requests.clear(); repoCache.clear()
    session = { csrfToken, account, version: session.version + 1 }
    useApiMeta.setState({ rateRemaining: null, rateLimit: null, rateReset: null, warnings: [] })
  }
}
export function isAbort(error: unknown) { return error instanceof Error && error.name === 'AbortError' }
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const version = session.version
  const controller = new AbortController()
  const abort = () => controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  if (init.signal?.aborted) controller.abort()
  requests.add(controller)
  let timedOut=false
  const timeout=setTimeout(()=>{timedOut=true;controller.abort()},90000)
  try {
    const headers = new Headers(init.headers)
    if (init.method && init.method !== 'GET' && session.csrfToken) headers.set('X-CSRF-Token', session.csrfToken)
    const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'same-origin' })
    const body = response.status === 204 ? null : await response.json().catch(() => null)
    if (version !== session.version || controller.signal.aborted) throw new DOMException('请求所属账号已改变', 'AbortError')
    if (!response.ok) {
      const kind: GitHubErrorKind = response.status === 401 ? 'auth' : response.status === 404 ? 'not_found' : response.status === 429 ? 'rate' : response.status === 403 ? 'scope' : 'other'
      if (response.status === 401) listeners.forEach((fn) => fn())
      throw new GitHubError(kind, body?.error ?? `请求失败（${response.status}）`, response.status, body?.code)
    }
    return body as T
  } catch (error) {
    if (timedOut) throw new GitHubError('network','请求超时，请重试')
    if (isAbort(error) || error instanceof GitHubError) throw error
    throw new GitHubError('network', '无法连接服务，请检查网络后重试')
  } finally {
    clearTimeout(timeout);requests.delete(controller); init.signal?.removeEventListener('abort', abort)
  }
}
function remember<T extends Repo>(repo: T): T {
  if (repoCache.size > 1500) repoCache.delete(repoCache.keys().next().value!)
  repoCache.set(repo.id, repo); repoCache.set(repo.nameWithOwner.toLowerCase(), repo)
  return repo
}
async function operation<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!session.csrfToken) throw new GitHubError('other', '会话尚未就绪，请重试会话连接')
  const response = await apiRequest<{ data: T; meta?: Partial<ReturnType<typeof useApiMeta.getState>> }>('/api/gitube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, ...args }) })
  if (response.meta) useApiMeta.setState(response.meta)
  return response.data
}
export interface Seeds { starred: Repo[]; own: { language: string | null; topics: string[] }[]; profile?: RecommendationProfile }
export async function fetchSeeds(): Promise<Seeds> {
  if (session.account === 'guest') return { starred: [], own: [] }
  const data = await operation<Seeds>('seeds'); data.starred.forEach(remember); return data
}
export async function fetchFollowingStars(): Promise<FollowingStar[]> {
  if (session.account === 'guest') return []
  const data = await operation<FollowingStar[]>('followingStars'); data.forEach((item) => remember(item.repo)); return data
}
export async function fetchMyStars(after: string | null): Promise<SearchPage> { const data = await operation<SearchPage>('myStars', { after }); data.repos.forEach(remember); return data }
export async function searchMany(specs: { query: string; after?: string | null; first?: number }[]): Promise<SearchPage[]> {
  const data = await operation<SearchPage[]>('searchMany', { specs: specs.map(({ query, after = null, first = 20 }) => ({ query, after, first })) })
  data.forEach((page) => page.repos.forEach(remember)); return data
}
export async function searchRepos(query: string, after: string | null = null, first = 20) { return (await searchMany([{ query, after, first }]))[0] }
export async function fetchRepo(owner: string, name: string): Promise<RepoDetail> { return remember(await operation<RepoDetail>('repository', { owner, name })) }
export async function setStarred(repoId: string, starred: boolean) {
  const repo = repoCache.get(repoId)
  if (!repo) throw new GitHubError('other', '仓库信息尚未加载，请打开项目后重试')
  const previous = repo.viewerHasStarred
  await apiRequest(`/api/starred/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`, { method: starred ? 'PUT' : 'DELETE' })
  const stars = Math.max(0, repo.stars + (starred === previous ? 0 : starred ? 1 : -1))
  remember({ ...repo, viewerHasStarred: starred, stars })
  return { starred, stars }
}
