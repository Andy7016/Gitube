import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}
const { useAuth } = await import('../src/store/auth.ts')
const { useLibrary } = await import('../src/store/library.ts')
const { useSeeds } = await import('../src/store/seeds.ts')
const { useStars } = await import('../src/store/stars.ts')
const { feedKey, useFeed, visibleFeedItems, feedDisplayStatus } = await import('../src/store/feed.ts')
const { resetEngines } = await import('../src/lib/recommend.ts')
const { setApiToken, normalizeRepo } = await import('../src/api/github.ts')
const { createFeedPagingGate, observeFeedPaging, isFeedScrollIntent } = await import('../src/components/FeedGrid.tsx')

let accountNumber = 0
let account
let requests

function loginAs(login) {
  const token = `token-${login}`
  setApiToken(token)
  useAuth.setState({ token, viewer: { id: login, login, avatarUrl: '', name: null } })
  useLibrary.getState().load(login)
}

function rawRepo(name, topic = 'test-topic') {
  return {
    id: name, name, nameWithOwner: `owner-${name}/${name}`,
    description: `Repository ${name}`, url: `https://github.com/owner-${name}/${name}`,
    homepageUrl: null, stargazerCount: 500, forkCount: 5,
    primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
    repositoryTopics: { nodes: [{ topic: { name: topic } }] },
    owner: { __typename: 'User', id: `owner-${name}`, login: `owner-${name}`, avatarUrl: '' },
    pushedAt: new Date().toISOString(), createdAt: '2026-01-01T00:00:00Z',
    viewerHasStarred: false, usesCustomOpenGraphImage: false, openGraphImageUrl: '',
    isArchived: false, licenseInfo: null, defaultBranchRef: { name: 'main' },
  }
}

function resolveSearch(request, prefix, { more = true, count = 12 } = {}) {
  const data = {}
  const variables = request.body.variables
  for (let i = 0; Object.hasOwn(variables, `q${i}`); i++) {
    data[`s${i}`] = {
      nodes: Array.from({ length: count }, (_, n) => rawRepo(`${prefix}-${i}-${n}`)),
      repositoryCount: 1000, pageInfo: { hasNextPage: more, endCursor: `${prefix}-cursor-${i}` },
    }
  }
  request.resolve(new Response(JSON.stringify({ data }), { status: 200 }))
}

async function waitForRequests(count) {
  for (let i = 0; i < 30 && requests.length < count; i++) await new Promise(setImmediate)
  assert.equal(requests.length, count, `expected ${count} real API requests`)
}

beforeEach(() => {
  account = `feed-test-${++accountNumber}`
  loginAs(account)
  resetEngines(account)
  useFeed.getState().resetAll()
  useSeeds.getState().reset()
  useSeeds.setState({ seeds: { starred: [], own: [] }, following: [] })
  useStars.setState({ overrides: {}, pending: {} })
  requests = []
  globalThis.fetch = (_url, init) => new Promise((resolve) => {
    requests.push({ body: JSON.parse(init.body), resolve })
  })
})

function fakeObserverEnvironment() {
  const browser = new EventTarget()
  globalThis.window = browser
  const observers = []
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
    observe() { this.callback([{ isIntersecting: true }]) }
    disconnect() { this.disconnected = true }
    intersect(value) { this.callback([{ isIntersecting: value }]) }
  }
  return { browser, observers }
}

function keyboard(key, { editing = false, control = false, button = false } = {}) {
  const event = new Event('keydown')
  Object.defineProperties(event, {
    key: { value: key }, ctrlKey: { value: control },
    target: { value: { closest: (selector) => editing && selector.includes('input') || button && selector.includes('button') ? {} : null } },
  })
  return event
}

test('restoring an existing batch preserves items/cursor/scroll and sends no request until wheel intent', async () => {
  const load = useFeed.getState().loadMore('week')
  await waitForRequests(1)
  resolveSearch(requests[0], 'cached', { count: 4 })
  await load
  useFeed.getState().saveScroll('week', 875)
  const key = feedKey(account, 'week')
  const cached = useFeed.getState().channels[key]
  useFeed.getState().activate('month')
  useFeed.getState().activate('week')
  assert.equal(useFeed.getState().channels[key], cached)
  assert.equal(cached.scrollY, 875)
  assert.equal(cached.cursor, 'cached-cursor-0')

  const { browser, observers } = fakeObserverEnvironment()
  const gate = createFeedPagingGate(true)
  const target = {}
  let pending
  const loadNext = () => { pending = useFeed.getState().loadMore('week') }
  let cleanup = observeFeedPaging(target, gate, loadNext)
  browser.dispatchEvent(new Event('scroll'))
  cleanup()
  observers[0].intersect(true)
  cleanup = observeFeedPaging(target, gate, loadNext)
  browser.dispatchEvent(keyboard('PageDown', { editing: true }))
  browser.dispatchEvent(keyboard('PageDown', { control: true }))
  browser.dispatchEvent(keyboard(' ', { button: true }))
  assert.equal(requests.length, 1, 'observer remount, programmatic scroll and editing cannot page')
  browser.dispatchEvent(new Event('wheel'))
  await waitForRequests(2)
  assert.equal(requests[1].body.variables.a0, 'cached-cursor-0')
  cleanup()
  resolveSearch(requests[1], 'next', { more: false, count: 4 })
  await pending
  assert.equal(useFeed.getState().channels[key].items.length, 8)
})

test('new short batches automatically fill the viewport; touch and scroll keys unlock restored batches', () => {
  const { browser } = fakeObserverEnvironment()
  let loads = 0
  let cleanup = observeFeedPaging({}, createFeedPagingGate(false), () => loads++)
  assert.equal(loads, 1)
  cleanup()
  cleanup = observeFeedPaging({}, createFeedPagingGate(true), () => loads++)
  assert.equal(loads, 1)
  browser.dispatchEvent(new Event('touchmove'))
  assert.equal(loads, 2)
  cleanup()
  cleanup = observeFeedPaging({}, createFeedPagingGate(true), () => loads++)
  browser.dispatchEvent(keyboard('PageDown'))
  assert.equal(loads, 3)
  assert.equal(isFeedScrollIntent(new Event('scroll')), false)
  cleanup()
})

test('mode caches preserve completed lists and scroll, while refresh replaces only the current mode', async () => {
  let pending = useFeed.getState().loadMore('foryou')
  await waitForRequests(1)
  resolveSearch(requests[0], 'normal')
  await pending
  useFeed.getState().saveScroll('foryou', 640)
  const normalKey = feedKey(account, 'foryou', 'normal')
  const normal = useFeed.getState().channels[normalKey]

  useLibrary.getState().setRecommendationMode('random')
  pending = useFeed.getState().loadMore('foryou')
  await waitForRequests(2)
  resolveSearch(requests[1], 'random')
  await pending
  useFeed.getState().saveScroll('foryou', 240)
  const randomKey = feedKey(account, 'foryou', 'random')
  const random = useFeed.getState().channels[randomKey]
  useLibrary.getState().setRecommendationMode('normal')
  useFeed.getState().activate('foryou')
  assert.equal(useFeed.getState().channels[normalKey], normal)
  assert.equal(normal.scrollY, 640)
  assert.equal(requests.length, 2)
  useLibrary.getState().setInterests(['rust'])
  useLibrary.getState().setFollowingWeight('alice', 0)
  assert.equal(useFeed.getState().channels[normalKey], normal, 'interest/weight edits keep the completed batch')

  pending = useFeed.getState().refresh('foryou')
  await waitForRequests(3)
  resolveSearch(requests[2], 'refreshed')
  await pending
  assert.notEqual(useFeed.getState().channels[normalKey].snapshot, normal.snapshot)
  assert.equal(useFeed.getState().channels[normalKey].scrollY, 0)
  assert.equal(useFeed.getState().channels[randomKey], random)
  useLibrary.getState().setRecommendationMode('random')
  useFeed.getState().activate('foryou')
  assert.equal(useFeed.getState().channels[randomKey].scrollY, 240)
  assert.equal(requests.length, 3)
})

test('switching mode isolates a slow response from list, seen and engine cursors', async () => {
  const old = useFeed.getState().loadMore('foryou', 'normal')
  await waitForRequests(1)
  useLibrary.getState().setRecommendationMode('random')
  const current = useFeed.getState().loadMore('foryou', 'random')
  await waitForRequests(2)
  await useFeed.getState().loadMore('foryou', 'normal')
  assert.equal(requests.length, 2, 'a queued callback from the old mode cannot request or invalidate the new one')
  resolveSearch(requests[1], 'current')
  await current
  const seen = { ...useLibrary.getState().seen }
  resolveSearch(requests[0], 'stale')
  await old
  assert.deepEqual(useLibrary.getState().seen, seen)
  assert.equal(Object.keys(seen).some((name) => name.includes('stale')), false)
  assert.equal(useFeed.getState().channels[feedKey(account, 'foryou', 'normal')].items.length, 0)
  assert.equal(useFeed.getState().channels[feedKey(account, 'foryou', 'normal')].status, 'idle')
  assert.equal(localStorage.getItem(`gitube:cursors:${account}`), null)
  assert.ok(localStorage.getItem(`gitube:cursors:${account}:random`))
})

test('refresh beats its slow previous batch and keeps only the new seen/cursor state', async () => {
  const old = useFeed.getState().loadMore('foryou')
  await waitForRequests(1)
  const current = useFeed.getState().refresh('foryou')
  await waitForRequests(2)
  resolveSearch(requests[1], 'fresh')
  await current
  const seen = { ...useLibrary.getState().seen }
  const cursor = localStorage.getItem(`gitube:cursors:${account}`)
  resolveSearch(requests[0], 'late')
  await old
  const feed = useFeed.getState().channels[feedKey(account, 'foryou')]
  assert.ok(feed.items.every((item) => item.repo.name.includes('fresh')))
  assert.deepEqual(useLibrary.getState().seen, seen)
  assert.equal(localStorage.getItem(`gitube:cursors:${account}`), cursor)
})

test('recommendation reset makes all modes and every in-flight result obsolete', async () => {
  const old = useFeed.getState().loadMore('foryou')
  await waitForRequests(1)
  useLibrary.getState().resetRecommendations()
  resetEngines(account)
  useFeed.getState().resetAll()
  resolveSearch(requests[0], 'reset-late')
  await old
  assert.deepEqual(useFeed.getState().channels, {})
  assert.deepEqual(useLibrary.getState().seen, {})
  for (const suffix of ['', ':taste', ':random']) assert.equal(localStorage.getItem(`gitube:cursors:${account}${suffix}`), null)
})

test('an account change isolates late results and scroll writes from the next account', async () => {
  const oldAccount = account
  const old = useFeed.getState().loadMore('foryou')
  await waitForRequests(1)
  loginAs(`${account}-b`)
  account = `${account}-b`
  useSeeds.setState({ seeds: { starred: [], own: [] }, following: [] })
  const current = useFeed.getState().loadMore('foryou')
  await waitForRequests(2)
  resolveSearch(requests[1], 'account-b')
  await current
  useFeed.getState().saveScroll('foryou', 300)
  useFeed.getState().saveScroll('foryou', 900, 'normal', oldAccount)
  const seen = { ...useLibrary.getState().seen }
  resolveSearch(requests[0], 'account-a-late')
  await old
  const key = feedKey(account, 'foryou')
  assert.equal(useFeed.getState().channels[key].scrollY, 300)
  assert.deepEqual(Object.keys(useFeed.getState().channels), [key])
  assert.deepEqual(useLibrary.getState().seen, seen)
  assert.equal(localStorage.getItem(`gitube:cursors:${oldAccount}`), null)
  assert.notEqual(feedKey(oldAccount, 'foryou'), key)
})

test('seed reset starts fresh promises and late settlement cannot cache data or clear the new promises', async () => {
  useSeeds.getState().reset()
  const oldSeeds = useSeeds.getState().loadSeeds()
  const oldFollowing = useSeeds.getState().loadFollowing()
  await waitForRequests(2)
  loginAs(`${account}-b`)
  const newSeeds = useSeeds.getState().loadSeeds()
  const newFollowing = useSeeds.getState().loadFollowing()
  await waitForRequests(4)
  assert.notEqual(oldSeeds, newSeeds)
  assert.notEqual(oldFollowing, newFollowing)
  const seedResponse = (name) => new Response(JSON.stringify({ data: { viewer: {
    starredRepositories: { nodes: [rawRepo(name)] }, repositories: { nodes: [] },
  } } }))
  const followingResponse = (login) => new Response(JSON.stringify({ data: { viewer: { following: { nodes: [{
    login, avatarUrl: '', starredRepositories: { edges: [{ starredAt: new Date().toISOString(), node: rawRepo(login) }] },
  }] } } } }))
  requests[0].resolve(seedResponse('old-seed'))
  requests[1].resolve(followingResponse('old-following'))
  await Promise.all([oldSeeds, oldFollowing])
  assert.equal(useSeeds.getState().seeds, null)
  assert.equal(useSeeds.getState().following, null)
  assert.equal(useSeeds.getState().loadSeeds(), newSeeds)
  assert.equal(useSeeds.getState().loadFollowing(), newFollowing)
  requests[2].resolve(seedResponse('new-seed'))
  requests[3].resolve(followingResponse('new-following'))
  await Promise.all([newSeeds, newFollowing])
  assert.equal(useSeeds.getState().seeds.starred[0].name, 'new-seed')
  assert.equal(useSeeds.getState().following[0].login, 'new-following')
})

test('live feedback filters cached batches, preserves undo placeholders, and shows a stable empty state', async () => {
  const repos = ['starred', 'topic', 'lang', 'disliked', 'undo'].map((name) => normalizeRepo(rawRepo(name, name === 'topic' ? 'blocked' : 'safe')))
  repos[2].language = 'Rust'
  const items = repos.map((repo) => ({ key: repo.id, repo }))
  const lib = { dislikedRepos: [repos[3].nameWithOwner.toUpperCase(), repos[4].nameWithOwner], blockedTopics: ['blocked'], blockedLangs: ['Rust'] }
  const dismissed = { [repos[4].nameWithOwner]: { label: '已减少推荐', reason: { type: 'repo' } } }
  const visible = visibleFeedItems(items, lib, (repo) => repo.id === 'starred', dismissed)
  assert.deepEqual(visible.map((item) => item.repo.name), ['undo'])
  const none = visibleFeedItems(items, lib, (repo) => repo.id === 'starred')
  assert.deepEqual(none, [])
  assert.equal(feedDisplayStatus({ items, status: 'idle' }, 0), 'end')
  assert.equal(feedDisplayStatus({ items, status: 'error' }, 0), 'error')

  useLibrary.getState().setFollowingWeight('alice', 0)
  useSeeds.setState({ following: [{ login: 'alice', avatarUrl: '', starredAt: new Date().toISOString(), repo: repos[0] }] })
  await useFeed.getState().loadMore('following')
  assert.equal(useFeed.getState().channels[feedKey(account, 'following')].items.length, 1, 'zero recommendation weight keeps original following channel data')
  assert.equal(requests.length, 0)
})
