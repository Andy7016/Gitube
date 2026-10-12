import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`
const interestsUrl = dataUrl(await readFile(new URL('../gitube/src/lib/interests.ts', import.meta.url), 'utf8'))
const validateUrl = dataUrl(await readFile(new URL('../gitube/src/api/validate.ts', import.meta.url), 'utf8'))
const source = compile(await readFile(new URL('../gitube/src/store/library.ts', import.meta.url), 'utf8'))
  .replace("'zustand'", JSON.stringify(import.meta.resolve('zustand')))
  .replace("'../api/validate'", JSON.stringify(validateUrl))
  .replace("'../lib/interests'", JSON.stringify(interestsUrl))
let moduleId = 0
const fixedNow = Date.parse('2026-10-11T08:00:00Z')

function repo(name = 'Project') {
  return { id: name, nameWithOwner: `Owner/${name}`, name, owner: 'Owner', url: `https://github.com/Owner/${name}`, topics: ['python'], stars: 50, forks: 1, viewerHasStarred: false, language: 'Python', description: 'A project' }
}
function storage(initial = []) {
  const values = new Map(initial)
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
async function loadModule() {
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleId++}`)).useLibrary
}
async function withLibrary(fn, initial = []) {
  const previous = globalThis.localStorage
  const dateNow = Date.now
  const saved = storage(initial)
  globalThis.localStorage = saved
  Date.now = () => fixedNow
  try { await fn(await loadModule(), saved) } finally { globalThis.localStorage = previous; Date.now = dateNow }
}
const oldLibrary = extra => ({ version: 1, onboarded: true, interests: ['python'], folders: [{ id: 'default', name: 'My favorites', createdAt: 1, items: [{ repo: repo(), at: 10 }] }], later: [{ repo: repo('Later'), at: null }], history: [], events: [], dislikedRepos: [], blockedTopics: [], blockedLangs: [], seen: {}, ...extra })

test('version 1 and legacy unprefixed account storage gain defaults without losing favorites', async () => {
  await withLibrary(async (useLibrary, saved) => {
    useLibrary.getState().load('github:Alice')
    const state = useLibrary.getState()
    assert.equal(state.recommendationMode, 'normal')
    assert.deepEqual(state.followingWeights, {})
    assert.deepEqual(state.engagementAt, {})
    assert.equal(state.folders[0].items[0].repo.nameWithOwner, 'Owner/Project')
    assert.equal(state.later[0].at, null)
    assert.equal(JSON.parse(saved.getItem('gitube:library:github:alice')).folders[0].name, 'My favorites')
  }, [['gitube:library:alice', JSON.stringify(oldLibrary())]])
})

test('malformed new preferences are sanitized independently of saved collections', async () => {
  await withLibrary(async useLibrary => {
    useLibrary.getState().load('github:alice')
    const state = useLibrary.getState()
    assert.equal(state.folders[0].items.length, 1)
    assert.equal(state.recommendationMode, 'normal')
    assert.deepEqual(state.followingWeights, { alice: 0, bob: 3 })
    assert.deepEqual(state.engagementAt, { 'owner/project': fixedNow - 1 })
    assert.equal(state.events[0].kind, 'dwell')
    assert.deepEqual(state.seen, { 'owner/project': fixedNow - 1 })
  }, [['gitube:library:github:alice', JSON.stringify(oldLibrary({
    recommendationMode: 'garbage', followingWeights: { Alice: 0, BOB: 3, negative: -1, huge: 4, string: '2', nested: {}, 'bad/login': 2 },
    engagementAt: { 'Owner/Project': fixedNow - 1, 'owner/expired': fixedNow - 86_400_000, 'owner/future': fixedNow + 1, bad: fixedNow, 'owner/string': 'no' },
    events: [{ kind: 'dwell', topics: ['python'], lang: 'Python', at: fixedNow }, { kind: 'unknown', topics: [], lang: null, at: fixedNow }],
    seen: { 'Owner/Project': fixedNow - 1 },
  }))]])
})

test('mode and per-person slider persist by account, reject bad weights, and reset empty taste selection', async () => {
  await withLibrary(async (useLibrary, saved) => {
    const actions = useLibrary.getState()
    actions.load('github:alice')
    actions.setInterests(['python'])
    actions.setRecommendationMode('taste')
    actions.setFollowingWeight('  BOB  ', 2.5)
    for (const value of [-1, 4, NaN, Infinity, '2']) actions.setFollowingWeight('bob', value)
    assert.equal(useLibrary.getState().followingWeights.bob, 2.5)
    assert.equal(JSON.parse(saved.getItem('gitube:library:github:alice')).recommendationMode, 'taste')
    actions.load('github:bob')
    assert.deepEqual(useLibrary.getState().followingWeights, {})
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
    actions.setFollowingWeight('alice', 0)
    actions.markSeen(['OWNER/SEEN'])
    assert.deepEqual(useLibrary.getState().seen, { 'owner/seen': fixedNow })
    actions.load('github:alice')
    assert.deepEqual(useLibrary.getState().followingWeights, { bob: 2.5 })
    assert.equal(useLibrary.getState().recommendationMode, 'taste')
    actions.setInterests(['not-an-interest'])
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
    actions.setRecommendationMode('taste')
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
    actions.setInterests(['python'])
    actions.setRecommendationMode('taste')
    actions.dislike(repo(), { type: 'topic', topic: 'python' })
    assert.equal(useLibrary.getState().recommendationMode, 'normal')
  })
})

test('dwell records once per account/repository/24h across reloads and ignores stale account timers', async () => {
  await withLibrary(async (useLibrary, saved) => {
    const actions = useLibrary.getState()
    actions.load('github:alice')
    assert.equal(actions.recordEngagement(repo(), 'github:bob'), false)
    assert.equal(actions.recordEngagement(repo(), 'github:alice'), true)
    assert.equal(actions.recordEngagement(repo('project'), 'github:alice'), false)
    assert.equal(useLibrary.getState().events.length, 1)
    assert.equal(useLibrary.getState().events[0].kind, 'dwell')
    const reloaded = await loadModule()
    reloaded.getState().load('github:alice')
    assert.equal(reloaded.getState().recordEngagement(repo(), 'github:alice'), false)
    Date.now = () => fixedNow + 86_400_000
    assert.equal(reloaded.getState().recordEngagement(repo(), 'github:alice'), true)
    reloaded.getState().load('github:bob')
    assert.equal(reloaded.getState().recordEngagement(repo(), 'github:alice'), false)
    assert.equal(reloaded.getState().recordEngagement(repo(), 'github:bob'), true)
    assert.equal(JSON.parse(saved.getItem('gitube:library:github:alice')).events.length, 2)
    assert.equal(JSON.parse(saved.getItem('gitube:library:github:bob')).events.length, 1)
  })
})

test('engagement is mode-independent, bounded, and recommendation reset preserves favorites', async () => {
  await withLibrary(async useLibrary => {
    const actions = useLibrary.getState()
    actions.load('github:alice')
    actions.setInterests(['python'])
    for (const mode of ['normal', 'taste', 'random']) {
      actions.setRecommendationMode(mode)
      assert.equal(actions.recordEngagement(repo(mode), 'github:alice'), true)
    }
    useLibrary.setState({ engagementAt: Object.fromEntries(Array.from({ length: 1100 }, (_, index) => [`owner/r${index}`, fixedNow - index - 1])) })
    assert.equal(actions.recordEngagement(repo('Newest'), 'github:alice'), false)
    assert.equal(Object.keys(useLibrary.getState().engagementAt).length, 1000)
    assert.equal(actions.recordEngagement(repo('r0'), 'github:alice'), false, 'capacity does not evict an active dedup record to count it twice')
    actions.quickSave(repo())
    actions.setFollowingWeight('bob', 0)
    actions.resetRecommendations()
    const state = useLibrary.getState()
    assert.equal(state.folders[0].items.length, 1)
    assert.deepEqual(state.interests, ['python'])
    assert.deepEqual(state.events, [])
    assert.deepEqual(state.engagementAt, {})
    assert.deepEqual(state.followingWeights, {})
    assert.equal(state.recommendationMode, 'normal')
  })
})
