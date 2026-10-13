import type { GraphEdge, GraphNode } from '../../api/graph'
// Adapted from the original graph layout; see ADR 0004 for the browser-only port.
import { compareGraphNodes, type WorkspaceNode, type GraphCamera } from '../../store/graph'
type Camera = GraphCamera
export type CanvasSize = { width: number; height: number }
type GraphPoint = GraphPosition
type LabelBox = { x: number; y: number; width: number; height: number }
export type NodeLabel = LabelBox & { lines: string[]; fontSize: number; lineHeight: number; leader?: { x: number; y: number } }
const INITIAL_CAMERA: Camera = { x: 0, y: 0, scale: 1, mode: 'overview' }
export interface GraphPosition { x: number; y: number; radius: number; parentId?: string }
export function graphNodeRadius(node: GraphNode): number {
  if (node.tier === 0) return 17;
  const score = node.overlap.method === 'topics' && Number.isFinite(node.overlap.score) ? Math.max(0, Math.min(1, node.overlap.score)) : 0;
  // Area, rather than radius, is proportional to genuine topic overlap.
  return Math.sqrt(7 ** 2 + (15 ** 2 - 7 ** 2) * score);
}

interface LayoutBranch { node: WorkspaceNode; kind: GraphEdge['kind'] }
interface SubtreeLayout { positions: Map<string, GraphPosition>; centerX: number; radius: number }
const NODE_SPACE = 42, BRANCH_GAP = 28;
const compareIds = (a: string, b: string) => a.localeCompare(b, 'en');
const compareStableNodes = (a: GraphNode, b: GraphNode) => compareGraphNodes(a, b) || compareIds(a.id, b.id);

export function layoutGraph(nodes: WorkspaceNode[], edges: GraphEdge[] = []): Map<string, GraphPosition> {
  if (!nodes.length) return new Map();
  const ordered = [...nodes].sort((a, b) => a.tier - b.tier || a.depth - b.depth || compareStableNodes(a, b));
  const root = ordered.find(node => node.tier === 0) || ordered.find(node => node.depth === 0) || ordered[0];
  const byId = new Map(ordered.map(node => [node.id, node]));
  const incoming = new Map<string, Map<string, GraphEdge['kind']>>();
  const outgoing = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    const sources = incoming.get(edge.target) || new Map<string, GraphEdge['kind']>();
    if (!sources.has(edge.source) || edge.kind === 'direct') sources.set(edge.source, edge.kind);
    incoming.set(edge.target, sources);
    const targets = outgoing.get(edge.source) || new Set<string>();
    targets.add(edge.target); outgoing.set(edge.source, targets);
  }

  // The shortest root-reachable route supplies structure. overlapRoot describes
  // a score comparison and may change after merging; it is never a parent link.
  const distances = new Map<string, number>([[root.id, 0]]), queue = [root.id];
  for (let index = 0; index < queue.length; index++) {
    const source = queue[index];
    for (const target of [...(outgoing.get(source) || [])].sort(compareIds)) {
      if (distances.has(target)) continue;
      distances.set(target, distances.get(source)! + 1); queue.push(target);
    }
  }
  const parents = new Map<string, string>();
  const children = new Map<string, LayoutBranch[]>();
  for (const node of ordered) {
    if (node.id === root.id) continue;
    const candidates = [...(incoming.get(node.id) || [])]
      .filter(([source]) => distances.has(source) && distances.get(source)! + 1 === distances.get(node.id))
      .sort(([a, aKind], [b, bKind]) => Number(aKind === 'related') - Number(bKind === 'related') || compareStableNodes(byId.get(a)!, byId.get(b)!));
    // Missing edges get a deterministic root-level slot, not an invented lineage.
    const [parentId, kind] = candidates[0] || [root.id, node.tier === 2 ? 'related' : 'direct'];
    parents.set(node.id, parentId);
    const branches = children.get(parentId) || [];
    branches.push({ node, kind }); children.set(parentId, branches);
  }
  for (const branches of children.values()) branches.sort((a, b) => Number(a.kind === 'related') - Number(b.kind === 'related') || compareStableNodes(a.node, b.node));

  const pack = (node: WorkspaceNode, isRoot: boolean): SubtreeLayout => {
    const parentId = parents.get(node.id);
    const positions = new Map<string, GraphPosition>([[node.id, { x: 0, y: 0, radius: graphNodeRadius(node), ...(parentId ? { parentId } : {}) }]]);
    const branches = children.get(node.id) || [];
    if (!branches.length) return { positions, centerX: 0, radius: NODE_SPACE };
    const packed = branches.map(branch => ({ ...branch, layout: pack(branch.node, false) }));
    const weight = packed.reduce((sum, branch) => sum + Math.sqrt(branch.layout.radius), 0);
    const sweep = isRoot ? Math.PI * 2 : Math.PI * 4 / 3;
    let cursor = isRoot ? -Math.PI / 2 : -sweep / 2;
    const counts = { direct: branches.filter(branch => branch.kind === 'direct').length, related: branches.filter(branch => branch.kind === 'related').length };
    const ranks = { direct: 0, related: 0 };
    const slots = packed.map(branch => {
      const width = sweep * Math.sqrt(branch.layout.radius) / weight;
      const angle = packed.length === 1 ? 0 : cursor + width / 2; cursor += width;
      const rank = ranks[branch.kind]++, fraction = rank / Math.max(1, counts[branch.kind] - 1);
      const distance = (isRoot ? branch.kind === 'direct' ? 150 : 330 : branch.kind === 'direct' ? 95 : 165) + fraction * (isRoot ? 110 : 65);
      // Expanded parents move out with their occupied subtree. An offset circle
      // keeps long single-child chains compact instead of doubling every level.
      const anchor = distance + Math.max(0, branch.layout.radius - branch.layout.centerX);
      return { ...branch, angle, anchor, centerDistance: anchor + branch.layout.centerX };
    });

    // Solve the extra radial distance needed for every pair of complete subtree
    // circles. This gives a strict sibling separation guarantee, including all
    // descendants, rather than relying on individual node repulsion.
    let extra = 0;
    for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
      const first = slots[a], second = slots[b], cosine = Math.cos(first.angle - second.angle);
      const aa = 2 * (1 - cosine), bb = (first.centerDistance + second.centerDistance) * aa;
      const minimum = first.layout.radius + second.layout.radius + BRANCH_GAP;
      const cc = (first.centerDistance - second.centerDistance) ** 2 + first.centerDistance * second.centerDistance * aa - minimum ** 2;
      if (cc < 0) extra = Math.max(extra, -2 * cc / (bb + Math.sqrt(bb ** 2 - 4 * aa * cc)));
    }
    const circles: { x: number; y: number; radius: number }[] = [];
    let minX = -NODE_SPACE, maxX = NODE_SPACE;
    for (const slot of slots) {
      const cosine = Math.cos(slot.angle), sine = Math.sin(slot.angle), distance = slot.anchor + extra;
      for (const [id, point] of slot.layout.positions) positions.set(id, { ...point, x: cosine * (point.x + distance) - sine * point.y, y: sine * (point.x + distance) + cosine * point.y });
      const center = slot.centerDistance + extra, circle = { x: cosine * center, y: sine * center, radius: slot.layout.radius };
      circles.push(circle); minX = Math.min(minX, circle.x - circle.radius); maxX = Math.max(maxX, circle.x + circle.radius);
    }
    let centerX = (minX + maxX) / 2;
    const radius = Math.max(NODE_SPACE + Math.abs(centerX), ...circles.map(circle => Math.hypot(circle.x - centerX, circle.y) + circle.radius));
    // All enclosing circles have y=0, so the parent can rotate each complete
    // branch toward its own slot without recomputing descendant geometry.
    if (centerX < 0) { centerX = -centerX; for (const point of positions.values()) point.x = -point.x; }
    return { positions, centerX, radius };
  };
  return pack(root, true).positions;
}
const MIN_NODE_DENSITY = .05, MIN_NODE_GAP = 3;
export function fitCamera(nodes: WorkspaceNode[], positions: Map<string, GraphPoint>, size: CanvasSize, focus?: GraphPoint): Camera {
  const entries = nodes.flatMap(node => { const point = positions.get(node.id); return point ? [{ node, point, radius: point.radius + 5 }] : []; });
  if (!entries.length) return INITIAL_CAMERA;
  const width = Math.max(80, size.width - 24), height = Math.max(80, size.height - 48);
  const boundsAt = (scale: number) => ({
    left: Math.min(...entries.map(({ point, radius }) => (point.x - (focus?.x || 0)) * scale - radius)),
    right: Math.max(...entries.map(({ point, radius }) => (point.x - (focus?.x || 0)) * scale + radius)),
    top: Math.min(...entries.map(({ point, radius }) => (point.y - (focus?.y || 0)) * scale - radius)),
    bottom: Math.max(...entries.map(({ point, radius }) => (point.y - (focus?.y || 0)) * scale + radius)),
  });
  // Fit circles and halos once. Labels are independently avoided and clamped in
  // screen space below; reserving their full footprints here compresses small
  // root-centered graphs until a nearby center falls inside the fixed root.
  let low = .00001, high = 2;
  for (let a = 0; a < entries.length; a += 1) for (let b = a + 1; b < entries.length; b += 1) {
    const first = entries[a], second = entries[b], distance = Math.hypot(first.point.x - second.point.x, first.point.y - second.point.y);
    if (!distance) continue;
    const minimumRadius = (entry: typeof first) => entry.point.radius * (entry.node.tier === 0 ? 1 : MIN_NODE_DENSITY);
    low = Math.max(low, (minimumRadius(first) + minimumRadius(second) + MIN_NODE_GAP) / distance);
  }
  for (let step = 0; step < 28; step += 1) {
    const middle = (low + high) / 2, bounds = boundsAt(middle);
    const fits = focus ? Math.max(-bounds.left, bounds.right) * 2 <= width && Math.max(-bounds.top, bounds.bottom) * 2 <= height : bounds.right - bounds.left <= width && bounds.bottom - bounds.top <= height;
    if (fits) low = middle; else high = middle;
  }
  const bounds = boundsAt(low);
  return { x: focus?.x ?? (bounds.left + bounds.right) / (2 * low), y: focus?.y ?? (bounds.top + bounds.bottom) / (2 * low), scale: low, mode: focus ? 'focus' : 'overview' };
}
export function graphDensity(nodes: WorkspaceNode[], positions: Map<string, GraphPoint>, camera: Camera) {
  let factor = 1;
  for (let a = 0; a < nodes.length; a += 1) for (let b = a + 1; b < nodes.length; b += 1) {
    const first = positions.get(nodes[a].id), second = positions.get(nodes[b].id); if (!first || !second) continue;
    const distance = Math.hypot(first.x - second.x, first.y - second.y) * camera.scale - MIN_NODE_GAP;
    const rootRadius = nodes[a].tier === 0 ? first.radius : nodes[b].tier === 0 ? second.radius : 0;
    const scalable = (nodes[a].tier === 0 ? 0 : first.radius) + (nodes[b].tier === 0 ? 0 : second.radius);
    if (scalable) factor = Math.min(factor, (distance - rootRadius) / scalable);
  }
  // One shared factor preserves the topic area ordering, including the 30%
  // threshold. Focus restores full circle sizes whenever the visible spacing
  // permits them, while the root remains fixed and prominent.
  return Math.max(MIN_NODE_DENSITY, factor);
}
export function placeGraphLabels(nodes: WorkspaceNode[], positions: Map<string, GraphPoint>, labels: Set<string>, branches: Set<string>, camera: Camera, size: CanvasSize, density: number, selectedId: string, comfortable: boolean) {
  const result = new Map<string, NodeLabel>(), fontSize = comfortable ? 11 : nodes.length > 80 || size.width < 400 ? 9 : 10, lineHeight = fontSize + 2;
  const screen = (point: GraphPoint) => ({ x: size.width / 2 + (point.x - camera.x) * camera.scale, y: size.height / 2 + (point.y - camera.y) * camera.scale });
  const visible = nodes.flatMap(node => { const point = positions.get(node.id); if (!point) return []; const center = screen(point), radius = point.radius * (node.tier === 0 ? 1 : density); return center.x < -radius || center.y < -radius || center.x > size.width + radius || center.y > size.height + radius ? [] : [{ node, center, radius }]; });
  const occupied: LabelBox[] = visible.map(({ center, radius }) => ({ x: center.x - radius - 3, y: center.y - radius - 3, width: 2 * radius + 6, height: 2 * radius + 6 }));
  const intersects = (a: LabelBox, b: LabelBox) => a.x < b.x + b.width + 2 && a.x + a.width + 2 > b.x && a.y < b.y + b.height + 2 && a.y + a.height + 2 > b.y;
  const sorted = visible.filter(item => labels.has(item.node.id)).sort((a, b) => Number(b.node.id === selectedId) - Number(a.node.id === selectedId) || Number(branches.has(b.node.id)) - Number(branches.has(a.node.id)) || b.node.overlap.score - a.node.overlap.score || a.node.id.localeCompare(b.node.id));
  for (const { node, center, radius } of sorted) {
    const columns = Math.max(8, Math.min(24, Math.floor((size.width - 26) / (fontSize * .85)))), lines = node.repo.nameWithOwner.match(new RegExp(`.{1,${columns}}`, 'gu')) || [node.repo.nameWithOwner];
    const estimatedWidth = Math.max(...lines.map(line => [...line].reduce((width, character) => width + (/[MW@%]/u.test(character) ? 1.05 : .78) * fontSize, 0)));
    const width = Math.min(size.width - 16, Math.max(estimatedWidth + 8, branches.has(node.id) ? 150 : 0)), height = lines.length * lineHeight + (branches.has(node.id) ? 13 : 0) + 3;
    const below = { x: center.x - width / 2, y: center.y + radius + 6 }, above = { x: center.x - width / 2, y: center.y - radius - height - 6 }, left = { x: center.x - radius - width - 7, y: center.y - height / 2 }, right = { x: center.x + radius + 7, y: center.y - height / 2 };
    const outward = Math.abs(center.x - size.width / 2) > Math.abs(center.y - size.height / 2) ? center.x < size.width / 2 ? left : right : center.y < size.height / 2 ? above : below;
    const candidates = node.id === selectedId ? [below, above, right, left] : [outward, below, above, right, left];
    // Bounded deterministic search keeps names visible even when a small
    // embedded canvas packs many high-overlap projects into one ring.
    for (let distance = 16; distance <= Math.max(size.width, size.height); distance += 16) for (let angle = 0; angle < 16; angle += 1) {
      candidates.push({ x: center.x + Math.cos(angle * Math.PI / 8) * distance - width / 2, y: center.y + Math.sin(angle * Math.PI / 8) * distance - height / 2 });
    }
    let best: LabelBox | undefined, lowestOverlap = Infinity;
    for (const candidate of candidates) {
      const box = { x: Math.max(8, Math.min(size.width - width - 8, candidate.x)), y: Math.max(7, Math.min(size.height - height - 28, candidate.y)), width, height };
      let overlap = 0;
      for (const other of occupied) if (intersects(box, other)) overlap += Math.max(0, Math.min(box.x + width + 2, other.x + other.width + 2) - Math.max(box.x, other.x)) * Math.max(0, Math.min(box.y + height + 2, other.y + other.height + 2) - Math.max(box.y, other.y));
      if (overlap < lowestOverlap) { best = box; lowestOverlap = overlap; }
      if (!overlap) break;
    }
    if (!best) continue;
    if (labels.has(node.id)) occupied.push(best);
    const x = best.x - center.x, y = best.y - center.y, endpoint = { x: Math.max(x, Math.min(x + width, 0)), y: Math.max(y, Math.min(y + height, 0)) };
    result.set(node.id, { ...best, x, y, lines, fontSize, lineHeight, leader: Math.hypot(endpoint.x, endpoint.y) > radius + 11 ? endpoint : undefined });
  }
  return result;
}
