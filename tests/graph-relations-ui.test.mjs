import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const sharedUrl = new URL('../shared/graph-relations.mjs', import.meta.url).href
const graphDataUrl = dataUrl(compile(await readFile(new URL('../src/graph-data.ts', import.meta.url), 'utf8')).replaceAll('../shared/graph-relations.mjs', sharedUrl))
const graphCacheUrl = dataUrl(compile(await readFile(new URL('../src/graph-workspace-cache.ts', import.meta.url), 'utf8')).replaceAll('./graph-data', graphDataUrl))
const repoDataUrl = dataUrl(compile(await readFile(new URL('../src/data.ts', import.meta.url), 'utf8')))
let componentSource = compile(await readFile(new URL('../src/TechnologyGraph.tsx', import.meta.url), 'utf8'))
componentSource = componentSource.replace(/import ['"]\.\/graph\.css['"];?/, '')
for (const [specifier, resolved] of [
  ['./graph-data', graphDataUrl], ['./graph-workspace-cache', graphCacheUrl], ['./data', repoDataUrl], ['../shared/graph-relations.mjs', sharedUrl],
  ['react', import.meta.resolve('react')], ['react/jsx-runtime', import.meta.resolve('react/jsx-runtime')], ['lucide-react', import.meta.resolve('lucide-react')],
]) componentSource = componentSource.replaceAll(`'${specifier}'`, JSON.stringify(resolved)).replaceAll(`"${specifier}"`, JSON.stringify(resolved))
const { GraphRelationLine, GraphRelationDetails, EvidenceList, fitCamera, graphDensity, placeGraphLabels } = await import(dataUrl(componentSource))
const { mergeGraph, layoutGraph } = await import(graphDataUrl)
const evidence = (relation, overrides = {}) => ({ kind: 'readme-reference', url: 'https://github.com/acme/source/blob/main/README.md#L17-L19', label: 'README 说明', excerpt: 'Source uses target.', targetUrl: 'https://github.com/acme/original-target', relation, relationReason: '原始行明确写明使用目标项目。', ...overrides })
const edge = (items, overrides = {}) => ({ source: 'acme/source', target: 'acme/target', kind: 'direct', evidence: items, ...overrides })
const line = value => renderToStaticMarkup(createElement('svg', null, createElement(GraphRelationLine, { edge: value, markerId: 'test', emphasis: 'highlighted', x1: 1, y1: 2, x2: 3, y2: 4 })))
const textContent = html => html.replace(/<!--.*?-->/g, '').replace(/<[^>]*>/g, '')

test('upstream technical flow points toward the analyzed source while discovery endpoints stay unchanged', () => {
  const html = line(edge([evidence('upstream')], { relation: 'downstream' }))
  assert.match(html, /data-source="acme\/source" data-target="acme\/target"/)
  assert.match(html, /data-relation="upstream" data-flow-source="acme\/target" data-flow-target="acme\/source"/)
  assert.match(html, /marker-start="url\(#test-flow\)"/)
  assert.doesNotMatch(html, /marker-end=/)
  assert.match(html, /x1="1" y1="2" x2="3" y2="4"/)
  assert.match(html, /<title>.*acme\/target 是 acme\/source 的技术上游/)
})

test('a downstream use case points away from the analyzed source regardless of discovery tier', () => {
  const html = line(edge([evidence('downstream')], { kind: 'related', relation: 'upstream' }))
  assert.match(html, /data-relation="downstream" data-flow-source="acme\/source" data-flow-target="acme\/target"/)
  assert.match(html, /marker-end="url\(#test-flow\)"/)
  assert.doesNotMatch(html, /marker-start=/)
  assert.match(html, /acme\/target 是 acme\/source 的下游使用方/)
})

test('association, reference, and conflicting evidence have no arrow or inferred technical endpoints', () => {
  for (const relation of ['related', 'reference', 'ambiguous']) {
    const value = edge([evidence(relation)], { relation: 'upstream' })
    const html = line(value)
    assert.match(html, new RegExp(`relation-${relation}`))
    assert.doesNotMatch(html, /marker-start=|marker-end=|data-flow-source=|data-flow-target=/)
    assert.match(html, /<title>.*技术方向(?:未确定|不确定)/)
    const details = textContent(renderToStaticMarkup(createElement(GraphRelationDetails, { edge: value })))
    assert.match(details, /分析仓库：acme\/source/)
    assert.match(details, /无箭头关联线 · 技术方向未确定/)
  }
  assert.match(line(edge([evidence('upstream'), evidence('downstream')])), /data-relation="ambiguous"/)
})

test('legacy fixture evidence keeps dependency, person association, and credit reference semantics', () => {
  assert.match(line(edge([evidence(undefined, { kind: 'dependency' })])), /data-relation="upstream"/)
  assert.match(line(edge([evidence(undefined, { kind: 'contributor' })])), /data-relation="related"/)
  const credit = line(edge([evidence(undefined, { kind: 'credit' })]))
  assert.match(credit, /data-relation="reference"/)
  assert.doesNotMatch(credit, /marker-start=|marker-end=/)
})

test('evidence retains the referenced repository URL, source lines, original excerpt and decision reason', () => {
  const value = evidence('upstream')
  const html = renderToStaticMarkup(createElement(EvidenceList, { evidence: [value], showRelation: true }))
  assert.ok(html.includes(`href="${value.url}"`))
  assert.ok(html.includes(`href="${value.targetUrl}"`))
  const text = textContent(html)
  assert.match(text, /来源行：第 17–19 行/)
  assert.ok(text.includes(value.targetUrl))
  assert.ok(text.includes(value.excerpt))
  assert.ok(text.includes(value.relationReason))
  const unsafe = renderToStaticMarkup(createElement(EvidenceList, { evidence: [evidence('reference', { targetUrl: 'javascript:alert(1)' })], showRelation: true }))
  assert.doesNotMatch(unsafe, /href="javascript:/)
})

test('merging preserves contradictory evidence and traversal depth instead of trusting cached relation', () => {
  const node = (id, tier) => ({ id, repo: { full_name: id, name: id.split('/')[1], stargazers_count: 10 }, tier, overlap: { score: .5, shared: ['test'], method: 'topics' }, evidence: [] })
  const result = (root, nodes, edges) => ({ version: 1, root, generatedAt: '2026-10-11T00:00:00Z', nodes, edges, people: [], warnings: [], counts: { referencesFound: 1, referencesResolved: 1, peopleFound: 0, peopleScanned: 0, candidatesScanned: 0 }, limits: { references: 24, people: 4, reposPerPerson: 100, requests: 40 } })
  const nodes = [node('acme/source', 0), node('acme/target', 1)]
  const upstream = evidence('upstream')
  const initial = mergeGraph(null, result('acme/source', nodes, [edge([upstream], { relation: 'downstream' })]))
  assert.equal(initial.edges[0].relation, 'upstream')
  const variants = [upstream, evidence('downstream'), evidence('upstream', { excerpt: 'A separate source statement.' }), evidence('upstream', { targetUrl: 'https://github.com/acme/other-target' }), evidence('upstream', { relationReason: 'A distinct supported reason.' })]
  const merged = mergeGraph(initial, result('acme/source', nodes, [edge(variants, { relation: 'upstream' })]))
  assert.equal(merged.semanticsVersion, 2)
  assert.equal(merged.edges[0].evidence.length, variants.length)
  assert.equal(merged.edges[0].relation, 'ambiguous')
  assert.equal(merged.edges[0].source, 'acme/source')
  assert.equal(merged.edges[0].target, 'acme/target')
  assert.equal(merged.nodes.find(value => value.id === 'acme/target').depth, 1)
  const nextEdge = { ...edge([evidence('upstream')]), source: 'acme/target', target: 'acme/leaf' }
  const expanded = mergeGraph(merged, result('acme/target', [node('acme/target', 0), node('acme/leaf', 1)], [nextEdge]))
  assert.equal(expanded.nodes.find(value => value.id === 'acme/leaf').depth, 2)
  assert.equal(layoutGraph(expanded.nodes, expanded.edges).get('acme/leaf').parentId, 'acme/target')
  assert.equal(expanded.edges.find(value => value.target === 'acme/leaf').source, 'acme/target')
})

test('small embedded graphs keep the root centered and every actual circle separated and on canvas', () => {
  const node = (id, tier, score) => ({ id, repo: { full_name: id, name: id.split('/')[1], stargazers_count: 1800 }, tier, depth: tier ? 1 : 0, overlapRoot: 'fixture/root', overlap: { score, shared: ['graph'], method: 'topics' }, evidence: [] })
  const nodes = [node('fixture/root', 0, 1), node('source/high', 1, .8), node('source/low', 1, .3), node('developer/related', 2, .5)]
  const edges = nodes.slice(1).map(value => ({ source: nodes[0].id, target: value.id, kind: value.tier === 2 ? 'related' : 'direct', evidence: [] }))
  const positions = layoutGraph(nodes, edges), labels = new Set(nodes.map(value => value.id))
  for (const size of [{ width: 490, height: 194 }, { width: 360, height: 210 }, { width: 280, height: 178 }, { width: 390, height: 240 }]) {
    for (const focused of [true, false]) {
      const camera = fitCamera(nodes, positions, size, focused ? positions.get('fixture/root') : undefined), density = graphDensity(nodes, positions, camera)
      const circles = nodes.map(value => {
        const point = positions.get(value.id)
        return { id: value.id, x: size.width / 2 + (point.x - camera.x) * camera.scale, y: size.height / 2 + (point.y - camera.y) * camera.scale, radius: point.radius * (value.tier === 0 ? 1 : density) }
      })
      const root = circles[0]
      assert.equal(root.radius, 17, 'the root retains its normal fixed screen radius')
      if (focused) {
        assert.ok(Math.abs(root.x - size.width / 2) < 1e-8)
        assert.ok(Math.abs(root.y - size.height / 2) < 1e-8)
      }
      for (let a = 0; a < circles.length; a += 1) {
        const circle = circles[a]
        assert.ok(circle.x - circle.radius >= 0 && circle.x + circle.radius <= size.width, `${circle.id} stays horizontally on canvas`)
        assert.ok(circle.y - circle.radius >= 0 && circle.y + circle.radius <= size.height, `${circle.id} stays vertically on canvas`)
        for (let b = a + 1; b < circles.length; b += 1) {
          const second = circles[b], distance = Math.hypot(circle.x - second.x, circle.y - second.y)
          assert.ok(distance - circle.radius - second.radius >= 3 - 1e-7, `${circle.id} and ${second.id} keep a real gap at ${size.width}×${size.height}`)
        }
      }
      const placed = placeGraphLabels(nodes, positions, labels, new Set(), camera, size, density, nodes[0].id, false)
      assert.equal(placed.size, labels.size)
      for (const circle of circles) {
        const label = placed.get(circle.id), box = { x: circle.x + label.x, y: circle.y + label.y, width: label.width, height: label.height }
        assert.ok(box.x >= 0 && box.x + box.width <= size.width && box.y >= 0 && box.y + box.height <= size.height - 27, 'persistent labels stay clamped above the caption')
        for (const other of circles) {
          const closestX = Math.max(box.x, Math.min(box.x + box.width, other.x)), closestY = Math.max(box.y, Math.min(box.y + box.height, other.y))
          assert.ok(Math.hypot(closestX - other.x, closestY - other.y) > other.radius, 'persistent names avoid every actual circle')
        }
      }
    }
  }
})
