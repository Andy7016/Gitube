import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProfile, RecommendEngine } from '../src/lib/recommend.ts'
import { candidateSearch, context, library, memoryStorage, repo, seededRandom } from './recommend-fixtures.mjs'

globalThis.localStorage = memoryStorage()

const approximate = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`)
const total = (map) => [...map.values()].reduce((sum, value) => sum + value, 0)
const star = (login, project, days = 0) => ({ login, avatarUrl: login, repo: project,
  starredAt: new Date(Date.now() - days * 86_400_000).toISOString() })

test('following profile has a per-person topic budget, linear weights, deduplication and half-life', () => {
  const first = star('Alice', repo('one', ['rust', 'cli', 'rust', 'open-source']), 30)
  const second = star('alice', repo('two', ['cli']), 30)
  const following = [first, second, first]
  const one = buildProfile(null, library(), following)
  const three = buildProfile(null, library({ followingWeights: { alice: 3 } }), following)
  approximate(total(one.topicW), 0.6)
  approximate(total(one.langW), 0.3)
  approximate(total(three.topicW), 3 * total(one.topicW))
  approximate(total(three.langW), 3 * total(one.langW))
  assert.equal(one.topicW.has('open-source'), false)
  const single = buildProfile(null, library(), [star('alice', repo('solo', ['rust']))])
  const six = buildProfile(null, library(), Array.from({ length: 6 }, (_, i) => star('alice', repo(`sample${i}`, ['rust']))))
  approximate(total(single.topicW), total(six.topicW))
})

test('zero weight excludes all following topic and language signals; default remains one', () => {
  const following = [star('Alice', repo('one', ['rust']))]
  const zero = buildProfile(null, library({ followingWeights: { alice: 0 } }), following)
  assert.equal(zero.topicW.size, 0)
  assert.equal(zero.langW.size, 0)
  const fallback = buildProfile(null, library({ followingWeights: { alice: NaN } }), following)
  approximate(total(fallback.topicW), 1.2)
})

test('normal social picks rank by actual follower weight and star freshness, excluding zero', async () => {
  const following = [
    star('zero', repo('zero', ['rust'])),
    star('old', repo('old', ['rust']), 90),
    star('low', repo('low', ['rust'])),
    star('high', repo('high', ['rust'])),
  ]
  const engine = new RecommendEngine('viewer', { random: seededRandom(), searchMany: candidateSearch([]) })
  const items = await engine.next(context({ following, lib: library({ followingWeights: { zero: 0, old: 3, low: 1, high: 2 } }) }))
  assert.deepEqual(items.map((item) => item.repo.name), ['high', 'low'])
  assert.ok(items.every((item) => item.reason.kind === 'following'))
})

test('social deduplicates one user, sums distinct users, and identifies the most influential user', async () => {
  const shared = repo('shared', [])
  const following = [star('low', shared), star('high', shared), star('high', shared), star('solo', repo('solo'))]
  const engine = new RecommendEngine('viewer', { random: seededRandom(), searchMany: candidateSearch([]) })
  const items = await engine.next(context({ following, lib: library({ followingWeights: { low: 1, high: 2, solo: 2.5 } }) }))
  assert.deepEqual(items.map((item) => item.repo.name), ['shared', 'solo'])
  assert.equal(items[0].reason.text, '@high 等 2 人 Star 了')
  assert.equal(items[0].reason.avatar, 'high')
})
