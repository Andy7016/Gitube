import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import session from 'express-session'
import { createOAuthConfigStore, validateOAuthConfig } from '../server/oauth-config.mjs'
import { APP_ORIGIN, TOKEN, beginLogin, empty, fixture, json, login, memoryConfigStore, repo } from './helpers.mjs'

const noEnvironment = { GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' }
const appConfig = { clientId: 'existing-app-client', clientSecret: 'existing-app-secret', kind: 'github-app', origin: APP_ORIGIN }
const input = { clientId: 'Ov23li0123456789Abcde', clientSecret: 'a'.repeat(40) }
const oauthConfig = { ...input, kind: 'oauth', origin: APP_ORIGIN }
const granted = (scope = 'read:user,public_repo') => json({ access_token: TOKEN, scope })
const sessionFor = async (client) => (await client.request('/api/session')).json()
const allSessions = (store) => new Promise((resolve, reject) => store.all((error, entries) => error ? reject(error) : resolve(entries)))
const callbackPath = (authorize, extra = {}) => `/api/auth/callback?${new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'synthetic-code', ...extra })}`
const headersFor = (current) => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': current.csrfToken, Origin: APP_ORIGIN })
async function submit(client, value = input, headers = {}) {
  const current = await sessionFor(client)
  return client.request('/api/setup/oauth', { method: 'POST', headers: { ...headersFor(current), ...headers }, body: JSON.stringify(value) })
}
async function candidate(client, value = input) {
  const response = await submit(client, value)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { next: '/api/auth/github' })
  return (await beginLogin(client)).authorize
}
function options(extra = {}) {
  return { env: noEnvironment, configStore: memoryConfigStore(appConfig), oauthConfigStore: memoryConfigStore(), exchange: () => granted(), ...extra }
}

test('OAuth configuration uses a separate exclusive private file and never changes existing App credentials', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'repoflow-oauth-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.local'))
  const appFile = join(root, '.local', 'github-app.json')
  const original = JSON.stringify({ synthetic: 'existing-app-placeholder' })
  await writeFile(appFile, original)
  const store = createOAuthConfigStore(root)
  const competing = createOAuthConfigStore(root)
  assert.equal(store.get(), null)
  await store.save(oauthConfig)
  assert.deepEqual(store.get(), oauthConfig)
  const returned = store.get()
  returned.clientSecret = 'changed copy'
  assert.deepEqual(store.get(), oauthConfig)
  const oauthFile = join(root, '.local', 'github-oauth.json')
  assert.deepEqual(JSON.parse(await readFile(oauthFile, 'utf8')), oauthConfig)
  assert.equal(await readFile(appFile, 'utf8'), original)
  if (process.platform !== 'win32') assert.equal((await stat(oauthFile)).mode & 0o777, 0o600)
  await assert.rejects(store.save({ ...oauthConfig, clientSecret: 'b'.repeat(40) }))
  await assert.rejects(competing.save({ ...oauthConfig, clientSecret: 'c'.repeat(40) }))
  assert.deepEqual(createOAuthConfigStore(root).get(), oauthConfig)
})

test('OAuth config strictly validates field types, size, credential format, kind, and exact origin', async (t) => {
  for (const patch of [
    { clientId: 'short' }, { clientId: 'a'.repeat(65) }, { clientId: 'a'.repeat(19) + '\n' }, { clientId: 123 },
    { clientSecret: 'a'.repeat(31) }, { clientSecret: 'a'.repeat(257) }, { clientSecret: 'x'.repeat(39) + ' ' }, { clientSecret: {} },
    { kind: 'github-app' }, { origin: APP_ORIGIN + '/' }, { origin: 'ftp://localhost' }, { origin: 'http://name:secret@localhost' },
    { origin: 'invalid' }, { origin: 'a'.repeat(2049) }, { unexpected: 'field' },
  ]) assert.throws(() => validateOAuthConfig({ ...oauthConfig, ...patch }))
  for (const value of [null, [], 'text']) assert.throws(() => validateOAuthConfig(value))
  assert.deepEqual(validateOAuthConfig(oauthConfig), oauthConfig)
  const root = await mkdtemp(join(tmpdir(), 'repoflow-oauth-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createOAuthConfigStore(root)
  await assert.rejects(store.save({ ...oauthConfig, clientSecret: 'invalid' }))
  await assert.rejects(readFile(join(root, '.local', 'github-oauth.json')), { code: 'ENOENT' })
  await mkdir(join(root, '.local'))
  await writeFile(join(root, '.local', 'github-oauth.json'), 'x'.repeat(4097))
  assert.throws(() => createOAuthConfigStore(root), { message: '无法读取服务端 OAuth 连接信息。' })
})

test('local OAuth guide renders safe addresses, first-time registration, scope disclosure, CSP, and theme support', async (t) => {
  const client = await fixture(t, options())
  const response = await client.request('/api/setup/oauth')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const csp = response.headers.get('content-security-policy')
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /connect-src 'self'/)
  assert.match(csp, /frame-ancestors 'none'/)
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1]
  const html = await response.text()
  assert.ok(nonce)
  for (const script of html.matchAll(/<script([^>]*)>/g)) assert.ok(script[1].includes(`nonce="${nonce}"`))
  assert.ok(html.includes('https://github.com/settings/applications/new'))
  assert.ok(html.includes(`value="${APP_ORIGIN}"`))
  assert.ok(html.includes(`value="${APP_ORIGIN}/api/auth/callback"`))
  for (const text of ['readonly', 'public_repo', '公开仓库写权限', '不申请私有仓库权限', 'gitube:theme', 'prefers-color-scheme:dark', 'oauth-connection-form']) assert.ok(html.includes(text))
  assert.equal(html.includes(appConfig.clientSecret), false)
  assert.equal(html.includes(appConfig.clientId), false)
  assert.equal(client.calls.length, 0)
})

test('OAuth candidate is server-side only until verified identity and actual public Star grant, then session rotates', async (t) => {
  const appStore = memoryConfigStore(appConfig)
  const oauthStore = memoryConfigStore()
  const sessionStore = new session.MemoryStore()
  const client = await fixture(t, options({ configStore: appStore, oauthConfigStore: oauthStore, sessionStore }))
  const guest = await sessionFor(client)
  const oldCookie = client.cookie
  const prepared = await submit(client)
  assert.equal(prepared.status, 200)
  const preparedText = await prepared.text()
  assert.deepEqual(JSON.parse(preparedText), { next: '/api/auth/github' })
  assert.equal(preparedText.includes(input.clientSecret), false)
  assert.equal(oauthStore.saves.length, 0)
  const { authorize } = await beginLogin(client)
  assert.equal(authorize.searchParams.get('client_id'), input.clientId)
  assert.equal(authorize.searchParams.get('scope'), 'read:user public_repo')
  assert.equal(authorize.searchParams.get('redirect_uri'), `${APP_ORIGIN}/api/auth/callback`)
  assert.equal(authorize.searchParams.has('client_secret'), false)
  assert.equal(oauthStore.saves.length, 0)
  const pending = Object.values(await allSessions(sessionStore))[0]
  assert.equal(pending.oauthCandidate, undefined)
  assert.equal(pending.oauth.config.clientSecret, input.clientSecret)
  const callback = await client.request(callbackPath(authorize))
  assert.equal(callback.headers.get('location'), '/')
  assert.notEqual(client.cookie, oldCookie)
  assert.deepEqual(oauthStore.saves, [oauthConfig])
  assert.deepEqual(appStore.get(), appConfig)
  assert.equal(appStore.saves.length, 0)
  const exchange = JSON.parse(client.calls[0].init.body)
  assert.equal(exchange.client_id, input.clientId)
  assert.equal(exchange.client_secret, input.clientSecret)
  assert.equal(createHash('sha256').update(exchange.code_verifier).digest('base64url'), authorize.searchParams.get('code_challenge'))
  const current = await sessionFor(client)
  assert.equal(current.user.login, 'octocat')
  assert.notEqual(current.csrfToken, guest.csrfToken)
  assert.deepEqual(Object.keys(current).sort(), ['csrfToken', 'oauthConfigured', 'user'])
  const authenticated = Object.values(await allSessions(sessionStore))[0]
  assert.equal(authenticated.authKind, 'oauth')
  assert.equal(authenticated.oauth, undefined)
  assert.equal(authenticated.oauthCandidate, undefined)
  assert.equal(JSON.stringify(authenticated).includes(input.clientSecret), false)
  assert.equal((await (await client.request('/api/session', { headers: { Cookie: oldCookie } })).json()).user, null)
  const restored = await fixture(t, options({ configStore: appStore, oauthConfigStore: oauthStore }))
  const subsequent = (await beginLogin(restored)).authorize
  assert.equal(subsequent.searchParams.get('client_id'), input.clientId)
  assert.equal(subsequent.searchParams.get('scope'), 'read:user public_repo')
})

test('candidate state is session-bound, single-use, expired, and never saves rejected attempts', async (t) => {
  for (const mode of ['mismatch', 'other browser', 'expired', 'denied', 'missing code']) await t.test(mode, async (t) => {
    const oauthStore = memoryConfigStore()
    const sessionStore = new session.MemoryStore()
    const client = await fixture(t, options({ oauthConfigStore: oauthStore, sessionStore }))
    const authorize = await candidate(client)
    let target = client
    if (mode === 'other browser') target = await fixture(t, options({ oauthConfigStore: oauthStore }))
    if (mode === 'expired') {
      const later = Date.now() + 11 * 60 * 1000
      t.mock.method(Date, 'now', () => later)
    }
    const path = mode === 'missing code' ? `/api/auth/callback?state=${authorize.searchParams.get('state')}`
      : callbackPath(authorize, mode === 'mismatch' ? { state: 'wrong' } : mode === 'denied' ? { error: 'access_denied' } : {})
    const response = await target.request(path)
    assert.equal(response.headers.get('location'), `/?auth_error=${mode === 'denied' ? 'access_denied' : mode === 'missing code' ? 'missing_code' : 'invalid_state'}`)
    assert.equal(target.calls.length, 0)
    assert.equal(oauthStore.saves.length, 0)
    if (mode !== 'other browser') {
      assert.equal((await client.request(callbackPath(authorize))).headers.get('location'), '/?auth_error=invalid_state')
      const persisted = Object.values(await allSessions(sessionStore))[0]
      assert.equal(persisted.oauth, undefined)
      assert.equal(persisted.oauthCandidate, undefined)
      assert.equal(JSON.stringify(persisted).includes(input.clientSecret), false)
    }
  })
})

test('candidate expires and is consumed before a later login can select it again', async (t) => {
  const client = await fixture(t, options())
  assert.equal((await submit(client)).status, 200)
  const later = Date.now() + 11 * 60 * 1000
  t.mock.method(Date, 'now', () => later)
  const expired = (await beginLogin(client)).authorize
  assert.equal(expired.searchParams.get('client_id'), appConfig.clientId)
  assert.equal(expired.searchParams.has('scope'), false)
  t.mock.restoreAll()
  const first = await candidate(client)
  const second = (await beginLogin(client)).authorize
  assert.equal(second.searchParams.get('client_id'), appConfig.clientId)
  assert.equal((await client.request(callbackPath(first))).headers.get('location'), '/?auth_error=invalid_state')
})

test('failed candidate exchange, missing or insufficient grant, and invalid identity never persist and permit refilling', async (t) => {
  for (const scenario of [
    { name: 'bad credentials', exchange: () => json({ error: 'bad_client_secret', detail: input.clientSecret }), error: 'exchange_rejected', calls: 1 },
    { name: 'transport', exchange: () => { throw new Error(input.clientSecret) }, error: 'exchange_connection', calls: 1 },
    { name: 'missing scope', exchange: () => json({ access_token: TOKEN }), error: 'exchange_insufficient_scope', calls: 1 },
    { name: 'insufficient scope', exchange: () => granted('read:user'), error: 'exchange_insufficient_scope', calls: 1 },
    { name: 'lookalike scope', exchange: () => granted('read:user,public_repo_extra'), error: 'exchange_insufficient_scope', calls: 1 },
    { name: 'non-string scope', exchange: () => granted(['public_repo']), error: 'exchange_insufficient_scope', calls: 1 },
    { name: 'invalid identity', identity: () => json({ login: 'not valid', detail: input.clientSecret }), error: 'identity_invalid_response', calls: 2 },
    { name: 'identity denied', identity: () => json({ detail: input.clientSecret }, 403), error: 'identity_forbidden', calls: 2 },
  ]) await t.test(scenario.name, async (t) => {
    const oauthStore = memoryConfigStore()
    const sessionStore = new session.MemoryStore()
    const client = await fixture(t, options({ ...scenario, oauthConfigStore: oauthStore, sessionStore }))
    const authorize = await candidate(client)
    const response = await client.request(callbackPath(authorize))
    assert.equal(response.headers.get('location'), `/?auth_error=${scenario.error}`)
    assert.equal(client.calls.length, scenario.calls)
    assert.equal(oauthStore.saves.length, 0)
    assert.equal((await sessionFor(client)).user, null)
    const persisted = Object.values(await allSessions(sessionStore))[0]
    assert.equal(persisted.oauth, undefined)
    assert.equal(persisted.oauthCandidate, undefined)
    const serialized = JSON.stringify({ headers: [...response.headers], body: await response.text(), diagnostics: client.authDiagnostics, persisted })
    for (const secret of [input.clientSecret, TOKEN, 'synthetic-code']) assert.equal(serialized.includes(secret), false)
    assert.equal((await submit(client, { ...input, clientSecret: 'b'.repeat(40) })).status, 200, 'a rejected setup does not lock the configuration')
  })
})

test('normalized public_repo and broader previously granted repo scopes are accepted without requesting repo', async (t) => {
  for (const scope of ['read:user, public_repo', 'read:user public_repo', 'public_repo', 'repo']) await t.test(scope, async (t) => {
    const oauthStore = memoryConfigStore()
    const client = await fixture(t, options({ oauthConfigStore: oauthStore, exchange: () => granted(scope) }))
    const authorize = await candidate(client)
    assert.equal(authorize.searchParams.get('scope'), 'read:user public_repo')
    assert.equal((await client.request(callbackPath(authorize))).headers.get('location'), '/')
    assert.deepEqual(oauthStore.saves, [oauthConfig])
  })
})

test('setup restrictions reject production, remote origins, wrong Host, cross-site entry and invalid CSRF', async (t) => {
  for (const scenario of [
    { name: 'production', env: { ...noEnvironment, NODE_ENV: 'production', APP_URL: 'https://127.0.0.1:5173' } },
    { name: 'remote origin', env: { ...noEnvironment, APP_URL: 'http://public.example' } },
    { name: 'remote Host', host: 'public.example' },
    { name: 'cross-site', headers: { 'Sec-Fetch-Site': 'cross-site' } },
    { name: 'different Origin', headers: { Origin: 'https://public.example' } },
  ]) await t.test(scenario.name, async (t) => {
    const oauthStore = memoryConfigStore()
    const client = await fixture(t, options({ oauthConfigStore: oauthStore, ...(scenario.env ? { env: scenario.env } : {}) }))
    const response = scenario.host ? await client.requestHost('/api/setup/oauth', scenario.host) : await client.request('/api/setup/oauth', { headers: scenario.headers })
    assert.equal(response.status, 403)
    if (!scenario.host) assert.equal((await submit(client, input, scenario.headers)).status, 403)
    assert.equal(oauthStore.saves.length, 0)
    assert.equal(client.calls.length, 0)
  })
  const client = await fixture(t, options())
  for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'wrong' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'null' }]) {
    const response = await submit(client, input, headers)
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'CSRF_INVALID')
  }
  const authorize = (await beginLogin(client)).authorize
  assert.equal(authorize.searchParams.get('client_id'), appConfig.clientId)
})

test('setup JSON cannot inject origin, scopes, redirect, tokens, or secret response fields', async (t) => {
  const client = await fixture(t, options())
  for (const value of [null, [], {}, { ...input, origin: APP_ORIGIN }, { ...input, scope: 'repo' }, { ...input, next: 'https://untrusted.example' }, { ...input, token: TOKEN }, { ...input, clientId: '<script>bad</script>' }, { ...input, clientSecret: 'short' }]) {
    const response = await submit(client, value)
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.code, value === null ? 'INVALID_JSON' : 'INVALID_OAUTH_CONFIG')
    assert.equal(JSON.stringify(body).includes(input.clientSecret), false)
  }
  const current = await sessionFor(client)
  const malformed = await client.request('/api/setup/oauth', { method: 'POST', headers: headersFor(current), body: `{"clientSecret":"${input.clientSecret}" invalid}` })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: '请求内容必须是有效 JSON。', code: 'INVALID_JSON' })
  const nonJson = await client.request('/api/setup/oauth', { method: 'POST', headers: { ...headersFor(current), 'Content-Type': 'text/plain' }, body: input.clientSecret })
  assert.equal(nonJson.status, 400)
  assert.equal(client.calls.length, 0)
})

test('existing OAuth configuration cannot be overwritten and exact origin and explicit environment take priority', async (t) => {
  const oauthStore = memoryConfigStore(oauthConfig)
  const client = await fixture(t, options({ oauthConfigStore: oauthStore }))
  const html = await (await client.request('/api/setup/oauth')).text()
  assert.ok(html.includes('id="oauth-reauthorize"'))
  assert.equal(html.includes('id="oauth-connection-form"'), false)
  assert.equal(html.includes(input.clientSecret), false)
  const response = await submit(client, { ...input, clientSecret: 'b'.repeat(40) })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'OAUTH_CONFIG_EXISTS')
  assert.equal(oauthStore.saves.length, 0)
  const mismatch = await fixture(t, options({ oauthConfigStore: memoryConfigStore({ ...oauthConfig, origin: 'http://localhost:5173' }) }))
  for (const response of [await mismatch.request('/api/setup/oauth'), await submit(mismatch)]) {
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'SETUP_ORIGIN_CHANGED')
  }
  for (const kind of ['oauth', 'github-app']) await t.test(`explicit ${kind}`, async (t) => {
    const envClient = await fixture(t, options({ env: { GITHUB_APP_TYPE: kind }, oauthConfigStore: oauthStore }))
    const authorize = (await beginLogin(envClient)).authorize
    assert.equal(authorize.searchParams.get('client_id'), 'test-client')
    assert.equal(authorize.searchParams.has('scope'), kind === 'oauth')
    const html = await (await envClient.request('/api/setup/oauth')).text()
    assert.equal(html.includes('id="oauth-connection-form"'), false)
    assert.ok(html.includes(kind === 'oauth' ? 'id="oauth-reauthorize"' : 'id="oauth-managed"'))
    assert.equal((await submit(envClient)).status, 409)
    assert.equal(oauthStore.saves.length, 0)
  })
})

test('an App attempt keeps its original credentials and kind when another browser enables OAuth', async (t) => {
  const oauthStore = memoryConfigStore()
  const exchanged = []
  const sessionStore = new session.MemoryStore()
  const client = await fixture(t, options({ oauthConfigStore: oauthStore, sessionStore, exchange: ({ init }) => { exchanged.push(JSON.parse(init.body)); return granted() } }))
  const appAttempt = (await beginLogin(client)).authorize
  const other = await fixture(t, options({ oauthConfigStore: oauthStore }))
  const oauthAttempt = await candidate(other)
  assert.equal((await other.request(callbackPath(oauthAttempt))).headers.get('location'), '/')
  assert.equal((await client.request(callbackPath(appAttempt))).headers.get('location'), '/')
  assert.equal(exchanged[0].client_id, appConfig.clientId)
  assert.equal(exchanged[0].client_secret, appConfig.clientSecret)
  assert.equal(Object.values(await allSessions(sessionStore))[0].authKind, 'github-app')
})

test('configuration persistence failures discard old authentication and candidate without leaking or implicit retries', async (t) => {
  const sessionStore = new session.MemoryStore()
  let writes = 0
  const oauthStore = { get: () => null, save: async () => { writes++; throw new Error(`private path secret ${input.clientSecret}`) } }
  const client = await fixture(t, options({ oauthConfigStore: oauthStore, sessionStore }))
  await login(client)
  const oldCookie = client.cookie
  const authorize = await candidate(client)
  const response = await client.request(callbackPath(authorize))
  assert.equal(response.headers.get('location'), '/?auth_error=oauth_configuration_failed')
  assert.match(response.headers.get('set-cookie'), /repoflow\.sid=;/)
  assert.equal(writes, 1)
  assert.deepEqual(client.authDiagnostics, [{ stage: 'configuration', kind: 'storage' }])
  assert.equal(Object.values(await allSessions(sessionStore)).some((value) => value.user || value.token || value.oauth || value.oauthCandidate), false)
  assert.equal((await sessionFor(client)).user, null)
  assert.equal((await (await client.request('/api/session', { headers: { Cookie: oldCookie } })).json()).user, null)
  const serialized = JSON.stringify({ headers: [...response.headers], body: await response.text(), diagnostics: client.authDiagnostics })
  for (const secret of [TOKEN, input.clientSecret, 'private path']) assert.equal(serialized.includes(secret), false)
})

test('another successful candidate cannot be overwritten by an already pending callback', async (t) => {
  const oauthStore = memoryConfigStore()
  const first = await fixture(t, options({ oauthConfigStore: oauthStore }))
  const second = await fixture(t, options({ oauthConfigStore: oauthStore }))
  const firstAttempt = await candidate(first)
  const secondAttempt = await candidate(second, { ...input, clientSecret: 'b'.repeat(40) })
  assert.equal((await first.request(callbackPath(firstAttempt))).headers.get('location'), '/')
  assert.equal((await second.request(callbackPath(secondAttempt))).headers.get('location'), '/?auth_error=oauth_configuration_failed')
  assert.deepEqual(oauthStore.saves, [oauthConfig])
  assert.equal((await sessionFor(second)).user, null)
})

test('only actionable local App Star denials request OAuth; OAuth and managed or remote App failures remain truthful', async (t) => {
  for (const mode of ['local App', 'legacy App', 'OAuth', 'managed App', 'remote App']) await t.test(mode, async (t) => {
    const sessionStore = new session.MemoryStore()
    const env = mode === 'managed App' ? { GITHUB_APP_TYPE: 'github-app' }
      : mode === 'remote App' ? { ...noEnvironment, APP_URL: 'http://public.example' } : noEnvironment
    const client = await fixture(t, options({ env, sessionStore, ...(mode === 'OAuth' ? { oauthConfigStore: memoryConfigStore(oauthConfig) } : {}),
      ...(mode === 'remote App' ? { configStore: memoryConfigStore({ ...appConfig, origin: 'http://public.example' }) } : {}),
      upstream: ({ url }) => url.pathname === '/graphql' ? json({ errors: [{ type: 'FORBIDDEN', message: input.clientSecret }] }) : empty(403),
    }))
    const current = await login(client)
    if (mode === 'legacy App') {
      const entries = await allSessions(sessionStore)
      const [id, value] = Object.entries(entries)[0]
      delete value.authKind
      await new Promise((resolve, reject) => sessionStore.set(id, value, (error) => error ? reject(error) : resolve()))
    }
    for (const method of ['PUT', 'DELETE']) {
      const response = await client.request('/api/starred/sample/demo', { method, headers: { 'X-CSRF-Token': current.csrfToken } })
      assert.equal(response.status, 403)
      const body = await response.json()
      assert.equal(body.code, ['local App', 'legacy App'].includes(mode) ? 'STAR_OAUTH_REQUIRED' : 'STAR_PERMISSION_REQUIRED')
      assert.equal(JSON.stringify(body).includes(input.clientSecret), false)
      assert.equal((await sessionFor(client)).user.login, 'octocat')
    }
    assert.equal(Object.keys(Object.values(await allSessions(sessionStore))[0].starCache).length, 0)
  })
})

test('OAuth-required App failures preserve cached Star state and recommendation profile', async (t) => {
  let profileReads = 0, starReads = 0
  const client = await fixture(t, options({ upstream: ({ url, init }) => {
    if (url.pathname === '/search/repositories') return json({ total_count: 1, items: [repo(1, 'demo')] })
    if (url.pathname === '/user/starred') { profileReads++; return json([]) }
    if (url.pathname === '/users/octocat/repos') return json([])
    if (url.pathname === '/graphql') return json({ errors: [{ type: 'FORBIDDEN' }] })
    if (init.method === 'PUT') return empty(403)
    starReads++
    return empty(404)
  } }))
  const current = await login(client)
  const feed = async () => (await (await client.request('/api/feed?topics=web')).json()).items[0].viewer_starred
  const profile = async () => (await (await client.request('/api/recommendation-profile')).json()).counts.starred
  assert.equal(await feed(), false)
  assert.equal(await profile(), 0)
  const response = await client.request('/api/starred/sample/demo', { method: 'PUT', headers: { 'X-CSRF-Token': current.csrfToken } })
  assert.equal((await response.json()).code, 'STAR_OAUTH_REQUIRED')
  assert.equal(await feed(), false)
  assert.equal(await profile(), 0)
  assert.equal(profileReads, 1)
  assert.equal(starReads, 1)
})
