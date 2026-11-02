import test from 'node:test'
import assert from 'node:assert/strict'
import { useLibrary } from '../src/store/library.ts'

let nextAccount = 0
function withLibrary(run, initial = {}) {
  const previousStorage = globalThis.localStorage
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const values = new Map(Object.entries(initial))
  const timers = new Map()
  let nextTimer = 0
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  globalThis.setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id }
  globalThis.clearTimeout = id => timers.delete(id)
  const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
  try {
    useLibrary.getState().load(`following-test-${++nextAccount}`)
    run(useLibrary.getState(), values, flush)
  } finally {
    flush()
    globalThis.localStorage = previousStorage
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
  }
}

const oldData = extra => ({ version: 1, onboarded: true, interests: ['python'], folders: [{ id: 'default', name: 'Favorites', createdAt: 1, items: [{ at: 2, repo: { nameWithOwner: 'Owner/Saved', topics: ['python'] } }] }], later: [], history: [], events: [], dislikedRepos: [], blockedTopics: [], blockedLangs: [], seen: {}, ...extra })

test('old version-1 favorites survive missing and malformed following preferences', () => {
  withLibrary(actions => {
    actions.load('OldData')
    assert.deepEqual(useLibrary.getState().followingWeights, {})
    assert.equal(useLibrary.getState().folders[0].items[0].repo.nameWithOwner, 'Owner/Saved')
    actions.load('Malformed')
    const state = useLibrary.getState()
    assert.equal(state.version, 1)
    assert.equal(state.folders[0].name, 'Favorites')
    assert.deepEqual(state.followingWeights, { alice: 0, bob: 3, carol: 1.25 })
  }, {
    'gitube:library:olddata': JSON.stringify(oldData()),
    'gitube:library:malformed': JSON.stringify(oldData({ followingWeights: { Alice: 0, BOB: 3, ' Carol ': 1.25, offStep: 1.1, negative: -1, huge: 4, string: '2', nested: {}, 'bad/login': 2 } })),
  })
})

test('following weights normalize logins and accept only 0..3 in quarter steps', () => {
  withLibrary(actions => {
    actions.setFollowingWeight('  ALICE  ', 2.5)
    for (const weight of [-1, 4, 1.1, NaN, Infinity, '2']) actions.setFollowingWeight('alice', weight)
    actions.setFollowingWeight('bad/login', 1)
    assert.deepEqual(useLibrary.getState().followingWeights, { alice: 2.5 })
    actions.setFollowingWeight('alice', 0)
    assert.equal(useLibrary.getState().followingWeights.alice, 0)
  })
})

test('debounced snapshots survive rapid account changes without cross-account writes', () => {
  withLibrary((actions, values, flush) => {
    actions.load('Alice')
    actions.setFollowingWeight('PersonA', 2.5)
    actions.setInterests(['python'])
    actions.load('Bob')
    assert.deepEqual(JSON.parse(values.get('gitube:library:alice')).followingWeights, { persona: 2.5 })
    assert.deepEqual(useLibrary.getState().followingWeights, {})
    actions.setFollowingWeight('PersonB', 0)
    actions.load('Alice')
    assert.deepEqual(useLibrary.getState().followingWeights, { persona: 2.5 })
    actions.setFollowingWeight('PersonA', 3)
    flush()
    assert.deepEqual(JSON.parse(values.get('gitube:library:alice')).followingWeights, { persona: 3 })
    assert.deepEqual(JSON.parse(values.get('gitube:library:bob')).followingWeights, { personb: 0 })
    assert.deepEqual(JSON.parse(values.get('gitube:library:alice')).interests, ['python'])
    assert.deepEqual(JSON.parse(values.get('gitube:library:bob')).interests, [])
  })
})
