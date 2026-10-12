import test from 'node:test'
import assert from 'node:assert/strict'
import { TOKEN, json, empty, repo, fixture, login } from './helpers.mjs'

const metadata = () => repo(31, 'guide', { private: false, default_branch: 'main' })
const content = '# 完整文档\n\n项目正文\n\n## 最后一节\n\nEND OF README'
const readme = () => ({ encoding: 'base64', content: Buffer.from(content).toString('base64'), path: 'docs/README.md', html_url: 'https://github.com/sample/guide/blob/main/docs/README.md', download_url: 'https://raw.githubusercontent.com/sample/guide/main/docs/README.md' })

test('public detail API returns the complete UTF-8 README, no credentials, and separate missing README state', async (t) => {
  let missing = false
  const client = await fixture(t, { upstream: ({ url, init }) => {
    assert.equal(url.origin, 'https://api.github.com')
    assert.equal(init.headers.Authorization, undefined)
    if (url.pathname === '/repos/sample/guide') return json(metadata())
    if (url.pathname === '/repos/sample/guide/readme') return missing ? empty(404) : json(readme())
    throw new Error(`Unexpected ${url.pathname}`)
  } })
  const response = await client.request('/api/repos/sample/guide')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const details = await response.json()
  assert.equal(details.repo.full_name, 'sample/guide')
  assert.equal(details.defaultBranch, 'main')
  assert.equal(details.readme.content, content)
  assert.equal(details.readmeError, null)
  assert.equal('viewer_starred' in details.repo, false)
  assert.equal(JSON.stringify(details).includes(TOKEN), false)
  await client.request('/api/repos/sample/guide')
  assert.equal(client.calls.length, 2)
  missing = true
  const refreshed = await (await client.request('/api/repos/sample/guide?refresh=1')).json()
  assert.equal(refreshed.readme, null)
  assert.equal(refreshed.readmeError, null)
  assert.equal(client.calls.length, 4)
})

test('detail route isolates viewer Star state, reflects writes, and retains public docs if Star lookup fails', async (t) => {
  let isStarred = true
  let starDenied = false
  const client = await fixture(t, { upstream: ({ url, init }) => {
    if (url.pathname === '/repos/sample/guide') return json(metadata())
    if (url.pathname === '/repos/sample/guide/readme') return json(readme())
    if (url.pathname === '/user/starred/sample/guide') {
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
      if (init.method === 'DELETE') { isStarred = false; return empty() }
      if (starDenied) return empty(403)
      return empty(isStarred ? 204 : 404)
    }
    throw new Error(`Unexpected ${url.pathname}`)
  } })
  const session = await login(client)
  assert.equal((await (await client.request('/api/repos/sample/guide')).json()).repo.viewer_starred, true)
  const write = await client.request('/api/starred/sample/guide', { method: 'DELETE', headers: { 'X-CSRF-Token': session.csrfToken } })
  assert.equal(write.status, 204)
  assert.equal((await (await client.request('/api/repos/sample/guide')).json()).repo.viewer_starred, false)
  const guest = await (await client.request('/api/repos/sample/guide', { headers: { Cookie: '' } })).json()
  assert.equal('viewer_starred' in guest.repo, false)
  starDenied = true
  await login(client)
  const response = await client.request('/api/repos/sample/guide')
  assert.equal(response.status, 200)
  const partial = await response.json()
  assert.equal(partial.readme.content, content)
  assert.equal('viewer_starred' in partial.repo, false)
})

test('README permission fallback uses no credentials only after verifying a public repository', async (t) => {
  const client = await fixture(t, { upstream: ({ url, init }) => {
    if (url.pathname === '/repos/sample/guide') {
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
      return json(metadata())
    }
    if (url.pathname === '/repos/sample/guide/readme') return init.headers.Authorization ? empty(403) : json(readme())
    if (url.pathname === '/user/starred/sample/guide') return empty(404)
    throw new Error(`Unexpected ${url.pathname}`)
  } })
  await login(client)
  const response = await client.request('/api/repos/sample/guide')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).readme.content, content)
  const reads = client.calls.filter(({ url }) => url.pathname.endsWith('/readme'))
  assert.deepEqual(reads.map(({ init }) => init.headers.Authorization), [`Bearer ${TOKEN}`, undefined])
})

test('expired detail credentials clear the account; malformed and missing repositories are explicit errors', async (t) => {
  let expired = false
  const client = await fixture(t, { upstream: ({ url }) => {
    if (url.pathname === '/repos/sample/guide') return expired ? empty(401) : empty(404)
    throw new Error(`Unexpected ${url.pathname}`)
  } })
  const invalid = await client.request('/api/repos/sample/bad%20repo')
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).code, 'INVALID_REPO')
  assert.equal(client.calls.length, 0)
  assert.equal((await client.request('/api/repos/sample/guide')).status, 404)
  await login(client)
  expired = true
  const response = await client.request('/api/repos/sample/guide')
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'SESSION_EXPIRED')
  assert.equal((await (await client.request('/api/session')).json()).user, null)
})
