import test from 'node:test'
import assert from 'node:assert/strict'
import { RecommendEngine, StaleRecommendationRequest, getEngine, resetEngines } from '../src/lib/recommend.ts'
import { hasTasteInterests, RECOMMENDATION_MODES, TASTE_FAMILIAR_SHARE } from '../src/lib/recommendationMode.ts'
import { candidateSearch, context, deferred, library, memoryStorage, repo, seededRandom } from './recommend-fixtures.mjs'

globalThis.localStorage = memoryStorage()
const candidates = (familiar, unfamiliar) => [
  ...Array.from({ length: unfamiliar }, (_, i) => repo(`other${i}`, ['database'])),
  ...Array.from({ length: familiar }, (_, i) => repo(`familiar${i}`, ['rust'])),
]
const familiarCount = (items) => items.filter((item) => item.repo.topics.includes('rust')).length

test('taste classifies actual candidate topics and picks the configured approximately 50/50 target', async () => {
  assert.equal(TASTE_FAMILIAR_SHARE, 0.5)
  const calls = []
  const engine = new RecommendEngine('taste-balanced', 'taste', { random: seededRandom(), searchMany: candidateSearch(candidates(15, 15), calls) })
  const items = await engine.next(context({ lib: library({ interests: ['rust'] }) }))
  assert.equal(items.length, 18)
  assert.equal(familiarCount(items), 9)
  assert.ok(items.every((item) => item.reason.text === (item.repo.topics.includes('rust') ? '已选兴趣内随机探索' : '已选兴趣外随机探索')))
  assert.ok(calls.length <= 3 && calls.every((specs) => specs.length <= 8))
  const alternate = new RecommendEngine('taste-alternate', 'taste', { tasteFamiliarShare: 0.25, random: seededRandom(), searchMany: candidateSearch(candidates(15, 15)) })
  assert.equal(familiarCount(await alternate.next(context({ lib: library({ interests: ['rust'] }) }))), 5)
})

test('taste fills a short side with real candidates from the other side and preserves available small batches', async () => {
  for (const [familiar, unfamiliar, size, count] of [[2, 30, 18, 2], [30, 1, 18, 17], [2, 3, 5, 2], [0, 22, 18, 0]]) {
    const calls = []
    const engine = new RecommendEngine(`short-${familiar}-${unfamiliar}`, 'taste', { random: seededRandom(), searchMany: candidateSearch(candidates(familiar, unfamiliar), calls) })
    const items = await engine.next(context({ lib: library({ interests: ['rust'] }) }))
    assert.equal(items.length, size)
    assert.equal(familiarCount(items), count)
    assert.equal(new Set(items.map((item) => item.repo.nameWithOwner)).size, size)
    assert.ok(calls.length <= 3 && calls.every((specs) => specs.length <= 8))
  }
})

test('random candidate order and retrieval ignore learned profile, dwell, and follower weights; exploration has no social slots', async () => {
  const pool = candidates(15, 15)
  const social = { login: 'friend', avatarUrl: '', starredAt: new Date().toISOString(), repo: repo('social-only', ['rust']) }
  const callsA = [], callsB = []
  const base = new RecommendEngine('random-a', 'random', { random: seededRandom(88), searchMany: candidateSearch(pool, callsA) })
  const learned = new RecommendEngine('random-b', 'random', { random: seededRandom(88), searchMany: candidateSearch(pool, callsB) })
  const a = await base.next(context())
  const b = await learned.next(context({ following: [social], lib: library({ interests: ['rust'], followingWeights: { friend: 3 },
    events: Array.from({ length: 20 }, () => ({ kind: 'dwell', topics: ['database'], lang: 'TypeScript', at: Date.now() })) }) }))
  assert.deepEqual(a.map((item) => item.repo.id), b.map((item) => item.repo.id))
  assert.deepEqual(callsA, callsB)
  assert.ok(callsA.flat().every((spec) => Number(spec.query.match(/stars:(?:>=)?(\d+)/)?.[1]) >= 21))
  assert.ok(callsA.flat().every((spec) => !spec.query.includes('topic:') && spec.query.includes('created:') && spec.query.includes('stars:') && spec.query.includes('sort:')))
  assert.ok(b.every((item) => item.reason.kind === 'explore' && item.repo.name !== 'social-only'))
  const taste = new RecommendEngine('taste-social', 'taste', { random: seededRandom(), searchMany: candidateSearch(pool) })
  const tasteItems = await taste.next(context({ following: [social], lib: library({ interests: ['rust'], followingWeights: { friend: 3 } }) }))
  assert.ok(tasteItems.every((item) => item.reason.kind === 'explore' && item.repo.name !== 'social-only'))
  const tasteLearned = new RecommendEngine('taste-learned', 'taste', { random: seededRandom(), searchMany: candidateSearch(pool) })
  const learnedTasteItems = await tasteLearned.next(context({ following: [social], lib: library({ interests: ['rust'], followingWeights: { friend: 0 },
    events: Array.from({ length: 20 }, () => ({ kind: 'dwell', topics: ['database'], lang: 'TypeScript', at: Date.now() })) }) }))
  assert.deepEqual(tasteItems.map((item) => item.repo.id), learnedTasteItems.map((item) => item.repo.id))
})

test('every mode keeps Star, own repository, disliked, blocked topic/language and recent seen filters', async () => {
  const blocked = [repo('starred'), repo('api-starred'), repo('VIEWER/own'), repo('disliked'), repo('blocked-topic', ['blocked']),
    repo('blocked-language', [], { language: 'Java' }), repo('seen'), repo('archived', [], { isArchived: true })]
  const eligible = repo('eligible', ['rust'])
  for (const mode of ['normal', 'taste', 'random']) {
    const engine = new RecommendEngine('viewer', mode, { random: seededRandom(), searchMany: candidateSearch([...blocked, eligible]) })
    const ctx = context({ seeds: { starred: [blocked[0]], own: [] }, isStarred: (project) => project.name === 'api-starred',
      lib: library({ interests: ['rust'], dislikedRepos: [blocked[3].nameWithOwner.toUpperCase()], blockedTopics: ['blocked'], blockedLangs: ['Java'], seen: { [blocked[6].nameWithOwner]: Date.now() } }) })
    assert.deepEqual((await engine.next(ctx)).map((item) => item.repo.name), ['eligible'])
    assert.deepEqual(await engine.next(ctx), [])
  }
})

test('mode and account caches/cursors are isolated while normal accepts the old cursor key', async () => {
  localStorage.clear()
  localStorage.setItem('gitube:cursors:legacy', JSON.stringify({ 'topic:rust:best': { after: 'old-after', done: false, at: Date.now() } }))
  const calls = []
  const normal = new RecommendEngine('Legacy', 'normal', { random: () => 0, searchMany: candidateSearch(candidates(20, 0), calls) })
  await normal.next(context({ lib: library({ interests: ['rust'] }) }))
  assert.equal(calls[0].find((spec) => spec.query.startsWith('topic:rust ')).after, 'old-after')
  for (const mode of ['taste', 'random']) {
    const engine = new RecommendEngine('Legacy', mode, { random: seededRandom(), searchMany: candidateSearch(candidates(20, 0)) })
    assert.ok((await engine.next(context({ lib: library({ interests: ['rust'] }) }))).length > 0)
    assert.ok(localStorage.getItem(`gitube:cursors:legacy:${mode}`))
  }
  assert.equal(getEngine('MixedCase'), getEngine('mixedcase', 'normal'))
  assert.notEqual(getEngine('MixedCase'), getEngine('MixedCase', 'random'))
  const other = getEngine('other')
  localStorage.setItem('gitube:cursors:other', '{}')
  const previous = getEngine('legacy')
  resetEngines('LEGACY')
  assert.notEqual(previous, getEngine('legacy'))
  assert.equal(getEngine('other'), other)
  for (const suffix of ['', ':taste', ':random']) assert.equal(localStorage.getItem(`gitube:cursors:legacy${suffix}`), null)
  assert.equal(localStorage.getItem('gitube:cursors:other'), '{}')
})

test('slow invalidated requests reject without committing cursors or poisoning session seen', async () => {
  for (const trigger of ['reset', 'context', 'newer-request']) {
    const gate = deferred()
    const project = repo(`slow-${trigger}`, ['rust'])
    let current = true, calls = 0
    const engine = new RecommendEngine(`slow-${trigger}`, 'random', { random: seededRandom(), searchMany: async (specs) => {
      if (++calls === 1) return gate.promise
      return candidateSearch([project])(specs)
    } })
    const pending = engine.next(context({ isCurrent: () => current }))
    const rejected = assert.rejects(pending, StaleRecommendationRequest)
    if (trigger === 'reset') engine.reset()
    if (trigger === 'context') current = false
    if (trigger === 'newer-request') await engine.next(context())
    const before = localStorage.getItem(`gitube:cursors:slow-${trigger}:random`)
    gate.resolve([{ repos: [project], endCursor: 'stale-cursor', hasNextPage: true, total: 1 }])
    await rejected
    assert.equal(localStorage.getItem(`gitube:cursors:slow-${trigger}:random`), before)
    if (trigger !== 'newer-request') {
      current = true
      assert.deepEqual((await engine.next(context())).map((item) => item.repo.name), [project.name])
    }
  }
})

test('failed batches do not commit partial cursors, and stale failures are identified as stale', async () => {
  const gate = deferred()
  const engine = new RecommendEngine('stale-error', 'random', { random: seededRandom(), searchMany: () => gate.promise })
  const pending = engine.next(context())
  const rejected = assert.rejects(pending, StaleRecommendationRequest)
  engine.invalidate()
  gate.reject(new Error('network'))
  await rejected
  assert.equal(localStorage.getItem('gitube:cursors:stale-error:random'), null)
  let calls = 0
  const partial = new RecommendEngine('partial-error', 'taste', { random: seededRandom(), searchMany: async (specs) => {
    if (++calls > 1) throw new Error('network')
    return candidateSearch(candidates(1, 0))(specs)
  } })
  await assert.rejects(partial.next(context({ lib: library({ interests: ['rust'] }) })), /network/)
  assert.equal(localStorage.getItem('gitube:cursors:partial-error:taste'), null)
})

test('taste is unavailable without usable selected interests and direct calls fall back to normal', async () => {
  assert.equal(RECOMMENDATION_MODES.length, 3)
  assert.equal(hasTasteInterests(['unknown']), false)
  assert.equal(hasTasteInterests(['rust'], ['rust']), false)
  assert.equal(hasTasteInterests(['rust']), true)
  const calls = []
  const engine = new RecommendEngine('taste-fallback', 'taste', { random: seededRandom(), searchMany: candidateSearch([repo('available')], calls) })
  const items = await engine.next(context({ lib: library({ interests: ['unknown'] }) }))
  assert.equal(items.length, 1)
  assert.ok(calls.flat().some((spec) => !spec.query.includes('created:200')))
  assert.notEqual(items[0].reason.text, '公开搜索候选池内随机探索')
})
