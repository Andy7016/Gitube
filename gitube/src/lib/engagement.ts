import type { Repo } from '../api/types'

export const DWELL_THRESHOLD_MS = 180_000
export const OUTBOUND_DWELL_THRESHOLD_MS = 60_000

interface TrackerOptions {
  /** A monotonic clock, normally performance.now. */
  now: () => number
  onQualified: () => void
}

/** One repository-page visit. Only explicitly active intervals count. */
export function createEngagementTracker({ now, onQualified }: TrackerOptions) {
  let elapsed = 0
  let activeSince: number | null = null
  let openedOriginal = false
  let reported = false
  let disposed = false

  const flush = () => {
    if (activeSince === null) return
    const current = now()
    elapsed += Math.max(0, current - activeSince)
    activeSince = current
  }
  const qualify = () => {
    if (reported || !(elapsed > DWELL_THRESHOLD_MS || openedOriginal && elapsed > OUTBOUND_DWELL_THRESHOLD_MS)) return
    reported = true
    onQualified()
  }

  return {
    setActive(active: boolean) {
      if (disposed) return
      flush()
      activeSince = active ? now() : null
      qualify()
    },
    openOriginal() {
      if (disposed) return
      flush()
      openedOriginal = true
      qualify()
    },
    /** Delay to the next strict threshold; no timer is needed while paused. */
    nextDelay(): number | null {
      if (disposed || reported || activeSince === null) return null
      const threshold = openedOriginal ? OUTBOUND_DWELL_THRESHOLD_MS : DWELL_THRESHOLD_MS
      return Math.max(1, Math.floor(threshold - elapsed) + 1)
    },
    dispose() {
      if (disposed) return
      flush()
      qualify()
      activeSince = null
      disposed = true
    },
  }
}

export interface EngagementEnvironment {
  now: () => number
  isActive: () => boolean
  schedule: (callback: () => void, delay: number) => () => void
  listen: (activity: () => void, pageHide: () => void, pageShow: () => void) => () => void
}

/** Browser lifecycle adapter with one bounded timer, rather than polling. */
export function observeEngagement(environment: EngagementEnvironment, onQualified: () => void) {
  const tracker = createEngagementTracker({ now: environment.now, onQualified })
  let cancelTimer: (() => void) | undefined
  let pageHidden = false
  let disposed = false

  const schedule = () => {
    cancelTimer?.()
    cancelTimer = undefined
    const delay = tracker.nextDelay()
    if (delay !== null) cancelTimer = environment.schedule(sync, delay)
  }
  const sync = () => {
    if (disposed) return
    tracker.setActive(!pageHidden && environment.isActive())
    schedule()
  }
  const unlisten = environment.listen(sync, () => {
    pageHidden = true
    sync()
  }, () => {
    pageHidden = false
    sync()
  })
  sync()

  return {
    refresh: sync,
    openOriginal() {
      if (disposed) return
      sync()
      tracker.openOriginal()
      schedule()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelTimer?.()
      unlisten()
      tracker.dispose()
    },
  }
}

interface EngagementLibrary {
  login: string | null
  recordEngagement: (repo: Repo, expectedAccount: string) => boolean
}

/** Recheck both live account scopes at the instant a visit qualifies. */
export function recordEngagementForAccount(repo: Repo, expectedAccount: string, authAccount: string, library: EngagementLibrary): boolean {
  if (expectedAccount === 'pending' || authAccount !== expectedAccount || library.login !== expectedAccount) return false
  return library.recordEngagement(repo, expectedAccount)
}

export const isOriginalRepoActivation = (event: { button: number; defaultPrevented: boolean }): boolean =>
  !event.defaultPrevented && (event.button === 0 || event.button === 1)
