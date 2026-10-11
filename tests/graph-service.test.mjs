import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { ApiError } from '../server/github.mjs'
import { createGraphService } from '../server/graph-service.mjs'

const fixedTime = Date.parse('2026-10-10T12:00:00.000Z')
let nextId = 1
function repository(name, extra = {}) {
  const [owner, repo] = name.split('/')
  return { id: nextId++, name: repo, full_name: name, private: false, default_branch: 'main', html_url: `https://github.com/${name}`, owner: { login: owner, avatar_url: `https://avatars.githubusercontent.com/${owner}` }, topics: ['rust', 'cli'], language: 'Rust', stargazers_count: 10, fork: false, archived: false, ...extra }
}
const profile = (login, type = 'User', extra = {}) => ({ login, type, avatar_url: `https://avatars.githubusercontent.com/${login}`, html_url: `https://github.com/${login}`, ...extra })
const response = (value, status = 200, headers) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
const file = (content) => ({ encoding: 'base64', content: Buffer.from(content).toString('base64') })
const details = (repo, content = '') => ({ repo, defaultBranch: 'main', readme: { content, path: 'README.md', html_url: `https://github.com/${repo.full_name}/blob/main/README.md`, download_url: null }, readmeError: null })
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
async function finish(service, job, session = 'session', timeout = 2500) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = service.getJob(job.id, session)
    if (['complete', 'partial', 'failed'].includes(value.status)) {
      assert.equal(value.phase, 'done')
      assert.equal(value.progress, 100)
      return value
    }
    await delay(2)
  }
  assert.fail('Graph fixture task did not settle before its test deadline.')
}
function mockApi({ contributors = [], profiles = {}, repositories = {}, files = {}, refs = {}, override } = {}) {
  const calls = []
  const request = async (path, token, options = {}) => {
    calls.push({ path, token, signal: options.signal })
    const custom = await override?.(path, token, options)
    if (custom !== undefined) return custom
    const url = new URL(`https://api.github.com${path}`)
    if (url.pathname.includes('/contents/')) {
      const name = decodeURIComponent(url.pathname.split('/contents/')[1])
      return Object.hasOwn(files, name) ? response(file(files[name])) : response({}, 404)
    }
    if (url.pathname.endsWith('/contributors')) return response(contributors)
    const userRepos = url.pathname.match(/^\/users\/([^/]+)\/repos$/)
    if (userRepos) return response(repositories[decodeURIComponent(userRepos[1])] ?? [])
    const user = url.pathname.match(/^\/users\/([^/]+)$/)
    if (user) return response(profiles[decodeURIComponent(user[1])] ?? profile(decodeURIComponent(user[1]), 'Organization'))
    const repo = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/)
    if (repo) { const name = `${decodeURIComponent(repo[1])}/${decodeURIComponent(repo[2])}`.toLowerCase(); return refs[name] ? response(refs[name]) : response({}, 404) }
    throw new Error(`Unexpected fixture API path: ${path}`)
  }
  return { request, calls }
}

test('graph resolves one level, preserves source evidence, prioritizes explicit people, merges duplicates and ranks precise tiers', async () => {
  const root = repository('acme/root', { viewer_starred: true })
  const shared = repository('lead/shared', { topics: ['rust'], stargazers_count: 20 })
  const ordinary = repository('other/ordinary', { topics: ['cli'], stargazers_count: 2 })
  const direct = repository('other/direct', { topics: [], stargazers_count: 100000 })
  const api = mockApi({
    contributors: [profile('second', 'User', { contributions: 90 }), profile('lead', 'User', { contributions: 100 }), profile('robot', 'Bot', { contributions: 999 })],
    profiles: { code: profile('code'), maint: profile('maint'), acme: profile('acme') },
    files: { 'package.json': JSON.stringify({ repository: 'https://github.com/ignored/home', dependencies: { shared: 'github:lead/shared', repeated: 'github:other/direct', react: '^19' } }), '.github/CODEOWNERS': '* @code @org/team mail@example.com', CODEOWNERS: '* @ignored' },
    refs: { 'lead/shared': shared, 'other/direct': direct, 'other/ordinary': ordinary },
    repositories: {
      code: [repository('code/high', { topics: ['rust', 'cli'], stargazers_count: 50 }), repository('code/fork', { fork: true }), repository('code/archive', { archived: true })],
      maint: [repository('maint/no-overlap', { topics: ['web'] }), repository('maint/private', { private: true }), repository('foreign/other')],
      lead: [shared], acme: [root, repository('acme/owned', { topics: ['rust', 'cli', 'web'], stargazers_count: 5 })],
    },
  })
  const service = createGraphService({ request: api.request, getDetails: async () => details(root, '[ordinary](https://github.com/other/ordinary)\n## Credits\n[origin](https://github.com/other/direct)\n## Maintainers\n@maint'), now: () => fixedTime })
  const job = await finish(service, await service.start('acme', 'root', 'fixture-token', 'session'))
  assert.equal(job.status, 'partial', 'More discovered people than the 4-person sample must be visible in coverage warnings.')
  assert.equal(job.error, null)
  assert.equal(job.result.semanticsVersion, 2)
  assert.equal(job.requests, api.calls.length + 3)
  assert.ok(job.requests <= 40)
  assert.deepEqual(job.result.nodes.map((node) => node.id), ['acme/root', 'lead/shared', 'other/ordinary', 'other/direct', 'code/high', 'acme/owned'])
  assert.equal(job.result.nodes[1].tier, 1)
  assert.deepEqual(new Set(job.result.nodes[1].evidence.map((item) => item.kind)), new Set(['dependency', 'contributor']))
  assert.deepEqual(new Set(job.result.nodes[3].evidence.map((item) => item.kind)), new Set(['credit', 'dependency']))
  assert.equal(job.result.nodes[3].overlap.score, 0)
  assert.equal(job.result.nodes[5].overlap.score, 2 / 3)
  assert.equal(job.result.edges.find((edge) => edge.target === 'lead/shared').kind, 'direct')
  assert.equal(job.result.edges.find((edge) => edge.target === 'lead/shared').relation, 'upstream', 'Related people evidence must not overwrite an explicit dependency.')
  assert.equal(job.result.edges.find((edge) => edge.target === 'other/direct').relation, 'upstream')
  assert.equal(job.result.edges.find((edge) => edge.target === 'code/high').relation, 'related')
  assert.ok(job.result.edges.every((edge) => edge.source === 'acme/root'))
  assert.deepEqual(job.result.counts, { referencesFound: 3, referencesResolved: 3, peopleFound: 5, peopleScanned: 4, candidatesScanned: 9 })
  const scanned = api.calls.filter((call) => /^\/users\/[^/]+\/repos\?/.test(call.path)).map((call) => call.path.split('/')[2])
  assert.deepEqual(scanned, ['code', 'maint', 'lead', 'acme'])
  assert.ok(!api.calls.some((call) => /\/contents\/CODEOWNERS\?/.test(call.path)))
  assert.ok(!api.calls.some((call) => /\/readme/.test(call.path)), 'Referenced README must never be fetched recursively.')
  assert.ok(api.calls.every((call) => call.path.startsWith('/') && call.signal instanceof AbortSignal))
  for (const person of job.result.people) assert.ok(person.roles.every((role) => person.evidence.some((item) => item.kind === role && item.person.toLowerCase() === person.login.toLowerCase())))
  const serialized = JSON.stringify(job)
  for (const marker of ['fixture-token', 'viewer_starred', 'sessionKey', 'rawReadme']) assert.ok(!serialized.includes(marker))
  assert.throws(() => service.getJob(job.id, 'other-session'), { status: 404 })
  const copy = service.getJob(job.id, 'session')
  copy.result.nodes.length = 0
  assert.ok(service.getJob(job.id, 'session').result.nodes.length > 0)
})

test('strict root validation and private rejection make no additional API calls or cache writes', async () => {
  const api = mockApi()
  let loads = 0
  let writes = 0
  const service = createGraphService({ request: api.request, getDetails: async () => { loads++; return details(repository('acme/root', { private: true })) }, store: { get: async () => undefined, set: async () => { writes++ } } })
  for (const [owner, repo] of [['acme', '..'], ['a/b', 'root'], ['acme', 'x?private=true']]) await assert.rejects(service.start(owner, repo, null, 'session'), { status: 400 })
  assert.equal(loads, 0)
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.status, 'failed')
  assert.equal(job.error.code, 'PRIVATE_REPOSITORY')
  assert.equal(job.result, null)
  assert.equal(api.calls.length, 0)
  assert.equal(writes, 0)
})

test('public content permission 403 retries anonymously; 401 and rate limits stop without fallback or further requests', async () => {
  for (const status of [403, 401, 429]) {
    let writes = 0
    const api = mockApi({ override: (path, token) => path.includes('/contents/package.json') && token ? response({}, status, status === 429 ? { 'retry-after': '30' } : undefined) : undefined })
    const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root')), store: { get: async () => undefined, set: async () => { writes++ } }, now: () => fixedTime })
    const job = await finish(service, await service.start('acme', 'root', 'token', 'session'))
    if (status === 403) {
      assert.equal(job.status, 'complete')
      assert.equal(api.calls[1].token, null)
      assert.equal(api.calls[1].path, api.calls[0].path)
      assert.equal(writes, 1)
    } else {
      assert.equal(api.calls.length, 1)
      assert.equal(job.status, status === 401 ? 'failed' : 'partial')
      assert.equal(status === 401 ? job.error.code : job.result.warnings.some((item) => item.includes('额度')), status === 401 ? 'SESSION_EXPIRED' : true)
      assert.equal(writes, status === 401 ? 0 : 1)
      if (status === 401) assert.equal(job.result, null)
    }
  }
})

test('source failures preserve successful references with explicit coverage warnings and no raw upstream message', async () => {
  const api = mockApi({ refs: { 'other/engine': repository('other/engine') }, override: (path) => path.endsWith('/contributors?per_page=100&anon=false') ? Promise.reject(new ApiError(502, 'raw secret error token=oops')) : undefined })
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root'), '## Credits\n[engine](https://github.com/other/engine)'), now: () => fixedTime })
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.status, 'partial')
  assert.equal(job.result.counts.referencesResolved, 1)
  assert.ok(job.result.warnings.some((item) => item.includes('公开贡献者')))
  assert.ok(!JSON.stringify(job).includes('raw secret'))
})

test('request budget includes 3 reserved detail calls and never starts a request past the limit', async () => {
  const api = mockApi()
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root'), '## Credits\n[known](https://github.com/other/known)'), now: () => fixedTime, limits: { requests: 5 } })
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.status, 'partial')
  assert.equal(job.requests, 5)
  assert.equal(api.calls.length, 2)
  assert.equal(job.result.counts.referencesFound, 1, 'Already extracted references remain visible when file scanning hits budget.')
  assert.ok(job.result.warnings.some((item) => item.includes('请求上限')))
  assert.ok(!job.result.warnings.some((item) => item.includes('额度')))
})

test('rate limits preserve people already verified before CODEOWNERS scanning stops', async () => {
  const api = mockApi({ contributors: [profile('lead', 'User', { contributions: 7 })], override: (path) => path.includes('/contents/.github/CODEOWNERS') ? response({}, 403, { 'x-ratelimit-remaining': '0' }) : undefined })
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root')), now: () => fixedTime })
  const job = await finish(service, await service.start('acme', 'root', 'token', 'session'))
  assert.equal(job.status, 'partial')
  assert.deepEqual(job.result.people.map((item) => item.login), ['lead'])
  assert.equal(job.result.counts.peopleFound, 1)
  assert.ok(!api.calls.some((item) => item.token === null))
  assert.ok(!api.calls.some((item) => /^\/users\//.test(item.path)))
})

test('reference and people repository caps are reflected in coverage without recursive expansion', async () => {
  const api = mockApi({ contributors: [profile('lead', 'User', { contributions: 2 })], refs: { 'other/a': repository('other/a'), 'other/b': repository('other/b') }, repositories: { lead: [repository('lead/a'), repository('lead/b'), repository('lead/c')] } })
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root'), '## Credits\n[a](https://github.com/other/a) [b](https://github.com/other/b)'), now: () => fixedTime, limits: { references: 1, reposPerPerson: 2, people: 1 } })
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.result.counts.referencesFound, 2)
  assert.equal(job.result.counts.referencesResolved, 1)
  assert.equal(job.result.counts.candidatesScanned, 2)
  assert.deepEqual(job.result.nodes.map((item) => item.id), ['acme/root', 'other/a', 'lead/a', 'lead/b'])
  assert.ok(job.result.warnings.some((item) => item.includes('最多解析 1 个')))
  assert.ok(api.calls.some((item) => item.path.includes('per_page=2')))
})

test('independent deadline settles a hanging upstream call and aborts its signal without scanning more sources', async () => {
  const api = mockApi({ override: () => new Promise(() => {}) })
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root')), limits: { deadlineMs: 30 } })
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.status, 'partial')
  assert.equal(api.calls.length, 1)
  assert.equal(api.calls[0].signal.aborted, true)
  assert.ok(job.result.warnings.some((item) => item.includes('时间上限')))
})

test('deadline before root details fails safely and does not cache an invented empty success', async () => {
  let writes = 0
  const service = createGraphService({ request: async () => assert.fail('No request before root verification'), getDetails: () => new Promise(() => {}), store: { get: async () => undefined, set: async () => { writes++ } }, limits: { deadlineMs: 25 } })
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.status, 'failed')
  assert.equal(job.error.code, 'GRAPH_DEADLINE')
  assert.equal(job.result, null)
  assert.equal(writes, 0)
})

test('queue enforces concurrency, capacity, session active count, pending merge, and private job ownership', async () => {
  const gates = new Map()
  let active = 0
  let peak = 0
  const api = mockApi()
  const service = createGraphService({ request: api.request, getDetails: async (owner, repo) => { active++; peak = Math.max(peak, active); const gate = deferred(); gates.set(repo, gate); await gate.promise; active--; return details(repository(`${owner}/${repo}`)) }, limits: { concurrency: 2, queue: 2, sessionActive: 3 } })
  const a = await service.start('acme', 'a', null, 'one')
  const merged = await Promise.all([service.start('ACME', 'A', 'another-token', 'one'), service.start('acme', 'a', null, 'one', { refresh: true })])
  assert.ok(merged.every((job) => job.id === a.id))
  const b = await service.start('acme', 'b', null, 'one')
  const c = await service.start('acme', 'c', null, 'one')
  await assert.rejects(service.start('acme', 'd', null, 'one'), { code: 'GRAPH_SESSION_LIMIT' })
  const d = await service.start('acme', 'd', null, 'two')
  assert.equal(c.status, 'queued')
  assert.equal(d.status, 'queued')
  await assert.rejects(service.start('acme', 'e', null, 'three'), { code: 'GRAPH_QUEUE_FULL' })
  assert.throws(() => service.getJob(a.id, 'two'), { status: 404 })
  assert.throws(() => service.getJob('unknown', 'one'), { status: 404 })
  gates.get('a').resolve(); gates.get('b').resolve()
  await finish(service, a, 'one'); await finish(service, b, 'one')
  for (let i = 0; i < 50 && (!gates.has('c') || !gates.has('d')); i++) await delay(2)
  gates.get('c').resolve(); gates.get('d').resolve()
  await finish(service, c, 'one'); await finish(service, d, 'two')
  assert.equal(peak, 2)
})

test('public cache isolates job sessions, expires complete/partial entries, merges asynchronous starts and throttles refresh', async () => {
  let clock = fixedTime
  let loads = 0
  const api = mockApi()
  const memory = new Map()
  const service = createGraphService({ request: api.request, getDetails: async () => { loads++; return details(repository('acme/root')) }, store: { get: async (key) => { await delay(1); return memory.get(key) }, set: async (key, value) => { memory.set(key, value) } }, now: () => clock })
  const [first, duplicate] = await Promise.all([service.start('acme', 'root', 'token-a', 'one'), service.start('ACME', 'ROOT', 'token-a', 'one')])
  assert.equal(first.id, duplicate.id)
  const completed = await finish(service, first, 'one')
  assert.equal(completed.status, 'complete')
  const cached = await service.start('acme', 'root', 'token-b', 'two')
  assert.equal(cached.status, 'complete')
  assert.equal(cached.requests, 0)
  assert.notEqual(cached.id, first.id)
  assert.throws(() => service.getJob(cached.id, 'one'), { status: 404 })
  assert.equal(loads, 1)
  const fresh = await finish(service, await service.start('acme', 'root', null, 'two', { refresh: true }), 'two')
  assert.equal(loads, 2)
  const throttled = await service.start('acme', 'root', null, 'two', { refresh: true })
  assert.equal(throttled.requests, 0)
  assert.match(throttled.message, /刷新间隔/)
  clock += 30000
  await finish(service, await service.start('acme', 'root', null, 'two', { refresh: true }), 'two')
  assert.equal(loads, 3)
  clock += 86400000
  const expired = await service.start('acme', 'root', null, 'three')
  await finish(service, expired, 'three')
  assert.equal(loads, 4)
  assert.throws(() => service.getJob(fresh.id, 'two'), { status: 404 })
  const partial = structuredClone(memory.get('acme/root'))
  partial.warnings = ['部分来源不可用。']
  memory.set('acme/root', partial)
  clock += 299999
  assert.equal((await service.start('acme', 'root', null, 'two')).status, 'partial')
  clock++
  await finish(service, await service.start('acme', 'root', null, 'two'), 'two')
  assert.equal(loads, 5)
})

test('related projects use language fallback only when root has no valid topics; public owned filter is strict', async () => {
  for (const topics of [[], ['rust']]) {
    const api = mockApi({ contributors: [profile('lead', 'User', { contributions: 1 })], repositories: { lead: [repository('lead/plain', { topics: [], language: 'Rust' }), repository('lead/private', { private: true }), repository('foreign/wrong-owner'), repository('lead/unknown-public', { private: undefined })] } })
    const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root', { topics })), now: () => fixedTime })
    const job = await finish(service, await service.start('acme', 'root', null, 'session'))
    assert.deepEqual(job.result.nodes.map((node) => node.id), topics.length ? ['acme/root'] : ['acme/root', 'lead/plain'])
    if (!topics.length) assert.deepEqual(job.result.nodes[1].overlap, { score: 1, shared: [], method: 'language-fallback' })
  }
})

test('cache semantic mismatch triggers bounded fresh analysis and the resulting semantic version is reused', async () => {
  const seedApi = mockApi()
  const seedService = createGraphService({ request: seedApi.request, getDetails: async () => details(repository('acme/root')), now: () => fixedTime })
  const seed = (await finish(seedService, await seedService.start('acme', 'root', null, 'seed'), 'seed')).result
  for (const version of [undefined, 1, '2', 3]) {
    let cached = structuredClone(seed)
    if (version === undefined) delete cached.semanticsVersion
    else cached.semanticsVersion = version
    let loads = 0
    let writes = 0
    const api = mockApi()
    const service = createGraphService({ request: api.request, getDetails: async () => { loads++; return details(repository('acme/root')) }, store: { get: async () => cached, set: async (_key, result) => { writes++; cached = structuredClone(result) } }, now: () => fixedTime })
    const fresh = await finish(service, await service.start('acme', 'root', null, 'one'), 'one')
    assert.equal(loads, 1, `Semantic version ${String(version)} must miss the cache.`)
    assert.equal(writes, 1)
    assert.equal(fresh.result.semanticsVersion, 2)
    assert.ok(fresh.requests > 0 && fresh.requests <= fresh.requestLimit)
    const hit = await service.start('acme', 'root', null, 'two')
    assert.equal(hit.status, 'complete')
    assert.equal(hit.requests, 0)
    assert.equal(hit.result.semanticsVersion, 2)
    assert.equal(loads, 1)
    assert.equal(writes, 1)
  }
})

test('one-level service preserves directional README evidence and conflicting statements after merges', async () => {
  const readme = '## Credits\nThis project is based on [Conflict](https://github.com/fixture/conflict).\n\n## Projects using this library\n- [Conflict](https://github.com/fixture/conflict)\n- [Consumer](https://github.com/fixture/consumer)'
  const conflict = repository('fixture/conflict')
  const consumer = repository('fixture/consumer')
  const api = mockApi({ refs: { 'fixture/conflict': conflict, 'fixture/consumer': consumer } })
  let persisted
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root'), readme), store: { get: async () => undefined, set: async (_key, result) => { persisted = structuredClone(result) } }, now: () => fixedTime })
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.status, 'complete')
  assert.equal(job.result.semanticsVersion, 2)
  const conflictEdge = job.result.edges.find((edge) => edge.target === 'fixture/conflict')
  const consumerEdge = job.result.edges.find((edge) => edge.target === 'fixture/consumer')
  assert.equal(conflictEdge.relation, 'ambiguous')
  assert.deepEqual(new Set(conflictEdge.evidence.map((item) => item.relation)), new Set(['upstream', 'downstream']))
  assert.equal(consumerEdge.relation, 'downstream')
  assert.ok(job.result.edges.every((edge) => edge.source === 'acme/root'))
  for (const edge of job.result.edges) {
    for (const item of edge.evidence) {
      assert.equal(item.targetUrl, `https://github.com/${edge.target}`)
      assert.ok(typeof item.relationReason === 'string' && item.relationReason.length > 0 && item.relationReason.length <= 200)
    }
  }
  assert.deepEqual(persisted, job.result)
  assert.equal(job.result.counts.referencesResolved, 2)
  assert.ok(!api.calls.some((call) => /\/readme|\/repos\/fixture\/[^/]+\/contents\//.test(call.path)))
})

test('repository redirects merge evidence without losing distinct canonical target URLs', async () => {
  const canonical = repository('fixture/renamed')
  const api = mockApi({ refs: { 'fixture/old': canonical, 'fixture/new': canonical } })
  const readme = '## Credits\nThis project is based on [Old](https://github.com/fixture/old) and [New](https://github.com/fixture/new).'
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root'), readme), now: () => fixedTime })
  const job = await finish(service, await service.start('acme', 'root', null, 'session'))
  assert.equal(job.status, 'complete')
  assert.equal(job.result.edges.length, 1)
  const edge = job.result.edges[0]
  assert.equal(edge.target, 'fixture/renamed')
  assert.equal(edge.relation, 'upstream')
  assert.equal(edge.evidence.length, 2)
  assert.deepEqual(new Set(edge.evidence.map((item) => item.targetUrl)), new Set(['https://github.com/fixture/old', 'https://github.com/fixture/new']))
  assert.equal(edge.evidence[0].url, edge.evidence[1].url)
  assert.equal(edge.evidence[0].excerpt, edge.evidence[1].excerpt)
  assert.deepEqual(job.result.nodes.find((node) => node.id === edge.target).evidence, edge.evidence)
})

test('a slow cache write cannot expose a terminal job before done/100% or occupy a worker past its deadline', async () => {
  const gate = deferred()
  const api = mockApi()
  let saving = false
  const service = createGraphService({ request: api.request, getDetails: async () => details(repository('acme/root')), store: { get: async () => undefined, set: async () => { saving = true; await gate.promise } }, limits: { deadlineMs: 60 } })
  const job = await service.start('acme', 'root', null, 'session')
  for (let i = 0; i < 100 && !saving; i++) await delay(1)
  assert.equal(saving, true)
  const before = service.getJob(job.id, 'session')
  assert.equal(before.status, 'running')
  assert.equal(before.phase, 'ranking')
  const completed = await finish(service, job)
  assert.equal(completed.status, 'partial')
  assert.ok(completed.result.warnings.some((value) => value.includes('缓存')))
  gate.resolve()
})

test('never-settling cache writes have a short independent bound and release the queued job worker', async () => {
  const api = mockApi()
  const service = createGraphService({ request: api.request, getDetails: async (owner, repo) => details(repository(`${owner}/${repo}`)), store: { get: async () => undefined, set: () => new Promise(() => {}) }, limits: { concurrency: 1, queue: 1, deadlineMs: 1000, cacheWriteMs: 20 } })
  const first = await service.start('acme', 'a', null, 'session')
  const second = await service.start('acme', 'b', null, 'session')
  assert.equal(second.status, 'queued')
  const a = await finish(service, first)
  const b = await finish(service, second)
  for (const job of [a, b]) {
    assert.equal(job.status, 'partial')
    assert.equal(job.result.nodes[0].id, job.rootFullName)
    assert.ok(job.result.warnings.some((value) => value.includes('缓存')))
  }
})
