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

test('legacy collections missing repo metadata survive loading, saving and reloading', () => {
  withLibrary((actions, values, flush) => {
    actions.load('LegacyMetadata')
    const collections = state => [state.folders[0].items, state.later, state.history]
    const snapshot = collections(useLibrary.getState())
    assert.deepEqual(snapshot.map(items => items.map(item => item.repo.nameWithOwner)), [
      ['Owner/Saved'], ['Owner/Later'], ['Owner/History'],
    ])
    assert.equal(useLibrary.getState().folders[0].createdAt, 0)
    for (const [item] of snapshot) {
      assert.deepEqual(item.repo.topics, [])
      assert.equal(item.repo.owner, 'Owner')
      assert.equal(item.repo.name, item.repo.nameWithOwner.split('/')[1])
      assert.equal(item.repo.url, `https://github.com/${item.repo.nameWithOwner}`)
      assert.equal(item.repo.stars, 0)
      assert.equal(item.repo.forks, 0)
      assert.equal(item.repo.language, null)
      assert.equal(item.repo.description, null)
      assert.equal(item.repo.coverImage, null)
      assert.equal(item.repo.ownerType, 'User')
      assert.equal(item.repo.viewerHasStarred, false)
      assert.equal(item.at, 0)
    }
    actions.setFollowingWeight('alice', 2)
    flush()
    const saved = JSON.parse(values.get('gitube:library:legacymetadata'))
    assert.deepEqual(collections(saved), snapshot)
    actions.load('Other')
    actions.load('LegacyMetadata')
    assert.deepEqual(collections(useLibrary.getState()), snapshot)
    assert.equal(useLibrary.getState().followingWeights.alice, 2)
  }, { 'gitube:library:legacymetadata': JSON.stringify({
    version: 1,
    folders: [{ id: 'default', name: 'Favorites', items: [{ repo: { nameWithOwner: 'Owner/Saved' } }] }],
    later: [{ repo: { nameWithOwner: 'Owner/Later', topics: null }, at: 'old' }],
    history: [{ repo: { nameWithOwner: 'Owner/History', topics: 'python' }, at: null }],
  }) })
})

test('stored repo metadata is retained while malformed optional fields get safe defaults', () => {
  const completeRepo = {
    id: 'R_123', nameWithOwner: 'Org/Project', name: 'Project', owner: 'Org', ownerId: 'O_1',
    ownerType: 'Organization', ownerAvatar: 'https://example.com/avatar.png', description: 'Saved description',
    url: 'https://github.com/Org/Project', homepageUrl: 'https://example.com', stars: 12, forks: 3,
    language: 'Python', languageColor: '#3572A5', topics: ['python'], pushedAt: '2026-10-01T00:00:00Z',
    createdAt: '2020-01-01T00:00:00Z', viewerHasStarred: true, coverImage: 'https://example.com/cover.png',
    isArchived: true, license: 'MIT', defaultBranch: 'main', legacyExtra: { preserved: true },
  }
  withLibrary((actions, values, flush) => {
    actions.load('RepoMetadata')
    const [complete, malformed] = useLibrary.getState().later
    assert.deepEqual(complete, { repo: completeRepo, at: 123 })
    assert.equal(malformed.repo.nameWithOwner, 'Owner/Partial')
    assert.equal(malformed.repo.name, 'Partial')
    assert.equal(malformed.repo.owner, 'Owner')
    assert.equal(malformed.repo.id, '')
    assert.equal(malformed.repo.ownerId, '')
    assert.equal(malformed.repo.ownerType, 'User')
    assert.equal(malformed.repo.ownerAvatar, '')
    assert.equal(malformed.repo.description, null)
    assert.equal(malformed.repo.url, 'https://github.com/Owner/Partial')
    assert.equal(malformed.repo.homepageUrl, null)
    assert.equal(malformed.repo.stars, 0)
    assert.equal(malformed.repo.forks, 0)
    assert.equal(malformed.repo.language, null)
    assert.equal(malformed.repo.languageColor, null)
    assert.deepEqual(malformed.repo.topics, ['python'])
    assert.equal(malformed.repo.pushedAt, null)
    assert.equal(malformed.repo.createdAt, '1970-01-01T00:00:00.000Z')
    assert.equal(malformed.repo.viewerHasStarred, false)
    assert.equal(malformed.repo.coverImage, null)
    assert.equal(malformed.repo.isArchived, false)
    assert.equal(malformed.repo.license, null)
    assert.equal(malformed.repo.defaultBranch, null)
    assert.equal(malformed.at, 0)
    flush()
    actions.load('OtherMetadata')
    actions.load('RepoMetadata')
    assert.deepEqual(useLibrary.getState().later, [complete, malformed])
    assert.deepEqual(JSON.parse(values.get('gitube:library:repometadata')).later, [complete, malformed])
  }, { 'gitube:library:repometadata': JSON.stringify({ later: [
    { repo: completeRepo, at: 123 },
    { repo: {
      nameWithOwner: 'Owner/Partial', name: {}, owner: '', id: 1, ownerId: false, ownerType: {}, ownerAvatar: [],
      description: {}, url: 2, homepageUrl: [], stars: '12', forks: -1, language: {}, languageColor: [],
      topics: ['python', null, 42], pushedAt: 7, createdAt: null, viewerHasStarred: 'true', coverImage: {},
      isArchived: 1, license: [], defaultBranch: {},
    }, at: -1 },
  ] }) })
})

test('unusable repo identities are filtered independently across all stored collections', () => {
  const items = [
    null, 1, [], {}, { repo: null }, { repo: [] }, { repo: {} },
    ...['', ' ', 'Owner', 'Owner/', '/Project', 'Owner/Too/Many', 'Owner/Bad Name', 7]
      .map(nameWithOwner => ({ repo: { nameWithOwner, topics: [] }, at: 1 })),
    { repo: { nameWithOwner: 'Owner/Keep' } },
  ]
  withLibrary((actions, values, flush) => {
    actions.load('DamagedEntries')
    const state = useLibrary.getState()
    for (const saved of [state.folders[0].items, state.later, state.history]) {
      assert.equal(saved.length, 1)
      assert.equal(saved[0].repo.nameWithOwner, 'Owner/Keep')
    }
    flush()
    const saved = JSON.parse(values.get('gitube:library:damagedentries'))
    assert.equal(saved.folders[0].items.length, 1)
    assert.equal(saved.later.length, 1)
    assert.equal(saved.history.length, 1)
  }, { 'gitube:library:damagedentries': JSON.stringify({
    folders: [{ id: 'default', name: 'Favorites', createdAt: 1, items }], later: items, history: items,
  }) })
})
