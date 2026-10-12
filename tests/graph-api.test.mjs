import test from 'node:test'
import assert from 'node:assert/strict'
import { APP_ORIGIN, TOKEN, json, repo, fixture, login } from './helpers.mjs'

const terminal = new Set(['complete', 'partial', 'failed'])
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const file = (content, path, fullName = 'sample/root') => ({
  encoding: 'base64', content: Buffer.from(content).toString('base64'), path,
  html_url: `https://github.com/${fullName}/blob/main/${path}`,
  download_url: `https://untrusted.example/${path}`,
})
const metadata = (id, fullName, extra = {}) => {
  const [owner, name] = fullName.split('/')
  return repo(id, name, { full_name: fullName, html_url: `https://github.com/${fullName}`,
    private: false, default_branch: 'main', owner: { login: owner, type: 'User', avatar_url: `https://avatars.example/${owner}` }, ...extra })
}
const repositories = {
  'sample/root': metadata(1, 'sample/root', { topics: ['web', 'graph'], owner: { login: 'sample', type: 'Organization', avatar_url: 'https://avatars.example/sample' } }),
  'devone/alpha': metadata(2, 'devone/alpha', { topics: ['web', 'graph'], stargazers_count: 800, viewer_starred: true, permissions: { admin: true } }),
  'lib/beta': metadata(3, 'lib/beta', { topics: ['web'], stargazers_count: 300 }),
  'lib/html': metadata(4, 'lib/html', { topics: ['graph'], stargazers_count: 200 }),
  'lib/manifest': metadata(5, 'lib/manifest', { topics: ['graph'], stargazers_count: 100 }),
  'lib/private': metadata(6, 'lib/private', { private: true, description: 'PRIVATE_SOURCE_SECRET' }),
  'devone/related': metadata(7, 'devone/related', { topics: ['web'], stargazers_count: 50 }),
  'devone/unrelated': metadata(8, 'devone/unrelated', { topics: ['music'] }),
  'devone/fork': metadata(9, 'devone/fork', { topics: ['web'], fork: true }),
  'devone/archived': metadata(10, 'devone/archived', { topics: ['web'], archived: true }),
  'devone/private': metadata(11, 'devone/private', { topics: ['web'], private: true, description: 'PRIVATE_SOURCE_SECRET' }),
}
const README = `# Root\n\n## Credits\n\nInspired by [alpha](https://github.com/devone/alpha), [beta][beta] and <a href="https://github.com/lib/html">HTML source</a>.\n\n[beta]: https://github.com/lib/beta\n\n## Maintainers\n\nMaintainer: [@devone](https://github.com/devone)\n\n## Links\n\n[Self](https://github.com/sample/root) [Navigation](https://github.com/issues) [External](https://untrusted.example/secret)\n`

function publicUpstream({ gate, failRoot, failReadme } = {}) {
  return async ({ url, init }) => {
    assert.equal(url.origin, 'https://api.github.com', 'collector only uses the fixed GitHub API origin')
    assert.ok(!url.searchParams.has('access_token'), 'tokens must remain in headers')
    const path = decodeURIComponent(url.pathname)
    if (path === '/repos/sample/root') {
      if (gate) await gate.promise
      if (failRoot) return failRoot()
    }
    if (path === '/repos/sample/root/readme') return failReadme ? failReadme() : json(file(README, 'README.md'))
    if (/^\/repos\/[^/]+\/[^/]+\/readme$/.test(path)) assert.fail(`automatic collection cannot recurse into ${path}`)
    if (path === '/repos/sample/root/contributors') return json([
      { login: 'devone', type: 'User', contributions: 100, avatar_url: 'https://avatars.example/devone', html_url: 'https://github.com/devone' },
      { login: 'dependabot[bot]', type: 'Bot', contributions: 900 },
    ])
    if (path.startsWith('/repos/sample/root/contents/')) {
      assert.equal(url.searchParams.get('ref'), 'main', 'files are pinned to the verified default branch')
      const name = path.slice('/repos/sample/root/contents/'.length)
      if (name === '.github/CODEOWNERS') return json(file('* @devone @sample/team contact@example.com\n', name))
      if (name === 'package.json') return json(file(JSON.stringify({ dependencies: { source: 'github:lib/manifest', ordinary: '^1.0.0' } }), name))
      assert.ok(['CODEOWNERS', 'docs/CODEOWNERS', 'pyproject.toml', 'requirements.txt', 'Cargo.toml'].includes(name), `only declared files may be read: ${name}`)
      return json({}, 404)
    }
    if (path === '/users/devone/repos') {
      assert.equal(url.searchParams.get('per_page'), '100')
      assert.equal(url.searchParams.get('type'), 'owner')
      return json(Object.entries(repositories).filter(([name]) => name.startsWith('devone/')).map(([, value]) => value))
    }
    if (path === '/users/devone') return json({ login: 'devone', type: 'User', avatar_url: 'https://avatars.example/devone', html_url: 'https://github.com/devone' })
    if (path === '/users/sample') return json({ login: 'sample', type: 'Organization', avatar_url: 'https://avatars.example/sample', html_url: 'https://github.com/sample' })
    const fullName = path.match(/^\/repos\/([^/]+\/[^/]+)$/)?.[1]
    if (fullName && repositories[fullName]) return json(repositories[fullName])
    assert.fail(`Unexpected graph upstream request: ${init.method ?? 'GET'} ${url.href}`)
  }
}

async function sessionFor(client, headers) {
  const response = await client.request('/api/session', { headers })
  assert.equal(response.status, 200)
  return response.json()
}
async function start(client, session, { path = '/api/graph/sample/root', body = {}, headers = {} } = {}) {
  return client.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, Origin: APP_ORIGIN, ...headers }, body: JSON.stringify(body) })
}
async function poll(client, initial, headers = {}) {
  let job = initial
  for (let attempt = 0; attempt < 100; attempt++) {
    if (terminal.has(job.status)) return job
    await pause(10)
    const response = await client.request(`/api/graph/jobs/${job.id}`, { headers })
    assert.ok([200, 202].includes(response.status))
    job = await response.json()
  }
  assert.fail(`graph job ${initial.id} did not finish within 100 polls`)
}
function publicDto(job, client) {
  assert.deepEqual(Object.keys(job).sort(), ['error', 'id', 'message', 'phase', 'progress', 'requestLimit', 'requests', 'result', 'rootFullName', 'status', 'updatedAt'])
  assert.ok(job.progress >= 0 && job.progress <= 100)
  assert.ok(job.requests <= job.requestLimit && job.requestLimit <= 40)
  const serialized = JSON.stringify(job)
  for (const secret of [TOKEN, client.cookie, 'PRIVATE_SOURCE_SECRET', 'private upstream password', 'test-client-secret']) assert.equal(serialized.includes(secret), false)
  for (const node of job.result?.nodes ?? []) {
    assert.equal('viewer_starred' in node.repo, false)
    assert.equal('permissions' in node.repo, false)
    assert.equal(node.id, node.repo.full_name.toLowerCase())
  }
}

test('graph creation requires the guest session CSRF and trusted origin before contacting GitHub', async (t) => {
  const client = await fixture(t, { upstream: publicUpstream() })
  const session = await sessionFor(client)
  assert.equal(session.user, null)
  for (const headers of [{}, { 'X-CSRF-Token': 'invalid' }, { 'X-CSRF-Token': session.csrfToken, Origin: 'https://untrusted.example' }, { 'X-CSRF-Token': session.csrfToken, Origin: 'null' }]) {
    const response = await client.request('/api/graph/sample/root', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'CSRF_INVALID')
  }
  assert.equal(client.calls.length, 0)
})

test('guest graph API runs the actual public collector, preserves evidence and excludes recursion/private viewer data', async (t) => {
  const client = await fixture(t, { upstream: publicUpstream() })
  const response = await start(client, await sessionFor(client))
  assert.equal(response.status, 202)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const initial = await response.json()
  publicDto(initial, client)
  const job = await poll(client, initial)
  assert.equal(job.status, 'complete')
  assert.equal(job.phase, 'done')
  assert.equal(job.progress, 100)
  publicDto(job, client)
  const result = job.result
  assert.equal(result.version, 1)
  assert.equal(result.root, 'sample/root')
  assert.ok(Number.isFinite(Date.parse(result.generatedAt)))
  assert.deepEqual(result.nodes.map((node) => node.id), ['sample/root', 'devone/alpha', 'lib/beta', 'lib/html', 'lib/manifest', 'devone/related'])
  assert.deepEqual(result.nodes.map((node) => node.tier), [0, 1, 1, 1, 1, 2])
  assert.equal(result.nodes[1].overlap.score, 1)
  assert.deepEqual(result.nodes[1].overlap.shared.sort(), ['graph', 'web'])
  assert.equal(result.nodes[1].overlap.method, 'topics')
  assert.ok(result.edges.some((edge) => edge.source === 'sample/root' && edge.target === 'devone/alpha' && edge.kind === 'direct'))
  assert.ok(result.edges.some((edge) => edge.target === 'devone/related' && edge.kind === 'related'))
  assert.ok(result.nodes.find((node) => node.id === 'lib/manifest').evidence.some((item) => item.kind === 'dependency'))
  const person = result.people.find((entry) => entry.login === 'devone')
  assert.ok(person)
  assert.ok(person.roles.includes('contributor'))
  assert.ok(person.roles.includes('codeowner'))
  assert.ok(person.evidence.some((entry) => entry.kind === 'contributor'))
  assert.ok(person.evidence.some((entry) => entry.kind === 'codeowner'))
  assert.equal(result.people.some((entry) => /bot|team|@/.test(entry.login)), false)
  assert.equal(new Set(result.nodes.map((node) => node.id)).size, result.nodes.length)
  assert.ok(result.counts.referencesFound >= 4)
  assert.ok(result.counts.peopleScanned >= 1)
  assert.ok(result.counts.candidatesScanned >= 5)
  assert.ok(result.limits.requests <= 40)
  assert.ok(client.calls.some(({ url }) => url.pathname === '/repos/sample/root/readme'))
  assert.equal(client.calls.some(({ url }) => url.pathname.includes('private/contents')), false)
  assert.ok(client.calls.every(({ init }) => init.headers.Authorization === undefined))
})

test('graph API coalesces active jobs within the session and reuses completed public cache without new requests', async (t) => {
  let release
  const gate = { promise: new Promise((resolve) => { release = resolve }) }
  const client = await fixture(t, { upstream: publicUpstream({ gate }) })
  const session = await sessionFor(client)
  const firstResponse = await start(client, session)
  assert.equal(firstResponse.status, 202)
  const first = await firstResponse.json()
  const repeated = await start(client, session)
  assert.equal(repeated.status, 202)
  assert.equal((await repeated.json()).id, first.id)
  release()
  const complete = await poll(client, first)
  assert.equal(complete.status, 'complete')
  const count = client.calls.length
  const cachedResponse = await start(client, session)
  assert.equal(cachedResponse.status, 200)
  const cached = await cachedResponse.json()
  assert.equal(cached.status, 'complete')
  assert.deepEqual(cached.result, complete.result)
  assert.equal(client.calls.length, count)
  publicDto(cached, client)
})

test('graph jobs are unreadable from another guest session and unknown ids return 404', async (t) => {
  const client = await fixture(t, { upstream: publicUpstream() })
  const session = await sessionFor(client)
  const creatorCookie = client.cookie
  const initial = await (await start(client, session)).json()
  await poll(client, initial)
  const otherSession = await sessionFor(client, { Cookie: '' })
  assert.notEqual(client.cookie, creatorCookie)
  for (const id of [initial.id, 'unknown-graph-job']) {
    const response = await client.request(`/api/graph/jobs/${id}`)
    assert.equal(response.status, 404)
    assert.equal((await response.json()).code, 'GRAPH_JOB_NOT_FOUND')
  }
  const before = client.calls.length
  const publicCache = await start(client, otherSession)
  assert.equal(publicCache.status, 200, 'public graph cache is reusable without sharing the creator job')
  const ownJob = await publicCache.json()
  assert.notEqual(ownJob.id, initial.id)
  assert.equal(ownJob.result.root, 'sample/root')
  assert.equal(client.calls.length, before)
  publicDto(ownJob, client)
  const creatorRead = await client.request(`/api/graph/jobs/${initial.id}`, { headers: { Cookie: creatorCookie } })
  assert.equal(creatorRead.status, 200)
  assert.equal((await creatorRead.json()).rootFullName.toLowerCase(), 'sample/root')
})

test('graph refuses private roots before reading any source and exposes only a safe failed job', async (t) => {
  const client = await fixture(t, { upstream: publicUpstream({ failRoot: () => json(metadata(1, 'sample/root', { private: true, description: 'PRIVATE_SOURCE_SECRET' })) }) })
  const initial = await (await start(client, await sessionFor(client))).json()
  const job = await poll(client, initial)
  assert.equal(job.status, 'failed')
  assert.equal(job.error.code, 'PRIVATE_REPOSITORY')
  assert.equal(job.result, null)
  publicDto(job, client)
  assert.deepEqual(client.calls.map(({ url }) => url.pathname), ['/repos/sample/root'])
})

test('a public README source failure keeps confirmed graph data with safe partial coverage warnings', async (t) => {
  const client = await fixture(t, { upstream: publicUpstream({ failReadme: () => { throw new Error('private upstream password') } }) })
  const initial = await (await start(client, await sessionFor(client))).json()
  const job = await poll(client, initial)
  assert.equal(job.status, 'partial')
  assert.ok(job.result.nodes.some((node) => node.id === 'sample/root'))
  assert.ok(job.result.nodes.some((node) => node.id === 'lib/manifest'))
  assert.ok(job.result.warnings.length > 0, 'partial results disclose missing source coverage')
  publicDto(job, client)
})

test('an asynchronous GitHub 401 is returned safely and clears the creator login session', async (t) => {
  const client = await fixture(t, { upstream: publicUpstream({ failRoot: () => json({ message: 'private upstream password' }, 401) }) })
  const session = await login(client)
  const response = await start(client, session)
  assert.equal(response.status, 202)
  const initial = await response.json()
  let expired
  for (let attempt = 0; attempt < 100; attempt++) {
    await pause(10)
    const read = await client.request(`/api/graph/jobs/${initial.id}`)
    if (read.status === 401) { expired = await read.text(); break }
    assert.ok([200, 202].includes(read.status))
    assert.equal(terminal.has((await read.json()).status), false, 'failed SESSION_EXPIRED job must use the API 401 handler')
  }
  assert.ok(expired, '401 must be observable within bounded job polling')
  assert.equal(JSON.parse(expired).code, 'SESSION_EXPIRED')
  assert.equal(expired.includes(TOKEN), false)
  assert.equal(expired.includes('private upstream password'), false)
  assert.equal((await sessionFor(client)).user, null)
  const rootCalls = client.calls.filter(({ url }) => url.pathname === '/repos/sample/root')
  assert.equal(rootCalls.length, 1, '401 must never trigger an anonymous retry')
  assert.equal(rootCalls[0].init.headers.Authorization, `Bearer ${TOKEN}`)
})

test('graph validates repository paths and refresh JSON before any GitHub work', async (t) => {
  const client = await fixture(t, { upstream: publicUpstream() })
  const session = await sessionFor(client)
  for (const options of [
    { path: '/api/graph/bad%20owner/root' },
    { path: '/api/graph/sample/bad%20repo' },
    { path: '/api/graph/sample/a%2Fb' },
    { body: { refresh: 'true' } },
    { body: { refresh: 1 } },
    { body: { refresh: null } },
    { body: [] },
    { body: { refresh: false, token: 'PRIVATE_SOURCE_SECRET' } },
  ]) {
    const response = await start(client, session, options)
    assert.equal(response.status, 400, JSON.stringify(options))
    assert.ok(['INVALID_REPO', 'INVALID_QUERY', 'INVALID_GRAPH_REQUEST'].includes((await response.json()).code))
  }
  assert.equal(client.calls.length, 0)
  const valid = await start(client, session, { body: { refresh: false } })
  assert.equal(valid.status, 202, 'a literal boolean false is valid')
  assert.equal((await poll(client, await valid.json())).status, 'complete')
})
