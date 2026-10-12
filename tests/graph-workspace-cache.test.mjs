import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const graphDataUrl = dataUrl(compile(await readFile(new URL('../src/graph-data.ts', import.meta.url), 'utf8')).replaceAll('../shared/graph-relations.mjs', new URL('../shared/graph-relations.mjs', import.meta.url).href))
const cacheUrl = dataUrl(compile(await readFile(new URL('../src/graph-workspace-cache.ts', import.meta.url), 'utf8')).replaceAll('./graph-data', graphDataUrl))
const { GraphWorkspaceCache, graphWorkspaceCache, initialGraphView, restoreGraphCamera } = await import(cacheUrl)
const repoDataUrl = dataUrl(compile(await readFile(new URL('../src/data.ts', import.meta.url), 'utf8')))
let componentSource = compile(await readFile(new URL('../src/TechnologyGraph.tsx', import.meta.url), 'utf8')).replace(/import ['"]\.\/graph\.css['"];?/, '')
for (const [specifier, resolved] of [
  ['./graph-data', graphDataUrl], ['./graph-workspace-cache', cacheUrl], ['./data', repoDataUrl], ['../shared/graph-relations.mjs', new URL('../shared/graph-relations.mjs', import.meta.url).href],
  ['react', import.meta.resolve('react')], ['react/jsx-runtime', import.meta.resolve('react/jsx-runtime')], ['lucide-react', import.meta.resolve('lucide-react')],
]) componentSource = componentSource.replaceAll(`'${specifier}'`, JSON.stringify(resolved)).replaceAll(`"${specifier}"`, JSON.stringify(resolved))
const { default: TechnologyGraph } = await import(dataUrl(componentSource))
const graphProps = account => ({ account, csrfToken: null, onSessionRetry() {}, onSessionExpired() {}, onNavigate() {}, onRoute() {} })

function result(root, children = []) {
  const node = (id, tier) => ({ id, tier, repo: { full_name: id, name: id.split('/')[1], owner: { login: id.split('/')[0] }, stargazers_count: 50 }, overlap: { score: 0.5, shared: ['graph'], method: 'topics' }, evidence: [] })
  return { version: 1, semanticsVersion: 2, root, generatedAt: '2026-10-11T10:00:00Z', nodes: [node(root, 0), ...children.map(id => node(id, 1))], edges: children.map(target => ({ source: root, target, kind: 'direct', evidence: [] })), people: [], warnings: [], counts: { referencesFound: children.length, referencesResolved: children.length, peopleFound: 0, peopleScanned: 0, candidatesScanned: 0 }, limits: { references: 24, people: 4, reposPerPerson: 100, requests: 40 } }
}
function job(root, children = [], overrides = {}) {
  return { id: 'session-owned-polling-id', rootFullName: root, status: 'complete', phase: 'done', progress: 100, message: '完成', requests: 3, requestLimit: 40, updatedAt: '2026-10-11T10:00:00Z', result: result(root, children), error: null, ...overrides }
}
function complete(cache, account = 'guest', root = 'acme/root', children = ['acme/branch'], refresh = false, target = root) {
  const lease = cache.begin(account, root, target, refresh)
  assert.ok(cache.finish(lease, job(target, children)))
  return cache.read(account, root, 'workbench')
}
const ids = snapshot => snapshot.graph.nodes.map(node => node.id)

test('workspace keys canonicalize roots while isolating accounts and recent independent roots', () => {
  const cache = new GraphWorkspaceCache()
  complete(cache, 'github:alice', 'Acme/Root')
  cache.rememberWorkbench('github:alice', 'Acme/Root')
  assert.ok(cache.read('github:alice', 'ACME/ROOT', 'embedded'))
  assert.equal(cache.read('github:bob', 'acme/root', 'workbench'), null)
  assert.equal(cache.read('guest', 'acme/root', 'workbench'), null)
  assert.equal(cache.latestWorkbenchRoot('github:bob'), '')
  complete(cache, 'github:bob', 'other/root')
  cache.rememberWorkbench('github:bob', 'other/root')
  assert.equal(cache.latestWorkbenchRoot('github:alice'), 'Acme/Root')
  assert.equal(cache.latestWorkbenchRoot('github:bob'), 'other/root')
})

test('manual expansions and complete/partial evidence survive leaving and cross-surface reads', () => {
  const cache = new GraphWorkspaceCache()
  complete(cache)
  const expansion = cache.begin('guest', 'acme/root', 'acme/branch', false)
  assert.ok(cache.finish(expansion, job('acme/branch', ['acme/leaf'], { status: 'partial', message: '部分完成' })))
  const snapshot = cache.read('guest', 'acme/root', 'embedded')
  assert.deepEqual(ids(snapshot), ['acme/root', 'acme/branch', 'acme/leaf'])
  assert.deepEqual(snapshot.analyzed, ['acme/root', 'acme/branch'])
  assert.equal(snapshot.graph.nodes.find(node => node.id === 'acme/leaf').depth, 2)
  assert.equal(snapshot.graph.analyses.length, 2)
  assert.equal(snapshot.job.status, 'partial')
  assert.equal(snapshot.hasAttempted, true, 'restoring must not submit the first-level analysis again')
})

test('selection, camera, input, tab and disclosure restore independently for each surface', () => {
  const cache = new GraphWorkspaceCache()
  complete(cache)
  const view = { ...initialGraphView('acme/root'), selectedId: 'acme/branch', input: 'https://github.com/acme/next', tab: 'people', expanded: false, openDetails: ['person:alice', 'warnings'], viewScope: 'all', camera: { x: 127, y: -33, scale: 0.8, mode: 'manual', focusId: 'acme/branch' }, canvasSize: { width: 900, height: 500 } }
  cache.saveView('guest', 'acme/root', 'workbench', view)
  assert.deepEqual(cache.read('guest', 'acme/root', 'workbench').view, view)
  const embedded = { ...view, selectedId: 'acme/root', camera: { x: 0, y: 0, scale: 0.3, mode: 'overview' }, canvasSize: { width: 360, height: 210 }, expanded: true }
  cache.saveView('guest', 'acme/root', 'embedded', embedded)
  assert.deepEqual(cache.read('guest', 'acme/root', 'workbench').view, view)
  assert.deepEqual(cache.read('guest', 'acme/root', 'embedded').view, embedded)
  const returned = cache.read('guest', 'acme/root', 'workbench')
  returned.view.camera.x = 999
  returned.view.openDetails.push('mutated')
  returned.analyzed.push('mutated/repo')
  assert.deepEqual(cache.read('guest', 'acme/root', 'workbench').view, view)
  assert.deepEqual(cache.read('guest', 'acme/root', 'workbench').analyzed, ['acme/root'])
})

test('successful explicit root refresh replaces expansions only after a usable result arrives', () => {
  const cache = new GraphWorkspaceCache()
  complete(cache)
  complete(cache, 'guest', 'acme/root', ['acme/leaf'], false, 'acme/branch')
  const refresh = cache.begin('guest', 'acme/root', 'acme/root', true)
  assert.deepEqual(ids(cache.read('guest', 'acme/root', 'workbench')), ['acme/root', 'acme/branch', 'acme/leaf'])
  assert.ok(cache.finish(refresh, job('acme/root', ['acme/new'])))
  const snapshot = cache.read('guest', 'acme/root', 'workbench')
  assert.deepEqual(ids(snapshot), ['acme/root', 'acme/new'])
  assert.deepEqual(snapshot.analyzed, ['acme/root'])
  assert.equal(snapshot.graph.analyses.length, 1)
})

test('explicit searches request one refresh even for a cached different root while navigation remains a read', () => {
  const cache = new GraphWorkspaceCache()
  complete(cache, 'github:alice', 'acme/first')
  complete(cache, 'github:alice', 'acme/second')
  cache.requestRefresh('github:alice', 'Acme/Second')
  assert.equal(cache.takeRefreshRequest('github:bob', 'acme/second'), false)
  assert.equal(cache.takeRefreshRequest('github:alice', 'acme/first'), false)
  assert.ok(cache.read('github:alice', 'acme/second', 'embedded'), 'embedded access cannot consume the workbench search')
  assert.ok(cache.read('github:alice', 'acme/second', 'workbench'), 'rendering and StrictMode initialization must not consume the intent')
  assert.equal(cache.takeRefreshRequest('github:alice', 'ACME/SECOND'), true)
  assert.equal(cache.takeRefreshRequest('github:alice', 'acme/second'), false, 'revisiting this route does not repeat the explicit search')
  assert.equal(cache.read('github:alice', 'acme/second', 'workbench').graph.nodes.length, 2, 'requesting refresh retains the old usable graph')
})

test('failed server and transport refreshes retain the previous usable graph', () => {
  const cache = new GraphWorkspaceCache()
  const before = complete(cache).graph
  let refresh = cache.begin('guest', 'acme/root', 'acme/root', true)
  assert.ok(cache.finish(refresh, job('acme/root', [], { status: 'failed', result: null, error: { code: 'UPSTREAM_FAILURE', message: '暂时不可用' } })))
  let restored = cache.read('guest', 'acme/root', 'workbench')
  assert.equal(restored.graph, before)
  assert.equal(restored.job.status, 'failed')
  assert.equal(restored.error, '暂时不可用')
  refresh = cache.begin('guest', 'acme/root', 'acme/root', true)
  assert.equal(cache.fail(refresh, '连接失败'), true)
  restored = cache.read('guest', 'acme/root', 'workbench')
  assert.equal(restored.graph, before)
  assert.equal(restored.error, '连接失败')
  assert.equal(restored.pausedTarget, '')
})

test('interrupted initial and manual jobs restore paused targets without pretending to be complete', () => {
  const cache = new GraphWorkspaceCache()
  const initial = cache.begin('guest', 'acme/root', 'acme/root', false)
  cache.pause(initial)
  let snapshot = cache.read('guest', 'acme/root', 'workbench')
  assert.equal(snapshot.graph, null)
  assert.equal(snapshot.job, null)
  assert.equal(snapshot.hasAttempted, true)
  assert.equal(snapshot.pausedTarget, 'acme/root')
  assert.equal(cache.finish(initial, job('acme/root')), null, 'a late interrupted response cannot revive its lease')
  complete(cache)
  const manual = cache.begin('guest', 'acme/root', 'acme/branch', false)
  cache.pause(manual)
  snapshot = cache.read('guest', 'acme/root', 'embedded')
  assert.deepEqual(ids(snapshot), ['acme/root', 'acme/branch'])
  assert.equal(snapshot.pausedTarget, 'acme/branch')
  assert.equal(snapshot.job.id, '', 'paused restoration has no old session polling capability')
})

test('newer analysis invalidates earlier late responses and wrong roots cannot commit', () => {
  const cache = new GraphWorkspaceCache()
  complete(cache)
  const older = cache.begin('guest', 'acme/root', 'acme/branch', false)
  const newer = cache.begin('guest', 'acme/root', 'acme/root', true)
  assert.equal(cache.finish(older, job('acme/branch', ['acme/stale'])), null)
  assert.equal(cache.fail(older, 'stale error'), false)
  assert.equal(cache.finish(newer, job('other/root')), null)
  assert.equal(cache.finish(newer, job('acme/root', [], { result: result('other/root') })), null)
  assert.equal(cache.finish(newer, job('acme/root', ['acme/fresh']))?.error, '')
  assert.deepEqual(ids(cache.read('guest', 'acme/root', 'workbench')), ['acme/root', 'acme/fresh'])
})

test('cache keeps at most eight LRU roots and touching a root changes its eviction order', () => {
  const cache = new GraphWorkspaceCache()
  for (let index = 0; index < 8; index++) complete(cache, 'guest', `acme/root${index}`, [])
  assert.ok(cache.read('guest', 'ACME/ROOT0', 'workbench'))
  complete(cache, 'guest', 'acme/root8', [])
  assert.equal(cache.read('guest', 'acme/root1', 'workbench'), null)
  assert.ok(cache.read('guest', 'acme/root0', 'workbench'))
  assert.ok(cache.read('guest', 'acme/root8', 'workbench'))
  assert.equal(Array.from({ length: 9 }, (_, index) => cache.read('guest', `acme/root${index}`, 'embedded')).filter(Boolean).length, 8)
})

test('visiting more than eight embedded roots preserves the last independent workspace', () => {
  const cache = new GraphWorkspaceCache()
  complete(cache)
  cache.rememberWorkbench('guest', 'acme/root')
  for (let index = 0; index < 20; index++) {
    complete(cache, 'guest', `acme/detail${index}`, [])
    cache.saveView('guest', `acme/detail${index}`, 'embedded', initialGraphView(`acme/detail${index}`))
  }
  assert.equal(cache.latestWorkbenchRoot('guest'), 'acme/root')
  assert.deepEqual(ids(cache.read('guest', 'acme/root', 'workbench')), ['acme/root', 'acme/branch'])
  assert.equal(cache.read('guest', 'acme/detail0', 'embedded'), null)
  cache.rememberWorkbench('guest', 'acme/new-workbench')
  assert.equal(cache.latestWorkbenchRoot('guest'), 'acme/new-workbench')
})

test('eviction invalidates leases even if the same root is recreated later', () => {
  const cache = new GraphWorkspaceCache(2)
  const evicted = cache.begin('github:alice', 'acme/root', 'acme/root', false)
  complete(cache, 'github:bob', 'other/root', [])
  complete(cache, 'guest', 'third/root', [])
  assert.equal(cache.isCurrent(evicted), false)
  const replacement = cache.begin('github:alice', 'acme/root', 'acme/root', false)
  assert.equal(cache.finish(evicted, job('acme/root', ['acme/stale'])), null)
  assert.ok(cache.finish(replacement, job('acme/root', ['acme/fresh'])))
  assert.deepEqual(ids(cache.read('github:alice', 'acme/root', 'workbench')), ['acme/root', 'acme/fresh'])
})

test('cache strips job capabilities and credentials and rejects nonterminal or missing completed results', () => {
  const cache = new GraphWorkspaceCache()
  const lease = cache.begin('guest', 'acme/root', 'acme/root', false)
  assert.equal(cache.finish(lease, job('acme/root', [], { status: 'running', result: null })), null)
  assert.equal(cache.finish(lease, job('acme/root', [], { result: null })), null)
  assert.ok(cache.finish(lease, job('acme/root', [], { csrfToken: 'secret', sessionId: 'secret', headers: { Authorization: 'secret' } })))
  const snapshot = cache.read('guest', 'acme/root', 'workbench')
  assert.equal(snapshot.job.id, '')
  assert.doesNotMatch(JSON.stringify(snapshot), /session-owned-polling-id|secret|csrfToken|Authorization|sessionId/)
  assert.equal(new GraphWorkspaceCache().read('guest', 'acme/root', 'workbench'), null, 'a fresh runtime has no old workspace')
})

test('restored manual camera fits changed canvas dimensions without losing its world center', () => {
  const camera = { x: 123, y: -44, scale: 0.8, mode: 'manual', focusId: 'acme/branch' }
  assert.equal(restoreGraphCamera(camera, { width: 900, height: 500 }, { width: 900, height: 500 }), camera)
  assert.deepEqual(restoreGraphCamera(camera, { width: 900, height: 500 }, { width: 360, height: 210 }), { ...camera, scale: 0.8 * 0.4 })
  const automatic = { ...camera, mode: 'focus' }
  assert.equal(restoreGraphCamera(automatic, { width: 900, height: 500 }, { width: 360, height: 210 }), automatic, 'focus/overview are refitted by the graph camera effect')
})

test('rootless component renders the account recent workspace with the restored selection and camera', () => {
  const account = 'github:component-resume'
  complete(graphWorkspaceCache, account)
  complete(graphWorkspaceCache, account, 'acme/embedded-only', [])
  graphWorkspaceCache.rememberWorkbench(account, 'acme/root')
  graphWorkspaceCache.saveView(account, 'acme/root', 'workbench', { ...initialGraphView('acme/root'), selectedId: 'acme/branch', camera: { x: 42, y: 7, scale: 0.6, mode: 'manual' }, openDetails: ['warnings'] })
  const html = renderToStaticMarkup(createElement(TechnologyGraph, graphProps(account)))
  assert.match(html, /<h3>acme\/branch<\/h3>/)
  assert.match(html, /data-camera-mode="manual"/)
  assert.match(html, /translate\(-42 -7\)/)
  assert.match(html, /value="acme\/root"/)
  assert.doesNotMatch(html, /acme\/embedded-only|正在提交分析请求/)
  const other = renderToStaticMarkup(createElement(TechnologyGraph, graphProps('github:component-new-account')))
  assert.match(other, /选择一个 GitHub 仓库/)
  assert.doesNotMatch(other, /acme\/branch/)
})

test('paused component makes the absence of completed results visible and requires manual continuation', () => {
  const account = 'github:component-paused'
  const lease = graphWorkspaceCache.begin(account, 'acme/pending', 'acme/pending', false)
  graphWorkspaceCache.pause(lease)
  graphWorkspaceCache.rememberWorkbench(account, 'acme/pending')
  const html = renderToStaticMarkup(createElement(TechnologyGraph, graphProps(account)))
  assert.match(html, /上次分析已暂停/)
  assert.match(html, /本次尚无已完成结果/)
  assert.match(html, /继续上次分析/)
  assert.doesNotMatch(html, /一级分析完成|部分分析完成|已读取缓存/)
})
