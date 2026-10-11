import test from 'node:test'
import assert from 'node:assert/strict'
import { GRAPH_SEMANTICS_VERSION, relationFromEvidence } from '../shared/graph-relations.mjs'

test('legacy attribution and citations stay undirected while actual dependencies and people retain safe semantics', () => {
  assert.equal(GRAPH_SEMANTICS_VERSION, 2)
  for (const kind of ['credit', 'citation', 'copyright', 'readme-reference']) assert.equal(relationFromEvidence([{ kind }]), 'reference')
  assert.equal(relationFromEvidence([{ kind: 'dependency' }]), 'upstream')
  for (const kind of ['contributor', 'codeowner', 'readme-maintainer', 'owner', 'readme-related']) assert.equal(relationFromEvidence([{ kind }]), 'related')
  assert.equal(relationFromEvidence(null), 'reference')
  assert.equal(relationFromEvidence([null, {}, { relation: 'forged' }]), 'reference')
})

test('merged evidence preserves an explicit direction and represents contradictions without inventing two arrows', () => {
  const unknown = { kind: 'citation' }, related = { kind: 'owner' }
  const upstream = { kind: 'credit', relation: 'upstream' }, downstream = { kind: 'readme-reference', relation: 'downstream' }
  for (const values of [[upstream, unknown, related], [related, unknown, upstream]]) assert.equal(relationFromEvidence(values), 'upstream')
  assert.equal(relationFromEvidence([downstream, unknown, related]), 'downstream')
  for (const values of [[upstream, downstream], [downstream, upstream]]) assert.equal(relationFromEvidence(values), 'ambiguous')
  assert.equal(relationFromEvidence([upstream, { relation: 'ambiguous' }]), 'ambiguous')
  assert.equal(relationFromEvidence([{ kind: 'readme-related', relation: 'reference' }]), 'reference', 'explicit conservative classification takes precedence over a section default')
})
