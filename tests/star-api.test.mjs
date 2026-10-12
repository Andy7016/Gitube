import test from 'node:test'
import assert from 'node:assert/strict'
import { APP_ORIGIN, TOKEN, empty, fixture, json, login, repo } from './helpers.mjs'

const target = (starred = false, extra = {}) => ({ id: 'R_star_fixture', nameWithOwner: 'sample/demo', isPrivate: false, viewerHasStarred: starred, ...extra })
const lookup = (value = target()) => json({ data: { repository: value } })
const mutation = (starred, value = target(starred)) => json({ data: { [starred ? 'addStar' : 'removeStar']: { starrable: value } } })
const write = (client, session, method = 'PUT', headers = {}) => client.request('/api/starred/sample/demo', { method, headers: { 'X-CSRF-Token': session.csrfToken, Origin: APP_ORIGIN, ...headers } })
const sessionFor = async (client) => (await client.request('/api/session')).json()

test('REST Star success keeps PUT and DELETE contracts and sends an explicit empty PUT body', async (t) => {
  const client = await fixture(t, { upstream: ({ url, init }) => {
    assert.equal(url.pathname, '/user/starred/sample/demo')
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
    if (init.method === 'PUT') assert.equal(init.headers['Content-Length'], '0')
    assert.equal(init.body, undefined)
    return empty()
  } })
  const session = await login(client)
  for (const method of ['PUT', 'DELETE']) assert.equal((await write(client, session, method)).status, 204)
  assert.equal(client.calls.filter(({ url }) => url.pathname === '/graphql').length, 0)
})

test('non-rate REST 403 uses one same-account public GraphQL lookup and confirmed add/remove mutation', async (t) => {
  for (const starred of [true, false]) await t.test(starred ? 'PUT' : 'DELETE', async (t) => {
    const client = await fixture(t, { env: { GITHUB_APP_TYPE: 'github-app' }, upstream: ({ url, init }) => {
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
      if (url.pathname === '/user/starred/sample/demo') return json({ message: `private upstream message ${TOKEN}` }, 403)
      assert.equal(url.pathname, '/graphql')
      assert.equal(init.method, 'POST')
      assert.equal(init.headers['Content-Type'], 'application/json')
      const body = JSON.parse(init.body)
      if (body.query.startsWith('query RepositoryStarTarget')) {
        assert.deepEqual(body.variables, { owner: 'sample', name: 'demo' })
        return lookup(target(!starred, { nameWithOwner: 'Sample/Demo' }))
      }
      assert.match(body.query, new RegExp(`mutation RepositoryStarWrite\\(\\$input: ${starred ? 'Add' : 'Remove'}StarInput!\\)`))
      assert.match(body.query, new RegExp(`${starred ? 'add' : 'remove'}Star\\(input: \\$input\\)`))
      assert.deepEqual(body.variables, { input: { starrableId: 'R_star_fixture' } })
      return mutation(starred)
    } })
    const response = await write(client, await login(client), starred ? 'PUT' : 'DELETE')
    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
    assert.equal(client.calls.filter(({ url }) => url.pathname === '/user/starred/sample/demo').length, 1)
    assert.equal(client.calls.filter(({ url }) => url.pathname === '/graphql').length, 2)
    assert.equal((await sessionFor(client)).user.login, 'octocat')
  })
})

test('GraphQL fallback is idempotent when the target already has the requested state', async (t) => {
  for (const starred of [true, false]) await t.test(starred ? 'already starred' : 'already removed', async (t) => {
    const client = await fixture(t, { upstream: ({ url, init }) => {
      if (url.pathname !== '/graphql') return empty(403)
      assert.match(JSON.parse(init.body).query, /^query RepositoryStarTarget/)
      return lookup(target(starred))
    } })
    assert.equal((await write(client, await login(client), starred ? 'PUT' : 'DELETE')).status, 204)
    assert.equal(client.calls.filter(({ url }) => url.pathname === '/graphql').length, 1)
  })
})

test('REST auth, standard rate limits, other failures and unexpected success statuses never fall back', async (t) => {
  const cases = [
    [401, {}, 401, 'SESSION_EXPIRED'], [403, { 'x-ratelimit-remaining': '0' }, 429, 'RATE_LIMITED'],
    [403, { 'Retry-After': '60' }, 429, 'RATE_LIMITED'], [429, {}, 429, 'RATE_LIMITED'],
    [404, {}, 404, 'UPSTREAM_ERROR'], [422, {}, 422, 'UPSTREAM_ERROR'], [500, {}, 502, 'UPSTREAM_ERROR'],
    [200, {}, 502, 'INVALID_GITHUB_DATA'], [202, {}, 502, 'INVALID_GITHUB_DATA'],
  ]
  for (const [upstream, headers, status, code] of cases) await t.test(`${upstream} ${JSON.stringify(headers)}`, async (t) => {
    const client = await fixture(t, { upstream: ({ url }) => {
      assert.notEqual(url.pathname, '/graphql')
      return json({ message: TOKEN }, upstream, headers)
    } })
    const response = await write(client, await login(client))
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.code, code)
    assert.ok(!JSON.stringify(body).includes(TOKEN))
    assert.equal(client.calls.filter(({ url }) => url.pathname === '/graphql').length, 0)
    assert.equal(Boolean((await sessionFor(client)).user), status !== 401)
  })
})

test('GraphQL query and mutation errors never use partial data or disclose upstream messages', async (t) => {
  for (const stage of ['query', 'mutation']) {
    for (const [type, status, code] of [
      ['FORBIDDEN', 403, 'STAR_PERMISSION_REQUIRED'], ['UNAUTHENTICATED', 401, 'SESSION_EXPIRED'],
      ['RATE_LIMITED', 429, 'RATE_LIMITED'], ['NOT_FOUND', 404, 'STAR_TARGET_UNAVAILABLE'],
      ['UNKNOWN', 502, 'INVALID_GITHUB_DATA'],
    ]) await t.test(`${stage} ${type}`, async (t) => {
      let graphCalls = 0
      const client = await fixture(t, { upstream: ({ url }) => {
        if (url.pathname !== '/graphql') return empty(403)
        graphCalls++
        if (stage === 'mutation' && graphCalls === 1) return lookup()
        return json({ errors: [{ type, message: `upstream secret ${TOKEN}`, extensions: { detail: TOKEN } }], data: { repository: target(true), addStar: { starrable: target(true) } } })
      } })
      const response = await write(client, await login(client))
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.code, code)
      assert.ok(!JSON.stringify(body).includes(TOKEN))
      assert.equal('data' in body, false)
      assert.equal(graphCalls, stage === 'query' ? 1 : 2)
      assert.equal(Boolean((await sessionFor(client)).user), status !== 401)
    })
  }
})

test('GraphQL HTTP denials, rate limits and transport failures remain bounded and safe', async (t) => {
  for (const [mode, status, code] of [
    ['forbidden', 403, 'STAR_PERMISSION_REQUIRED'], ['unauthorized', 401, 'SESSION_EXPIRED'],
    ['rate', 429, 'RATE_LIMITED'], ['network', 502, 'GITHUB_UNAVAILABLE'], ['json', 502, 'INVALID_GITHUB_DATA'],
  ]) await t.test(mode, async (t) => {
    const client = await fixture(t, { upstream: ({ url }) => {
      if (url.pathname !== '/graphql') return empty(403)
      if (mode === 'network') throw new Error(`network secret ${TOKEN}`)
      if (mode === 'json') return new Response(`broken json ${TOKEN}`, { status: 200 })
      return json({ message: TOKEN }, mode === 'forbidden' ? 403 : mode === 'unauthorized' ? 401 : 403, mode === 'rate' ? { 'Retry-After': '10' } : {})
    } })
    const response = await write(client, await login(client))
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.code, code)
    assert.ok(!JSON.stringify(body).includes(TOKEN))
    assert.equal(client.calls.filter(({ url }) => url.pathname === '/graphql').length, 1)
  })
})

test('only a verified public matching repository with a valid ID and boolean state can be mutated', async (t) => {
  const cases = [
    ['missing', null, 404, 'STAR_TARGET_UNAVAILABLE'], ['private', target(false, { isPrivate: true }), 404, 'STAR_TARGET_UNAVAILABLE'],
    ['wrong name', target(false, { nameWithOwner: 'someone/else' }), 502, 'INVALID_GITHUB_DATA'],
    ['missing ID', target(false, { id: undefined }), 502, 'INVALID_GITHUB_DATA'],
    ['empty ID', target(false, { id: '' }), 502, 'INVALID_GITHUB_DATA'],
    ['invalid ID', target(false, { id: 'R_star\nsecret' }), 502, 'INVALID_GITHUB_DATA'],
    ['unknown visibility', target(false, { isPrivate: undefined }), 502, 'INVALID_GITHUB_DATA'],
    ['non-boolean', target(false, { viewerHasStarred: 'false' }), 502, 'INVALID_GITHUB_DATA'],
  ]
  for (const [label, value, status, code] of cases) await t.test(label, async (t) => {
    const client = await fixture(t, { upstream: ({ url, init }) => {
      if (url.pathname !== '/graphql') return empty(403)
      assert.match(JSON.parse(init.body).query, /^query /)
      return lookup(value)
    } })
    const response = await write(client, await login(client))
    assert.equal(response.status, status)
    assert.equal((await response.json()).code, code)
    assert.equal(client.calls.filter(({ url }) => url.pathname === '/graphql').length, 1)
  })
})

test('mutation response must confirm the same public repository ID and requested state', async (t) => {
  for (const [label, value, code] of [
    ['unchanged state', target(false), 'STAR_STATE_UNCONFIRMED'],
    ['wrong ID', target(true, { id: 'R_other_fixture' }), 'INVALID_GITHUB_DATA'],
    ['wrong name', target(true, { nameWithOwner: 'sample/other' }), 'INVALID_GITHUB_DATA'],
    ['missing state', target(true, { viewerHasStarred: undefined }), 'INVALID_GITHUB_DATA'],
    ['missing payload', null, 'INVALID_GITHUB_DATA'],
  ]) await t.test(label, async (t) => {
    let reads = 0
    const client = await fixture(t, { upstream: ({ url }) => url.pathname !== '/graphql' ? empty(403) : ++reads === 1 ? lookup() : mutation(true, value) })
    const response = await write(client, await login(client))
    assert.equal(response.status, 502)
    assert.equal((await response.json()).code, code)
    assert.equal(reads, 2)
  })
})

test('only a confirmed Star fallback updates the session Star cache and invalidates the profile', async (t) => {
  for (const success of [true, false]) await t.test(success ? 'confirmed' : 'unconfirmed', async (t) => {
    let graphReads = 0, profileReads = 0, starReads = 0, actualStarred = false
    const client = await fixture(t, { upstream: ({ url, init }) => {
      if (url.pathname === '/search/repositories') return json({ total_count: 1, items: [repo(1, 'demo')] })
      if (url.pathname === '/user/starred') { profileReads++; return json(actualStarred ? [{ repo: repo(1, 'demo'), starred_at: '2026-10-11T00:00:00Z' }] : []) }
      if (url.pathname === '/users/octocat/repos') return json([])
      if (url.pathname === '/user/starred/sample/demo') {
        if (init.method === 'PUT') return empty(403)
        starReads++
        return empty(actualStarred ? 204 : 404)
      }
      assert.equal(url.pathname, '/graphql')
      if (++graphReads === 1) return lookup()
      actualStarred = success
      return mutation(true, target(success))
    } })
    const session = await login(client)
    const feed = async () => (await (await client.request('/api/feed?topics=web')).json()).items[0].viewer_starred
    const profile = async () => (await (await client.request('/api/recommendation-profile')).json()).counts.starred
    assert.equal(await feed(), false)
    assert.equal(await profile(), 0)
    assert.equal((await write(client, session)).status, success ? 204 : 502)
    assert.equal(await feed(), success)
    assert.equal(await profile(), success ? 1 : 0)
    assert.equal(starReads, 1, 'the session retains its existing state on failure and changes it only on confirmation')
    assert.equal(profileReads, success ? 2 : 1, 'failed writes do not invalidate the cached profile')
  })
})

test('CSRF and invalid repository inputs are rejected before REST or GraphQL writes', async (t) => {
  const client = await fixture(t, { upstream: () => { throw new Error('Rejected input reached GitHub') } })
  const session = await login(client)
  const before = client.calls.length
  for (const headers of [{ 'X-CSRF-Token': 'wrong' }, { Origin: 'https://other.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await write(client, session, 'PUT', headers)
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'CSRF_INVALID')
  }
  const invalid = await client.request('/api/starred/sample/bad%20repo', { method: 'PUT', headers: { 'X-CSRF-Token': session.csrfToken } })
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).code, 'INVALID_REPO')
  assert.equal(client.calls.length, before)
})
