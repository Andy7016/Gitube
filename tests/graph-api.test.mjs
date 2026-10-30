import test from 'node:test'
import assert from 'node:assert/strict'
import { createGraphAnalyzer } from '../src/lib/graph/analyze.ts'

const repo = (name, extra = {}) => ({ full_name: name, private: false, visibility: 'public', owner: { login: name.split('/')[0], type: 'Organization', avatar_url: 'https://avatars.githubusercontent.com/u/1' }, topics: ['graph', 'rust'], language: 'Rust', description: name, stargazers_count: 100, default_branch: 'main', fork: false, archived: false, ...extra })
const source = (content, path = 'README.md') => ({ content: Buffer.from(content).toString('base64'), encoding: 'base64', path, size: Buffer.byteLength(content) })
const response = (data, status = 200, headers = {}) => new Response(data === undefined ? '' : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
function fakeApi(routes, { delay = 0 } = {}) {
  const calls = []; let active = 0; let peak = 0
  const fetch = async (url, init) => {
    const path = new URL(url).pathname + new URL(url).search
    calls.push({ url, path, init }); active++; peak = Math.max(peak, active)
    try {
      if (delay) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      })
      if (init.signal.aborted) throw new DOMException('aborted', 'AbortError')
      const value = routes[path]
      return typeof value === 'function' ? await value(url, init) : value instanceof Response ? value.clone() : value === undefined ? response({ message: 'Not Found' }, 404) : response(value)
    } finally { active-- }
  }
  return { fetch, calls, get peak() { return peak } }
}

test('frontend analysis verifies public direct targets and bounded human-owned topic related repositories', async () => {
  const api = fakeApi({
    '/repos/acme/root': repo('Acme/Root'),
    '/repos/acme/root/readme': source('## Credits\nThis project is based on [Base](https://github.com/source/base).\n## Used by\n[Client](https://github.com/client/app)\n## References\n[Private](https://github.com/no/private)\n[Missing](https://github.com/no/missing)\n## Authors\n[Alice](https://github.com/alice)\n\nDo not fetch https://evil.test/secret'),
    '/repos/acme/root/contents/package.json': source(JSON.stringify({ dependencies: { base: 'github:source/base', engine: 'git+https://github.com/source/engine.git', bad: 'https://secret@evil.test/repo' } }), 'package.json'),
    '/repos/acme/root/contents/.github/CODEOWNERS': source('* @alice @org/team\n/docs @bob', '.github/CODEOWNERS'),
    '/repos/acme/root/contributors?per_page=30': [{ login: 'alice', type: 'User', contributions: 9 }, { login: 'bot[bot]', type: 'Bot', contributions: 100 }, { login: 'bob', type: 'User', contributions: 5 }, { login: 'charlie', type: 'User', contributions: 1 }],
    '/repos/source/base': repo('Source/Base'),
    '/repos/source/engine': repo('Source/Engine'),
    '/repos/client/app': repo('Client/App'),
    '/repos/no/private': repo('No/Private', { private: true }),
    '/users/alice': { login: 'Alice', type: 'User', avatar_url: 'https://avatars.githubusercontent.com/u/2' },
    '/users/bob': { login: 'Bob', type: 'User' },
    '/users/alice/repos?type=owner&sort=updated&per_page=30': [repo('Alice/Related', { owner: { login: 'Alice', type: 'User' }, topics: ['graph', 'cli'] }), repo('Alice/Fork', { fork: true, owner: { login: 'Alice', type: 'User' } }), repo('Alice/Archived', { archived: true, owner: { login: 'Alice', type: 'User' } }), repo('Alice/Private', { private: true, owner: { login: 'Alice', type: 'User' } }), repo('Other/NotOwned'), repo('Alice/Unrelated', { topics: ['cli'], owner: { login: 'Alice', type: 'User' } })],
    '/users/bob/repos?type=owner&sort=updated&per_page=30': [repo('Source/Base', { owner: { login: 'Bob', type: 'User' } })],
  }, { delay: 2 })
  const progress = []
  const analyze = createGraphAnalyzer({ fetch: api.fetch, now: () => 1_000 })
  const result = await analyze('Acme/Root', { token: 'captured-token', onProgress: (p) => progress.push(p) })
  assert.equal(result.root, 'acme/root')
  assert.deepEqual(result.nodes.map((node) => node.id), ['acme/root', 'client/app', 'source/base', 'source/engine', 'alice/related'])
  assert.equal(result.nodes.find((node) => node.id === 'alice/related').overlap.score, 1 / 3)
  assert.equal(result.edges.find((edge) => edge.target === 'source/base').relation, 'upstream')
  assert.equal(result.edges.find((edge) => edge.target === 'client/app').relation, 'downstream')
  assert.equal(result.edges.find((edge) => edge.target === 'alice/related').relation, 'related')
  assert.equal(result.nodes.find((node) => node.id === 'source/base').tier, 1)
  assert.deepEqual(result.counts, { referencesFound: 5, referencesResolved: 3, peopleFound: 3, peopleScanned: 2, candidatesScanned: 7, requests: api.calls.length })
  assert.ok(result.warnings.some((warning) => warning.includes('No/Private') || warning.includes('no/private')))
  assert.equal(result.incomplete, true)
  assert.ok(result.warnings.some((warning) => warning.includes('2 位')))
  assert.equal(progress.at(-1).phase, 'done')
  assert.equal(progress.at(-1).progress, 100)
  assert.ok(api.peak <= 3)
  assert.ok(api.calls.every(({ url, init }) => url.startsWith('https://api.github.com/') && init.redirect === 'error' && init.credentials === 'omit' && init.headers.Authorization === 'Bearer captured-token'))
  assert.ok(!api.calls.some((call) => call.path === '/repos/source/base/readme'))
  assert.ok(!api.calls.some((call) => call.path.includes('/contents/CODEOWNERS')))
  assert.ok(!api.calls.some((call) => call.path.includes('charlie/repos')))
})

test('CODEOWNERS priority falls through only confirmed 404, and failed authoritative read stops fallback', async () => {
  for (const status of [403, 404]) {
    const api = fakeApi({ '/repos/acme/root': repo('acme/root'), '/repos/acme/root/contents/.github/CODEOWNERS': response({ message: 'Missing permission' }, status), '/repos/acme/root/contents/CODEOWNERS': source('* @alice', 'CODEOWNERS') })
    const result = await createGraphAnalyzer({ fetch: api.fetch, now: Date.now })('acme/root', { token: 'token' })
    assert.equal(api.calls.some((call) => call.path.endsWith('/contents/CODEOWNERS')), status === 404)
    if (status === 403) assert.ok(result.warnings.some((warning) => warning.includes('未改用')))
  }
})

test('discovery budgets count all references while verifying only 12 and scanning 30 owned repos for two people', async () => {
  const routes = { '/repos/acme/root': repo('acme/root'), '/repos/acme/root/readme': source('## Credits\n' + Array.from({ length: 16 }, (_, i) => `[R${i}](https://github.com/targets/r${i})`).join('\n')), '/repos/acme/root/contributors?per_page=30': [{ login: 'alice', type: 'User', contributions: 10 }, { login: 'bob', type: 'User', contributions: 5 }, { login: 'charlie', type: 'User', contributions: 1 }] }
  for (let i = 0; i < 16; i++) routes[`/repos/targets/r${i}`] = repo(`targets/r${i}`)
  for (const login of ['alice', 'bob']) { routes[`/users/${login}`] = { login, type: 'User' }; routes[`/users/${login}/repos?type=owner&sort=updated&per_page=30`] = Array.from({ length: 40 }, (_, i) => repo(`${login}/r${i}`, { owner: { login, type: 'User' } })) }
  const api = fakeApi(routes)
  const result = await createGraphAnalyzer({ fetch: api.fetch, now: Date.now })('acme/root', { token: 'token' })
  assert.equal(result.counts.referencesFound, 16)
  assert.equal(result.counts.referencesResolved, 12)
  assert.equal(result.counts.peopleScanned, 2)
  assert.equal(result.counts.candidatesScanned, 60)
  assert.ok(result.counts.requests <= 48)
  assert.ok(result.warnings.some((warning) => warning.includes('前 12 个')))
  assert.equal(result.nodes.filter((node) => node.tier === 2).length, 60)
  assert.equal(result.incomplete, false, 'intended sampling caps alone are complete bounded coverage')
})

test('missing README still produces owner language fallback without fabricated topic score', async () => {
  const api = fakeApi({ '/repos/alice/root': repo('alice/root', { topics: [], owner: { login: 'alice', type: 'User' } }), '/users/alice': { login: 'alice', type: 'User' }, '/users/alice/repos?type=owner&sort=updated&per_page=30': [repo('alice/other', { topics: [], owner: { login: 'alice', type: 'User' } })] })
  const result = await createGraphAnalyzer({ fetch: api.fetch, now: Date.now })('alice/root', { token: 'token' })
  assert.equal(result.people[0].roles[0], 'owner')
  assert.equal(result.nodes[1].overlap.method, 'language-fallback')
  assert.equal(result.nodes[1].overlap.score, 0)
  assert.ok(result.warnings.some((warning) => warning.includes('README')))
})

test('rate limits and request budget preserve the verified root with actionable partial warnings', async () => {
  for (const mode of ['rate', 'budget']) {
    const api = fakeApi({ '/repos/acme/root': repo('acme/root'), '/repos/acme/root/readme': mode === 'rate' ? response({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' }) : source('[A](https://github.com/other/a)') })
    const result = await createGraphAnalyzer({ fetch: api.fetch, now: Date.now, limits: mode === 'budget' ? { requests: 4 } : undefined })('acme/root', { token: 'token' })
    assert.equal(result.nodes[0].id, 'acme/root')
    assert.equal(result.incomplete, true, 'root metadata success does not hide subsequent source failure')
    assert.ok(result.warnings.some((warning) => mode === 'rate' ? warning.includes('限流') : warning.includes('请求上限')))
    assert.ok(api.calls.length <= (mode === 'rate' ? 48 : 4))
  }
})

test('auth failures never return success; cancellation stops queued and active calls', async () => {
  const api = fakeApi({ '/repos/acme/root': response({}, 401) })
  await assert.rejects(createGraphAnalyzer({ fetch: api.fetch, now: Date.now })('acme/root', { token: 'token' }), (error) => error.kind === 'auth' && /重新登录/.test(error.message))
  const delayed = fakeApi({ '/repos/acme/root': repo('acme/root') }, { delay: 10 })
  const controller = new AbortController()
  const running = createGraphAnalyzer({ fetch: delayed.fetch, now: Date.now })('acme/root', { token: 'token', signal: controller.signal })
  controller.abort()
  await assert.rejects(running, (error) => error.kind === 'cancelled')
  assert.equal(delayed.calls.length, 1)
  const loggedOut = new AbortController(); loggedOut.abort()
  await assert.rejects(createGraphAnalyzer({ fetch: delayed.fetch, now: Date.now })('acme/root', { token: 'token', signal: loggedOut.signal }), (error) => error.kind === 'cancelled')
  assert.equal(delayed.calls.length, 1)
})

test('per-request and total deadlines return bounded partial coverage and clear timers', async () => {
  const api = fakeApi({ '/repos/acme/root': () => response(repo('acme/root')) })
  const baseFetch = api.fetch
  const slowFetch = async (url, init) => {
    if (url.endsWith('/repos/acme/root')) return baseFetch(url, init)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(response({}, 404)), 500)
      init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('abort', 'AbortError')) }, { once: true })
    })
  }
  for (const limits of [{ requestTimeoutMs: 5, totalTimeoutMs: 200 }, { requestTimeoutMs: 200, totalTimeoutMs: 5 }]) {
    const result = await createGraphAnalyzer({ fetch: slowFetch, now: Date.now, limits })('acme/root', { token: 'token' })
    assert.equal(result.nodes.length, 1)
    assert.ok(result.warnings.some((warning) => /超过|期限|时间上限/.test(warning)))
  }
})

test('oversized source and response bodies are skipped, and private or absent roots are rejected', async () => {
  const huge = source('x'.repeat(512001))
  const api = fakeApi({ '/repos/acme/root': repo('acme/root'), '/repos/acme/root/readme': huge, '/repos/acme/root/contents/package.json': response({}, 200, { 'content-length': '3000000' }) })
  const result = await createGraphAnalyzer({ fetch: api.fetch, now: Date.now })('acme/root', { token: 'token' })
  assert.ok(result.warnings.some((warning) => warning.includes('512 KB')))
  assert.ok(result.warnings.some((warning) => warning.includes('数据过大')))
  for (const metadata of [repo('acme/root', { private: true }), undefined]) {
    const failed = fakeApi({ '/repos/acme/root': metadata })
    await assert.rejects(createGraphAnalyzer({ fetch: failed.fetch, now: Date.now })('acme/root', { token: 'token' }), (error) => error.kind === 'not_found')
  }
})

test('renamed root and direct reference use one bounded fixed-origin GraphQL lookup after REST redirect failure', async () => {
  const graphRepo = (name) => ({ nameWithOwner: name, isPrivate: false, description: name, stargazerCount: 12, isFork: false, isArchived: false, primaryLanguage: { name: 'Rust' }, repositoryTopics: { nodes: [{ topic: { name: 'graph' } }] }, owner: { login: name.split('/')[0], avatarUrl: 'https://avatars.githubusercontent.com/u/2', __typename: 'Organization' }, defaultBranchRef: { name: 'main' } })
  const redirects = () => { throw new TypeError('Failed to fetch: redirect blocked') }
  const api = fakeApi({
    '/repos/old/root': redirects,
    '/repos/moved/root/readme': source('This project uses [Old](https://github.com/old/dependency).'),
    '/repos/moved/root/contributors?per_page=30': [],
    '/repos/old/dependency': redirects,
    '/graphql': (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.variables.owner, 'old')
      assert.match(body.query, /query GraphRepository/)
      return response({ data: { repository: graphRepo(body.variables.name === 'root' ? 'Moved/Root' : 'Moved/Dependency') } })
    },
  })
  const result = await createGraphAnalyzer({ fetch: api.fetch, now: Date.now })('old/root', { token: 'token' })
  assert.equal(result.root, 'moved/root')
  assert.deepEqual(result.nodes.map((node) => node.id), ['moved/root', 'moved/dependency'])
  assert.equal(result.edges[0].relation, 'upstream')
  assert.equal(result.edges[0].source, 'moved/root')
  assert.equal(result.edges[0].target, 'moved/dependency')
  assert.equal(result.counts.requests, api.calls.length)
  assert.equal(api.calls.filter((call) => call.path === '/graphql').length, 2)
  assert.ok(api.calls.filter((call) => call.path === '/graphql').every((call) => call.init.method === 'POST' && call.init.redirect === 'error' && call.init.headers.Authorization === 'Bearer token'))
  assert.ok(api.calls.every((call) => new URL(call.url).origin === 'https://api.github.com'))
  assert.deepEqual(result.warnings, [])
  assert.equal(result.incomplete, false)
})

test('GraphQL fallback shares budget and never retries REST auth/rate/private/not-found failures', async () => {
  const redirects = () => { throw new TypeError('redirect') }
  const graphql = { data: { repository: { nameWithOwner: 'moved/root', isPrivate: false, owner: { login: 'moved', __typename: 'Organization' } } } }
  const api = fakeApi({ '/repos/old/root': redirects, '/graphql': graphql })
  const partial = await createGraphAnalyzer({ fetch: api.fetch, now: Date.now, limits: { requests: 2 } })('old/root', { token: 'token' })
  assert.equal(partial.root, 'moved/root')
  assert.equal(api.calls.length, 2)
  assert.ok(partial.warnings.some((warning) => warning.includes('请求上限')))
  for (const rootResponse of [response({}, 401), response({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }), repo('old/root', { private: true }), response({}, 404)]) {
    const stopped = fakeApi({ '/repos/old/root': rootResponse, '/graphql': graphql })
    await assert.rejects(createGraphAnalyzer({ fetch: stopped.fetch, now: Date.now })('old/root', { token: 'token' }))
    assert.equal(stopped.calls.length, 1)
  }
  const rate = fakeApi({ '/repos/old/root': redirects, '/graphql': { errors: [{ type: 'RATE_LIMITED', message: 'rate limit' }] } })
  await assert.rejects(createGraphAnalyzer({ fetch: rate.fetch, now: Date.now })('old/root', { token: 'token' }), (error) => error.kind === 'rate')
  assert.equal(rate.calls.length, 2)
})
