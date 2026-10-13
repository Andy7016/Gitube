import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGraphStore, graphKey, mergeGraph, MAX_GRAPH_NODES, MAX_GRAPH_ROOTS } from '../src/store/graph.ts'

const evidence = (relation = 'upstream') => ({ kind: 'dependency', url: 'https://github.com/a/root/blob/main/package.json#L1', label: '明确依赖', relation, relationReason: 'GitHub 依赖地址' })
const node = (id, tier = 1, score = .5) => ({ id, repo: { id, nameWithOwner: id, description: null, url: `https://github.com/${id}`, stars: 10, language: 'TypeScript', topics: ['graph'], avatarUrl: '' }, tier, overlap: { score, shared: ['graph'], method: 'topics' }, evidence: [] })
function result(root, children = ['a/child'], relation = 'upstream') {
  return { version: 1, semanticsVersion: 2, incomplete: false, root, generatedAt: '2026-10-12T00:00:00Z', nodes: [node(root, 0, 1), ...children.filter(id => id !== root).map(id => node(id))], edges: children.filter(id => id !== root).map(target => ({ source: root, target, kind: 'direct', relation, evidence: [evidence(relation)] })), people: [], warnings: [], counts: { referencesFound: children.length, referencesResolved: children.length, peopleFound: 0, peopleScanned: 0, candidatesScanned: 0, requests: 5 }, limits: { references: 12, people: 2, reposPerPerson: 30, requests: 48, concurrency: 3, requestTimeoutMs: 20000, totalTimeoutMs: 90000 } }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture() {
  const calls = []
  const store = createGraphStore((root, options) => { const pending = deferred(); calls.push({ root, options, ...pending }); return pending.promise })
  store.getState().setScope('alice', 'token-alice')
  return { store, calls }
}

test('completed roots restore selection/camera/branches without requests; mode views share analysis independently', async () => {
  const { store, calls } = fixture(), state = () => store.getState()
  const key = state().open('standalone', 'a/root')
  let pending = state().ensure(key)
  calls[0].resolve(result('a/root')); await pending
  state().updateView(key, { selected: 'a/child', camera: { x: 10, y: 40, scale: 1.2, mode: 'custom' }, panel: 'nodes' })
  pending = state().expand(key, 'a/child')
  calls[1].resolve(result('a/child', ['a/grandchild'])); await pending
  const cached = state().views[key]
  const embedded = state().open('embedded', 'a/root')
  await state().ensure(embedded)
  assert.equal(calls.length, 2)
  assert.equal(state().views[embedded].graph, cached.graph)
  assert.deepEqual(state().views[embedded].expanded, ['a/child'])
  assert.equal(state().views[embedded].selected, 'a/root')
  state().updateView(embedded, { selected: 'a/grandchild', camera: { x: 0, y: 0, scale: .5, mode: 'focus' } })
  state().open('embedded', 'b/another')
  assert.equal(state().open('standalone'), key)
  await state().ensure(key)
  assert.equal(state().views[key], cached)
  assert.equal(state().lastStandalone, 'a/root')
  assert.equal(calls.length, 2)
})

test('leaving aborts requests and ignores late completions; StrictMode lease reacquisition stays active', async () => {
  const { store, calls } = fixture(), state = () => store.getState()
  const key = state().open('standalone', 'a/root')
  state().retain(key)
  const pending = state().ensure(key)
  state().release(key); state().retain(key)
  await Promise.resolve()
  assert.equal(calls[0].options.signal.aborted, false)
  state().release(key)
  await Promise.resolve()
  assert.equal(calls[0].options.signal.aborted, true)
  assert.equal(state().views[key].status, 'interrupted')
  calls[0].resolve(result('a/root')); await pending
  assert.equal(state().views[key].graph, null)
  state().open('standalone', 'a/root'); await state().ensure(key)
  assert.equal(calls.length, 1, 'returning to interrupted roots requires manual continuation')
})

test('explicit reanalysis requests anew and failures retain the complete graph and view', async () => {
  const { store, calls } = fixture(), state = () => store.getState(), key = state().open('standalone', 'a/root')
  let pending = state().ensure(key); calls[0].resolve(result('a/root')); await pending
  state().updateView(key, { selected: 'a/child', camera: { x: 40, y: 10, scale: 2, mode: 'focus' } })
  const before = state().views[key]
  pending = state().reanalyze(key)
  calls[1].reject(new Error('GitHub 暂时不可用')); await pending
  assert.equal(state().views[key].graph, before.graph)
  assert.equal(state().views[key].selected, 'a/child')
  assert.deepEqual(state().views[key].camera, before.camera)
  assert.equal(state().views[key].status, 'error')
  assert.match(state().views[key].error, /暂时不可用/)
})

test('account and token boundaries invalidate requests, views, last workspace and mount version', async () => {
  const { store, calls } = fixture(), state = () => store.getState(), key = state().open('standalone', 'a/root')
  const pending = state().ensure(key), version = state().scopeVersion
  state().setScope('alice', 'replacement-token')
  assert.equal(calls[0].options.signal.aborted, true)
  assert.ok(state().scopeVersion > version)
  assert.deepEqual(state().views, {})
  assert.equal(state().lastStandalone, null)
  calls[0].resolve(result('a/root')); await pending
  assert.deepEqual(state().views, {})
  const currentKey = state().open('standalone', 'a/root')
  const current = state().ensure(currentKey)
  assert.equal(calls[1].options.token, 'replacement-token')
  calls[1].resolve(result('a/root')); await current
  state().setScope('bob', 'token-bob')
  assert.deepEqual(state().views, {})
})

test('operationally incomplete refresh retains the previous graph; partial manual expansion remains retryable', async () => {
  const { store, calls } = fixture(), state = () => store.getState(), key = state().open('standalone', 'a/root')
  let pending = state().ensure(key); calls[0].resolve(result('a/root')); await pending
  state().updateView(key, { selected: 'a/child', camera: { x: 12, y: 34, scale: 1.2, mode: 'focus' } })
  const before = state().views[key]
  pending = state().reanalyze(key)
  calls[1].resolve({ ...result('a/root', []), incomplete: true, warnings: ['README 请求限流'] }); await pending
  assert.equal(state().views[key].graph, before.graph)
  assert.equal(state().views[key].selected, before.selected)
  assert.equal(state().views[key].camera, before.camera)
  assert.deepEqual(state().views[key].expanded, before.expanded)
  assert.equal(state().views[key].status, 'error')
  assert.match(state().views[key].error, /已保留之前的图谱.*限流/)
  pending = state().expand(key, 'a/child')
  calls[2].resolve({ ...result('a/child', ['a/partial']), incomplete: true, warnings: ['部分来源超时'] }); await pending
  assert.ok(state().views[key].graph.nodes.some(n => n.id === 'a/partial'))
  assert.deepEqual(state().views[key].expanded, [])
  pending = state().expand(key, 'a/child')
  calls[3].resolve(result('a/child', ['a/complete'])); await pending
  assert.deepEqual(state().views[key].expanded, ['a/child'])
  assert.ok(state().views[key].graph.nodes.some(n => n.id === 'a/complete'))
})

test('cache bounds count unique roots and protect the latest independent workspace from detail browsing', () => {
  const { store } = fixture(), state = () => store.getState()
  const key = state().open('standalone', 'a/pinned')
  state().open('embedded', 'a/pinned')
  for (let i = 0; i < 12; i++) state().open('embedded', `a/detail-${i}`)
  assert.equal(new Set(Object.values(state().views).map(v => v.root)).size, MAX_GRAPH_ROOTS)
  assert.ok(state().views[key])
  assert.ok(state().views[graphKey('embedded', 'a/pinned')])
  assert.equal(state().lastStandalone, 'a/pinned')
  assert.equal(state().views[graphKey('embedded', 'a/detail-0')], undefined)
})

test('manual expansion shares graph merges while preserving the other mode camera and selection', async () => {
  const { store, calls } = fixture(), state = () => store.getState(), standalone = state().open('standalone', 'a/root')
  let pending = state().ensure(standalone); calls[0].resolve(result('a/root')); await pending
  const embedded = state().open('embedded', 'a/root')
  state().updateView(embedded, { selected: 'a/root', camera: { x: 5, y: 6, scale: .7, mode: 'custom' } })
  pending = state().expand(standalone, 'a/child'); calls[1].resolve(result('a/child', ['a/grand'])); await pending
  assert.equal(state().views[embedded].graph, state().views[standalone].graph)
  assert.equal(state().views[embedded].selected, 'a/root')
  assert.equal(state().views[embedded].camera.scale, .7)
  assert.equal(state().views[embedded].graph.analyses.length, 2)
  await state().expand(standalone, 'a/child')
  assert.equal(calls.length, 2, 'already expanded nodes do not trigger repeated analysis')
})

test('merging preserves cyclic evidence, deduplicates nodes and conflicts, and recomputes shortest descendant depths', () => {
  let graph = mergeGraph(null, result('a/root', ['a/one']))
  graph = mergeGraph(graph, result('a/one', ['a/two']))
  graph = mergeGraph(graph, result('a/two', ['a/three', 'a/root']))
  assert.equal(graph.nodes.length, 4)
  assert.ok(graph.edges.some(e => e.source === 'a/two' && e.target === 'a/root'))
  assert.equal(graph.nodes.find(n => n.id === 'a/three').depth, 3)
  graph = mergeGraph(graph, result('a/root', ['a/two', 'a/one'], 'downstream'))
  assert.equal(graph.nodes.find(n => n.id === 'a/three').depth, 2)
  assert.equal(graph.edges.find(e => e.source === 'a/root' && e.target === 'a/one').relation, 'ambiguous')
  assert.equal(graph.edges.filter(e => e.source === 'a/root' && e.target === 'a/one').length, 1)
})

test('node and depth limits bound manual expansion and disclose omitted nodes', () => {
  let graph = mergeGraph(null, result('a/root', Array.from({ length: 140 }, (_, i) => `a/item-${i}`)))
  assert.equal(graph.nodes.length, MAX_GRAPH_NODES)
  assert.match(graph.warnings.join(' '), /120/)
  graph = mergeGraph(null, result('a/root', ['a/one']))
  for (let i = 1; i <= 5; i++) graph = mergeGraph(graph, result(i === 1 ? 'a/one' : `a/depth-${i}`, [`a/depth-${i + 1}`]))
  assert.ok(graph.nodes.every(n => n.depth <= 5))
  assert.match(graph.warnings.join(' '), /5 层/)
})
