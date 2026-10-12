import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const moduleURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const engagementURL = moduleURL(compile(await readFile(new URL('../gitube/src/lib/engagement.ts', import.meta.url), 'utf8')))
const { createEngagementTracker, observeEngagement, recordEngagementForAccount, isOriginalRepoActivation } = await import(engagementURL)

function clockEnvironment() {
  let time = 0
  let visible = true
  let focused = true
  let serial = 0
  const timers = new Map()
  const browser = new EventTarget()
  const document = new EventTarget()
  const setTimer = (callback, delay) => {
    assert.ok(delay >= 1 && delay <= 180_001, `timer must target a bounded threshold: ${delay}`)
    const id = ++serial
    timers.set(id, { callback, delay, due: time + delay })
    assert.ok(timers.size <= 1, 'one visit must have at most one timer')
    return id
  }
  const clearTimer = (id) => timers.delete(id)
  browser.setTimeout = setTimer
  browser.clearTimeout = clearTimer
  Object.defineProperty(document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' })
  document.hasFocus = () => focused
  const listen = (activity, hide, show) => {
    browser.addEventListener('focus', activity)
    browser.addEventListener('blur', activity)
    document.addEventListener('visibilitychange', activity)
    browser.addEventListener('pagehide', hide)
    browser.addEventListener('pageshow', show)
    return () => {
      browser.removeEventListener('focus', activity)
      browser.removeEventListener('blur', activity)
      document.removeEventListener('visibilitychange', activity)
      browser.removeEventListener('pagehide', hide)
      browser.removeEventListener('pageshow', show)
    }
  }
  return {
    browser, document, timers,
    now: () => time,
    environment: { now: () => time, isActive: () => visible && focused, schedule: (callback, delay) => { const id = setTimer(callback, delay); return () => clearTimer(id) }, listen },
    jump(ms) { time += ms },
    advance(ms) {
      const until = time + ms
      for (let count = 0; ; count++) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0]
        if (!next || next[1].due > until) break
        assert.ok(count < 20, 'threshold timers must not busy-poll')
        time = next[1].due
        timers.delete(next[0])
        next[1].callback()
      }
      time = until
    },
    visible(value) { visible = value; document.dispatchEvent(new Event('visibilitychange')) },
    focus(value) { focused = value; browser.dispatchEvent(new Event(value ? 'focus' : 'blur')) },
    page(type) { browser.dispatchEvent(new Event(type)) },
  }
}

for (const [threshold, outbound] of [[180_000, false], [60_000, true]]) {
  test(`qualification is strictly greater than ${threshold}ms`, () => {
    let time = 0
    let reports = 0
    const tracker = createEngagementTracker({ now: () => time, onQualified: () => reports++ })
    tracker.setActive(true)
    if (outbound) tracker.openOriginal()
    time = threshold
    tracker.setActive(true)
    assert.equal(reports, 0, 'the exact boundary must not award engagement')
    time += 0.25
    tracker.setActive(false)
    assert.equal(reports, 1)
    tracker.openOriginal()
    tracker.dispose()
    assert.equal(reports, 1)
  })
}

test('a click before reading persists; hidden and unfocused intervals do not count on resume', () => {
  const clock = clockEnvironment()
  let reports = 0
  const visit = observeEngagement(clock.environment, () => reports++)
  visit.openOriginal()
  clock.advance(59_000)
  clock.visible(false)
  assert.equal(clock.timers.size, 0)
  clock.advance(900_000)
  clock.focus(false)
  clock.visible(true)
  clock.advance(900_000)
  assert.equal(reports, 0)
  assert.equal(clock.timers.size, 0, 'visibility alone cannot resume an unfocused page')
  clock.focus(true)
  clock.advance(1_000)
  assert.equal(reports, 0)
  clock.advance(1)
  assert.equal(reports, 1)
  assert.equal(clock.timers.size, 0)
  visit.dispose()
})

test('opening the original after over one minute qualifies immediately without blocking navigation', () => {
  const clock = clockEnvironment()
  let reports = 0
  const visit = observeEngagement(clock.environment, () => reports++)
  clock.advance(60_001)
  assert.equal(reports, 0)
  visit.openOriginal()
  visit.openOriginal()
  clock.advance(300_000)
  assert.equal(reports, 1)
  assert.equal(clock.timers.size, 0)
  visit.dispose()
})

test('pagehide pauses a cached page and pageshow resumes only the remaining foreground reading', () => {
  const clock = clockEnvironment()
  let reports = 0
  const visit = observeEngagement(clock.environment, () => reports++)
  clock.advance(120_000)
  clock.page('pagehide')
  assert.equal(clock.timers.size, 0)
  clock.advance(600_000)
  clock.focus(true)
  assert.equal(clock.timers.size, 0, 'focus events cannot restart a page still hidden by pagehide')
  clock.page('pageshow')
  clock.advance(60_000)
  assert.equal(reports, 0)
  clock.advance(1)
  assert.equal(reports, 1)
  visit.dispose()
})

test('destroy flushes an overdue active interval once and makes queued callbacks/actions inert', () => {
  const clock = clockEnvironment()
  let reports = 0
  const visit = observeEngagement(clock.environment, () => reports++)
  const staleTimer = [...clock.timers.values()][0].callback
  clock.jump(180_001)
  visit.dispose()
  visit.dispose()
  staleTimer()
  visit.openOriginal()
  clock.focus(false)
  clock.focus(true)
  assert.equal(reports, 1)
  assert.equal(clock.timers.size, 0)
})

test('account guard rejects both auth/store races and forwards the captured repo/account only on a match', () => {
  const repo = { nameWithOwner: 'old/repository' }
  const recorded = []
  const library = { login: 'github:alice', recordEngagement: (...args) => { recorded.push(args); return true } }
  assert.equal(recordEngagementForAccount(repo, 'github:alice', 'github:bob', library), false)
  library.login = 'github:bob'
  assert.equal(recordEngagementForAccount(repo, 'github:alice', 'github:alice', library), false)
  assert.equal(recordEngagementForAccount(repo, 'pending', 'pending', { ...library, login: 'pending' }), false)
  assert.deepEqual(recorded, [])
  library.login = 'github:alice'
  assert.equal(recordEngagementForAccount(repo, 'github:alice', 'github:alice', library), true)
  assert.deepEqual(recorded, [[repo, 'github:alice']])
  library.recordEngagement = () => false
  assert.equal(recordEngagementForAccount(repo, 'github:alice', 'github:alice', library), false)
})

test('primary/keyboard/Ctrl activation and middle clicks count while cancelled/right clicks do not', () => {
  for (const event of [{ button: 0, defaultPrevented: false }, { button: 0, defaultPrevented: false, ctrlKey: true }, { button: 1, defaultPrevented: false }]) assert.equal(isOriginalRepoActivation(event), true)
  for (const event of [{ button: 2, defaultPrevented: false }, { button: 0, defaultPrevented: true }, { button: 1, defaultPrevented: true }]) assert.equal(isOriginalRepoActivation(event), false)
})

// Run the real hook's lifecycle against a small hook host so route/account effects
// can be verified without a browser, extra dependencies, or wall-clock waits.
const hostKey = Symbol.for('repoflow.engagement-test-hook-host')
const reactURL = moduleURL(`const host=()=>globalThis[Symbol.for('repoflow.engagement-test-hook-host')]; export const useRef=(value)=>host().useRef(value); export const useEffect=(effect,deps)=>host().useEffect(effect,deps); export const useCallback=(callback,deps)=>host().useCallback(callback,deps);`)
const routerURL = moduleURL(`export const useLocation=()=>globalThis[Symbol.for('repoflow.engagement-test-hook-host')].location;`)
const storeURL = (field, name) => moduleURL(`const state=()=>globalThis[Symbol.for('repoflow.engagement-test-hook-host')].${field}; export const ${name}=(selector)=>selector(state()); ${name}.getState=state;`)
const hookSource = compile(await readFile(new URL('../gitube/src/lib/useRepoEngagement.ts', import.meta.url), 'utf8'))
  .replace(/from ['"]react['"]/g, `from '${reactURL}'`)
  .replace(/from ['"]react-router['"]/g, `from '${routerURL}'`)
  .replace(/from ['"]\.\.\/store\/auth['"]/g, `from '${storeURL('auth', 'useAuth')}'`)
  .replace(/from ['"]\.\.\/store\/library['"]/g, `from '${storeURL('library', 'useLibrary')}'`)
  .replace(/from ['"]\.\/engagement['"]/g, `from '${engagementURL}'`)
const { useRepoEngagement } = await import(moduleURL(hookSource))

function hookHost(t, clock) {
  const originals = new Map(['window', 'document', 'performance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries({ window: clock.browser, document: clock.document, performance: { now: clock.now } })) Object.defineProperty(globalThis, key, { configurable: true, value })
  let cursor = 0
  let pending = []
  const slots = []
  const recorded = []
  const changed = (before, after) => !before || before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]))
  const host = {
    auth: { account: 'github:alice' },
    library: { login: 'github:alice', recordEngagement: (repo, account) => { recorded.push({ repo, account }); return true } },
    location: { key: 'first-visit' },
    recorded,
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useEffect(effect, deps) {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) pending.push({ index, effect, deps })
    },
    useCallback(callback, deps) {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) slots[index] = { callback, deps }
      return slots[index].callback
    },
    render(repo, route = repo?.nameWithOwner ?? 'acme/one') {
      cursor = 0
      pending = []
      const click = useRepoEngagement(repo, route)
      for (const { index } of pending) slots[index]?.cleanup?.()
      for (const { index, effect, deps } of pending) slots[index] = { effect, deps, cleanup: effect() }
      return click
    },
    replayEffects() {
      for (const slot of slots) slot?.cleanup?.()
      for (const slot of slots) if (slot?.effect) slot.cleanup = slot.effect()
    },
    dispose() { for (const slot of slots) slot?.cleanup?.() },
  }
  globalThis[hostKey] = host
  t.after(() => {
    host.dispose()
    delete globalThis[hostKey]
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]
  })
  return host
}

test('hook survives StrictMode replay and detail refresh without resetting a real visit', (t) => {
  const clock = clockEnvironment()
  const host = hookHost(t, clock)
  const repo = { nameWithOwner: 'acme/one', topics: ['old'] }
  const click = host.render(repo)
  host.replayEffects()
  click({ button: 0, defaultPrevented: false, ctrlKey: true })
  clock.advance(30_000)
  host.render(null)
  clock.advance(900_000)
  assert.equal(clock.timers.size, 0, 'a temporarily absent repo pauses a visit without resetting it')
  const detail = { ...repo, topics: ['new'] }
  host.render(detail)
  clock.advance(30_000)
  assert.deepEqual(host.recorded, [])
  clock.advance(1)
  assert.deepEqual(host.recorded, [{ repo: detail, account: 'github:alice' }])
  click({ button: 1, defaultPrevented: false })
  host.dispose()
  assert.equal(host.recorded.length, 1)
  assert.equal(clock.timers.size, 0)
})

test('real navigation resets elapsed time and outbound marker, and cleans the old route timer', (t) => {
  const clock = clockEnvironment()
  const host = hookHost(t, clock)
  const first = { nameWithOwner: 'acme/one' }
  host.render(first)({ button: 0, defaultPrevented: false })
  clock.advance(59_000)
  const oldCallback = [...clock.timers.values()][0].callback
  host.location = { key: 'second-visit' }
  host.render(first)
  oldCallback()
  clock.advance(60_001)
  assert.deepEqual(host.recorded, [], 'same repo with a new navigation key must start a fresh visit')
  const second = { nameWithOwner: 'acme/two' }
  host.location = { key: 'third-visit' }
  const click = host.render(second)
  clock.advance(60_001)
  assert.deepEqual(host.recorded, [], 'a different repo cannot inherit reading or the outbound marker')
  click({ button: 1, defaultPrevented: false })
  assert.deepEqual(host.recorded, [{ repo: second, account: 'github:alice' }])
})

test('hook never awards an old visit to a new account, including a timer before React commits', (t) => {
  const clock = clockEnvironment()
  const host = hookHost(t, clock)
  const repo = { nameWithOwner: 'acme/one' }
  host.render(repo)
  clock.advance(179_000)
  host.auth.account = 'github:bob'
  clock.advance(1_001)
  assert.deepEqual(host.recorded, [])
  host.render(repo)
  assert.equal(clock.timers.size, 0, 'an account/store mismatch cannot start another visit')
  host.library.login = 'github:bob'
  const click = host.render(repo)
  clock.advance(60_000)
  click({ button: 0, defaultPrevented: false })
  assert.deepEqual(host.recorded, [])
  clock.advance(1)
  assert.deepEqual(host.recorded, [{ repo, account: 'github:bob' }])
})
