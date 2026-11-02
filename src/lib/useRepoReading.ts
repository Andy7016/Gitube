import { useCallback, useEffect, useRef } from 'react'
import type { MouseEventHandler } from 'react'
import { useLocation } from 'react-router'
import type { Repo } from '../api/types'
import { useAuth } from '../store/auth'
import { useLibrary } from '../store/library'
import { isOriginalRepoActivation, observeReading } from './reading'

interface Visit {
  repoName: string
  login: string
  revision: number
  observer: ReturnType<typeof observeReading>
  updateRepo: (repo: Repo | null) => void
}

export function useRepoReading(repo: Repo | null, nameWithOwner: string): MouseEventHandler<HTMLAnchorElement> {
  const account = useAuth((state) => state.viewer?.login ?? null)
  const libraryAccount = useLibrary((state) => state.login)
  const revision = useLibrary((state) => state.recommendationRevision)
  const { key: locationKey } = useLocation()
  const visit = useRef<Visit | null>(null)
  const repoName = nameWithOwner.toLowerCase()
  const canTrack = !!account && account === libraryAccount

  useEffect(() => {
    if (!canTrack || !account) return
    const expectedLogin = account
    const expectedRevision = revision
    let latestRepo = repo?.nameWithOwner.toLowerCase() === repoName ? repo : null
    let showingRepo = !!latestRepo
    const observer = observeReading({
      now: () => performance.now(),
      isActive: () => showingRepo && document.visibilityState === 'visible' && document.hasFocus(),
      schedule(callback, delay) {
        const timer = window.setTimeout(callback, delay)
        return () => window.clearTimeout(timer)
      },
      listen(activity, pageHide, pageShow) {
        window.addEventListener('focus', activity)
        window.addEventListener('blur', activity)
        document.addEventListener('visibilitychange', activity)
        window.addEventListener('pagehide', pageHide)
        window.addEventListener('pageshow', pageShow)
        return () => {
          window.removeEventListener('focus', activity)
          window.removeEventListener('blur', activity)
          document.removeEventListener('visibilitychange', activity)
          window.removeEventListener('pagehide', pageHide)
          window.removeEventListener('pageshow', pageShow)
        }
      },
    }, () => {
      // 退出/切换账号和重置发生在 React 清理前时，也不能提交旧访问。
      const auth = useAuth.getState()
      if (latestRepo && auth.token && auth.viewer?.login === expectedLogin) {
        useLibrary.getState().recordDwell(latestRepo, expectedLogin, expectedRevision)
      }
    })
    const current: Visit = {
      repoName,
      login: expectedLogin,
      revision: expectedRevision,
      observer,
      updateRepo(nextRepo) {
        showingRepo = nextRepo?.nameWithOwner.toLowerCase() === repoName
        if (showingRepo) latestRepo = nextRepo
        observer.refresh()
      },
    }
    visit.current = current
    return () => {
      observer.dispose()
      if (visit.current === current) visit.current = null
    }
    // 同仓库元数据刷新沿用本次访问；路由、账号或重置才建立新访问。
  }, [account, libraryAccount, revision, repoName, locationKey, canTrack])

  useEffect(() => {
    visit.current?.updateRepo(repo)
  }, [repo])

  return useCallback((event) => {
    const current = visit.current
    if (current?.repoName === repoName && current.login === account && current.revision === revision && isOriginalRepoActivation(event)) {
      current.observer.openOriginal()
    }
  }, [repoName, account, revision])
}
