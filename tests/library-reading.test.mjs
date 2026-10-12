import test from 'node:test'
import assert from 'node:assert/strict'
import { useLibrary } from '../src/store/library.ts'

const fixedNow = Date.parse('2026-10-12T08:00:00Z')
let nextAccount = 0
function withLibrary(run, initial = {}) {
  const previousStorage = globalThis.localStorage
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const previousNow = Date.now
  const values = new Map(Object.entries(initial))
  const timers = new Map()
  let nextTimer = 0
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  globalThis.setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id }
  globalThis.clearTimeout = id => timers.delete(id)
  Date.now = () => fixedNow
  const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
  try {
    useLibrary.getState().load(`reading-test-${++nextAccount}`)
    run(useLibrary.getState(), values, flush)
  } finally {
    flush()
    globalThis.localStorage = previousStorage
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
    Date.now = previousNow
  }
}

const repo = (name = 'Project') => ({ nameWithOwner: `Owner/${name}`, topics: ['python'], language: 'Python' })
const oldData = extra => ({ version: 1, onboarded: true, interests: ['python'], folders: [{ id: 'default', name: 'Favorites', createdAt: 1, items: [{ at: 2, repo: repo('Saved') }] }], later: [{ at: 3, repo: repo('Later') }], history: [{ at: 4, repo: repo('History') }], events: [], dislikedRepos: [], blockedTopics: [], blockedLangs: [], seen: {}, ...extra })

test('malformed dwell fields are filtered independently without losing old collections', () => {
  withLibrary(actions => {
    actions.load('Legacy')
    const state = useLibrary.getState()
    assert.equal(state.version, 1)
    assert.equal(state.folders[0].items.length, 1)
    assert.equal(state.later.length, 1)
    assert.equal(state.history.length, 1)
    assert.deepEqual(state.dwellRecorded, { 'owner/project': fixedNow - 1 })
    assert.equal(state.events.length, 1)
    assert.equal(state.events[0].kind, 'dwell')
  }, { 'gitube:library:legacy': JSON.stringify(oldData({
    dwellRecorded: { 'Owner/Project': fixedNow - 2, 'owner/project': fixedNow - 1, 'owner/expired': fixedNow - 86_400_000, 'owner/future': fixedNow + 1, bad: fixedNow, 'owner/string': 'no', 'owner/negative': -1 },
    events: [{ kind: 'dwell', topics: ['python'], lang: 'Python', at: fixedNow }, { kind: 'unknown', topics: [], lang: null, at: fixedNow }],
  })) })
})

test('dwell deduplicates case-insensitively for 24 hours across account reloads', () => {
  withLibrary((actions, values, flush) => {
    actions.load('Alice')
    let revision = useLibrary.getState().recommendationRevision
    assert.equal(actions.recordDwell(repo(), 'Bob', revision), false)
    assert.equal(actions.recordDwell(repo(), 'Alice', revision), true)
    assert.equal(actions.recordDwell(repo('project'), 'Alice', revision), false)
    assert.equal(useLibrary.getState().events.length, 1)
    assert.equal(useLibrary.getState().events[0].kind, 'dwell')
    actions.load('Bob')
    assert.equal(actions.recordDwell(repo(), 'Alice', revision), false)
    assert.equal(actions.recordDwell(repo(), 'Bob', useLibrary.getState().recommendationRevision), true)
    actions.load('Alice')
    revision = useLibrary.getState().recommendationRevision
    assert.equal(actions.recordDwell(repo(), 'Alice', revision), false)
    Date.now = () => fixedNow + 86_400_000 - 1
    assert.equal(actions.recordDwell(repo(), 'Alice', revision), false)
    Date.now = () => fixedNow + 86_400_000
    assert.equal(actions.recordDwell(repo(), 'Alice', revision), true)
    flush()
    assert.equal(JSON.parse(values.get('gitube:library:alice')).events.length, 2)
    assert.equal(JSON.parse(values.get('gitube:library:bob')).events.length, 1)
  })
})

test('reset and account changes invalidate old visits; weight updates keep their revision', () => {
  withLibrary(actions => {
    actions.load('Alice')
    const firstRevision = useLibrary.getState().recommendationRevision
    actions.setFollowingWeight('bob', 2)
    assert.equal(useLibrary.getState().recommendationRevision, firstRevision)
    actions.resetRecommendations()
    const resetRevision = useLibrary.getState().recommendationRevision
    assert.ok(resetRevision > firstRevision)
    assert.equal(actions.recordDwell(repo(), 'Alice', firstRevision), false)
    actions.load('Bob')
    actions.load('Alice')
    assert.equal(actions.recordDwell(repo(), 'Alice', resetRevision), false)
    assert.equal(actions.recordDwell(repo(), 'Alice', useLibrary.getState().recommendationRevision), true)
  })
})

test('1000 active dedup entries block new signals without evicting existing entries', () => {
  withLibrary(actions => {
    const recorded = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`owner/r${index}`, fixedNow - index]))
    useLibrary.setState({ dwellRecorded: recorded })
    const { login, recommendationRevision } = useLibrary.getState()
    assert.equal(actions.recordDwell(repo('New'), login, recommendationRevision), false)
    assert.deepEqual(useLibrary.getState().dwellRecorded, recorded)
    assert.equal(actions.recordDwell(repo('r0'), login, recommendationRevision), false)
    Date.now = () => fixedNow + 86_400_000
    assert.equal(actions.recordDwell(repo('New'), login, recommendationRevision), true)
    assert.equal(Object.keys(useLibrary.getState().dwellRecorded).length, 1)
  })
})

test('recommendation reset preserves favorites, later, history and manually selected interests', () => {
  withLibrary(actions => {
    actions.load('Existing')
    actions.recordDwell(repo(), 'Existing', useLibrary.getState().recommendationRevision)
    actions.setFollowingWeight('bob', 0)
    actions.resetRecommendations()
    const state = useLibrary.getState()
    assert.equal(state.folders[0].items.length, 1)
    assert.equal(state.later.length, 1)
    assert.equal(state.history.length, 1)
    assert.deepEqual(state.interests, ['python'])
    assert.deepEqual(state.dwellRecorded, {})
    assert.deepEqual(state.followingWeights, {})
    assert.deepEqual(state.events, [])
  }, { 'gitube:library:existing': JSON.stringify(oldData()) })
})
