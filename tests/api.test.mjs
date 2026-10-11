import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import session from 'express-session'
import { APP_ORIGIN, TOKEN, profile, json, empty, repo, fixture, beginLogin, login } from './helpers.mjs'

test('OAuth binds state and PKCE, validates identity, rotates the session, and keeps tokens server-side', async (t) => {
  const client = await fixture(t)
  const guestResponse = await client.request('/api/session')
  const guest = await guestResponse.json()
  const oldCookie = client.cookie
  assert.equal(guest.user, null)
  assert.equal(guest.oauthConfigured, true)
  assert.match(guestResponse.headers.get('set-cookie'), /; HttpOnly/i)
  assert.match(guestResponse.headers.get('set-cookie'), /; SameSite=Lax/i)
  assert.equal(guestResponse.headers.get('cache-control'), 'no-store')

  const { authorize } = await beginLogin(client)
  assert.equal(authorize.origin, 'https://github.com')
  assert.equal(authorize.pathname, '/login/oauth/authorize')
  assert.equal(authorize.searchParams.get('client_id'), 'test-client')
  assert.equal(authorize.searchParams.get('redirect_uri'), `${APP_ORIGIN}/api/auth/callback`)
  assert.equal(authorize.searchParams.get('scope'), 'read:user public_repo')
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(authorize.searchParams.get('state').length >= 32)
  const callback = await client.request(`/api/auth/callback?${new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'test-code' })}`)
  assert.equal(callback.headers.get('location'), '/')
  assert.match(callback.headers.get('set-cookie'), /; HttpOnly/i)
  assert.notEqual(client.cookie, oldCookie)
  assert.equal(client.calls.length, 2)
  const exchange = client.calls[0]
  const body = JSON.parse(exchange.init.body)
  assert.equal(exchange.init.method, 'POST')
  assert.equal(body.code, 'test-code')
  assert.equal(body.redirect_uri, `${APP_ORIGIN}/api/auth/callback`)
  assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), authorize.searchParams.get('code_challenge'))
  assert.equal(client.calls[1].url.pathname, '/user')
  assert.equal(client.calls[1].init.headers.Authorization, `Bearer ${TOKEN}`)

  const current = await client.request('/api/session')
  const serialized = await current.text()
  const session = JSON.parse(serialized)
  assert.deepEqual(session.user, profile)
  assert.notEqual(session.csrfToken, guest.csrfToken)
  assert.equal(serialized.includes(TOKEN), false)
  assert.deepEqual(Object.keys(session).sort(), ['csrfToken', 'oauthConfigured', 'user'])
  const previous = await client.request('/api/session', { headers: { Cookie: oldCookie } })
  assert.equal((await previous.json()).user, null)
})

test('OAuth rejects mismatched, missing, and replayed state without contacting GitHub', async (t) => {
  const client = await fixture(t)
  const { authorize } = await beginLogin(client)
  const state = authorize.searchParams.get('state')
  const mismatch = await client.request('/api/auth/callback?state=wrong&code=test')
  assert.equal(mismatch.headers.get('location'), '/?auth_error=invalid_state')
  const replay = await client.request(`/api/auth/callback?state=${state}&code=test`)
  assert.equal(replay.headers.get('location'), '/?auth_error=invalid_state')
  const missing = await client.request('/api/auth/callback?code=test')
  assert.equal(missing.headers.get('location'), '/?auth_error=invalid_state')
  assert.equal(client.calls.length, 0)
  assert.equal((await (await client.request('/api/session')).json()).user, null)
})

test('OAuth requires a successful exchange and a verified GitHub identity', async (t) => {
  for (const scenario of [
    { name: 'exchange denied', exchange: () => json({ error: 'bad_verification_code' }), expected: 'exchange_rejected', calls: 1 },
    { name: 'identity missing', identity: () => json({ name: 'Unverified' }), expected: 'identity_invalid_response', calls: 2 },
    { name: 'identity unavailable', identity: () => empty(500), expected: 'identity_upstream', calls: 2 },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const client = await fixture(subtest, scenario)
      const { authorize } = await beginLogin(client)
      const response = await client.request(`/api/auth/callback?state=${authorize.searchParams.get('state')}&code=test`)
      assert.equal(response.headers.get('location'), `/?auth_error=${scenario.expected}`)
      assert.equal(client.calls.length, scenario.calls)
      assert.equal((await (await client.request('/api/session')).json()).user, null)
    })
  }
})

test('OAuth diagnoses transport, upstream, invalid-response and identity authorization failures without leaking secrets', async (t) => {
  const privateText = 'private-proxy-password authorization client_secret access_token'
  const connectionError = () => {
    const error = new Error(privateText, { cause: { code: 'ENOTFOUND', message: privateText, request: { Authorization: `Bearer ${TOKEN}` } } })
    error.code = 'UNTRUSTED_' + TOKEN
    error.request = { url: 'https://private-proxy.example/', client_secret: 'test-client-secret' }
    return error
  }
  for (const stage of ['exchange', 'identity']) {
    for (const scenario of [
      { name: 'connection', result: () => { throw connectionError() }, kind: 'connection', code: 'ENOTFOUND' },
      { name: 'timeout', result: () => { throw new DOMException(privateText, 'TimeoutError') }, kind: 'timeout' },
      { name: 'transport timeout', result: () => { throw new Error(privateText, { cause: { code: 'UND_ERR_CONNECT_TIMEOUT', message: TOKEN } }) }, kind: 'timeout', code: 'UND_ERR_CONNECT_TIMEOUT' },
      { name: 'service failure', result: () => json({ error: privateText, token: TOKEN }, 503), kind: 'upstream', status: 503 },
      { name: 'rate limit', result: () => empty(403, { 'X-RateLimit-Remaining': '0' }), kind: 'upstream', status: 403 },
      { name: 'invalid JSON', result: () => new Response(privateText, { status: 200 }), kind: 'invalid_response', status: 200 },
      { name: 'invalid payload', result: () => json(stage === 'exchange' ? { access_token: { secret: TOKEN } } : { login: { token: TOKEN } }), kind: 'invalid_response', status: 200 },
      { name: 'unauthorized', result: () => json({ error: privateText }, 401), kind: stage === 'exchange' ? 'rejected' : 'unauthorized', status: 401 },
      { name: 'forbidden', result: () => json({ error: privateText }, 403), kind: stage === 'exchange' ? 'rejected' : 'forbidden', status: 403 },
    ]) {
      await t.test(`${stage}: ${scenario.name}`, async (subtest) => {
        const client = await fixture(subtest, { [stage === 'exchange' ? 'exchange' : 'identity']: scenario.result })
        const { authorize } = await beginLogin(client)
        const state = authorize.searchParams.get('state')
        const query = new URLSearchParams({ state, code: 'private-authorization-code' })
        const response = await client.request(`/api/auth/callback?${query}`)
        assert.equal(response.status, 302)
        assert.equal(response.headers.get('location'), `/?auth_error=${stage}_${scenario.kind}`)
        assert.equal(client.calls.length, stage === 'exchange' ? 1 : 2, 'authorization codes and failed identity requests are not retried')
        assert.deepEqual(client.authDiagnostics, [{ stage, kind: scenario.kind, ...(scenario.status === undefined ? {} : { status: scenario.status }), ...(scenario.code ? { code: scenario.code } : {}) }])
        assert.ok(Object.isFrozen(client.authDiagnostics[0]))
        const serialized = JSON.stringify({ headers: [...response.headers], body: await response.text(), diagnostics: client.authDiagnostics })
        for (const secret of [privateText, TOKEN, 'test-client-secret', 'private-authorization-code', 'private-proxy.example', state, authorize.searchParams.get('code_challenge')]) {
          assert.equal(serialized.includes(secret), false, 'OAuth responses and diagnostics contain only fixed safe values')
        }
        assert.equal((await (await client.request('/api/session')).json()).user, null)
        const replay = await client.request(`/api/auth/callback?${query}`)
        assert.equal(replay.headers.get('location'), '/?auth_error=invalid_state')
        assert.equal(client.calls.length, stage === 'exchange' ? 1 : 2)
      })
    }
  }
})

test('OAuth session failures discard authentication even when a failed save already wrote the session', async (t) => {
  for (const phase of ['consume state', 'regenerate', 'save authenticated session']) {
    await t.test(phase, async (subtest) => {
      const store = new session.MemoryStore()
      const set = store.set.bind(store)
      const destroy = store.destroy.bind(store)
      let armed = false
      let failed = false
      let authWrites = 0
      const storageError = () => new Error(`private store path password ${TOKEN}`)
      store.set = (id, value, callback) => {
        if (value.token) authWrites++
        if (armed && !failed && ((phase === 'consume state' && !value.oauth) || (phase === 'save authenticated session' && value.token))) {
          failed = true
          // Some remote stores commit a write before reporting a transport error.
          return set(id, value, () => callback(storageError()))
        }
        set(id, value, callback)
      }
      store.destroy = (id, callback) => {
        if (armed && !failed && phase === 'regenerate') {
          failed = true
          return callback(storageError())
        }
        destroy(id, callback)
      }
      const client = await fixture(subtest, { sessionStore: store })
      const { authorize } = await beginLogin(client)
      const previousCookie = client.cookie
      armed = true
      const callback = await client.request(`/api/auth/callback?${new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'private-authorization-code' })}`)
      assert.equal(callback.headers.get('location'), '/?auth_error=session_failed')
      assert.match(callback.headers.get('set-cookie'), /repoflow\.sid=;/)
      assert.equal(failed, true)
      assert.equal(authWrites, phase === 'save authenticated session' ? 1 : 0, 'a failed save is never implicitly retried on redirect')
      assert.deepEqual(client.authDiagnostics, [{ stage: 'session', kind: 'storage' }])
      const persisted = await new Promise((resolve, reject) => store.all((error, entries) => error ? reject(error) : resolve(entries)))
      assert.equal(Object.values(persisted).some((entry) => entry.token || entry.user || entry.oauth), false)
      assert.equal((await (await client.request('/api/session')).json()).user, null)
      const stale = await client.request('/api/session', { headers: { Cookie: previousCookie } })
      assert.equal((await stale.json()).user, null)
      const serialized = JSON.stringify({ headers: [...callback.headers], body: await callback.text(), diagnostics: client.authDiagnostics })
      assert.equal(serialized.includes(TOKEN), false)
      assert.equal(serialized.includes('private'), false)
      assert.equal(client.calls.length, phase === 'consume state' ? 0 : 2)
    })
  }
})

test('an unavailable OAuth diagnostic sink does not replace a safe login failure', async (t) => {
  const client = await fixture(t, {
    exchange: () => { throw new Error('private network detail') },
    authDiagnostics: () => { throw new Error('private logger detail') },
  })
  const { authorize } = await beginLogin(client)
  const response = await client.request(`/api/auth/callback?${new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'test' })}`)
  assert.equal(response.headers.get('location'), '/?auth_error=exchange_connection')
  assert.equal((await (await client.request('/api/session')).json()).user, null)
})

test('guests cannot read their private star state or perform Star writes', async (t) => {
  const client = await fixture(t)
  for (const [method, path] of [['GET', '/api/starred'], ['GET', '/api/starred/sample/demo'], ['PUT', '/api/starred/sample/demo'], ['DELETE', '/api/starred/sample/demo']]) {
    const response = await client.request(path, { method })
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'LOGIN_REQUIRED')
  }
  assert.equal(client.calls.length, 0)
})

test('Star writes require the current CSRF token and same-origin requests, then forward PUT and DELETE', async (t) => {
  const client = await fixture(t, { upstream: () => empty() })
  const session = await login(client)
  const before = client.calls.length
  for (const headers of [
    {},
    { 'X-CSRF-Token': 'invalid' },
    { 'X-CSRF-Token': 'é'.repeat(session.csrfToken.length) },
    { 'X-CSRF-Token': session.csrfToken, Origin: 'https://untrusted.example' },
    { 'X-CSRF-Token': session.csrfToken, Origin: 'null' },
  ]) {
    const response = await client.request('/api/starred/sample/demo', { method: 'PUT', headers })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'CSRF_INVALID')
  }
  assert.equal(client.calls.length, before)
  for (const method of ['PUT', 'DELETE']) {
    const response = await client.request('/api/starred/sample/demo', { method, headers: { 'X-CSRF-Token': session.csrfToken, Origin: APP_ORIGIN } })
    assert.equal(response.status, 204)
    const call = client.calls.at(-1)
    assert.equal(call.url.href, 'https://api.github.com/user/starred/sample/demo')
    assert.equal(call.init.method, method)
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`)
  }
  const badRepo = await client.request('/api/starred/sample/bad%20repo', { method: 'PUT', headers: { 'X-CSRF-Token': session.csrfToken } })
  assert.equal(badRepo.status, 400)
  assert.equal((await badRepo.json()).code, 'INVALID_REPO')
})

test('feed queries topics independently, preserves public scope and filters, interleaves and deduplicates', async (t) => {
  const client = await fixture(t, {
    upstream: ({ url, init }) => {
      assert.equal(url.pathname, '/search/repositories')
      assert.equal(init.headers.Authorization, undefined)
      const topic = url.searchParams.get('q').includes('topic:react') ? 'react' : 'node'
      return json({ items: topic === 'react' ? [repo(1, 'shared'), repo(2, 'react')] : [repo(1, 'shared'), repo(3, 'node')], total_count: topic === 'react' ? 18 : 100 })
    },
  })
  const response = await client.request(`/api/feed?${new URLSearchParams({ topics: 'react,node,react', q: 'is:private cool', language: 'JavaScript', sort: 'updated', page: '3' })}`)
  assert.equal(response.status, 200)
  const feed = await response.json()
  assert.equal(feed.source, 'github')
  assert.equal(feed.hasMore, true)
  assert.deepEqual(feed.items.map((item) => item.id), [1, 2, 3])
  assert.equal(feed.items.some((item) => 'viewer_starred' in item), false)
  assert.equal(feed.items[0].updated_at, '2026-10-01T00:00:00Z')
  assert.equal(feed.items[0].created_at, '2026-09-01T00:00:00Z')
  assert.equal(new URL(feed.items[0].cover_url).origin, 'https://opengraph.githubassets.com')
  assert.deepEqual(feed.items[0].license, { spdx_id: 'MIT' })
  assert.equal(client.calls.length, 2)
  for (const { url } of client.calls) {
    const query = url.searchParams
    assert.equal(query.get('page'), '3')
    assert.equal(query.get('per_page'), '6')
    assert.equal(query.get('sort'), 'updated')
    assert.equal(query.get('order'), 'desc')
    assert.match(query.get('q'), /^is:public archived:false fork:false stars:>20 /)
    assert.match(query.get('q'), /language:"JavaScript"/)
    assert.equal(query.get('q').includes('is:private'), false)
    assert.equal((query.get('q').match(/topic:/g) ?? []).length, 1)
  }
  await client.request(`/api/feed?${new URLSearchParams({ topics: 'react,node,react', q: 'is:private cool', language: 'JavaScript', sort: 'updated', page: '3' })}`)
  assert.equal(client.calls.length, 2, 'repeated identical feed uses the short search cache')
})

test('signed-in feed resolves viewer_starred, treats 404 as unstarred, and reflects a successful mutation', async (t) => {
  const client = await fixture(t, {
    upstream: ({ url, init }) => {
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
      if (url.pathname === '/search/repositories') return json({ items: [repo(1, 'yes'), repo(2, 'no')], total_count: 2 })
      if (init.method === 'PUT') return empty()
      if (url.pathname === '/user/starred/sample/yes') return empty()
      if (url.pathname === '/user/starred/sample/no') return empty(404)
      throw new Error(`Unexpected path ${url.pathname}`)
    },
  })
  const session = await login(client)
  const feed = await (await client.request('/api/feed')).json()
  assert.deepEqual(feed.items.map(({ viewer_starred }) => viewer_starred), [true, false])
  assert.equal(feed.hasMore, false)
  const count = client.calls.length
  await client.request('/api/feed')
  assert.equal(client.calls.length, count, 'cached search and per-viewer checks avoid repeated upstream calls')
  const direct = await client.request('/api/starred/sample/no')
  assert.equal(direct.status, 200)
  assert.deepEqual(await direct.json(), { starred: false })
  await client.request('/api/starred/sample/no', { method: 'PUT', headers: { 'X-CSRF-Token': session.csrfToken } })
  const after = await (await client.request('/api/feed')).json()
  assert.deepEqual(after.items.map(({ viewer_starred }) => viewer_starred), [true, true])
})

test('starred list uses account authentication and forwards pagination', async (t) => {
  const client = await fixture(t, {
    upstream: ({ url, init }) => {
      assert.equal(url.pathname, '/user/starred')
      assert.equal(url.searchParams.get('page'), '2')
      assert.equal(url.searchParams.get('per_page'), '100')
      assert.equal(url.searchParams.get('sort'), 'created')
      assert.equal(url.searchParams.get('direction'), 'desc')
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
      return json([repo(4, 'saved')], 200, { Link: '<https://api.github.com/user/starred?page=3>; rel="next"' })
    },
  })
  await login(client)
  const response = await client.request('/api/starred?page=2')
  assert.equal(response.status, 200)
  const saved = await response.json()
  assert.equal(saved.hasMore, true)
  assert.equal(saved.items[0].viewer_starred, true)
  const before = client.calls.length
  const invalid = await client.request('/api/starred?page=0')
  assert.equal(invalid.status, 400)
  assert.equal(client.calls.length, before)
})

test('upstream rate limits, server errors, and network failures produce bounded API errors', async (t) => {
  for (const scenario of [
    { name: '429', upstream: () => empty(429), status: 429, code: 'RATE_LIMITED' },
    { name: 'rate-limited 403', upstream: () => empty(403, { 'X-RateLimit-Remaining': '0' }), status: 429, code: 'RATE_LIMITED' },
    { name: '500', upstream: () => json({ secret: 'upstream internal stack' }, 500), status: 502, code: 'UPSTREAM_ERROR' },
    { name: 'network failure', upstream: () => { throw new Error('internal proxy password') }, status: 502, code: 'GITHUB_UNAVAILABLE' },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const client = await fixture(subtest, scenario)
      const response = await client.request('/api/feed')
      assert.equal(response.status, scenario.status)
      const body = await response.text()
      assert.equal(JSON.parse(body).code, scenario.code)
      assert.equal(body.includes('internal'), false)
      assert.equal(body.includes(TOKEN), false)
    })
  }
})

test('an upstream 401 clears the local identity and subsequent writes require login', async (t) => {
  const client = await fixture(t, { upstream: () => empty(401) })
  const session = await login(client)
  const response = await client.request('/api/starred/sample/demo')
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'SESSION_EXPIRED')
  assert.equal((await (await client.request('/api/session')).json()).user, null)
  const before = client.calls.length
  const write = await client.request('/api/starred/sample/demo', { method: 'PUT', headers: { 'X-CSRF-Token': session.csrfToken } })
  assert.equal(write.status, 401)
  assert.equal(client.calls.length, before)
})

test('logout rejects forged requests, destroys the session, and expires its HttpOnly cookie', async (t) => {
  const client = await fixture(t)
  const session = await login(client)
  const signedInCookie = client.cookie
  const forged = await client.request('/api/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken, Origin: 'https://untrusted.example' } })
  assert.equal(forged.status, 403)
  assert.equal((await (await client.request('/api/session')).json()).user.login, 'octocat')
  const response = await client.request('/api/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken, Origin: APP_ORIGIN } })
  assert.equal(response.status, 204)
  assert.match(response.headers.get('set-cookie'), /repoflow\.sid=;/)
  assert.match(response.headers.get('set-cookie'), /; HttpOnly/i)
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i)
  const stale = await client.request('/api/session', { headers: { Cookie: signedInCookie } })
  assert.equal((await stale.json()).user, null)
})
