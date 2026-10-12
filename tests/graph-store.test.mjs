import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGraphStore, publicGraphResult } from '../server/graph-store.mjs'

function fixture(name = 'acme/root') {
  const [owner, repo] = name.split('/')
  return { version: 1, semanticsVersion: 2, root: name, generatedAt: '2026-10-10T00:00:00.000Z', nodes: [{ id: name, repo: { id: 1, name: repo, full_name: name, private: false, owner: { login: owner, avatar_url: `https://avatars.githubusercontent.com/${owner}` }, html_url: `https://github.com/${name}`, language: 'Rust', topics: ['rust'], stargazers_count: 10 }, tier: 0, overlap: { score: 1, shared: ['rust'], method: 'topics' }, evidence: [] }], edges: [], people: [], warnings: [], counts: { referencesFound: 0, referencesResolved: 0, peopleFound: 0, peopleScanned: 0, candidatesScanned: 0 }, limits: { references: 24, people: 4, reposPerPerson: 100, requests: 40 } }
}

function withEdge(items, relation = 'related') {
  const value = fixture()
  const target = fixture('other/library').nodes[0]
  target.tier = 1
  target.evidence = items
  value.nodes.push(target)
  value.edges.push({ source: value.root, target: target.id, kind: 'direct', relation, evidence: items })
  return value
}

test('graph persistence atomically survives restart, canonicalizes keys, isolates callers, and bounds entries to 64', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'graph-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createGraphStore(root)
  await Promise.all(Array.from({ length: 66 }, (_, index) => store.set(`acme/r${index}`, fixture(`acme/r${index}`))))
  assert.equal(await store.get('acme/r0'), undefined)
  const restarted = createGraphStore(root)
  const value = await restarted.get('Acme/R65')
  assert.equal(value.root, 'acme/r65')
  value.nodes[0].repo.language = 'changed'
  assert.equal((await restarted.get('acme/r65')).nodes[0].repo.language, 'Rust')
  assert.deepEqual(await readdir(join(root, '.local')), ['graph-cache.json'])
  assert.equal(JSON.parse(await readFile(join(root, '.local', 'graph-cache.json'), 'utf8')).entries.length, 64)
})

test('all public Repo DTO fields reject nested secrets/source and invalid URL protocols before serialization', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'graph-sanitize-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const value = fixture()
  const secret = { token: 'fixture-secret', readme: 'raw source' }
  Object.assign(value, { token: secret, rawReadme: secret })
  Object.assign(value.nodes[0].repo, { viewer_starred: true, token: secret, id: secret, name: secret, description: secret, html_url: secret, stargazers_count: secret, forks_count: Infinity, language: secret, homepage: secret, open_issues_count: -1, created_at: secret, updated_at: secret, cover_url: 'javascript:fixture-secret', topics: ['rust', secret], license: { spdx_id: secret } })
  value.nodes[0].repo.owner = { login: secret, avatar_url: 'https://evil.test/fixture-secret', token: secret }
  value.nodes[0].overlap.shared.push(secret)
  value.people.push({ login: 'alice', avatar_url: secret, html_url: 'javascript:fixture-secret', roles: ['owner', secret], contributions: secret, evidence: [{ kind: 'owner', url: 'javascript:fixture-secret', label: secret, excerpt: secret }] })
  const store = createGraphStore(root)
  await store.set('acme/root', value)
  const serialized = await readFile(join(root, '.local', 'graph-cache.json'), 'utf8')
  for (const marker of ['fixture-secret', 'raw source', 'viewer_starred', 'token', 'rawReadme', 'Infinity']) assert.ok(!serialized.includes(marker), marker)
  const repo = (await store.get('acme/root')).nodes[0].repo
  assert.equal(repo.language, null)
  assert.equal(repo.id, 0)
  assert.equal(repo.owner.login, 'acme')
  assert.equal(repo.html_url, 'https://github.com/acme/root')
  assert.equal(repo.homepage, '')
})

test('private nodes, wrong cache root and malformed persisted entries never become public cache results', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'graph-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createGraphStore(root)
  const privateValue = fixture()
  privateValue.nodes[0].repo.private = true
  await assert.rejects(store.set('acme/root', privateValue), /公开仓库/)
  await assert.rejects(store.set('acme/other', fixture()), /不一致/)
  await mkdir(join(root, '.local'), { recursive: true })
  await writeFile(join(root, '.local', 'graph-cache.json'), JSON.stringify({ version: 1, entries: [{ key: 'acme/root', result: privateValue }, { key: 'acme/good', result: fixture('acme/good') }, { key: 'acme/bad', result: { token: 'secret' } }] }))
  const restarted = createGraphStore(root)
  assert.equal(await restarted.get('acme/root'), undefined)
  assert.equal(await restarted.get('acme/bad'), undefined)
  assert.equal((await restarted.get('acme/good')).root, 'acme/good')
  assert.throws(() => publicGraphResult({ ...fixture(), nodes: [] }), /缺少中心/)
})

test('directional evidence and derived relation survive public DTO and an atomic cache restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'graph-relations-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const item = { kind: 'credit', url: 'https://github.com/acme/root/blob/main/README.md#L4', label: '来源', excerpt: 'Built on library.', relation: 'upstream', relationReason: '明确基于此项目构建。', targetUrl: 'https://github.com/other/library' }
  const value = withEdge([item], 'downstream')
  const result = publicGraphResult(value)
  assert.equal(result.version, 1)
  assert.equal(result.semanticsVersion, 2)
  assert.equal(result.edges[0].relation, 'upstream', 'Caller-supplied edge relation is never authoritative.')
  assert.deepEqual(result.edges[0].evidence, [item])
  await createGraphStore(root).set('acme/root', value)
  const restored = await createGraphStore(root).get('acme/root')
  assert.deepEqual(restored, result)
  assert.equal(restored.edges[0].source, 'acme/root')
  assert.equal(restored.edges[0].target, 'other/library')
  assert.deepEqual(await readdir(join(root, '.local')), ['graph-cache.json'])
})

test('evidence whitelists relation fields and exact canonical GitHub repository targets', () => {
  const base = { kind: 'copyright', url: 'https://github.com/acme/root/blob/main/README.md#L5', label: '版权来源' }
  const invalidTargets = ['http://github.com/other/library', 'https://user:secret@github.com/other/library', 'https://evil.test/other/library', 'https://api.github.com/other/library', 'https://github.com/other/library/issues', 'https://github.com/other/library/', 'https://github.com/other/library?q=token', 'https://github.com/other/library#token', 'https://github.com/topics/rust', 'https://github.com/other/library.git', 'https://github.com:443/other/library', 'https://github.com/other/%6cibrary', { token: 'fixture-secret' }]
  const items = invalidTargets.map((targetUrl) => ({ ...base, relation: 'forged-relation', relationReason: { token: 'fixture-secret' }, targetUrl }))
  items.push({ ...base, kind: 'readme-related', relation: 'related', relationReason: 'x'.repeat(201), targetUrl: 'https://github.com/other/library', rawSource: 'fixture-secret' })
  items.push({ ...base, kind: 'forged-kind', relation: 'downstream' })
  const result = publicGraphResult(withEdge(items, 'downstream'))
  assert.equal(result.edges[0].relation, 'related')
  assert.equal(result.edges[0].evidence.length, invalidTargets.length + 1)
  for (const item of result.edges[0].evidence.slice(0, -1)) {
    for (const key of ['relation', 'relationReason', 'targetUrl']) assert.ok(!Object.hasOwn(item, key), key)
  }
  const kept = result.edges[0].evidence.at(-1)
  assert.equal(kept.kind, 'readme-related')
  assert.equal(kept.relationReason.length, 200)
  assert.equal(kept.targetUrl, 'https://github.com/other/library')
  assert.ok(!JSON.stringify(result).includes('fixture-secret'))
})

test('DTO recomputes conflicts and legacy relation defaults from sanitized evidence', () => {
  const item = { kind: 'credit', url: 'https://github.com/acme/root/blob/main/README.md', label: '来源' }
  for (const [items, expected] of [
    [[{ ...item, relation: 'upstream' }, { ...item, relation: 'downstream' }], 'ambiguous'],
    [[{ ...item, relation: 'ambiguous' }, { ...item, kind: 'dependency' }], 'ambiguous'],
    [[{ ...item, kind: 'dependency' }, { ...item, kind: 'contributor' }], 'upstream'],
    [[{ ...item, kind: 'owner' }], 'related'],
    [[item], 'reference'],
    [[{ ...item, kind: 'forged-kind', relation: 'upstream' }], 'reference'],
  ]) {
    assert.equal(publicGraphResult(withEdge(items, 'downstream')).edges[0].relation, expected)
  }
})

test('legacy semantic versions remain readable without being upgraded or deleting persisted entries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'graph-legacy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const version of [undefined, 1, '2', 3, null]) {
    const value = fixture()
    if (version === undefined) delete value.semanticsVersion
    else value.semanticsVersion = version
    assert.ok(!Object.hasOwn(publicGraphResult(value), 'semanticsVersion'))
  }
  const legacy = fixture('acme/legacy')
  delete legacy.semanticsVersion
  const store = createGraphStore(root)
  await store.set('acme/legacy', legacy)
  const path = join(root, '.local', 'graph-cache.json')
  const before = await readFile(path, 'utf8')
  const restored = await createGraphStore(root).get('acme/legacy')
  assert.equal(restored.root, 'acme/legacy')
  assert.ok(!Object.hasOwn(restored, 'semanticsVersion'))
  assert.equal(await readFile(path, 'utf8'), before)
  await createGraphStore(root).set('acme/fresh', fixture('acme/fresh'))
  const saved = JSON.parse(await readFile(path, 'utf8')).entries
  assert.equal(saved.length, 2)
  assert.ok(!Object.hasOwn(saved.find((entry) => entry.key === 'acme/legacy').result, 'semanticsVersion'))
  assert.equal(saved.find((entry) => entry.key === 'acme/fresh').result.semanticsVersion, 2)
})
