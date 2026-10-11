import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { compileGitubeSearch, createGitubeApi } from '../server/gitube-api.mjs'
import { TOKEN, empty, fixture, json, login, repo } from './helpers.mjs'

const publicRepo = (id, name, extra = {}) => repo(id, name, {
  private: false, node_id: `R_fixture_${id}`, default_branch: 'main',
  owner: { login: 'sample', type: 'User', node_id: 'U_sample', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  ...extra,
})
const ownedRepo = (id, name, extra = {}) => publicRepo(id, name, {
  full_name: `octocat/${name}`,
  owner: { login: 'octocat', type: 'User', node_id: 'U_octocat', avatar_url: 'https://avatars.githubusercontent.com/u/2' },
  ...extra,
})
const search = (query = 'topic:web', first = 24, after = null) => ({ operation: 'searchMany', specs: [{ query, first, after }] })
const sessionFor = async (client) => (await client.request('/api/session')).json()
const post = (client, session, body, headers = {}) => client.request('/api/gitube', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, ...headers }, body: JSON.stringify(body),
})
const makeApi = (request, options = {}) => createGitubeApi({ request, recommendations: { getProfile: async () => { throw new Error('Unexpected profile request') } }, ...options })
const authenticated = { user: { login: 'octocat' }, token: TOKEN }
const expectError = (status, code) => (error) => error.status === status && error.code === code
const graphql = (init, starred = false) => {
  const body = JSON.parse(init.body)
  assert.match(body.query, /^query GitubeStarState\(/)
  assert.deepEqual(Object.keys(body.variables), ['ids'])
  return json({ data: { nodes: body.variables.ids.map((id) => ({ id, viewerHasStarred: starred })) } })
}

test('Gitube POST enforces same-origin CSRF and only accepts named bounded operations', async (t) => {
  const client = await fixture(t)
  const session = await sessionFor(client)
  for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'forged' }, { Origin: 'https://other.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await post(client, session, search(), headers)).status, 403, JSON.stringify(headers))
  }
  for (const body of [
    { operation: '__proto__' }, { operation: 'graphql', query: '{viewer{login}}' }, { operation: 'searchMany', specs: [], token: 'client-token' },
    { operation: 'repository', owner: 'sample', name: 'one', path: '/user' },
    { operation: 'searchMany', specs: Array.from({ length: 9 }, () => ({ query: 'web', first: 1 })) },
    search('web', 101), search('web', 0), search('x'.repeat(301)), search('web', 24, 'https://attacker.example/next'),
    { operation: 'repository', owner: 'sample', name: '..' },
  ]) assert.equal((await post(client, session, body)).status, 400, JSON.stringify(body))
  for (const operation of ['seeds', 'myStars', 'followingStars']) {
    const response = await post(client, session, { operation })
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'LOGIN_REQUIRED')
  }
  assert.equal(client.calls.length, 0, 'rejected input never reaches GitHub')
})

test('Gitube compiler preserves upstream channel and recommendation qualifiers without relaxing public scope', () => {
  const queries = [
    'topic:machine-learning topic:deep-learning stars:>100 sort:stars',
    'topic:developer-tools topic:cli archived:false fork:false sort:updated',
    'user:octocat language:TypeScript pushed:>=2026-09-01 stars:10..500 sort:stars-desc',
    'org:openai language:"Jupyter Notebook" created:2026-01-01..2026-10-10 sort:updated-asc',
    'repo:sample/project language:C++ license:mit in:name,description -topic:deprecated -fork:only size:<=10000',
    '"web framework" visibility:public is:public',
  ]
  for (const query of queries) assert.ok(compileGitubeSearch(query).query.startsWith('is:public '), query)
  assert.deepEqual(compileGitubeSearch('language:"Jupyter Notebook" sort:stars-asc'), { query: 'is:public language:"Jupyter Notebook"', sort: 'stars', order: 'asc' })
  for (const query of ['is:private', '-is:public', 'visibility:internal', 'topic:web OR is:private', 'topic:web AND topic:rust', 'token:secret', 'language:"unterminated', 'web\nrepo:private/name', 'topic:bad_slug']) {
    assert.throws(() => compileGitubeSearch(query), expectError(400, 'INVALID_GITUBE_REQUEST'), query)
  }
})

test('anonymous search maps only verified public metadata, safe URLs, genuine IDs and upstream rate headers', async (t) => {
  const client = await fixture(t, { upstream: ({ url, init }) => {
    assert.equal(url.origin, 'https://api.github.com')
    assert.equal(url.pathname, '/search/repositories')
    assert.equal(url.searchParams.get('q'), 'is:public topic:rust topic:cli language:"C++" stars:>20')
    assert.equal(url.searchParams.get('sort'), 'stars')
    assert.equal(url.searchParams.get('order'), 'asc')
    assert.equal(init.headers.Authorization, undefined)
    return json({ total_count: 500, incomplete_results: true, items: [
      publicRepo(1, 'one', { homepage: 'javascript:alert(1)', html_url: 'https://attacker.example', token: 'do-not-return', topics: ['web', 'bad_slug', 'web'] }),
      publicRepo(2, 'two', { node_id: undefined, homepage: 'https://example.org/docs', owner: { login: 'sample', type: 'Organization', avatar_url: 'data:text/plain,unsafe' } }),
      publicRepo(3, 'private', { private: true }), publicRepo(4, 'unknown', { private: undefined }),
      publicRepo(5, 'wrong-owner', { owner: { login: 'different', type: 'User' } }),
    ] }, 200, { 'x-ratelimit-remaining': '59', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '1791580000' })
  } })
  const response = await post(client, await sessionFor(client), search('topic:rust topic:cli language:C++ stars:>20 sort:stars-asc'))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result.data[0].repos.map((repo) => repo.nameWithOwner), ['sample/one', 'sample/two'])
  assert.equal(result.data[0].repos[0].id, 'R_fixture_1')
  assert.equal(result.data[0].repos[1].id, 'repo:sample/two')
  assert.equal(result.data[0].repos[0].url, 'https://github.com/sample/one')
  assert.equal(result.data[0].repos[0].homepageUrl, null)
  assert.equal(result.data[0].repos[1].homepageUrl, 'https://example.org/docs')
  assert.equal(result.data[0].repos[1].ownerAvatar, '')
  assert.deepEqual(result.data[0].repos[0].topics, ['web'])
  assert.equal(result.data[0].repos[0].coverImage, null)
  assert.equal(result.data[0].repos[0].viewerHasStarred, false)
  assert.equal(result.data[0].total, 500)
  assert.equal(result.data[0].hasNextPage, true)
  assert.deepEqual([result.meta.rateRemaining, result.meta.rateLimit, result.meta.rateReset], [59, 60, 1791580000000])
  assert.match(result.meta.warnings.join(' '), /部分结果/)
  assert.ok(!JSON.stringify(result).includes('do-not-return'))
})

test('search cursors bind query and page size and stop before GitHub 1000-result overflow', async () => {
  const paths = []
  const api = makeApi(async (path) => { paths.push(new URL(path, 'https://api.github.com')); return json({ items: [publicRepo(1, 'one')], total_count: 5000 }) })
  let page = (await api.execute(search('web', 24))).data[0]
  const firstCursor = page.endCursor
  assert.ok(firstCursor && !firstCursor.includes('/'))
  await assert.rejects(api.execute(search('rust', 24, firstCursor)), expectError(400, 'INVALID_GITUBE_REQUEST'))
  await assert.rejects(api.execute(search('web', 25, firstCursor)), expectError(400, 'INVALID_GITUBE_REQUEST'))
  assert.equal(paths.length, 1)
  let result
  for (let n = 2; n <= 41; n++) {
    result = await api.execute(search('web', 24, page.endCursor))
    page = result.data[0]
    assert.equal(paths.at(-1).searchParams.get('page'), String(n))
    assert.equal(paths.at(-1).searchParams.get('per_page'), '24')
  }
  assert.equal(page.hasNextPage, false)
  assert.equal(page.endCursor, null)
  assert.equal(page.total, 5000)
  assert.match(result.meta.warnings.join(' '), /1000/)
  const forged = JSON.parse(Buffer.from(firstCursor, 'base64url'))
  forged.p = 42
  await assert.rejects(api.execute(search('web', 24, Buffer.from(JSON.stringify(forged)).toString('base64url'))), expectError(400, 'INVALID_GITUBE_REQUEST'))
  assert.equal(paths.length, 41)
})

test('authenticated search batches only verified node IDs, uses bounded REST fallback and isolates viewer state', async (t) => {
  const client = await fixture(t, { upstream: ({ url, init }) => {
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
    assert.ok(init.signal instanceof AbortSignal)
    if (url.pathname === '/search/repositories') return json({ total_count: 3, items: [publicRepo(1, 'one'), publicRepo(2, 'two', { node_id: undefined }), publicRepo(3, 'private', { private: true })] })
    if (url.pathname === '/graphql') {
      const body = JSON.parse(init.body)
      assert.deepEqual(body.variables.ids, ['R_fixture_1'])
      assert.equal(init.method, 'POST')
      return graphql(init, true)
    }
    if (url.pathname === '/user/starred/sample/two') return empty(404)
    throw new Error(`Unexpected request ${url}`)
  } })
  const session = await login(client)
  const response = await post(client, session, { operation: 'searchMany', specs: [{ query: 'web', first: 2 }, { query: 'rust', first: 2 }] })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result.data.map((page) => page.repos.map((repo) => repo.viewerHasStarred)), [[true, false], [true, false]])
  assert.equal(client.calls.filter(({ url }) => url.pathname === '/graphql').length, 1)
  assert.equal(client.calls.filter(({ url }) => url.pathname === '/user/starred/sample/two').length, 1)
  assert.ok(!JSON.stringify(result).includes(TOKEN))
  const tokens = []
  const api = makeApi(async (path, token, options) => {
    tokens.push(token)
    return path.startsWith('/search') ? json({ items: [publicRepo(1, 'one')], total_count: 1 }) : graphql(options, token === 'account-a')
  })
  assert.equal((await api.execute(search(), { ...authenticated, token: 'account-a' })).data[0].repos[0].viewerHasStarred, true)
  assert.equal((await api.execute(search(), { ...authenticated, token: 'account-b' })).data[0].repos[0].viewerHasStarred, false)
  assert.deepEqual(tokens, ['account-a', 'account-a', 'account-b', 'account-b'])
})

test('GraphQL Star errors stay explicit, hide upstream secrets, and 401 clears the session', async (t) => {
  for (const [type, status, code] of [['UNAUTHENTICATED', 401, 'SESSION_EXPIRED'], ['RATE_LIMITED', 429, 'RATE_LIMITED'], ['FORBIDDEN', 502, 'INVALID_GITHUB_DATA']]) {
    await t.test(type, async (t) => {
      const client = await fixture(t, { upstream: ({ url }) => url.pathname === '/search/repositories'
        ? json({ items: [publicRepo(1, 'one')], total_count: 1 })
        : json({ errors: [{ type, message: `raw secret ${TOKEN}` }], data: { nodes: [{ id: 'R_fixture_1', viewerHasStarred: false }] } }) })
      const response = await post(client, await login(client), search())
      assert.equal(response.status, status)
      const result = await response.json()
      assert.equal(result.code, code)
      assert.ok(!JSON.stringify(result).includes(TOKEN))
      assert.equal('data' in result, false)
      if (status === 401) assert.equal((await sessionFor(client)).user, null)
    })
  }
  const api = makeApi(async (path) => path.startsWith('/search') ? json({ items: [publicRepo(1, 'one')], total_count: 1 }) : json({ data: { nodes: [{ id: 'R_fixture_1', viewerHasStarred: 'false' }] } }))
  await assert.rejects(api.execute(search(), { ...authenticated, starred: async () => 'false' }), expectError(502, 'INVALID_GITHUB_DATA'))
  const many = makeApi(async () => json({ items: Array.from({ length: 17 }, (_, i) => publicRepo(i + 1, `local-${i}`, { node_id: undefined })), total_count: 17 }))
  let fallbackCount = 0
  await assert.rejects(many.execute(search(), { ...authenticated, starred: async () => { fallbackCount++; return false } }), expectError(502, 'INVALID_GITHUB_DATA'))
  assert.equal(fallbackCount, 0, 'missing IDs cannot fan out hundreds of REST calls')
})

test('maximum search input is capped at eight REST searches and eight fixed GraphQL batches of 100', async () => {
  let active = 0
  let maximum = 0
  let restCalls = 0
  const batches = []
  const api = makeApi(async (path, token, options) => {
    assert.equal(token, TOKEN)
    if (path === '/graphql') {
      const body = JSON.parse(options.body)
      batches.push(body.variables.ids)
      return graphql(options)
    }
    const url = new URL(path, 'https://api.github.com')
    assert.equal(url.pathname, '/search/repositories')
    assert.equal(url.searchParams.get('per_page'), '100')
    restCalls++; active++; maximum = Math.max(maximum, active)
    await nextTurn()
    active--
    const source = Number(url.searchParams.get('q').match(/topic:source-(\d+)/)[1])
    return json({ total_count: 100, items: Array.from({ length: 100 }, (_, at) => publicRepo(source * 100 + at + 1, `repo-${source}-${at}`)) })
  })
  const result = await api.execute({ operation: 'searchMany', specs: Array.from({ length: 8 }, (_, i) => ({ query: `topic:source-${i}`, first: 100 })) }, authenticated)
  assert.equal(result.data.length, 8)
  assert.equal(result.data.flatMap((page) => page.repos).length, 800)
  assert.equal(restCalls, 8)
  assert.equal(maximum, 2)
  assert.deepEqual(batches.map((batch) => batch.length), Array(8).fill(100))
  assert.equal(new Set(batches.flat()).size, 800)
})

test('repository detail keeps genuine subscriber counts, unknown nullable data, and public-only permission fallback', async (t) => {
  const calls = []
  const client = await fixture(t, { upstream: ({ url, init }) => {
    calls.push({ path: url.pathname, token: init.headers.Authorization })
    if (url.pathname === '/repos/sample/one') return json(publicRepo(1, 'one', { watchers_count: 999, subscribers_count: 7, open_issues_count: 11, homepage: 'data:text/html,unsafe' }))
    if (url.pathname.endsWith('/releases/latest')) return init.headers.Authorization ? json({ message: 'Resource not accessible by integration' }, 403) : json({ tag_name: 'v1.0', published_at: '2026-10-09T12:00:00Z' })
    if (url.pathname === '/graphql') return graphql(init)
    throw new Error(`Unexpected request ${url}`)
  } })
  const response = await post(client, await login(client), { operation: 'repository', owner: 'sample', name: 'one' })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual([result.data.watchers, result.data.openIssues, result.data.stars], [7, 11, 100])
  assert.deepEqual(result.data.latestRelease, { tagName: 'v1.0', publishedAt: '2026-10-09T12:00:00Z' })
  assert.equal(result.data.homepageUrl, null)
  assert.deepEqual(calls.filter(({ path }) => path.endsWith('/releases/latest')).map(({ token }) => token), [`Bearer ${TOKEN}`, undefined])
  const absent = makeApi(async (path) => path.endsWith('/releases/latest') ? empty(404) : json(publicRepo(2, 'two', { watchers_count: 9000 })))
  const unknown = await absent.execute({ operation: 'repository', owner: 'sample', name: 'two' })
  assert.deepEqual([unknown.data.watchers, unknown.data.openIssues, unknown.data.latestRelease], [null, null, null])
  assert.match(unknown.meta.warnings.join(' '), /最新版本/)
})

test('repository private/not-found and fatal release failures do not become public empty successes', async (t) => {
  for (const [kind, metadata, release, status, code] of [
    ['private', json(publicRepo(1, 'one', { private: true })), null, 403, 'PRIVATE_REPOSITORY'],
    ['missing', empty(404), null, 404, 'GITHUB_UNAVAILABLE'],
    ['expired', json(publicRepo(1, 'one')), empty(401), 401, 'SESSION_EXPIRED'],
    ['rate', json(publicRepo(1, 'one')), empty(403, { 'x-ratelimit-remaining': '0' }), 429, 'RATE_LIMITED'],
  ]) await t.test(kind, async () => {
    const paths = []
    const api = makeApi(async (path) => { paths.push(path); return path.endsWith('/releases/latest') ? release : metadata })
    await assert.rejects(api.execute({ operation: 'repository', owner: 'sample', name: 'one' }, authenticated), expectError(status, code))
    assert.equal(paths.length, release ? 2 : 1)
    assert.ok(!paths.includes('/graphql'))
  })
})

test('seeds reuses complete paginated profile and preserves recent stars and owned preview scope', async (t) => {
  const old = { starred_at: '2018-01-01T00:00:00Z', repo: publicRepo(2, 'old', { topics: ['old-research'], language: 'Rust' }) }
  const recent = { starred_at: '2026-10-09T00:00:00Z', repo: publicRepo(1, 'recent', { topics: ['web'] }) }
  const client = await fixture(t, { upstream: ({ url }) => {
    const page = url.searchParams.get('page')
    if (url.pathname === '/user/starred') return page === '1'
      ? json([recent], 200, { Link: '<https://attacker.example/do-not-follow>; rel="next"' })
      : json([old])
    if (url.pathname === '/users/octocat/repos') {
      if (url.searchParams.get('per_page') === '40') return json([ownedRepo(3, 'mine'), ownedRepo(4, 'fork', { fork: true }), publicRepo(5, 'foreign'), ownedRepo(6, 'secret', { private: true })])
      return page === '1' ? json([ownedRepo(3, 'mine')], 200, { Link: '<https://api.github.com/ignored>; rel="next"' }) : json([ownedRepo(7, 'research', { topics: ['owned-research'], language: 'Python' }), ownedRepo(6, 'secret', { private: true }), publicRepo(5, 'foreign')])
    }
    throw new Error(`Unexpected request ${url}`)
  } })
  const session = await login(client)
  const response = await post(client, session, { operation: 'seeds' })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result.data.starred.map((repo) => [repo.nameWithOwner, repo.viewerHasStarred]), [['sample/recent', true]])
  assert.equal(result.data.own.length, 1)
  assert.deepEqual(result.data.profile.counts, { starred: 2, owned: 2 })
  assert.deepEqual(result.data.profile.limits, { starred: 1000, owned: 300 })
  assert.deepEqual(result.data.profile.starredIds, [1, 2])
  assert.deepEqual(result.data.profile.ownedIds, [3, 7])
  assert.ok(result.data.profile.topics.some((topic) => topic.name === 'old-research' && topic.evidence.repo === 'sample/old'))
  assert.ok(result.data.profile.topics.some((topic) => topic.name === 'owned-research' && topic.evidence.source === 'owned'))
  const before = client.calls.length
  const cached = await (await client.request('/api/recommendation-profile')).json()
  assert.deepEqual(cached, result.data.profile)
  assert.equal(client.calls.length, before, 'seeds uses the shared profile cache rather than another small profile')
  assert.ok(client.calls.every(({ url }) => ['api.github.com', 'github.com'].includes(url.hostname)))
  assert.ok(!JSON.stringify(result).includes(TOKEN))
})

test('myStars uses bounded fixed pagination, preserves unknown totals and does not re-query known Star state', async (t) => {
  const paths = []
  const client = await fixture(t, { upstream: ({ url, init }) => {
    paths.push(url)
    assert.equal(url.pathname, '/user/starred')
    assert.equal(url.searchParams.get('per_page'), '24')
    assert.equal(url.searchParams.get('sort'), 'created')
    assert.equal(init.headers.Accept, 'application/vnd.github.star+json')
    return json([{ starred_at: '2026-10-09T00:00:00Z', repo: publicRepo(1, 'one') }, { repo: publicRepo(2, 'secret', { private: true }) }], 200, url.searchParams.get('page') === '1' ? { Link: '<https://attacker.example/?token=secret>; rel="next"' } : {})
  } })
  const session = await login(client)
  const first = await (await post(client, session, { operation: 'myStars', after: null })).json()
  assert.equal(first.data.total, null)
  assert.equal(first.data.hasNextPage, true)
  assert.deepEqual(first.data.repos.map((repo) => repo.viewerHasStarred), [true])
  const second = await (await post(client, session, { operation: 'myStars', after: first.data.endCursor })).json()
  assert.equal(second.data.hasNextPage, false)
  assert.equal(second.data.endCursor, null)
  assert.deepEqual(paths.map((url) => url.searchParams.get('page')), ['1', '2'])
  assert.equal((await post(client, session, search('web', 24, first.data.endCursor))).status, 400)
  assert.equal(paths.length, 2)
})

test('following activity is visibly sampled, public-only and limited to two concurrent source reads', async () => {
  let active = 0
  let maximum = 0
  const readPeople = []
  const people = Array.from({ length: 15 }, (_, i) => ({ login: `person-${i}`, type: 'User', avatar_url: 'javascript:unsafe' }))
  const api = makeApi(async (path, token, options) => {
    const url = new URL(path, 'https://api.github.com')
    if (url.pathname.endsWith('/following')) { assert.equal(url.searchParams.get('per_page'), '12'); return json(people) }
    if (url.pathname === '/graphql') return graphql(options, true)
    const person = url.pathname.split('/')[2]
    readPeople.push(person)
    assert.equal(url.searchParams.get('per_page'), '6')
    assert.equal(url.searchParams.get('page'), '1')
    active++; maximum = Math.max(maximum, active)
    await nextTurn()
    active--
    const index = Number(person.split('-')[1])
    return json(Array.from({ length: 8 }, (_, at) => ({ starred_at: `2026-10-${String(at + 1).padStart(2, '0')}T00:00:00Z`, repo: publicRepo(index * 10 + at + 1, `repo-${index}-${at}`, { private: at === 0 }) })), 200, { Link: '<https://attacker.example/next>; rel="next"' })
  })
  const result = await api.execute({ operation: 'followingStars' }, authenticated)
  assert.equal(readPeople.length, 12)
  assert.equal(maximum, 2)
  assert.equal(result.data.length, 12 * 5, 'each source is capped at six including one private item')
  assert.ok(result.data.every((entry) => entry.repo.viewerHasStarred && entry.avatarUrl === '' && !entry.repo.name.endsWith('-0')))
  assert.ok(result.data[0].starredAt >= result.data.at(-1).starredAt)
  assert.match(result.meta.warnings.join(' '), /12.*6/)
})

test('following partial failures are visible, total failures fail, and 401 stops further people', async (t) => {
  for (const mode of ['partial', 'all', 'expired']) await t.test(mode, async () => {
    const checked = []
    const api = makeApi(async (path, token, options) => {
      if (path.includes('/following?')) return json(Array.from({ length: 8 }, (_, i) => ({ login: `p-${i}`, type: 'User' })))
      if (path === '/graphql') return graphql(options)
      const person = path.split('/')[2]
      checked.push(person)
      if (mode === 'expired') return empty(401)
      if (mode === 'all' || person === 'p-0') return empty(500)
      return json([{ starred_at: '2026-10-10T00:00:00Z', repo: publicRepo(1, 'one') }])
    })
    if (mode === 'partial') {
      const result = await api.execute({ operation: 'followingStars' }, authenticated)
      assert.equal(result.data.length, 7)
      assert.match(result.meta.warnings.join(' '), /@p-0.*覆盖不完整/)
    } else {
      await assert.rejects(api.execute({ operation: 'followingStars' }, authenticated), expectError(mode === 'expired' ? 401 : 502, mode === 'expired' ? 'SESSION_EXPIRED' : 'GITHUB_UNAVAILABLE'))
      if (mode === 'expired') assert.ok(checked.length <= 2, `unexpected fanout after 401: ${checked}`)
    }
  })
})

test('operation deadline and cancellation abort in-flight requests and stop subsequent Star fallbacks', async () => {
  let requestSignal
  const hanging = makeApi(async (path, token, options) => { requestSignal = options.signal; return new Promise(() => {}) }, { deadlineMs: 20 })
  await assert.rejects(hanging.execute(search()), expectError(504, 'GITUBE_TIMEOUT'))
  assert.equal(requestSignal.aborted, true)
  const calls = []
  const fallback = makeApi(async () => json({ items: [publicRepo(1, 'one', { node_id: undefined }), publicRepo(2, 'two', { node_id: undefined })], total_count: 2 }), { deadlineMs: 20 })
  await assert.rejects(fallback.execute(search(), { ...authenticated, starred: (name, { signal }) => {
    calls.push(name)
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve(false), { once: true }))
  } }), expectError(504, 'GITUBE_TIMEOUT'))
  await nextTurn()
  assert.deepEqual(calls, ['sample/one'])
  let cancelled
  const broken = makeApi(async (path, token, options) => {
    if (path.includes('topic%3Arust')) { cancelled = options.signal; return new Promise(() => {}) }
    await nextTurn()
    return empty(500)
  })
  await assert.rejects(broken.execute({ operation: 'searchMany', specs: [{ query: 'web', first: 1 }, { query: 'topic:rust', first: 1 }] }), expectError(502, 'GITHUB_UNAVAILABLE'))
  assert.equal(cancelled.aborted, true, 'one failed branch cancels another in-flight branch')
})
