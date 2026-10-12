import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { compileGitubeSearch } from '../server/gitube-api.mjs'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`
const interestsUrl = dataUrl(await readFile(new URL('../gitube/src/lib/interests.ts', import.meta.url), 'utf8'))
const formatUrl = dataUrl(await readFile(new URL('../gitube/src/lib/format.ts', import.meta.url), 'utf8'))
const source = compile(await readFile(new URL('../gitube/src/lib/recommend.ts', import.meta.url), 'utf8'))
  .replace(/import \{ searchMany \} from ['"]\.\.\/api\/github['"];?/, 'const searchMany = specs => globalThis.__recommendationSearch(specs);')
  .replace("'./format'", JSON.stringify(formatUrl))
  .replace("'./interests'", JSON.stringify(interestsUrl))
const { buildProfile, RecommendEngine, getEngine, resetEngines, selectedInterestTopics, TASTE_FAMILIAR_SHARE } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const now = Date.parse('2026-10-11T08:00:00Z')
const today = new Date(now).toISOString()
const repo = (name, topics = ['python'], extra = {}) => ({ id: name, name, nameWithOwner: `owner/${name}`, owner: 'owner', ownerId: null, ownerType: 'User', ownerAvatar: '', description: 'A repository', url: `https://github.com/owner/${name}`, homepageUrl: null, stars: 50, forks: 1, language: 'Python', languageColor: null, topics, pushedAt: today, createdAt: today, viewerHasStarred: false, coverImage: null, isArchived: false, license: null, defaultBranch: 'main', ...extra })
const library = extra => ({ version: 1, onboarded: true, interests: [], recommendationMode: 'normal', followingWeights: {}, engagementAt: {}, folders: [], later: [], history: [], events: [], dislikedRepos: [], blockedTopics: [], blockedLangs: [], seen: {}, ...extra })
const context = extra => ({ seeds: null, lib: library(), following: [], isStarred: item => item.viewerHasStarred, ...extra })
const following = (login, item, starredAt = today) => ({ login, repo: item, starredAt, avatarUrl: `https://avatars.example/${login}` })
const page = (repos, extra = {}) => ({ repos, endCursor: null, hasNextPage: false, total: repos.length, ...extra })
const rng = (seed = 42) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
async function withEnv(fn, initial = []) {
  const previous = { storage: globalThis.localStorage, search: globalThis.__recommendationSearch, random: Math.random, now: Date.now }
  const storage = new Map(initial)
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  Math.random = rng()
  Date.now = () => now
  const calls = []
  let handler = specs => specs.map(() => page([]))
  globalThis.__recommendationSearch = async specs => { calls.push(specs); return handler(specs, calls.length) }
  try { await fn({ storage, calls, search: next => { handler = next } }) } finally {
    resetEngines(); globalThis.localStorage = previous.storage; globalThis.__recommendationSearch = previous.search; Math.random = previous.random; Date.now = previous.now
  }
}
const topicTotal = profile => [...profile.topicW.values()].reduce((sum, weight) => sum + weight, 0)

test('following profile uses a per-person normalized budget with linear slider multipliers', async () => {
  await withEnv(() => {
    const one = [following('Alice', repo('one', ['python', 'cli', 'rust']))]
    const many = Array.from({ length: 6 }, (_, i) => following('ALICE', repo(`many${i}`, ['python', 'cli', 'rust'])))
    const base = buildProfile(null, library(), one)
    const doubled = buildProfile(null, library({ followingWeights: { alice: 2 } }), one)
    assert.ok(Math.abs(topicTotal(base) - 1.2) < 1e-10)
    assert.ok(Math.abs(topicTotal(buildProfile(null, library(), many)) - topicTotal(base)) < 1e-10)
    for (const [topic, weight] of base.topicW) assert.ok(Math.abs(doubled.topicW.get(topic) - weight * 2) < 1e-10)
    assert.equal(doubled.langW.get('Python'), base.langW.get('Python') * 2)
    const unique = buildProfile(null, library(), [...one, ...one])
    assert.equal(topicTotal(unique), topicTotal(base), 'duplicate sampled stars do not double the budget')
    const twoPeople = buildProfile(null, library(), [...one, following('Bob', repo('other', ['python']))])
    assert.ok(Math.abs(topicTotal(twoPeople) - 2.4) < 1e-10)
  })
})

test('zero following weight removes all profile influence; bad weights default to one and decay/blocking remain', async () => {
  await withEnv(() => {
    const items = [following('Alice', repo('old'), new Date(now - 30 * 86_400_000).toISOString())]
    const disabled = buildProfile(null, library({ followingWeights: { alice: 0 } }), items)
    assert.equal(disabled.topicW.size, 0)
    assert.equal(disabled.langW.size, 0)
    for (const weight of [-1, 4, NaN, Infinity, '2', null]) {
      const profile = buildProfile(null, library({ followingWeights: { alice: weight } }), items)
      assert.ok(Math.abs(profile.topicW.get('python') - 0.6) < 1e-10)
    }
    const oldFixture = library(); delete oldFixture.followingWeights; delete oldFixture.engagementAt; delete oldFixture.recommendationMode
    assert.equal(buildProfile(null, oldFixture, items).topicW.get('python'), 0.6)
    const blocked = buildProfile(null, library({ blockedTopics: ['python'], blockedLangs: ['Python'] }), items)
    assert.equal(blocked.topicW.size, 0)
    assert.equal(blocked.langW.size, 0)
  })
})

test('dwell contributes a small decayed signal and leaves the existing normal event weights intact', async () => {
  await withEnv(() => {
    const profile = buildProfile(null, library({ events: [{ kind: 'dwell', topics: ['python'], lang: 'Python', at: now }] }))
    assert.equal(profile.topicW.get('python'), 0.3)
    assert.equal(profile.langW.get('Python'), 0.15)
    const old = buildProfile(null, library({ events: [{ kind: 'dwell', topics: ['python'], lang: null, at: now - 30 * 86_400_000 }] }))
    assert.equal(old.topicW.get('python'), 0.15)
    assert.equal(buildProfile(null, library({ events: [{ kind: 'open', topics: ['python'], lang: null, at: now }] })).topicW.get('python'), 0.6)
  })
})

test('normal social picks rank current person weights, exclude zero, and shuffle equal-weight input positions', async () => {
  await withEnv(async () => {
    const items = ['first', 'second', 'last', 'disabled'].map(login => following(login, repo(login)))
    const ranked = await new RecommendEngine('github:viewer').next(context({ following: items, lib: library({ followingWeights: { last: 3, disabled: 0 } }) }))
    assert.equal(ranked[0].repo.name, 'last')
    assert.equal(ranked.length, 2)
    assert.ok(ranked.every(item => item.repo.name !== 'disabled'))
    Math.random = () => 0
    const tied = await new RecommendEngine('github:other').next(context({ following: items.slice(0, 3) }))
    assert.deepEqual(tied.map(item => item.repo.name), ['second', 'last'])
  })
})

test('taste default targets 9/9 using actual expanded repo topics, regardless of retrieval source', async () => {
  await withEnv(async ({ search, calls }) => {
    const familiar = Array.from({ length: 15 }, (_, i) => repo(`f${i}`, [i % 2 ? 'ai-agents' : 'large-language-models']))
    const unfamiliar = Array.from({ length: 15 }, (_, i) => repo(`u${i}`, ['database']))
    // Even a topic query may return a mismatching fixture: classification must inspect the actual repo.
    search(specs => specs.map((spec, i) => page(i % 2 ? familiar : unfamiliar)))
    const lib = library({ interests: ['llm'] })
    const output = await new RecommendEngine('guest', 'taste').next(context({ lib, following: [following('friend', repo('social', ['llm']))] }))
    const topics = selectedInterestTopics(lib)
    assert.equal(TASTE_FAMILIAR_SHARE, 0.5)
    assert.equal(output.length, 18)
    assert.equal(output.filter(item => item.repo.topics.some(topic => topics.has(topic))).length, 9)
    assert.ok(output.every(item => item.reason.kind === 'explore'))
    assert.ok(output.every(item => item.repo.name !== 'social'))
    assert.equal(calls.length, 1)
  })
})

test('taste can adjust its ratio and fills shortages from the available opposite side', async () => {
  await withEnv(async ({ search, calls }) => {
    const familiar = Array.from({ length: 20 }, (_, i) => repo(`f${i}`, ['python']))
    const unfamiliar = Array.from({ length: 20 }, (_, i) => repo(`u${i}`, ['database']))
    search(specs => specs.map((spec, i) => page(i % 2 ? familiar : unfamiliar)))
    const ctx = context({ lib: library({ interests: ['python'] }) })
    const ratio = await new RecommendEngine('guest', 'taste', { tasteFamiliarShare: 0.25 }).next(ctx)
    assert.equal(ratio.length, 18)
    assert.equal(ratio.filter(item => item.repo.topics.includes('python')).length, 5)
    calls.length = 0
    search(specs => specs.map((spec, i) => page(i % 2 ? familiar.slice(0, 2) : unfamiliar)))
    const shortage = await new RecommendEngine('guest2', 'taste').next(ctx)
    assert.equal(shortage.length, 18)
    assert.equal(shortage.filter(item => item.repo.topics.includes('python')).length, 2)
    assert.equal(calls.length, 3, 'look for the target share only within the bounded three rounds')
  })
})

test('taste without a valid unblocked explicit interest performs no search', async () => {
  await withEnv(async ({ calls }) => {
    for (const lib of [library(), library({ interests: ['unknown'] }), library({ interests: ['python'], blockedTopics: ['python'] })]) {
      assert.deepEqual(await new RecommendEngine('guest', 'taste').next(context({ lib })), [])
    }
    assert.equal(calls.length, 0)
  })
})

test('random sampling ignores affinity, stars ranking and social insertion for the same actual candidate pool', async () => {
  await withEnv(async ({ search }) => {
    const candidates = Array.from({ length: 40 }, (_, i) => repo(`r${i}`, [i % 2 ? 'python' : 'rust'], { stars: i % 2 ? 1_000_000 : 21, language: i % 2 ? 'Python' : 'Rust' }))
    search(specs => specs.map(() => page(candidates)))
    Math.random = rng(91)
    const first = await new RecommendEngine('one', 'random').next(context({ lib: library({ interests: ['python', 'llm', 'frontend'] }) }))
    Math.random = rng(91)
    const second = await new RecommendEngine('two', 'random').next(context({
      lib: library({ interests: ['rust'], events: [{ kind: 'star', topics: ['rust'], lang: 'Rust', at: now }] }),
      following: [following('social', repo('social-only'))],
    }))
    assert.equal(first.length, 18)
    assert.deepEqual(first.map(item => item.repo.name), second.map(item => item.repo.name))
    assert.ok(first.some(item => item.repo.stars === 21))
    assert.ok(first.every(item => item.reason.kind === 'explore'))
  })
})

test('random and taste queries use actual bounded time/star strata and supported search DTOs', async () => {
  await withEnv(async ({ calls }) => {
    await new RecommendEngine('guest', 'random').next(context())
    await new RecommendEngine('guest', 'taste').next(context({ lib: library({ interests: ['llm', 'frontend', 'backend', 'ml', 'cv', 'nlp', 'bioinfo', 'chem', 'protein', 'datasci', 'devops', 'mobile'] }) }))
    assert.equal(calls.length, 6)
    for (const specs of calls) {
      assert.ok(specs.length > 0 && specs.length <= 8)
      for (const spec of specs) {
        assert.ok(spec.query.length <= 300)
        assert.match(spec.query, /created:\d{4}-01-01\.\.\d{4}-\d{2}-\d{2}/)
        assert.match(spec.query, /stars:(?:\d+\.\.\d+|>=10000)/)
        assert.equal(spec.first, 12)
        assert.ok(compileGitubeSearch(spec.query).query.startsWith('is:public '))
      }
    }
    assert.ok(new Set(calls.flat().map(spec => spec.query.match(/created:(\d{4})/)[1])).size > 1)
    assert.ok(new Set(calls.flat().map(spec => spec.query.match(/sort:([^ ]+)/)[1])).size > 1)
  })
})

test('all modes retain starred, owner, archived, blocked, disliked, recently seen and session-seen filters', async () => {
  await withEnv(async ({ search }) => {
    const bad = [
      repo('starred', ['python'], { viewerHasStarred: true }), repo('seed-star', ['python']),
      repo('owned', ['python'], { owner: 'Viewer', nameWithOwner: 'Viewer/owned' }),
      repo('archived', ['python'], { isArchived: true }), repo('blocked-topic', ['blocked']),
      repo('blocked-lang', ['python'], { language: 'Blocked' }), repo('disliked', ['python']), repo('seen', ['python']),
    ]
    const good = [repo('good-f', ['python']), repo('good-u', ['rust'])]
    search(specs => specs.map(() => page([...bad, ...good])))
    const ctx = context({ seeds: { starred: [bad[1]], own: [] }, lib: library({ interests: ['python'], blockedTopics: ['blocked'], blockedLangs: ['Blocked'], dislikedRepos: ['OWNER/DISLIKED'], seen: { 'owner/seen': now } }) })
    for (const mode of ['normal', 'taste', 'random']) {
      const engine = new RecommendEngine('github:viewer', mode)
      const output = await engine.next(ctx)
      assert.deepEqual(new Set(output.map(item => item.repo.name)), new Set(['good-f', 'good-u']), mode)
      assert.deepEqual(await engine.next(ctx), [], `${mode} session does not repeat candidates`)
    }
  })
})

test('guest scope can discover real guest-owned repositories while github:guest filters its own projects', async () => {
  await withEnv(async ({ search }) => {
    const candidate = repo('guest-project', ['python'], { owner: 'guest', nameWithOwner: 'guest/guest-project' })
    search(specs => specs.map(() => page([candidate])))
    const ctx = context({ lib: library({ interests: ['python'] }) })
    for (const mode of ['normal', 'taste', 'random']) {
      assert.equal((await new RecommendEngine('guest', mode).next(ctx)).length, 1)
      assert.deepEqual(await new RecommendEngine('github:guest', mode).next(ctx), [])
    }
  })
})

test('mode engines and sessions are isolated, normal preserves its legacy cursor key, and stored cursors are bounded', async () => {
  const legacy = JSON.stringify({ 'trend:week': { after: 'page:2', done: false, at: now }, invalid: null, broken: { at: now, after: 4, done: true } })
  await withEnv(async ({ search, calls, storage }) => {
    const candidates = Array.from({ length: 20 }, (_, i) => repo(`same${i}`))
    search(specs => specs.map(() => page(candidates, { endCursor: 'page:3', hasNextPage: true })))
    const normal = getEngine('github:viewer')
    assert.equal(normal, getEngine('GITHUB:VIEWER', 'normal'))
    assert.notEqual(normal, getEngine('github:viewer', 'random'))
    assert.equal((await normal.next(context())).length, 18)
    assert.ok(calls[0].some(spec => spec.after === 'page:2'))
    assert.equal((await getEngine('github:viewer', 'random').next(context())).length, 18, 'normal sessionSeen is not reused by random')
    assert.ok(calls[1].every(spec => spec.after === null))
    assert.ok(storage.has('gitube:cursors:github:viewer'))
    assert.ok(storage.has('gitube:cursors:github:viewer:random'))
    assert.ok(!storage.has('gitube:cursors:github:viewer:normal'))
    const oversize = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`old:${i}`, { after: null, done: false, at: now - i }]))
    storage.set('gitube:cursors:guest:random', JSON.stringify(oversize))
    await new RecommendEngine('guest', 'random').next(context())
    assert.equal(Object.keys(JSON.parse(storage.get('gitube:cursors:guest:random'))).length, 256)
  }, [['gitube:cursors:github:viewer', legacy]])
})

test('invalidate and reset discard in-flight responses without cursor or seen writes, and preserve completed progress', async () => {
  await withEnv(async ({ search, storage }) => {
    const candidates = Array.from({ length: 20 }, (_, i) => repo(`late${i}`))
    let resolve
    search(specs => new Promise(done => { resolve = () => done(specs.map(() => page(candidates, { endCursor: 'page:2', hasNextPage: true }))) }))
    const engine = new RecommendEngine('guest', 'random')
    const old = engine.next(context())
    engine.invalidate()
    resolve()
    assert.deepEqual(await old, [])
    assert.equal(storage.has('gitube:cursors:guest:random'), false)
    search(specs => specs.map(() => page(candidates, { endCursor: 'page:2', hasNextPage: true })))
    assert.equal((await engine.next(context())).length, 18, 'invalidated candidates were not committed to sessionSeen')
    const completed = storage.get('gitube:cursors:guest:random')
    engine.invalidate()
    assert.equal(storage.get('gitube:cursors:guest:random'), completed)
    search(specs => new Promise(done => { resolve = () => done(specs.map(() => page([repo('after-reset')], { endCursor: 'page:9', hasNextPage: true }))) }))
    const pending = engine.next(context())
    engine.reset()
    resolve()
    assert.deepEqual(await pending, [])
    assert.equal(storage.get('gitube:cursors:guest:random'), '{}')
  })
})

test('search failures and aborts propagate without advancing partial cursors, while stale failures are ignored', async () => {
  await withEnv(async ({ search, storage }) => {
    const engine = new RecommendEngine('guest', 'random')
    const failure = new Error('service unavailable')
    search((specs, call) => { if (call === 1) return specs.map(() => page([repo('partial')], { endCursor: 'page:2', hasNextPage: true })); throw failure })
    await assert.rejects(engine.next(context()), error => error === failure)
    assert.equal(storage.has('gitube:cursors:guest:random'), false)
    const abort = new DOMException('cancelled', 'AbortError')
    search(() => { throw abort })
    await assert.rejects(engine.next(context()), error => error === abort)
    let reject
    search(() => new Promise((resolve, fail) => { reject = fail }))
    const pending = engine.next(context())
    engine.invalidate()
    reject(failure)
    assert.deepEqual(await pending, [])
  })
})
