import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitCamera, graphNodeRadius, layoutGraph, placeGraphLabels } from '../src/components/graph/layout.ts'

const node = (id, tier = 1, depth = 1, score = .5, method = 'topics') => ({ id, tier, depth, overlapRoot: 'a/root', repo: { id, nameWithOwner: id, stars: 100, topics: ['graph'], language: 'TypeScript' }, overlap: { score, shared: [], method }, evidence: [] })
const edge = (source, target, kind = 'direct') => ({ source, target, kind, relation: 'reference', evidence: [] })

test('topic overlap changes area linearly; root is fixed and language fallback uses minimum radius', () => {
  const low = graphNodeRadius(node('a/low', 1, 1, 0)), high = graphNodeRadius(node('a/high', 1, 1, 1)), middle = graphNodeRadius(node('a/middle', 1, 1, .5))
  assert.ok(Math.abs(middle ** 2 - (low ** 2 + high ** 2) / 2) < 1e-8)
  assert.equal(graphNodeRadius(node('a/fallback', 1, 1, 1, 'language-fallback')), low)
  assert.equal(graphNodeRadius(node('a/none', 1, 1, 1, 'none')), low)
  assert.equal(graphNodeRadius(node('a/root', 0, 0, .1)), graphNodeRadius(node('a/root', 0, 0, 1)))
})

test('layout is deterministic independent of input order and uses shortest real discovery path for parents', () => {
  const nodes = [node('a/root', 0, 0), node('a/first'), node('a/second', 2), node('a/shared', 1, 2)]
  const edges = [edge('a/root', 'a/first'), edge('a/root', 'a/second', 'related'), edge('a/first', 'a/shared'), edge('a/second', 'a/shared', 'related'), edge('a/shared', 'a/root')]
  const first = layoutGraph(nodes, edges), reverse = layoutGraph([...nodes].reverse(), [...edges].reverse())
  assert.deepEqual([...first], [...reverse])
  assert.equal(first.get('a/shared').parentId, 'a/first')
  nodes.find(n => n.id === 'a/shared').overlapRoot = 'a/second'
  assert.equal(layoutGraph(nodes, edges).get('a/shared').parentId, 'a/first')
})

test('expanded branches reserve separate finite space for up to 120 nodes and five manual layers', () => {
  const nodes = [node('a/root', 0, 0)], edges = []
  for (let i = 0; i < 119; i++) {
    const id = `a/node-${String(i).padStart(3, '0')}`, depth = i < 24 ? 1 : i < 48 ? 2 : i < 72 ? 3 : i < 96 ? 4 : 5
    const parent = depth === 1 ? 'a/root' : `a/node-${String(i - 24).padStart(3, '0')}`
    nodes.push(node(id, i % 3 === 0 ? 2 : 1, depth, i / 120)); edges.push(edge(parent, id, i % 3 === 0 ? 'related' : 'direct'))
  }
  const positions = layoutGraph(nodes, edges)
  assert.equal(positions.size, 120)
  for (const point of positions.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
  const all = [...positions.values()]
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) > all[i].radius + all[j].radius)
  const camera = fitCamera(nodes, positions, { width: 360, height: 390 })
  assert.ok(camera.scale > 0 && Number.isFinite(camera.scale))
})

test('required labels remain complete and bounded in screen space with deterministic placement', () => {
  const nodes = [node('a/root', 0, 0), node('a/selected-long-repository-name'), node('a/overlap'), node('a/expanded'), node('a/unlabelled', 2, 1, .1)]
  const positions = layoutGraph(nodes, nodes.slice(1).map(n => edge('a/root', n.id)))
  const size = { width: 360, height: 390 }, camera = fitCamera(nodes, positions, size)
  const names = new Set(nodes.slice(0, 4).map(n => n.id)), branches = new Set(['a/expanded'])
  const labels = placeGraphLabels(nodes, positions, names, branches, camera, size, 1, 'a/selected-long-repository-name', true)
  assert.equal(labels.size, 4)
  assert.equal(labels.get('a/selected-long-repository-name').lines.join(''), 'a/selected-long-repository-name')
  assert.deepEqual(labels, placeGraphLabels(nodes, positions, names, branches, camera, size, 1, 'a/selected-long-repository-name', true))
  for (const [id, label] of labels) {
    const point = positions.get(id), screenX = size.width / 2 + (point.x - camera.x) * camera.scale, screenY = size.height / 2 + (point.y - camera.y) * camera.scale
    assert.ok(screenX + label.x >= 0 && screenX + label.x + label.width <= size.width)
    assert.ok(screenY + label.y >= 0 && screenY + label.y + label.height <= size.height)
  }
})
