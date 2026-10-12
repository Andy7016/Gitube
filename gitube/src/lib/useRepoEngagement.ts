import { useCallback, useEffect, useRef } from 'react'
import type { MouseEventHandler } from 'react'
import { useLocation } from 'react-router'
import type { Repo } from '../api/types'
import { useAuth } from '../store/auth'
import { useLibrary } from '../store/library'
import { isOriginalRepoActivation, observeEngagement, recordEngagementForAccount } from './engagement'

interface Visit {
  observer: ReturnType<typeof observeEngagement>
  updateRepo: (repo: Repo | null) => void
}

export function useRepoEngagement(repo: Repo | null, nameWithOwner: string): MouseEventHandler<HTMLAnchorElement> {
  const account = useAuth((state) => state.account)
  const libraryAccount = useLibrary((state) => state.login)
  const { key: locationKey } = useLocation()
  const visit = useRef<Visit | null>(null)
  const repoName = nameWithOwner.toLowerCase()
  const canTrack = account !== 'pending' && account === libraryAccount

  useEffect(() => {
    if (!canTrack) return
    const expectedAccount = account
    let latestRepo = repo?.nameWithOwner.toLowerCase() === repoName ? repo : null
    let showingRepo = !!latestRepo
    const observer = observeEngagement({
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
      if (latestRepo) recordEngagementForAccount(latestRepo, expectedAccount, useAuth.getState().account, useLibrary.getState())
    })
    const current: Visit = {
      observer,
      updateRepo(nextRepo) {
        showingRepo = nextRepo?.nameWithOwner.toLowerCase() === repoName
        if (showingRepo) latestRepo = nextRepo
        observer.refresh()
      },
    }
    visit.current = current
    return () => {
      current.observer.dispose()
      if (visit.current === current) visit.current = null
    }
    // Repository data can refresh within a visit; only navigation/account scope starts a new one.
  }, [account, libraryAccount, repoName, locationKey, canTrack])

  useEffect(() => {
    visit.current?.updateRepo(repo)
  }, [repo])

  return useCallback((event) => {
    if (isOriginalRepoActivation(event)) visit.current?.observer.openOriginal()
  }, [])
}
