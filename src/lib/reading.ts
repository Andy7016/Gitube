export const DWELL_THRESHOLD_MS = 180_000
export const OUTBOUND_DWELL_THRESHOLD_MS = 60_000

interface TrackerOptions {
  /** 单调时钟，浏览器中使用 performance.now。 */
  now: () => number
  onQualified: () => void
}

/** 单次详情页访问；只有明确处于前台的时间段才计入。 */
export function createReadingTracker({ now, onQualified }: TrackerOptions) {
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
    /** 严格超过阈值才上报；暂停时无需计时器。 */
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

export interface ReadingEnvironment {
  now: () => number
  isActive: () => boolean
  schedule: (callback: () => void, delay: number) => () => void
  listen: (activity: () => void, pageHide: () => void, pageShow: () => void) => () => void
}

/** 用生命周期事件和一个阈值定时器驱动，无需后台轮询。 */
export function observeReading(environment: ReadingEnvironment, onQualified: () => void) {
  const tracker = createReadingTracker({ now: environment.now, onQualified })
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

/** 保留普通点击、键盘激活和中键的新标签页行为。 */
export const isOriginalRepoActivation = (event: { button: number; defaultPrevented: boolean }): boolean =>
  !event.defaultPrevented && (event.button === 0 || event.button === 1)
