import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, buildSearch, githubRequest, normalizeRepo } from '../server/github.mjs'

test('caller cancellation reaches GitHub requests while transport failures stay sanitized', async () => {
  const controller = new AbortController()
  let transportSignal
  const pending = githubRequest(async (_url, init) => {
    transportSignal = init.signal
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private transport context')), { once: true }))
  }, '/repos/sample/tool', 'test-token', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, (error) => error.code === 'GITHUB_UNAVAILABLE' && !error.message.includes('private'))
  assert.equal(transportSignal.aborted, true)
})

test('search defaults to public active popular repositories with a twelve-item page', () => {
  const { queries, page, perPage } = buildSearch({})
  assert.equal(page, 1)
  assert.equal(perPage, 12)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].get('q'), 'is:public archived:false fork:false stars:>20')
  assert.equal(queries[0].get('page'), '1')
  assert.equal(queries[0].get('per_page'), '12')
  assert.equal(queries[0].has('sort'), false)
})

test('five topics get independent queries with at most fifteen combined results', () => {
  const { queries, page, perPage } = buildSearch({ topics: 'react,node,vue,rust,python', sort: 'stars', page: '83', language: 'all' })
  assert.equal(page, 83)
  assert.equal(perPage, 3)
  assert.equal(queries.length, 5)
  assert.equal(queries.length * perPage, 15)
  assert.deepEqual(queries.map((query) => query.get('q').split(' ').at(-1)), ['topic:react', 'topic:node', 'topic:vue', 'topic:rust', 'topic:python'])
  for (const query of queries) {
    assert.equal(query.get('sort'), 'stars')
    assert.equal(query.get('order'), 'desc')
    assert.equal(query.get('q').includes('language:'), false)
  }
})

test('search text cannot inject scope qualifiers, and Unicode text and C++ filters survive', () => {
  const { queries } = buildSearch({ q: 'is:private stars:0 日本語 / toolkit', language: 'C++', sort: 'unknown' })
  const query = queries[0]
  assert.match(query.get('q'), /^is:public archived:false fork:false stars:>20 /)
  assert.match(query.get('q'), /日本語/)
  assert.match(query.get('q'), /toolkit/)
  assert.equal(query.get('q').includes('is:private'), false)
  assert.equal(query.get('q').includes('stars:0'), false)
  assert.match(query.get('q'), /language:"C\+\+"/)
  assert.equal(query.has('sort'), false)
})

test('only supported topic and language qualifiers are promoted from search text', () => {
  const { queries } = buildSearch({ q: 'topic:rust language:rust is:private archived:true fork:true stars:0 日本語' })
  assert.equal(queries.length, 1)
  const query = queries[0].get('q')
  assert.match(query, /^is:public archived:false fork:false stars:>20 /)
  assert.match(query, /(?:^|\s)topic:rust(?:\s|$)/)
  assert.match(query, /(?:^|\s)language:(?:"rust"|rust)(?:\s|$)/)
  assert.match(query, /日本語/)
  for (const forbidden of ['is:private', 'archived:true', 'fork:true', 'stars:0']) assert.equal(query.includes(forbidden), false)
})

test('week and month ranges use the injected time and retain sorting and public scope', () => {
  const now = new Date('2026-10-09T12:00:00Z')
  const week = buildSearch({ range: 'week', sort: 'stars' }, now).queries[0]
  assert.match(week.get('q'), /(?:^|\s)created:>=?2026-10-02(?:\s|$)/)
  assert.equal(week.get('sort'), 'stars')
  assert.equal(week.get('order'), 'desc')
  assert.match(week.get('q'), /^is:public /)
  const month = buildSearch({ range: 'month', sort: 'updated' }, now).queries[0]
  assert.match(month.get('q'), /(?:^|\s)pushed:>=?2026-09-09(?:\s|$)/)
  assert.equal(month.get('sort'), 'updated')
  assert.equal(month.get('q').includes('created:'), false)
})

test('invalid feed filters are rejected before an upstream request can be constructed', () => {
  const invalid = [
    { page: '0' }, { page: '84' }, { page: '-1' }, { page: '1.5' }, { page: '1e1' },
    { topics: 'a,b,c,d,e,f' }, { topics: 'valid,not valid' }, { topics: 'Uppercase' },
    { topics: 'a'.repeat(51) }, { language: 'JavaScript" is:private' },
    { language: 'JavaScript\nfoo' }, { language: 'x'.repeat(41) }, { q: 'x'.repeat(121) },
  ]
  for (const filters of invalid) {
    assert.throws(() => buildSearch(filters), (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY', JSON.stringify(filters))
  }
})

test('repository normalization provides display defaults and excludes unrelated upstream fields', () => {
  const normalized = normalizeRepo({
    id: 7, name: 'demo', full_name: 'sample/demo', html_url: 'https://github.com/sample/demo',
    owner: { login: 'sample', avatar_url: 'avatar', private_details: 'hidden' },
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', private: true, permissions: { admin: true },
  })
  const cover = new URL(normalized.cover_url)
  assert.equal(cover.origin, 'https://opengraph.githubassets.com')
  assert.ok(cover.pathname.endsWith('/sample/demo'))
  assert.deepEqual(normalized, {
    id: 7, name: 'demo', full_name: 'sample/demo', html_url: 'https://github.com/sample/demo',
    owner: { login: 'sample', avatar_url: 'avatar' }, description: '', stargazers_count: 0,
    forks_count: 0, language: null, topics: [], updated_at: '2026-09-01T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z', cover_url: normalized.cover_url,
    license: null, homepage: '', open_issues_count: 0,
  })
})
