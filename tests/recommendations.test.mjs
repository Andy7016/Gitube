import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecommendationService } from '../server/recommendations.mjs'
import { ApiError } from '../server/github.mjs'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const TOKEN = 'recommendation-test-token-never-return-to-client'
const json = (value, headers = {}, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const repo = (id, options = {}) => ({ id, full_name: `octocat/repo-${id}`, owner: { login: 'octocat' }, private: false, fork: false, topics: [], language: null, ...options })
const star = (repository, starred_at = '2026-10-09T12:00:00Z') => ({ starred_at, repo: repository })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function parsed(path) {
  const url = new URL(path, 'https://api.github.com')
  assert.equal(url.origin, 'https://api.github.com')
  assert.ok(url.pathname === '/user/starred' || /^\/users\/[a-zA-Z0-9-]+\/repos$/.test(url.pathname), `unexpected endpoint: ${path}`)
  return { source: url.pathname === '/user/starred' ? 'starred' : 'owned', page: Number(url.searchParams.get('page')), url }
}

test('profile paginates both real metadata sources, retains old stars, and uses owned and language evidence', async () => {
  const stars = [
    star(repo(1, { topics: ['fresh-topic'], language: 'TypeScript' })),
    star(repo(2, { topics: ['old-topic'], language: 'Rust' }), '2016-01-01T00:00:00Z'),
    star(repo(3, { language: 'Haskell' })),
    star(repo(1, { topics: ['fresh-topic'], language: 'TypeScript' })),
    star(repo(9, { private: true, topics: ['private-topic'] })),
  ]
  const secondStars = [
    star(repo(4, { topics: ['second-page'], language: 'Zig' })),
    star(repo(5, { topics: ['forked'], fork: true, language: 'Go' })),
    star(repo(6, { topics: ['left', 'right', 'left', 'bad_topic', 'Uppercase'] })),
  ]
  const owned = [repo(10, { topics: ['owned-topic'], language: 'Python' }), repo(11, { owner: { login: 'other' }, topics: ['foreign-topic'] }), repo(12, { private: true, topics: ['private-topic'] }), repo(13, { topics: ['owned-fork'], fork: true, language: 'Go' })]
  const secondOwned = [repo(14, { topics: ['shared'], language: 'TypeScript' })]
  const calls = []
  const service = createRecommendationService({
    now: () => NOW,
    request: async (path, token, options) => {
      const call = parsed(path)
      calls.push(call)
      assert.equal(token, TOKEN)
      assert.equal(call.url.searchParams.get('per_page'), '100')
      assert.equal(call.url.searchParams.get('direction'), 'desc')
      if (call.source === 'starred') {
        assert.equal(options.headers.Accept, 'application/vnd.github.star+json')
        assert.equal(call.url.searchParams.get('sort'), 'created')
        return json(call.page === 1 ? stars : secondStars, call.page === 1 ? { Link: '<https://untrusted.example/steal-token>; rel="next"' } : {})
      }
      assert.equal(call.url.pathname, '/users/Octocat/repos')
      assert.equal(call.url.searchParams.get('type'), 'owner')
      assert.equal(call.url.searchParams.get('sort'), 'pushed')
      return json(call.page === 1 ? owned : secondOwned, call.page === 1 ? { Link: '<https://untrusted.example/wrong-page>; rel="next"' } : {})
    },
  })
  const profile = await service.getProfile('Octocat', TOKEN)
  assert.equal(profile.login, 'Octocat')
  assert.equal(profile.generatedAt, new Date(NOW).toISOString())
  assert.deepEqual(profile.counts, { starred: 6, owned: 3 })
  assert.deepEqual(profile.limits, { starred: 1000, owned: 300 })
  assert.deepEqual(profile.truncated, { starred: false, owned: false })
  assert.deepEqual(profile.starredIds, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(profile.ownedIds, [10, 13, 14])
  assert.deepEqual(profile.warnings, [])
  assert.deepEqual(calls.filter(({ source }) => source === 'starred').map(({ page }) => page), [1, 2])
  assert.deepEqual(calls.filter(({ source }) => source === 'owned').map(({ page }) => page), [1, 2])
  const topics = new Map(profile.topics.map((topic) => [topic.name, topic]))
  assert.ok(topics.get('old-topic').weight >= 1, 'old stars retain a baseline contribution')
  assert.ok(topics.get('fresh-topic').weight > topics.get('old-topic').weight)
  assert.ok(topics.get('owned-topic').weight > topics.get('fresh-topic').weight)
  assert.ok(topics.get('forked').weight < topics.get('second-page').weight)
  assert.equal(topics.get('left').weight, topics.get('right').weight)
  assert.ok(Math.abs(topics.get('left').weight + topics.get('right').weight - topics.get('fresh-topic').weight) < 0.00001)
  for (const excluded of ['bad_topic', 'Uppercase', 'private-topic', 'foreign-topic']) assert.equal(topics.has(excluded), false)
  assert.deepEqual(profile.languages.find(({ name }) => name === 'Haskell').evidence, { source: 'starred', repo: 'octocat/repo-3' })
  const records = { starred: [...stars, ...secondStars].map(({ repo }) => repo), owned: [...owned, ...secondOwned] }
  for (const [kind, values] of [['topics', profile.topics], ['language', profile.languages]]) {
    for (const value of values) {
      const contributing = records[value.evidence.source].find((repository) => repository.full_name === value.evidence.repo)
      assert.ok(contributing, 'evidence refers to a collected repository')
      assert.ok(kind === 'topics' ? contributing.topics.includes(value.name) : contributing.language === value.name, 'evidence actually contributes this signal')
    }
  }
  assert.equal(JSON.stringify(profile).includes(TOKEN), false)
})

test('source page limits bound collection and report truncation instead of silently claiming completeness', async () => {
  const calls = []
  const service = createRecommendationService({
    now: () => NOW,
    request: async (path) => {
      const call = parsed(path)
      calls.push(call)
      const rows = Array.from({ length: 100 }, (_, index) => repo((call.source === 'starred' ? 0 : 10000) + (call.page - 1) * 100 + index + 1, { topics: ['bulk'] }))
      return json(call.source === 'starred' ? rows.map((repository) => star(repository)) : rows, { Link: '<https://untrusted.example/next>; rel="next"' })
    },
  })
  const profile = await service.getProfile('octocat', TOKEN)
  assert.deepEqual(profile.counts, { starred: 1000, owned: 300 })
  assert.deepEqual(profile.truncated, { starred: true, owned: true })
  assert.equal(calls.length, 13)
  assert.equal(Math.max(...calls.filter(({ source }) => source === 'starred').map(({ page }) => page)), 10)
  assert.equal(Math.max(...calls.filter(({ source }) => source === 'owned').map(({ page }) => page)), 3)
})

test('ranking caps topics and languages and sorts their weights descending', async () => {
  const service = createRecommendationService({
    now: () => NOW,
    request: async (path) => json(parsed(path).source === 'owned' ? [] : Array.from({ length: 30 }, (_, index) => star(repo(index + 1, { topics: [`topic-${index}`], language: `Language ${index}` }), new Date(NOW - index * 86400000).toISOString()))),
  })
  const profile = await service.getProfile('octocat', TOKEN)
  assert.equal(profile.topics.length, 20)
  assert.equal(profile.languages.length, 15)
  for (const values of [profile.topics, profile.languages]) {
    assert.ok(values.every((value) => value.weight > 0))
    assert.ok(values.every((value, index) => index === 0 || values[index - 1].weight >= value.weight))
  }
})

test('one failed source returns explicit Chinese warnings and retries after one minute; full profiles cache for fifteen', async () => {
  let clock = NOW
  let starFails = true
  let count = 0
  const service = createRecommendationService({
    now: () => clock,
    request: async (path) => {
      count++
      if (parsed(path).source === 'owned') return json([repo(10, { topics: ['owned'] })])
      if (starFails) throw new ApiError(429, 'rate limited', 'RATE_LIMITED')
      return json([star(repo(1, { topics: ['starred'] }))])
    },
  })
  const partial = await service.getProfile('octocat', TOKEN)
  assert.deepEqual(partial.counts, { starred: 0, owned: 1 })
  assert.equal(partial.warnings.length, 1)
  assert.match(partial.warnings[0], /[\u4e00-\u9fff]/)
  assert.equal(partial.topics[0].name, 'owned')
  clock += 59999
  await service.getProfile('octocat', TOKEN)
  assert.equal(count, 2)
  clock += 1
  starFails = false
  const full = await service.getProfile('octocat', TOKEN)
  assert.equal(count, 4)
  assert.deepEqual(full.warnings, [])
  assert.deepEqual(full.counts, { starred: 1, owned: 1 })
  clock += 15 * 60000 - 1
  await service.getProfile('octocat', TOKEN)
  assert.equal(count, 4)
  clock += 1
  await service.getProfile('octocat', TOKEN)
  assert.equal(count, 6)
})

test('either source returning 401 propagates session expiration instead of a partial profile', async (t) => {
  for (const failedSource of ['starred', 'owned']) {
    await t.test(failedSource, async () => {
      let calls = 0
      const service = createRecommendationService({ request: async (path) => {
        calls++
        return parsed(path).source === failedSource ? json({ message: 'bad credentials' }, {}, 401) : json([])
      } })
      await assert.rejects(service.getProfile('octocat', TOKEN), (error) => error.status === 401 && error.code === 'SESSION_EXPIRED')
      await assert.rejects(service.getProfile('octocat', TOKEN), (error) => error.status === 401)
      assert.equal(calls, 4, 'failed profiles are not cached')
    })
  }
})

test('two failed sources propagate the original error, including request-wrapper 401 errors', async () => {
  const original = new ApiError(429, 'both sources unavailable', 'RATE_LIMITED')
  const service = createRecommendationService({ request: async (path) => {
    if (parsed(path).source === 'starred') throw original
    throw new Error('network unavailable')
  } })
  await assert.rejects(service.getProfile('octocat', TOKEN), (error) => error === original)
  const expired = new ApiError(401, 'expired', 'SESSION_EXPIRED')
  const unauthorized = createRecommendationService({ request: async (path) => {
    if (parsed(path).source === 'owned') throw expired
    return json([star(repo(1))])
  } })
  await assert.rejects(unauthorized.getProfile('octocat', TOKEN), (error) => error === expired)
})

test('cache isolates login and token, merges identical in-flight refreshes, and refresh bypasses completed entries', async () => {
  const gate = deferred()
  let calls = 0
  const service = createRecommendationService({ now: () => NOW, request: async (path, token) => {
    calls++
    if (parsed(path).source === 'owned') return json([])
    await gate.promise
    return json([star(repo(token === TOKEN ? 1 : 2, { topics: ['cached'] }))])
  } })
  const first = service.getProfile('octocat', TOKEN)
  assert.equal(service.getProfile('octocat', TOKEN), first)
  assert.equal(service.getProfile('octocat', TOKEN, { refresh: true }), first)
  assert.equal(calls, 2)
  gate.resolve()
  const profile = await first
  assert.equal(await service.getProfile('octocat', TOKEN), profile)
  assert.equal(calls, 2)
  const refresh = service.getProfile('octocat', TOKEN, { refresh: true })
  assert.equal(service.getProfile('octocat', TOKEN), refresh)
  await refresh
  assert.equal(calls, 4)
  const differentToken = await service.getProfile('octocat', 'another-secret-token')
  assert.deepEqual(differentToken.starredIds, [2])
  assert.equal(calls, 6)
  await service.getProfile('another-user', TOKEN)
  assert.equal(calls, 8)
  service.invalidate('octocat', TOKEN)
  await service.getProfile('octocat', TOKEN)
  assert.equal(calls, 10)
  assert.equal(JSON.stringify(differentToken).includes('another-secret-token'), false)
})

test('invalidation prevents old in-flight work from restoring cache or deleting a newer in-flight request', async () => {
  const gates = [deferred(), deferred(), deferred()]
  let starCalls = 0
  let calls = 0
  const service = createRecommendationService({ now: () => NOW, request: async (path) => {
    calls++
    if (parsed(path).source === 'owned') return json([])
    const index = starCalls++
    return index < gates.length ? gates[index].promise : json([star(repo(4))])
  } })
  const old = service.getProfile('octocat', TOKEN)
  service.invalidate('octocat', TOKEN)
  const fresh = service.getProfile('octocat', TOKEN)
  assert.equal(calls, 4)
  gates[0].resolve(json([star(repo(1))]))
  await old
  assert.equal(service.getProfile('octocat', TOKEN), fresh, 'old cleanup must retain the newer single-flight record')
  gates[1].resolve(json([star(repo(2))]))
  await fresh
  assert.deepEqual((await service.getProfile('octocat', TOKEN)).starredIds, [2])
  assert.equal(calls, 4)
  const orphaned = service.getProfile('octocat', TOKEN, { refresh: true })
  service.invalidate('octocat', TOKEN)
  gates[2].resolve(json([star(repo(3))]))
  await orphaned
  assert.deepEqual((await service.getProfile('octocat', TOKEN)).starredIds, [4], 'invalidated work without a replacement cannot repopulate cache')
  assert.equal(calls, 8)
})

test('cache holds at most sixty-four completed account/token profiles', async () => {
  let calls = 0
  const service = createRecommendationService({ now: () => NOW, request: async () => { calls++; return json([]) } })
  for (let index = 0; index < 65; index++) await service.getProfile('octocat', `token-${index}`)
  assert.equal(calls, 130)
  await service.getProfile('octocat', 'token-64')
  assert.equal(calls, 130)
  await service.getProfile('octocat', 'token-0')
  assert.equal(calls, 132, 'oldest completed profile was evicted')
})
