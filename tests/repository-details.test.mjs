import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepositoryDetailsService } from '../server/repository-details.mjs'
import { ApiError } from '../server/github.mjs'

const TOKEN = 'repository-details-test-secret-token'
const NOW = Date.parse('2026-10-10T00:00:00Z')
const LIMIT = 2 * 1024 * 1024
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const metadata = (extra = {}) => ({ id: 1, name: 'project', full_name: 'octocat/project', private: false, default_branch: 'feature/docs', owner: { login: 'octocat', avatar_url: 'https://avatars.example/octocat' }, html_url: 'https://github.com/octocat/project', created_at: '2020-01-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra })
const readme = (content = '# Actual README', extra = {}) => ({ encoding: 'base64', content: Buffer.from(content, 'utf8').toString('base64'), path: 'docs/README.md', html_url: 'https://github.com/octocat/project/blob/feature/docs/docs/README.md', download_url: 'https://raw.githubusercontent.com/octocat/project/feature/docs/docs/README.md', ...extra })
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

test('details decode the complete non-ASCII README and preserve its actual paths without fetching download URLs', async () => {
  const content = `# 项目说明 👩🏽‍💻\n\n${'完整内容、相对图片 ![图](./images/截图.png)\n'.repeat(2000)}\nREADME 最后一行 ✓\n`
  const payload = readme(content, { download_url: 'https://untrusted.example/readme' })
  payload.content = payload.content.match(/.{1,60}/g).join('\n') + '\n'
  const calls = []
  const service = createRepositoryDetailsService({ now: () => NOW, request: async (path, token, options) => {
    calls.push(path)
    assert.equal(token, TOKEN)
    if (path === '/repos/octocat/project') return json(metadata({ viewer_starred: true, permissions: { admin: true } }))
    assert.equal(path, '/repos/octocat/project/readme')
    assert.equal(options.headers.Accept, 'application/vnd.github+json')
    return json(payload)
  } })
  const result = await service.getDetails('octocat', 'project', TOKEN)
  assert.deepEqual(calls, ['/repos/octocat/project', '/repos/octocat/project/readme'])
  assert.equal(result.defaultBranch, 'feature/docs')
  assert.deepEqual(result.readme, { content, path: payload.path, html_url: payload.html_url, download_url: payload.download_url })
  assert.equal(result.readmeError, null)
  assert.equal(result.repo.full_name, 'octocat/project')
  assert.equal('viewer_starred' in result.repo, false)
  assert.equal('permissions' in result.repo, false)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
})

test('README 404 is an explicit absent README and may be cached as successful public metadata', async () => {
  let calls = 0
  const service = createRepositoryDetailsService({ request: async (path) => {
    calls++
    return path.endsWith('/readme') ? json({ message: 'Not Found' }, 404) : json(metadata())
  } })
  const first = await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(first.readme, null)
  assert.equal(first.readmeError, null)
  assert.equal((await service.getDetails('octocat', 'project', TOKEN)).repo.id, 1)
  assert.equal(calls, 2)
})

test('metadata failures and private repositories propagate and are never cached', async (t) => {
  for (const scenario of [
    { name: 'not found', response: () => json({}, 404), status: 404 },
    { name: 'forbidden', response: () => json({}, 403), status: 403 },
    { name: 'expired login', response: () => json({}, 401), status: 401 },
    { name: 'private repository', response: () => json(metadata({ private: true })), status: 403, code: 'PRIVATE_REPOSITORY' },
  ]) {
    await t.test(scenario.name, async () => {
      let calls = 0
      const service = createRepositoryDetailsService({ request: async (path) => {
        calls++
        assert.equal(path, '/repos/octocat/project', 'private or inaccessible metadata must not trigger a README request')
        return scenario.response()
      } })
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(service.getDetails('octocat', 'project', TOKEN), (error) => error.status === scenario.status && (!scenario.code || error.code === scenario.code))
      }
      assert.equal(calls, 2)
    })
  }
})

test('invalid repository paths are rejected before constructing any upstream request', () => {
  const service = createRepositoryDetailsService({ request: () => { assert.fail('invalid paths must not reach GitHub') } })
  for (const [owner, repo] of [['', 'project'], ['a'.repeat(40), 'project'], ['octo/cat', 'project'], ['octocat', '.'], ['octocat', '..'], ['octocat', 'a/b'], ['octocat', '%2e%2e'], ['octocat', 'x?token=secret'], ['octocat', 'x#fragment'], ['octocat', 'x'.repeat(101)], ['octocat', undefined]]) {
    assert.throws(() => service.getDetails(owner, repo, TOKEN), (error) => error.status === 400 && error.code === 'INVALID_REPO')
  }
})

test('README failures preserve repository details and remain retryable instead of caching an empty success', async () => {
  let calls = 0
  let failing = true
  const service = createRepositoryDetailsService({ request: async (path) => {
    calls++
    if (!path.endsWith('/readme')) return json(metadata())
    if (failing) throw new Error('private upstream stack with internal credentials')
    return json(readme('# Recovered README'))
  } })
  const partial = await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(partial.repo.id, 1)
  assert.equal(partial.readme, null)
  assert.equal(partial.readmeError.code, 'README_UNAVAILABLE')
  assert.match(partial.readmeError.message, /[\u4e00-\u9fff]/)
  assert.equal(JSON.stringify(partial).includes('credentials'), false)
  failing = false
  const recovered = await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(recovered.readme.content, '# Recovered README')
  assert.equal(recovered.readmeError, null)
  assert.equal(calls, 4)
})

test('authenticated README 403 retries anonymously only after verifying public metadata', async () => {
  const calls = []
  const service = createRepositoryDetailsService({ request: async (path, token) => {
    calls.push({ path, token })
    if (!path.endsWith('/readme')) return json(metadata())
    if (token) throw new ApiError(403, 'Resource not accessible by integration')
    return json(readme('# Public README', { download_url: null }))
  } })
  const result = await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(result.readme.content, '# Public README')
  assert.equal(result.readme.download_url, null)
  assert.equal(result.readmeError, null)
  assert.deepEqual(calls, [
    { path: '/repos/octocat/project', token: TOKEN },
    { path: '/repos/octocat/project/readme', token: TOKEN },
    { path: '/repos/octocat/project/readme', token: null },
  ])
})

test('README 401 propagates, and rate limits never trigger an anonymous bypass', async (t) => {
  for (const scenario of [
    { name: '401 response', response: () => json({}, 401), expired: true },
    { name: '401 from request wrapper', response: () => { throw new ApiError(401, 'expired', 'SESSION_EXPIRED') }, expired: true },
    { name: '429', response: () => json({}, 429) },
    { name: 'rate-limited 403', response: () => json({}, 403, { 'X-RateLimit-Remaining': '0' }) },
  ]) {
    await t.test(scenario.name, async () => {
      let calls = 0
      const service = createRepositoryDetailsService({ request: async (path, token) => {
        calls++
        assert.equal(token, TOKEN, 'authentication and rate failures cannot retry anonymously')
        return path.endsWith('/readme') ? scenario.response() : json(metadata())
      } })
      if (scenario.expired) await assert.rejects(service.getDetails('octocat', 'project', TOKEN), (error) => error.status === 401 && error.code === 'SESSION_EXPIRED')
      else {
        const result = await service.getDetails('octocat', 'project', TOKEN)
        assert.equal(result.repo.id, 1)
        assert.equal(result.readmeError.code, 'RATE_LIMITED')
      }
      assert.equal(calls, 2)
    })
  }
})

test('format and UTF-8 failures return explainable README errors with intact repository metadata', async (t) => {
  for (const scenario of [
    { name: 'unsupported encoding', payload: readme('text', { encoding: 'none' }), code: 'README_INVALID_FORMAT' },
    { name: 'malformed base64', payload: readme('text', { content: 'not!base64==' }), code: 'README_INVALID_FORMAT' },
    { name: 'non-canonical base64', payload: readme('text', { content: 'AB==' }), code: 'README_INVALID_FORMAT' },
    { name: 'missing path', payload: readme('text', { path: '' }), code: 'README_INVALID_FORMAT' },
    { name: 'invalid UTF-8', payload: readme('text', { content: Buffer.from([0xc3, 0x28]).toString('base64') }), code: 'README_INVALID_ENCODING' },
    { name: 'invalid JSON', response: () => new Response('{broken', { status: 200 }), code: 'README_INVALID_FORMAT' },
  ]) {
    await t.test(scenario.name, async () => {
      const service = createRepositoryDetailsService({ request: async (path) => path.endsWith('/readme') ? scenario.response?.() ?? json(scenario.payload) : json(metadata()) })
      const result = await service.getDetails('octocat', 'project', TOKEN)
      assert.equal(result.repo.id, 1)
      assert.equal(result.readme, null)
      assert.equal(result.readmeError.code, scenario.code)
      assert.match(result.readmeError.message, /[\u4e00-\u9fff]/)
    })
  }
})

test('decoded UTF-8 byte size allows exactly 2 MiB and rejects larger content without truncation', async () => {
  const boundary = '界'.repeat(Math.floor(LIMIT / 3)) + 'aa'
  assert.equal(Buffer.byteLength(boundary), LIMIT)
  let content = boundary
  const service = createRepositoryDetailsService({ request: async (path) => path.endsWith('/readme') ? json(readme(content)) : json(metadata()) })
  const exact = await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(exact.readme.content, boundary)
  assert.equal(exact.readmeError, null)
  content = '界'.repeat(Math.ceil(LIMIT / 3))
  assert.ok(Buffer.byteLength(content) > LIMIT)
  const oversized = await service.getDetails('octocat', 'project', TOKEN, { refresh: true })
  assert.equal(oversized.repo.id, 1)
  assert.equal(oversized.readme, null)
  assert.equal(oversized.readmeError.code, 'README_TOO_LARGE')
})

test('cache isolates credentials, shares identical pending refreshes, and expires public details after five minutes', async () => {
  const gate = deferred()
  let clock = NOW
  let calls = 0
  const service = createRepositoryDetailsService({ now: () => clock, request: async (path, token) => {
    calls++
    if (!path.endsWith('/readme')) {
      if (token === TOKEN) await gate.promise
      return json(metadata())
    }
    return json(readme(token === TOKEN ? '# First' : '# Other'))
  } })
  const first = service.getDetails('octocat', 'project', TOKEN)
  assert.equal(service.getDetails('octocat', 'project', TOKEN), first)
  assert.equal(service.getDetails('octocat', 'project', TOKEN, { refresh: true }), first)
  const other = await service.getDetails('octocat', 'project', 'other-token')
  assert.equal(other.readme.content, '# Other')
  assert.equal(calls, 3, 'different credentials cannot inherit another account pending request')
  gate.resolve()
  assert.equal((await first).readme.content, '# First')
  assert.equal(calls, 4)
  await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(calls, 4)
  await service.getDetails('octocat', 'project', null)
  assert.equal(calls, 6)
  await service.getDetails('octocat', 'project', TOKEN, { refresh: true })
  assert.equal(calls, 8)
  clock += 5 * 60000 - 1
  await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(calls, 8)
  clock++
  await service.getDetails('octocat', 'project', TOKEN)
  assert.equal(calls, 10)
})

test('completed cache holds at most 128 repository entries', async () => {
  let calls = 0
  const service = createRepositoryDetailsService({ now: () => NOW, request: async (path) => {
    calls++
    return path.endsWith('/readme') ? json({}, 404) : json(metadata())
  } })
  for (let index = 0; index < 129; index++) await service.getDetails('octocat', `repo-${index}`, TOKEN)
  assert.equal(calls, 258)
  await service.getDetails('octocat', 'repo-128', TOKEN)
  assert.equal(calls, 258)
  await service.getDetails('octocat', 'repo-0', TOKEN)
  assert.equal(calls, 260)
})
