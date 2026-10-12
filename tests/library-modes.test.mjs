import test from 'node:test'
import assert from 'node:assert/strict'
import { useLibrary } from '../src/store/library.ts'

let nextAccount = 0
function withLibrary(run, initial = {}) {
  const values = new Map(Object.entries(initial))
  const previousStorage = globalThis.localStorage
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const timers = new Map()
  let nextTimer = 0
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  globalThis.setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id }
  globalThis.clearTimeout = id => timers.delete(id)
  const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
  try {
    useLibrary.getState().load(`mode-test-${++nextAccount}`)
    run(useLibrary.getState(), values, flush)
  } finally {
    flush()
    globalThis.localStorage = previousStorage
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
  }
}

test('taste requires usable manual interests and mode changes keep the reading revision', () => {
  withLibrary(() => {
    const actions = useLibrary.getState()
    actions.load('ModeTest')
    const revision = useLibrary.getState().recommendationRevision
    actions.setRecommendationMode('taste')
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
    actions.setInterests(['not-a-real-interest'])
    actions.setRecommendationMode('taste')
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
    actions.setInterests(['python'])
    actions.setRecommendationMode('taste')
    assert.equal(useLibrary.getState().recommendationMode, 'taste')
    assert.equal(useLibrary.getState().recommendationRevision, revision)
    actions.setInterests([])
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
    actions.setInterests(['python'])
    actions.setRecommendationMode('taste')
    actions.dislike({ topics: [], language: null }, { type: 'topic', topic: 'python' })
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
    actions.setRecommendationMode('random')
    assert.equal(useLibrary.getState().recommendationMode, 'random')
    actions.resetRecommendations()
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
  })
})

test('invalid mode fields preserve version-1 data, and recommendation revision is transient', () => {
  withLibrary((actions, values, flush) => {
    actions.load('Stored')
    const state = useLibrary.getState()
    assert.equal(state.recommendationMode, 'normal')
    assert.equal(state.folders[0].name, 'Saved folder')
    assert.deepEqual(state.followingWeights, {})
    assert.deepEqual(state.dwellRecorded, {})
    assert.notEqual(state.recommendationRevision, 999)
    flush()
    assert.equal(Object.hasOwn(JSON.parse(values.get('gitube:library:stored')), 'recommendationRevision'), false)
    actions.load('EmptyTaste')
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
  }, {
    'gitube:library:stored': JSON.stringify({ version: 1, recommendationMode: { bad: 'random' }, recommendationRevision: 999, followingWeights: [], dwellRecorded: [], folders: [{ id: 'default', name: 'Saved folder', createdAt: 1, items: [] }] }),
    'gitube:library:emptytaste': JSON.stringify({ version: 1, recommendationMode: 'taste', interests: ['not-an-interest'] }),
  })
})

test('all recommendation modes continue to record reading signals', () => {
  withLibrary(actions => {
    actions.setInterests(['python'])
    const { login, recommendationRevision } = useLibrary.getState()
    for (const mode of ['normal', 'taste', 'random']) {
      actions.setRecommendationMode(mode)
      assert.equal(actions.recordDwell({ nameWithOwner: `Owner/${mode}`, topics: ['python'], language: 'Python' }, login, recommendationRevision), true)
    }
    assert.equal(useLibrary.getState().events.filter(event => event.kind === 'dwell').length, 3)
    assert.equal(useLibrary.getState().recommendationRevision, recommendationRevision)
  })
})
