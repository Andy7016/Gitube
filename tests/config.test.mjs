import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConfigStore } from '../server/config.mjs'

const config = { clientId: 'test-client-id', clientSecret: 'test-client-secret', kind: 'github-app', origin: 'http://127.0.0.1:5173' }

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'repoflow-config-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('configuration persists only on the server and can be restored by a fresh store', async (t) => {
  const root = await temporaryRoot(t)
  const store = createConfigStore(root)
  assert.equal(store.get(), null)
  await store.save(config)
  assert.deepEqual(store.get(), config)
  const restored = createConfigStore(root)
  assert.deepEqual(restored.get(), config)
  assert.deepEqual(JSON.parse(await readFile(join(root, '.local', 'github-app.json'), 'utf8')), config)
})

test('configuration creation is exclusive even when two stores race to save credentials', async (t) => {
  const root = await temporaryRoot(t)
  const first = createConfigStore(root)
  const second = createConfigStore(root)
  const alternate = { ...config, clientId: 'other-client', clientSecret: 'other-secret' }
  const results = await Promise.allSettled([first.save(config), second.save(alternate)])
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1)
  const saved = createConfigStore(root).get()
  assert.ok(saved.clientId === config.clientId || saved.clientId === alternate.clientId)
  assert.deepEqual(saved, saved.clientId === config.clientId ? config : alternate)
  await assert.rejects(createConfigStore(root).save({ ...config, clientSecret: 'replacement-secret' }))
  assert.deepEqual(createConfigStore(root).get(), saved)
})
