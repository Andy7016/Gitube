import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadingTracker, observeReading, isOriginalRepoActivation } from '../src/lib/reading.ts'

test('reading requires strictly more than 180 seconds and reports once', () => {
  let clock = 0
  let reported = 0
  const tracker = createReadingTracker({ now: () => clock, onQualified: () => reported++ })
  tracker.setActive(true)
  assert.equal(tracker.nextDelay(), 180001)
  clock = 180000
  tracker.setActive(true)
  assert.equal(reported, 0)
  assert.equal(tracker.nextDelay(), 1)
  clock += 0.5
  tracker.setActive(true)
  assert.equal(reported, 1)
  assert.equal(tracker.nextDelay(), null)
  clock += 180001
  tracker.dispose()
  tracker.openOriginal()
  assert.equal(reported, 1)
})

test('original-repository activation requires strictly more than 60 seconds', () => {
  let clock = 0
  let reported = 0
  const tracker = createReadingTracker({ now: () => clock, onQualified: () => reported++ })
  tracker.setActive(true)
  clock = 60000
  tracker.openOriginal()
  assert.equal(reported, 0)
  assert.equal(tracker.nextDelay(), 1)
  clock++
  tracker.setActive(false)
  assert.equal(reported, 1)
  tracker.openOriginal()
  tracker.dispose()
  assert.equal(reported, 1)
})

test('only active intervals accumulate and a disposed visit cannot restart', () => {
  let clock = 0
  let reported = 0
  const tracker = createReadingTracker({ now: () => clock, onQualified: () => reported++ })
  tracker.setActive(true)
  clock = 30000
  tracker.setActive(false)
  assert.equal(tracker.nextDelay(), null)
  clock += 3_600_000
  tracker.openOriginal()
  assert.equal(reported, 0)
  tracker.setActive(true)
  clock += 30000
  tracker.setActive(false)
  assert.equal(reported, 0)
  tracker.setActive(true)
  clock++
  tracker.dispose()
  assert.equal(reported, 1)
  tracker.setActive(true)
  assert.equal(tracker.nextDelay(), null)
})

function environment() {
  let clock = 0
  let visible = true
  let focused = true
  let activity
  let pageHide
  let pageShow
  let unlistened = false
  let id = 0
  const timers = new Map()
  return {
    adapter: {
      now: () => clock,
      isActive: () => visible && focused,
      schedule(callback, delay) {
        const timer = ++id
        timers.set(timer, { callback, at: clock + delay })
        return () => timers.delete(timer)
      },
      listen(onActivity, onHide, onShow) {
        activity = onActivity
        pageHide = onHide
        pageShow = onShow
        return () => { unlistened = true }
      },
    },
    advance(ms) {
      const end = clock + ms
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        clock = next[1].at
        timers.delete(next[0])
        next[1].callback()
      }
      clock = end
    },
    visible(value) { visible = value; activity() },
    focused(value) { focused = value; activity() },
    pageHide: () => pageHide(),
    pageShow: () => pageShow(),
    get timerCount() { return timers.size },
    get unlistened() { return unlistened },
  }
}

test('visibility, focus and page lifecycle pause the observer without background polling', () => {
  const env = environment()
  let reported = 0
  const observer = observeReading(env.adapter, () => reported++)
  assert.equal(env.timerCount, 1)
  env.advance(30000)
  env.visible(false)
  assert.equal(env.timerCount, 0)
  env.advance(1_000_000)
  env.focused(false)
  env.visible(true)
  assert.equal(env.timerCount, 0, 'visible without focus is still paused')
  env.focused(true)
  env.advance(30000)
  observer.openOriginal()
  assert.equal(reported, 0)
  env.pageHide()
  env.advance(1_000_000)
  assert.equal(reported, 0)
  env.pageShow()
  env.advance(1)
  assert.equal(reported, 1)
  assert.equal(env.timerCount, 0)
  observer.dispose()
  assert.equal(env.unlistened, true)
  observer.openOriginal()
  env.advance(1_000_000)
  assert.equal(reported, 1)
})

test('leaving a page clears its timer and a new repository starts at zero', () => {
  const env = environment()
  let first = 0
  let second = 0
  const oldVisit = observeReading(env.adapter, () => first++)
  env.advance(170000)
  oldVisit.dispose()
  assert.equal(env.timerCount, 0)
  const newVisit = observeReading(env.adapter, () => second++)
  env.advance(10001)
  assert.equal(first, 0)
  assert.equal(second, 0)
  newVisit.dispose()
})

test('normal, keyboard-style and middle-button activations qualify; prevented and right clicks do not', () => {
  assert.equal(isOriginalRepoActivation({ button: 0, defaultPrevented: false }), true)
  assert.equal(isOriginalRepoActivation({ button: 1, defaultPrevented: false }), true)
  assert.equal(isOriginalRepoActivation({ button: 2, defaultPrevented: false }), false)
  assert.equal(isOriginalRepoActivation({ button: 0, defaultPrevented: true }), false)
})
