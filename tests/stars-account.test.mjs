import test from 'node:test'
import assert from 'node:assert/strict'

const values = new Map()
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}
const { useStars } = await import('../src/store/stars.ts')
const { useLibrary } = await import('../src/store/library.ts')
const { setApiToken } = await import('../src/api/github.ts')

test('an old account Star response cannot overwrite or teach the next account', async () => {
  let resolveRequest
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => new Promise((resolve) => { resolveRequest = resolve })
  try {
    setApiToken('isolated-test-token')
    useLibrary.getState().load('first')
    const repo = { id: 'repo', name: 'project', nameWithOwner: 'owner/project', topics: ['rust'], language: 'Rust', viewerHasStarred: false, stars: 10 }
    const pending = useStars.getState().toggle(repo)
    assert.equal(useStars.getState().overrides.repo.starred, true)
    useStars.getState().reset()
    useLibrary.getState().load('second')
    useStars.setState({ overrides: { repo: { starred: false, stars: 11 } }, pending: { repo: true } })
    resolveRequest(new Response(JSON.stringify({ data: { addStar: { starrable: { viewerHasStarred: true, stargazerCount: 11 } } } }), { status: 200 }))
    await pending
    assert.deepEqual(useStars.getState().overrides.repo, { starred: false, stars: 11 })
    assert.equal(useStars.getState().pending.repo, true)
    assert.equal(useLibrary.getState().events.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    useStars.getState().reset()
    setApiToken(null)
  }
})
