import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, login, repo, json, empty, TOKEN } from './helpers.mjs'

test('account recommendation profile requires a session and only reads the authenticated account', async (t) => {
  const client = await fixture(t, { upstream: ({ url, init }) => {
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
    if (url.pathname === '/user/starred') {
      assert.equal(init.headers.Accept, 'application/vnd.github.star+json')
      return json([{ starred_at: '2026-10-01T00:00:00Z', repo: repo(101, 'starred', { topics: ['rust'], language: 'Rust' }) }])
    }
    assert.equal(url.pathname, '/users/octocat/repos')
    assert.equal(url.searchParams.get('type'), 'owner')
    return json([repo(102, 'owned', { full_name: 'octocat/owned', owner: { login: 'octocat', avatar_url: '' }, topics: ['graphics'], language: 'Rust' })])
  } })
  assert.equal((await client.request('/api/recommendation-profile')).status, 401)
  assert.equal(client.calls.length, 0)
  await login(client)
  const response = await client.request('/api/recommendation-profile?login=someone-else')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const text = await response.text(), profile = JSON.parse(text)
  assert.equal(profile.login, 'octocat')
  assert.deepEqual(profile.counts, { starred: 1, owned: 1 })
  assert.ok(profile.topics.some(topic => topic.name === 'rust'))
  assert.ok(profile.topics.some(topic => topic.name === 'graphics'))
  assert.equal(text.includes(TOKEN), false)
  assert.equal(text.includes('test-client-secret'), false)
})

test('profile source authentication failure expires the local account session', async (t) => {
  const client = await fixture(t, { upstream: ({ url }) => url.pathname === '/user/starred' ? json({}, 401) : json([]) })
  await login(client)
  assert.equal((await client.request('/api/recommendation-profile')).status, 401)
  assert.equal((await (await client.request('/api/session')).json()).user, null)
})

test('successful Star mutation invalidates the cached account profile', async (t) => {
  let profileReads = 0, added = false
  const client = await fixture(t, { upstream: ({ url, init }) => {
    if (url.pathname === '/user/starred') { profileReads++; return json(added ? [{ starred_at: '2026-10-09T00:00:00Z', repo: repo(103, 'new-star', { topics: ['typescript'] }) }] : []) }
    if (url.pathname === '/users/octocat/repos') return json([])
    assert.equal(url.pathname, '/user/starred/sample/new-star')
    assert.equal(init.method, 'PUT')
    added = true
    return empty()
  } })
  const session = await login(client)
  assert.equal((await (await client.request('/api/recommendation-profile')).json()).counts.starred, 0)
  await client.request('/api/recommendation-profile')
  assert.equal(profileReads, 1)
  assert.equal((await client.request('/api/starred/sample/new-star', { method: 'PUT', headers: { 'X-CSRF-Token': session.csrfToken } })).status, 204)
  assert.equal((await (await client.request('/api/recommendation-profile')).json()).counts.starred, 1)
  assert.equal(profileReads, 2)
})
