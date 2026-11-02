import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProfile } from '../src/lib/recommend.ts'
import { library } from './recommend-fixtures.mjs'

test('dwell is a small normal-profile signal with the existing language factor and 30-day decay', () => {
  const profile = buildProfile(null, library({ events: [{ kind: 'dwell', topics: ['rust'], lang: 'Rust', at: Date.now() - 30 * 86_400_000 }] }))
  assert.ok(Math.abs(profile.topicW.get('rust') - 0.15) < 0.00001)
  assert.ok(Math.abs(profile.langW.get('Rust') - 0.075) < 0.00001)
})
