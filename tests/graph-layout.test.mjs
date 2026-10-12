import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/graph-data.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replaceAll('../shared/graph-relations.mjs', new URL('../shared/graph-relations.mjs', import.meta.url).href)
const { layoutGraph, graphNodeRadius, compareGraphNodes, mergeGraph, MAX_GRAPH_DEPTH, MAX_GRAPH_NODES } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

function node(id, options = {}) {
  const { tier = 1, depth = tier ? 1 : 0, score = 0.5, stars = 100, method = 'topics', overlapRoot = 'acme/root' } = options
  return { id, tier, depth, overlapRoot, repo: { full_name: id, name: id.split('/')[1], stargazers_count: stars }, overlap: { score, shared: method === 'topics' ? ['test'] : [], method }, evidence: [] }
}
const edge = (source, target, kind = 'direct') => ({ source, target, kind, evidence: [] })
const distance = (a, b = { x: 0, y: 0 }) => Math.hypot(a.x - b.x, a.y - b.y)
const snapshot = positions => [...positions].sort(([a], [b]) => a.localeCompare(b))
const root = () => node('acme/root', { tier: 0, score: 1 })

test('layout is identical across input permutations and keeps all shared and cyclic relations intact', () => {
  const nodes = [root(), node('acme/a', { score: 0.9 }), node('acme/b', { score: 0.8 }), node('acme/shared', { depth: 2 }), node('acme/leaf', { depth: 3 })]
  const edges = [edge('acme/root', 'acme/a'), edge('acme/root', 'acme/b'), edge('acme/a', 'acme/shared', 'related'), edge('acme/b', 'acme/shared'), edge('acme/shared', 'acme/leaf'), edge('acme/leaf', 'acme/b'), edge('acme/a', 'acme/shared')]
  const original = JSON.stringify({ nodes, edges })
  const expected = snapshot(layoutGraph(nodes, edges))
  for (let shift = 0; shift < nodes.length; shift++) {
    const reordered = [...nodes.slice(shift), ...nodes.slice(0, shift)].reverse()
    assert.deepEqual(snapshot(layoutGraph(reordered, [...edges].reverse())), expected)
  }
  assert.equal(expected.length, nodes.length, 'a shared target must have exactly one position')
  assert.equal(JSON.stringify({ nodes, edges }), original, 'layout must not remove, reorder or rewrite real graph data')
})

test('structural parents follow shortest root-reachable edges, independent of overlapRoot and stored depth', () => {
  const nodes = [root(), node('acme/a', { score: 0.5, stars: 10 }), node('acme/b', { score: 0.5, stars: 20 }), node('acme/shared', { depth: 1, overlapRoot: 'acme/a' }), node('acme/near', { depth: 5 }), node('acme/orphan', { depth: 4, overlapRoot: 'acme/shared' })]
  const edges = [edge('acme/root', 'acme/a'), edge('acme/root', 'acme/b'), edge('acme/a', 'acme/shared'), edge('acme/b', 'acme/shared'), edge('acme/shared', 'acme/near'), edge('acme/root', 'acme/near', 'related')]
  const positions = layoutGraph(nodes, edges)
  assert.equal(positions.get('acme/shared').parentId, 'acme/b', 'equal-length direct routes use the original ranking of their parents')
  assert.equal(positions.get('acme/near').parentId, 'acme/root', 'a longer direct route cannot replace a root-level relationship')
  assert.equal(positions.get('acme/orphan').parentId, 'acme/root', 'an absent relationship must not be inferred from the score basis')
  assert.equal(positions.get('acme/root').parentId, undefined)
  assert.deepEqual(snapshot(layoutGraph(nodes.map(item => ({ ...item, overlapRoot: 'unrelated/basis' })), edges)), snapshot(positions))
})

test('node area grows linearly with real topic overlap, without promoting fallback matches', () => {
  const radii = [0, 0.25, 0.5, 0.75, 1].map(score => graphNodeRadius(node('acme/topic', { score })))
  assert.equal(radii[0], 7)
  assert.equal(radii.at(-1), 15)
  for (let index = 1; index < radii.length; index++) {
    assert.ok(radii[index] > radii[index - 1])
    assert.ok(Math.abs(radii[index] ** 2 - radii[index - 1] ** 2 - 44) < 1e-10)
  }
  for (const method of ['language-fallback', 'none']) assert.equal(graphNodeRadius(node('acme/fallback', { method, score: 1 })), 7)
  assert.equal(graphNodeRadius(node('acme/topic', { score: -1 })), 7)
  assert.equal(graphNodeRadius(node('acme/topic', { score: 2 })), 15)
  assert.equal(graphNodeRadius(node('acme/topic', { score: NaN })), 7)
  assert.equal(graphNodeRadius(node('acme/topic', { score: 0.5, stars: 1_000_000 })), radii[2])
  assert.equal(graphNodeRadius(root()), 17)
})

test('a single level retains distinct inner/outer tiers and topic, Stars, name distance ranking', () => {
  const nodes = [root(), node('acme/z', { score: 0.9, stars: 1 }), node('acme/c', { score: 0.5, stars: 10 }), node('acme/b', { score: 0.5, stars: 10 }), node('acme/a', { score: 0.5, stars: 20 }), node('acme/related-high', { tier: 2, score: 1 }), node('acme/related-low', { tier: 2, score: 0.1 })]
  const edges = nodes.slice(1).map(item => edge('acme/root', item.id, item.tier === 2 ? 'related' : 'direct'))
  const positions = layoutGraph(nodes, edges)
  const direct = nodes.filter(item => item.tier === 1).sort(compareGraphNodes)
  assert.deepEqual(direct.map(item => item.id), ['acme/z', 'acme/a', 'acme/b', 'acme/c'])
  for (let index = 1; index < direct.length; index++) assert.ok(distance(positions.get(direct[index].id)) > distance(positions.get(direct[index - 1].id)))
  assert.ok(distance(positions.get('acme/related-high')) > distance(positions.get(direct.at(-1).id)))
  assert.ok(distance(positions.get('acme/related-low')) > distance(positions.get('acme/related-high')))
  assert.equal(positions.get('acme/z').radius, graphNodeRadius(nodes[1]))
})

function expandedFixture() {
  const nodes = [root(), node('acme/a', { score: 1 }), node('acme/b', { score: 0.95 })]
  const edges = [edge('acme/root', 'acme/a'), edge('acme/root', 'acme/b')]
  const branchA = ['acme/a'], branchB = ['acme/b'], rest = []
  for (let index = 0; index < 6; index++) {
    const id = `acme/rest-${index}`; rest.push(id)
    nodes.push(node(id, { score: 0.7 - index / 100 })); edges.push(edge('acme/root', id))
  }
  for (const [parent, count, branch] of [['acme/a', 12, branchA], ['acme/b', 8, branchB]]) for (let index = 0; index < count; index++) {
    const id = `${parent}-${index}`; branch.push(id)
    nodes.push(node(id, { depth: 2, score: 0.9 - index / 100, overlapRoot: parent, tier: index % 3 ? 1 : 2 }))
    edges.push(edge(parent, id, index % 3 ? 'direct' : 'related'))
  }
  for (let index = 0; index < 5; index++) {
    const id = `acme/grand-${index}`; branchA.push(id)
    nodes.push(node(id, { depth: 3, overlapRoot: 'acme/a-0' })); edges.push(edge('acme/a-0', id))
  }
  return { nodes, edges, branchA, branchB, rest }
}

test('two manually expanded branches remain separate as complete subtrees and move their parents outward', () => {
  const { nodes, edges, branchA, branchB, rest } = expandedFixture()
  const positions = layoutGraph(nodes, edges)
  for (const a of branchA) for (const b of [...branchB, ...rest]) assert.ok(distance(positions.get(a), positions.get(b)) >= 111.9, `${a} collides with another branch ${b}`)
  for (const a of branchB) for (const b of rest) assert.ok(distance(positions.get(a), positions.get(b)) >= 111.9)
  assert.ok(distance(positions.get('acme/a')) > Math.max(...rest.map(id => distance(positions.get(id)))) + 80, 'the expanded parent must leave the unexpanded root-level group')
  assert.equal(positions.get('acme/grand-0').parentId, 'acme/a-0')
  const childDistances = branchB.slice(1).map(id => distance(positions.get(id), positions.get('acme/b')))
  assert.ok(Math.max(...childDistances) < distance(positions.get('acme/a'), positions.get('acme/b')), 'a local branch should form a neighborhood around its own parent')
})

test('a five-level single-child branch stays compact and points stay distinct', () => {
  const nodes = [root()], edges = []
  for (let depth = 1; depth <= MAX_GRAPH_DEPTH; depth++) {
    const id = `acme/chain-${depth}`, parent = depth === 1 ? 'acme/root' : `acme/chain-${depth - 1}`
    nodes.push(node(id, { depth, overlapRoot: parent })); edges.push(edge(parent, id))
  }
  const positions = layoutGraph(nodes, edges)
  assert.ok(Math.max(...[...positions.values()].map(point => distance(point))) < 1_200, 'a unary chain must not grow exponentially with depth')
  for (let depth = 1; depth <= MAX_GRAPH_DEPTH; depth++) {
    const point = positions.get(`acme/chain-${depth}`), parent = positions.get(point.parentId)
    assert.ok(distance(point, parent) >= 130)
  }
})

test('the 120-node, five-depth budget yields finite separated geometry without changing merge limits', () => {
  const nodes = [root()], edges = []
  for (let index = 1; index < MAX_GRAPH_NODES; index++) {
    const parentIndex = index === MAX_GRAPH_NODES - 1 ? index - 1 : Math.floor((index - 1) / 3), parent = nodes[parentIndex]
    const id = `acme/n-${String(index).padStart(3, '0')}`
    nodes.push(node(id, { depth: parent.depth + 1, tier: index % 4 ? 1 : 2, score: (index % 10) / 10, overlapRoot: parent.id }))
    edges.push(edge(parent.id, id, index % 4 ? 'direct' : 'related'))
  }
  assert.equal(Math.max(...nodes.map(item => item.depth)), MAX_GRAPH_DEPTH)
  const positions = layoutGraph(nodes, edges)
  assert.equal(positions.size, MAX_GRAPH_NODES)
  for (const point of positions.values()) for (const coordinate of [point.x, point.y, point.radius]) assert.ok(Number.isFinite(coordinate))
  const points = [...positions.values()]
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) assert.ok(distance(points[a], points[b]) >= 111.9, `nodes ${a}/${b} overlap`)
  assert.deepEqual(snapshot(layoutGraph([...nodes].reverse(), [...edges].reverse())), snapshot(positions))
  const graph = { version: 1, root: 'acme/root', generatedAt: '2026-10-11T00:00:00.000Z', nodes, edges, people: [], warnings: [], counts: {}, limits: {} }
  const merged = mergeGraph(null, graph)
  assert.equal(merged.nodes.length, MAX_GRAPH_NODES)
  const denied = mergeGraph(merged, { ...graph, nodes: [root(), node('acme/over-budget')], edges: [edge('acme/root', 'acme/over-budget')] })
  assert.equal(denied.nodes.length, MAX_GRAPH_NODES)
  assert.ok(!denied.nodes.some(item => item.id === 'acme/over-budget'))
  assert.ok(denied.warnings.some(message => message.includes('120')))
  let chain = null
  for (let depth = 0; depth <= MAX_GRAPH_DEPTH; depth++) {
    const parent = depth === 0 ? root() : node(`acme/chain-${depth}`, { tier: 0 })
    const child = node(`acme/chain-${depth + 1}`)
    chain = mergeGraph(chain, { ...graph, root: parent.id, nodes: [parent, child], edges: [edge(parent.id, child.id)] })
  }
  assert.equal(chain.nodes.length, MAX_GRAPH_DEPTH + 1)
  assert.equal(Math.max(...chain.nodes.map(item => item.depth)), MAX_GRAPH_DEPTH)
  assert.ok(!chain.nodes.some(item => item.id === 'acme/chain-6'))
  assert.ok(chain.warnings.some(message => message.includes('5 层')))
})
