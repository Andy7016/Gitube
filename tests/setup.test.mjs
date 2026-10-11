import test from 'node:test'
import assert from 'node:assert/strict'
import { APP_ORIGIN, json, fixture, memoryConfigStore } from './helpers.mjs'

const unconfigured = { GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' }
const converted = { client_id: 'manifest-client-id', client_secret: 'manifest-client-secret', id: 123, slug: 'personal-repoflow', pem: 'unused-private-key', webhook_secret: 'unused-webhook-secret' }
const appConfig = { clientId: converted.client_id, clientSecret: converted.client_secret, kind: 'github-app', origin: APP_ORIGIN, id: converted.id, slug: converted.slug }

function decodeHtml(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (_match, entity) => {
    if (entity.toLowerCase().startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)))
    return { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' }[entity.toLowerCase()]
  })
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, key, double, single]) => [key.toLowerCase(), decodeHtml(double ?? single)]))
}

async function beginSetup(client) {
  const response = await client.request('/api/setup/github')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const html = await response.text()
  assert.match(html, /\.(?:requestSubmit|submit)\s*\(/, 'the browser should continue directly to GitHub')
  const form = attributes(html.match(/<form\b[^>]*>/i)?.[0] ?? '')
  assert.equal(form.method?.toLowerCase(), 'post')
  const action = new URL(form.action)
  assert.equal(action.origin, 'https://github.com')
  assert.equal(action.pathname, '/settings/apps/new')
  const state = action.searchParams.get('state')
  assert.ok(state?.length >= 32)
  const input = [...html.matchAll(/<input\b[^>]*>/gi)].map(([tag]) => attributes(tag)).find((field) => field.name === 'manifest')
  const textarea = [...html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)].find(([, tag]) => attributes(tag).name === 'manifest')
  const manifest = JSON.parse(input?.value ?? decodeHtml(textarea?.[2] ?? ''))
  assert.equal(Object.hasOwn(manifest, 'hook_attributes'), false, 'no webhook is needed; even an inactive loopback hook is rejected by GitHub')
  return { response, html, state, manifest }
}

function assertRejected(response) {
  assert.ok([302, 400, 403, 409].includes(response.status), `expected a rejected setup, received ${response.status}`)
  if (response.status === 302) {
    const location = response.headers.get('location')
    assert.ok(location)
    assert.notEqual(location, '/api/auth/github')
    assert.equal(location.startsWith('https://github.com/'), false)
  }
}

test('unconfigured GitHub login creates a minimal app manifest and continues into PKCE OAuth without manual secrets', async (t) => {
  const store = memoryConfigStore()
  const client = await fixture(t, {
    env: unconfigured, configStore: store,
    upstream: ({ url, init }) => {
      assert.equal(url.href, 'https://api.github.com/app-manifests/manifest-code/conversions')
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.Authorization, undefined)
      return json(converted)
    },
  })
  const initial = await client.request('/api/auth/github')
  assert.equal(initial.status, 302)
  assert.equal(initial.headers.get('location'), '/api/setup/github')
  const { state, manifest, html } = await beginSetup(client)
  assert.deepEqual(manifest.callback_urls, [`${APP_ORIGIN}/api/auth/callback`])
  assert.equal(manifest.redirect_url, `${APP_ORIGIN}/api/setup/callback`)
  assert.deepEqual(manifest.default_permissions, { metadata: 'read', starring: 'write' })
  assert.deepEqual(manifest.default_events ?? [], [])
  assert.equal(html.includes(converted.client_secret), false)
  const callback = await client.request(`/api/setup/callback?${new URLSearchParams({ state, code: 'manifest-code' })}`)
  assert.equal(callback.status, 302)
  assert.equal(callback.headers.get('location'), '/api/auth/github')
  assert.deepEqual(store.saves, [appConfig], 'only OAuth configuration and application identifiers are persisted, excluding private keys and webhook secrets')
  assert.equal((await callback.text()).includes(converted.client_secret), false)
  await client.request(`/api/setup/callback?${new URLSearchParams({ state, code: 'manifest-code' })}`)
  assert.equal(client.calls.length, 1, 'a successful conversion code is never exchanged twice')
  assert.equal(store.saves.length, 1)
  const authorizeResponse = await client.request('/api/auth/github')
  const authorize = new URL(authorizeResponse.headers.get('location'))
  assert.equal(authorize.origin, 'https://github.com')
  assert.equal(authorize.searchParams.get('client_id'), converted.client_id)
  assert.equal(authorize.searchParams.has('scope'), false, 'GitHub App permissions come from its manifest')
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(authorize.searchParams.get('state').length >= 32)
  const authenticated = await client.request(`/api/auth/callback?${new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'oauth-code' })}`)
  assert.equal(authenticated.headers.get('location'), '/')
  const exchange = client.calls.find(({ url }) => url.pathname === '/login/oauth/access_token')
  assert.equal(JSON.parse(exchange.init.body).client_id, converted.client_id)
  assert.equal(JSON.parse(exchange.init.body).client_secret, converted.client_secret)
  const sessionResponse = await client.request('/api/session')
  const sessionText = await sessionResponse.text()
  assert.equal(JSON.parse(sessionText).user.login, 'octocat')
  for (const secret of [converted.client_secret, converted.pem, converted.webhook_secret]) assert.equal(sessionText.includes(secret), false)

  const restarted = await fixture(t, { env: unconfigured, configStore: store })
  const restored = await restarted.request('/api/auth/github')
  assert.equal(new URL(restored.headers.get('location')).searchParams.get('client_id'), converted.client_id)
  assert.equal(store.saves.length, 1, 'restarting reuses the persisted configuration')
})

test('setup is restricted to a local development origin and rejects cross-site entry', async (t) => {
  for (const scenario of [
    { name: 'production', env: { ...unconfigured, NODE_ENV: 'production', APP_URL: 'https://127.0.0.1:5173' } },
    { name: 'non-local app origin', env: { ...unconfigured, APP_URL: 'http://public.example' } },
    { name: 'non-local request hostname', env: unconfigured, host: 'public.example' },
    { name: 'cross-site fetch', env: unconfigured, headers: { 'Sec-Fetch-Site': 'cross-site' } },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const store = memoryConfigStore()
      const client = await fixture(subtest, { env: scenario.env, configStore: store })
      const response = scenario.host
        ? await client.requestHost('/api/setup/github', scenario.host)
        : await client.request('/api/setup/github', { headers: scenario.headers })
      assertRejected(response)
      assert.equal(client.calls.length, 0)
      assert.equal(store.saves.length, 0)
    })
  }
})

test('setup state is session-bound, single-use, and expires after ten minutes', async (t) => {
  await t.test('mismatch consumes the attempt and cannot be replayed', async (subtest) => {
    const store = memoryConfigStore()
    const client = await fixture(subtest, { env: unconfigured, configStore: store })
    const { state } = await beginSetup(client)
    assertRejected(await client.request('/api/setup/callback?state=wrong&code=manifest-code'))
    assertRejected(await client.request(`/api/setup/callback?state=${state}&code=manifest-code`))
    assert.equal(client.calls.length, 0)
    assert.equal(store.saves.length, 0)
  })
  await t.test('another browser cannot use the state', async (subtest) => {
    const store = memoryConfigStore()
    const first = await fixture(subtest, { env: unconfigured, configStore: store })
    const second = await fixture(subtest, { env: unconfigured, configStore: store })
    const { state } = await beginSetup(first)
    assertRejected(await second.request(`/api/setup/callback?state=${state}&code=manifest-code`))
    assert.equal(second.calls.length, 0)
    assert.equal(store.saves.length, 0)
  })
  await t.test('expired attempt cannot exchange a code', async (subtest) => {
    const store = memoryConfigStore()
    const client = await fixture(subtest, { env: unconfigured, configStore: store })
    const { state } = await beginSetup(client)
    const later = Date.now() + 11 * 60 * 1000
    subtest.mock.method(Date, 'now', () => later)
    assertRejected(await client.request(`/api/setup/callback?state=${state}&code=manifest-code`))
    assert.equal(client.calls.length, 0)
    assert.equal(store.saves.length, 0)
  })
})

test('failed or incomplete app conversions never persist credentials and cannot be replayed', async (t) => {
  for (const scenario of [
    { name: 'GitHub failure', upstream: () => json({ internal: 'conversion-server-secret' }, 500) },
    { name: 'network failure', upstream: () => { throw new Error('conversion-server-secret') } },
    { name: 'missing credentials', upstream: () => json({ id: 123, slug: 'incomplete' }) },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const store = memoryConfigStore()
      const client = await fixture(subtest, { env: unconfigured, configStore: store, upstream: scenario.upstream })
      const { state } = await beginSetup(client)
      const path = `/api/setup/callback?state=${state}&code=manifest-code`
      const response = await client.request(path)
      assertRejected(response)
      assert.equal((await response.text()).includes('conversion-server-secret'), false)
      assert.equal(client.calls.length, 1)
      assert.equal(store.saves.length, 0)
      assert.equal(store.get(), null)
      assertRejected(await client.request(path))
      assert.equal(client.calls.length, 1)
    })
  }
})

test('existing configuration cannot be overwritten, and environment OAuth credentials take priority', async (t) => {
  const store = memoryConfigStore(appConfig)
  const client = await fixture(t, { configStore: store })
  const response = await client.request('/api/auth/github')
  const authorize = new URL(response.headers.get('location'))
  assert.equal(authorize.searchParams.get('client_id'), 'test-client')
  assert.equal(authorize.searchParams.get('scope'), 'read:user public_repo')
  const setup = await client.request('/api/setup/github')
  assert.ok([302, 403, 409].includes(setup.status))
  if (setup.status === 302) assert.equal(setup.headers.get('location'), '/api/auth/github')
  assert.equal(store.saves.length, 0)
  assert.equal(client.calls.length, 0)
})
