import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, ExternalLink, Focus, GitBranch, Github, LoaderCircle, Maximize2, Minimize2, Network, RefreshCw, RotateCcw, Scan, Search, Star, ZoomIn, ZoomOut } from 'lucide-react';
import { formatNumber, projectPath, safeUrl } from './data';
import { MAX_GRAPH_DEPTH, MAX_GRAPH_NODES, canonicalId, evidenceLabels, graphPath, graphTime, layoutGraph, parseRepository, phaseLabels, type GraphEdge, type GraphEvidence, type GraphJob, type GraphWorkspace, type WorkspaceNode } from './graph-data';
import { graphWorkspaceCache, initialGraphView, restoreGraphCamera, type GraphCamera, type GraphCanvasSize, type GraphRequestLease, type GraphWorkspaceView as SavedGraphView } from './graph-workspace-cache';
import { relationFromEvidence, type GraphRelation } from '../shared/graph-relations.mjs';
import './graph.css';

interface Props {
  owner?: string; name?: string; account: string; csrfToken: string | null; embedded?: boolean;
  sessionError?: string; onSessionRetry: () => void; onSessionExpired: () => void;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void; onRoute: (path: string) => void;
}
type GraphFailure = Error & { status?: number; code?: string };
const terminal = (job: GraphJob) => ['complete', 'partial', 'failed'].includes(job.status);
const MAX_POLLS = 80, MAX_WAIT = 120_000, POLL_INTERVAL = 1_200;
function wait(ms: number, signal: AbortSignal) { return new Promise<void>((resolve, reject) => { const aborted = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms); signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted(); }); }
async function graphRequest(path: string, options: RequestInit, signal: AbortSignal): Promise<{ job: GraphJob; cached: boolean }> {
  const response = await fetch(path, { ...options, signal, credentials: 'same-origin' }), body = await response.json().catch(() => null);
  if (!response.ok) { const error: GraphFailure = new Error(body?.error || `图谱请求失败（${response.status}）`); error.status = response.status; error.code = body?.code; throw error; }
  if (!body || typeof body.id !== 'string' || !['queued', 'running', 'complete', 'partial', 'failed'].includes(body.status) || !(body.phase in phaseLabels) || typeof body.progress !== 'number') throw new Error('图谱响应格式不完整，请重试。');
  return { job: body, cached: options.method === 'POST' && response.status === 200 && terminal(body) };
}
function CircleProgress({ job, busy }: { job: GraphJob | null; busy: boolean }) {
  const progress = Math.min(100, Math.max(0, job?.progress || 0));
  return <div className="tg-progress" role={job ? 'progressbar' : 'status'} aria-label="技术图谱分析进度" aria-valuemin={job ? 0 : undefined} aria-valuemax={job ? 100 : undefined} aria-valuenow={job ? progress : undefined} aria-valuetext={job ? `${phaseLabels[job.phase]} ${progress}%` : undefined}><svg viewBox="0 0 64 64" aria-hidden="true"><circle className="tg-progress-track" cx="32" cy="32" r="27" /><circle className="tg-progress-value" cx="32" cy="32" r="27" pathLength="100" strokeDasharray={`${progress} 100`} /></svg><span>{job ? `${Math.round(progress)}%` : busy ? <LoaderCircle size={18} className="spinning" /> : <Network size={20} />}</span></div>;
}
const relationLabels: Record<GraphRelation, string> = { upstream: '技术上游', downstream: '下游使用方', related: '相关项目', reference: '文档引用', ambiguous: '方向不确定' };
const relationReasons: Record<GraphRelation, string> = { upstream: '证据表明被引用项目为分析仓库提供技术来源。', downstream: '证据表明被引用项目使用分析仓库。', related: '已确认项目或人员关联，技术方向未确定。', reference: '仅确认文档引用，技术方向不确定。', ambiguous: '证据含糊或冲突，技术方向不确定。' };
function technicalFlow(edge: GraphEdge, relation: GraphRelation) { return relation === 'upstream' ? { source: edge.target, target: edge.source } : relation === 'downstream' ? { source: edge.source, target: edge.target } : null; }
function relationDescription(relation: GraphRelation, source: string, target: string) { return relation === 'upstream' ? `${target} 是 ${source} 的技术上游` : relation === 'downstream' ? `${target} 是 ${source} 的下游使用方` : relation === 'related' ? `${source} 与 ${target} 是相关项目，技术方向未确定` : relation === 'reference' ? `${source} 的文档引用了 ${target}，技术方向不确定` : `${source} 与 ${target} 的证据含糊或冲突，技术方向不确定`; }
export function EvidenceList({ evidence, showRelation = false }: { evidence: GraphEvidence[]; showRelation?: boolean }) {
  return evidence.length ? <ul className="tg-evidence-list">{evidence.map((item, index) => {
    const sourceUrl = safeUrl(item.url), targetUrl = safeUrl(item.targetUrl), line = sourceUrl?.match(/#L(\d+)(?:-L?(\d+))?$/), relation = relationFromEvidence([item]);
    return <li key={`${item.kind}:${item.url}:${index}`}><span>{evidenceLabels[item.kind] || item.kind}{item.person && ` · ${item.person}`}{showRelation && ` · ${relationLabels[relation]}`}</span>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{item.label || '查看来源'}<ExternalLink size={11} /></a> : <strong>{item.label}</strong>}{line && <small className="tg-source-line">来源行：第 {line[1]}{line[2] ? `–${line[2]}` : ''} 行</small>}{item.targetUrl && <div className="tg-reference-url"><span>引用仓库链接</span>{targetUrl ? <a href={targetUrl} target="_blank" rel="noopener noreferrer">{item.targetUrl}<ExternalLink size={10} /></a> : <span>{item.targetUrl}</span>}</div>}{item.excerpt && <p className="tg-evidence-excerpt">{item.excerpt}</p>}{showRelation && <p className="tg-relation-reason">判定依据：{item.relationReason || relationReasons[relation]}</p>}</li>;
  })}</ul> : <p className="tg-muted">中心仓库。选择相连节点查看已核实的证据。</p>;
}
export function GraphRelationDetails({ edge, sourceName = edge.source, targetName = edge.target }: { edge: GraphEdge; sourceName?: string; targetName?: string }) {
  const relation = relationFromEvidence(edge.evidence), flow = technicalFlow(edge, relation), displayName = (id: string) => id === edge.source ? sourceName : targetName;
  return <section className={`tg-relation-card relation-${relation}`} data-analyzed-source={edge.source} data-relation={relation}><div className="tg-relation-heading"><strong>{relationLabels[relation]}</strong><span>分析仓库：{sourceName}</span></div><p>{relationDescription(relation, sourceName, targetName)}</p>{flow ? <p className="tg-technical-flow">技术流向：{displayName(flow.source)} → {displayName(flow.target)}</p> : <p className="tg-technical-flow">无箭头关联线 · 技术方向未确定</p>}<EvidenceList evidence={edge.evidence} showRelation /></section>;
}
export function GraphRelationLine({ edge, markerId, emphasis, sourceName = edge.source, targetName = edge.target, x1, y1, x2, y2 }: { edge: GraphEdge; markerId: string; emphasis: 'highlighted' | 'dimmed' | ''; sourceName?: string; targetName?: string; x1: number; y1: number; x2: number; y2: number }) {
  // A cached or forged edge.relation cannot overrule its retained evidence.
  const relation = relationFromEvidence(edge.evidence), flow = technicalFlow(edge, relation), description = relationDescription(relation, sourceName, targetName);
  return <line className={`tg-edge ${edge.kind} relation-${relation} ${emphasis}`} data-source={edge.source} data-target={edge.target} data-relation={relation} data-flow-source={flow?.source} data-flow-target={flow?.target} vectorEffect="non-scaling-stroke" x1={x1} y1={y1} x2={x2} y2={y2} markerStart={relation === 'upstream' ? `url(#${markerId}-flow)` : undefined} markerEnd={relation === 'downstream' ? `url(#${markerId}-flow)` : undefined} role="img" aria-label={description}><title>{`${description}。${flow ? '箭头由技术来源指向使用方。' : '无箭头；不推断技术流向。'}分析仓库：${sourceName}。`}</title></line>;
}

type GraphPoint = { x: number; y: number; radius: number; parentId?: string };
type Camera = GraphCamera;
type CanvasSize = GraphCanvasSize;
type LabelBox = { x: number; y: number; width: number; height: number };
type NodeLabel = LabelBox & { lines: string[]; fontSize: number; lineHeight: number; leader?: { x: number; y: number } };
const INITIAL_CAMERA: Camera = { x: 0, y: 0, scale: 1, mode: 'focus' };
function nodeLabelLines(name: string) {
  // Keep the complete repository name, including long names on narrow screens.
  return name.match(/.{1,24}/gu) || [name];
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
  const sorted = [...visible].sort((a, b) => Number(labels.has(b.node.id)) - Number(labels.has(a.node.id)) || Number(b.node.id === selectedId) - Number(a.node.id === selectedId) || Number(branches.has(b.node.id)) - Number(branches.has(a.node.id)) || b.node.overlap.score - a.node.overlap.score || a.node.id.localeCompare(b.node.id));
  for (const { node, center, radius } of sorted) {
    const columns = Math.max(8, Math.min(24, Math.floor((size.width - 26) / (fontSize * .85)))), lines = node.repo.name.match(new RegExp(`.{1,${columns}}`, 'gu')) || [node.repo.name];
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

export default function TechnologyGraph(props: Props) {
  const fullName = props.owner && props.name ? `${props.owner}/${props.name}` : props.embedded ? '' : graphWorkspaceCache.latestWorkbenchRoot(props.account);
  const parsed = parseRepository(fullName);
  return <GraphWorkspaceView key={JSON.stringify([props.account, canonicalId(fullName), !!props.embedded])} {...props} owner={parsed?.owner} name={parsed?.name} />;
}

function GraphWorkspaceView(props: Props) {
  const rootFullName = props.owner && props.name ? `${props.owner}/${props.name}` : '', root = canonicalId(rootFullName);
  const surface = props.embedded ? 'embedded' : 'workbench';
  const [initial] = useState(() => graphWorkspaceCache.read(props.account, root, surface));
  const initialView = initial?.view || initialGraphView(rootFullName);
  const [graph, setGraph] = useState<GraphWorkspace | null>(initial?.graph || null), [job, setJob] = useState<GraphJob | null>(initial?.job || null), [busy, setBusy] = useState(false), [target, setTarget] = useState(initial?.target || ''), [error, setError] = useState(initial?.error || ''), [cached, setCached] = useState(initial?.cached || false);
  const [analyzed, setAnalyzed] = useState<string[]>(initial?.analyzed || []), [selectedId, setSelectedId] = useState(initialView.selectedId), [expanded, setExpanded] = useState(initialView.expanded), [tab, setTab] = useState(initialView.tab), [input, setInput] = useState(initialView.input), [inputError, setInputError] = useState(''), [openDetails, setOpenDetails] = useState(initialView.openDetails);
  const [camera, setCamera] = useState<Camera>(initialView.camera), [viewScope, setViewScope] = useState(initialView.viewScope), [focusRequest, setFocusRequest] = useState({ id: initialView.selectedId, revision: 0, fitAll: true }), [canvasSize, setCanvasSize] = useState<CanvasSize>(initialView.canvasSize), [fullscreen, setFullscreen] = useState(false), [notice, setNotice] = useState(''), [paused, setPaused] = useState({ target: initial?.pausedTarget || '', refresh: initial?.pausedRefresh || false });
  const graphRef = useRef<GraphWorkspace | null>(initial?.graph || null), controllerRef = useRef<AbortController | null>(null), leaseRef = useRef<GraphRequestLease | null>(null), version = useRef(0), busyRef = useRef(false), frameRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLDivElement>(null), inspectorScrollRef = useRef<HTMLDivElement>(null);
  const savedView = useRef<SavedGraphView>(initialView), cameraSize = useRef(initialView.canvasSize);
  savedView.current = { selectedId, camera, canvasSize, viewScope, tab, expanded, input, openDetails };
  const callbacks = useRef(props); callbacks.current = props;
  const drag = useRef<{ pointerId: number; x: number; y: number; cameraX: number; cameraY: number; scale: number; moved: boolean } | null>(null), suppressClickUntil = useRef(0), appliedFocus = useRef(initial?.graph ? 0 : -1), markerId = useId().replace(/:/g, '');
  async function analyze(fullName: string, refresh = false) {
    if (busyRef.current || !props.csrfToken) return;
    const parsed = parseRepository(fullName); if (!parsed) return;
    const node = graphRef.current?.nodes.find(item => item.id === canonicalId(fullName));
    if (node && node.id !== root && node.depth >= MAX_GRAPH_DEPTH) { setNotice(`已达到 ${MAX_GRAPH_DEPTH} 层上限。可以将此节点设为新的根仓库。`); return; }
    if (node && node.id !== root && (graphRef.current?.nodes.length || 0) >= MAX_GRAPH_NODES) { setNotice(`已达到 ${MAX_GRAPH_NODES} 个节点上限。可以另开一个根仓库。`); return; }
    const controller = new AbortController(), request = ++version.current, started = Date.now(), lease = graphWorkspaceCache.begin(props.account, rootFullName, fullName, refresh); controllerRef.current?.abort(); controllerRef.current = controller; leaseRef.current = lease; busyRef.current = true;
    setBusy(true); setPaused({ target: '', refresh: false }); setTarget(canonicalId(fullName)); setJob(null); setError(''); setNotice(''); setCached(false);
    let timedOut = false; const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, MAX_WAIT);
    const current = () => request === version.current && !controller.signal.aborted && graphWorkspaceCache.isCurrent(lease);
    try {
      let response = await graphRequest(`/api/graph/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': props.csrfToken }, body: JSON.stringify({ refresh }) }, controller.signal);
      if (!current()) return; setCached(response.cached); setJob(response.job);
      let polls = 0;
      while (!terminal(response.job)) {
        if (polls >= MAX_POLLS || Date.now() - started >= MAX_WAIT) throw new Error('已停止等待：本次轮询达到时间或次数上限。可重试读取，后台任务有独立期限。');
        await wait(POLL_INTERVAL, controller.signal); response = await graphRequest(`/api/graph/jobs/${encodeURIComponent(response.job.id)}`, {}, controller.signal); polls += 1;
        if (!current()) return; setJob(response.job);
      }
      if (response.job.error?.code === 'SESSION_EXPIRED') { graphWorkspaceCache.fail(lease, 'GitHub 会话已失效，请重新登录。'); callbacks.current.onSessionExpired(); return; }
      const previous = graphRef.current, finished = graphWorkspaceCache.finish(lease, response.job, response.cached);
      if (!finished) throw new Error('图谱响应与当前分析仓库不匹配，请重试。');
      setError(finished.error);
      if (response.job.result && response.job.status !== 'failed') {
        graphRef.current = finished.graph; setGraph(finished.graph); setAnalyzed(finished.analyzed); setSelectedId(lease.target);
        setViewScope('selection'); setFocusRequest(value => ({ id: lease.target, revision: value.revision + 1, fitAll: !previous || lease.target === root && refresh }));
        savedView.current = { ...savedView.current, selectedId: lease.target, viewScope: 'selection' };
        graphWorkspaceCache.saveView(props.account, rootFullName, surface, savedView.current);
      }
    } catch (failure) {
      if (request !== version.current || !graphWorkspaceCache.isCurrent(lease)) return;
      const apiError = failure as GraphFailure;
      if (apiError.status === 401 || apiError.code === 'SESSION_EXPIRED') { graphWorkspaceCache.fail(lease, 'GitHub 会话已失效，请重新登录。'); callbacks.current.onSessionExpired(); return; }
      const message = timedOut ? '已停止等待：分析超过 120 秒。可重试读取，后台任务有独立期限。' : failure instanceof Error ? failure.message : '图谱暂时无法加载。';
      if (timedOut || !controller.signal.aborted) { graphWorkspaceCache.fail(lease, message); setError(message); }
    } finally { clearTimeout(deadline); if (request === version.current) { busyRef.current = false; controllerRef.current = null; leaseRef.current = null; setBusy(false); } }
  }
  useEffect(() => {
    if (!props.embedded && rootFullName) graphWorkspaceCache.rememberWorkbench(props.account, rootFullName);
    return () => {
      graphWorkspaceCache.saveView(props.account, rootFullName, surface, savedView.current);
      controllerRef.current?.abort(); version.current += 1; busyRef.current = false;
      if (leaseRef.current) graphWorkspaceCache.pause(leaseRef.current);
    };
  }, [root, props.account, surface]);
  useEffect(() => { graphWorkspaceCache.saveView(props.account, rootFullName, surface, savedView.current); }, [root, props.account, surface, selectedId, camera, canvasSize, viewScope, tab, expanded, input, openDetails]);
  useEffect(() => {
    const stored = graphWorkspaceCache.read(props.account, root, surface);
    if (stored?.pausedTarget) { setBusy(false); setPaused({ target: stored.pausedTarget, refresh: stored.pausedRefresh }); }
    // StrictMode replays mount effects before this timer can submit a request.
    const timer = setTimeout(() => {
      if (!rootFullName || !props.csrfToken) return;
      const refresh = surface === 'workbench' && graphWorkspaceCache.takeRefreshRequest(props.account, root);
      if (refresh || !graphWorkspaceCache.read(props.account, root, surface)?.hasAttempted) void analyze(rootFullName, refresh);
    }, 0);
    return () => {
      clearTimeout(timer); controllerRef.current?.abort(); version.current += 1; busyRef.current = false;
      if (leaseRef.current) graphWorkspaceCache.pause(leaseRef.current);
    };
  }, [root, props.account, props.csrfToken, surface]);
  useEffect(() => { if (props.embedded) return; document.title = `${rootFullName ? `${rootFullName} · ` : ''}技术图谱 — RepoFlow`; }, [rootFullName, props.embedded]);
  useEffect(() => { const changed = () => setFullscreen(document.fullscreenElement === frameRef.current); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed); }, []);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const measure = () => { const svg = canvas.querySelector('svg.tg-svg'), bounds = (svg || canvas).getBoundingClientRect(); if (bounds.width && bounds.height) setCanvasSize(previous => previous.width === bounds.width && previous.height === bounds.height ? previous : { width: bounds.width, height: bounds.height }); }; measure(); if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); } const observer = new ResizeObserver(measure); observer.observe(canvas); return () => observer.disconnect(); }, [expanded, !!rootFullName, !!graph]);
  const positions = useMemo(() => layoutGraph(graph?.nodes || [], graph?.edges || []), [graph?.nodes, graph?.edges]);
  const selected = graph?.nodes.find(node => node.id === selectedId) || graph?.nodes.find(node => node.id === graph.root), selectedEdges = graph?.edges.filter(edge => edge.source === selected?.id || edge.target === selected?.id) || [], discoveryParents = selectedEdges.filter(edge => edge.target === selected?.id);
  useEffect(() => { if (tab === 'sources' && inspectorScrollRef.current) inspectorScrollRef.current.scrollTop = 0; }, [selected?.id, tab]);
  const children = useMemo(() => { const counts = new Map<string, number>(); for (const edge of graph?.edges || []) counts.set(edge.source, (counts.get(edge.source) || 0) + 1); return counts; }, [graph?.edges]);
  const branches = useMemo(() => new Set([...children.keys()].filter(id => id !== graph?.root)), [children, graph?.root]);
  const labelIds = useMemo(() => new Set((graph?.nodes || []).filter(node => node.id === graph?.root || node.id === selected?.id || branches.has(node.id) || node.overlap.method === 'topics' && node.overlap.score >= .3).map(node => node.id)), [graph?.nodes, graph?.root, selected?.id, branches]);
  const neighborhood = useMemo(() => { const ids = new Set(selected ? [selected.id] : []); for (const edge of graph?.edges || []) if (edge.source === selected?.id || edge.target === selected?.id) { ids.add(edge.source); ids.add(edge.target); } return ids; }, [graph?.edges, selected?.id]);
  const overview = useMemo(() => fitCamera(graph?.nodes || [], positions, canvasSize), [graph?.nodes, positions, canvasSize]);
  useEffect(() => {
    if (!graph) return;
    const previousSize = cameraSize.current; cameraSize.current = canvasSize;
    const requested = appliedFocus.current !== focusRequest.revision;
    if (requested) appliedFocus.current = focusRequest.revision;
    setCamera(previous => {
      if (!requested && previous.mode === 'manual') return restoreGraphCamera(previous, previousSize, canvasSize);
      if (!requested && previous.mode === 'overview') return overview;
      const id = requested ? focusRequest.id : previous.focusId || graph.root, fitAll = requested ? focusRequest.fitAll : previous.fitAll;
      const point = positions.get(id); if (!point) return overview;
      const nearby = new Set([id]); for (const edge of graph.edges) if (edge.source === id || edge.target === id) { nearby.add(edge.source); nearby.add(edge.target); }
      return { ...fitCamera(fitAll ? graph.nodes : graph.nodes.filter(node => nearby.has(node.id)), positions, canvasSize, point), focusId: id, fitAll };
    });
  }, [graph, positions, overview, focusRequest, labelIds, branches, canvasSize]);
  const svgUnit = Math.max(1200 / canvasSize.width, 1000 / canvasSize.height), worldPixel = 1 / camera.scale, zoom = camera.scale / overview.scale;
  const comfortable = viewScope === 'selection' && !camera.fitAll && !!camera.focusId;
  const density = useMemo(() => graphDensity(graph?.nodes || [], positions, camera), [graph?.nodes, positions, camera]);
  const labelPositions = useMemo(() => placeGraphLabels(graph?.nodes || [], positions, labelIds, branches, camera, canvasSize, density, selected?.id || '', comfortable), [graph?.nodes, positions, labelIds, branches, camera, canvasSize, density, selected?.id, comfortable]);
  const nodeRadius = (node: WorkspaceNode) => (positions.get(node.id)?.radius || 7) * (node.tier === 0 ? 1 : density) * worldPixel;
  const canExpand = !!selected && selected.id !== root && !analyzed.includes(selected.id) && selected.depth < MAX_GRAPH_DEPTH && (graph?.nodes.length || 0) < MAX_GRAPH_NODES;
  function submit(event: FormEvent) { event.preventDefault(); const parsed = parseRepository(input); if (!parsed) { setInputError('请输入 owner/repo 或完整的 GitHub 仓库 URL。'); return; } setInputError(''); if (canonicalId(parsed.fullName) === root) void analyze(rootFullName, true); else { graphWorkspaceCache.requestRefresh(props.account, parsed.fullName); props.onRoute(graphPath(parsed.fullName)); } }
  function toggleDetail(key: string, open: boolean) { setOpenDetails(previous => previous.includes(key) === open ? previous : open ? [...previous, key] : previous.filter(item => item !== key)); }
  function focusSelected() { if (!selected) return; setViewScope('selection'); setFocusRequest(value => ({ id: selected.id, revision: value.revision + 1, fitAll: false })); }
  function select(node: WorkspaceNode) { setSelectedId(node.id); setTab('sources'); setViewScope('selection'); setFocusRequest(value => ({ id: node.id, revision: value.revision + 1, fitAll: false })); }
  function showOverview() { setViewScope('all'); setCamera(overview); }
  function resetView() { setSelectedId(root); setViewScope('selection'); setFocusRequest(value => ({ id: root, revision: value.revision + 1, fitAll: true })); }
  function changeZoom(factor: number) { setCamera(value => ({ ...value, mode: 'manual', scale: Math.min(Math.max(2, overview.scale * 8), Math.max(overview.scale * .2, value.scale * factor)) })); }
  function pointerDown(event: PointerEvent<SVGSVGElement>) { if (event.button !== 0 || !event.isPrimary) return; drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y, scale: camera.scale, moved: false }; }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const origin = drag.current; if (!origin || origin.pointerId !== event.pointerId) return;
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
    if (!origin.moved && Math.hypot(dx, dy) < 5) return;
    origin.moved = true; event.currentTarget.setPointerCapture(event.pointerId); suppressClickUntil.current = Date.now() + 250;
    setCamera(value => ({ ...value, mode: 'manual', x: origin.cameraX - dx / origin.scale, y: origin.cameraY - dy / origin.scale }));
  }
  function pointerEnd(event: PointerEvent<SVGSVGElement>) { if (drag.current?.moved) suppressClickUntil.current = Date.now() + 250; drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  async function toggleFullscreen() { if (document.fullscreenElement === frameRef.current) await document.exitFullscreen(); else if (frameRef.current?.requestFullscreen) { try { await frameRef.current.requestFullscreen(); } catch { setNotice('此浏览器未能进入全屏，可打开独立工作台查看。'); } } }
  const coverage = job?.result?.counts, status = error ? '分析未完成' : busy ? job ? phaseLabels[job.phase] : '正在提交分析请求' : paused.target ? '上次分析已暂停' : job?.status === 'partial' ? '部分分析完成' : job?.status === 'complete' ? cached ? '已读取缓存' : '一级分析完成' : props.csrfToken ? '等待分析' : '正在建立安全会话';
  const inspector = <aside className="tg-inspector">
    <div className="tg-tabs" role="tablist" aria-label="图谱信息"><button role="tab" aria-selected={tab === 'sources'} onClick={() => setTab('sources')}>关系</button><button role="tab" aria-selected={tab === 'nodes'} onClick={() => setTab('nodes')}>节点 {graph?.nodes.length || 0}</button><button role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>人员 {graph?.people.length || 0}</button></div>
    <div className="tg-inspector-scroll" role="tabpanel" ref={inspectorScrollRef}>
      {tab === 'nodes' ? <ul className="tg-node-list">{[...(graph?.nodes || [])].sort((a, b) => a.tier - b.tier || a.depth - b.depth || a.id.localeCompare(b.id)).map(node => <li key={node.id}><button aria-label={`选择 ${node.repo.full_name}`} aria-pressed={selected?.id === node.id} onClick={() => select(node)}><i className={`tg-dot tier-${node.tier}`} /><span>{node.repo.full_name}<small>{node.depth === 0 ? '根仓库' : `手动链路第 ${node.depth} 层`}{analyzed.includes(node.id) ? ' · 已分析' : ''}</small></span></button></li>)}</ul> : tab === 'people' ? <div className="tg-people">
        <p className="tg-muted">人员角色来自公开证据，不推断未列出的维护关系。</p>{graph?.people.map(person => <details className="person-evidence" key={person.login} open={openDetails.includes(`person:${person.login}`)} onToggle={event => toggleDetail(`person:${person.login}`, event.currentTarget.open)}><summary>{safeUrl(person.avatar_url) && <img src={safeUrl(person.avatar_url)!} alt="" loading="lazy" />}<span>{person.login}<small>{person.roles.map(role => evidenceLabels[role]).join(' · ')}</small></span></summary>{person.contributions !== null && <p className="tg-muted">公开贡献次数 {formatNumber(person.contributions)}</p>}<EvidenceList evidence={person.evidence} />{safeUrl(person.html_url) && <a className="tg-inline-link" href={safeUrl(person.html_url)!} target="_blank" rel="noopener noreferrer">GitHub 资料<ExternalLink size={11} /></a>}</details>)}
      </div> : selected ? <div className="tg-node-detail">
        <span className={`tg-tier tier-${selected.tier}`}>{selected.tier === 0 ? '中心仓库' : selected.tier === 1 ? 'README / 依赖链接' : '人员关联'} · {selected.depth === 0 ? '根' : `第 ${selected.depth} 层`}</span>
        <h3>{selected.repo.full_name}</h3>
        {selected.depth > 0 && discoveryParents.length > 0 && <div className="tg-branch-context"><GitBranch size={12} /><span>由 {discoveryParents.map(edge => graph?.nodes.find(node => node.id === edge.source)?.repo.full_name || edge.source).join('、')} 的一级分析发现{selected.depth > 1 ? ` · 手动追溯第 ${selected.depth} 层` : ' · 一级发现'}</span></div>}
        <p>{selected.repo.description || '这个仓库尚未提供简介。'}</p>
        <div className="tg-node-stats"><span><Star size={13} />{formatNumber(selected.repo.stargazers_count)}</span>{selected.repo.language && <span>{selected.repo.language}</span>}</div>
        <div className="tg-overlap"><small>比较基准：{selected.overlapRoot}</small><strong>{selected.overlap.method === 'topics' ? `${Math.round(selected.overlap.score * 100)}% topic 重合度` : selected.overlap.method === 'language-fallback' ? '相同主要语言 · 回退匹配' : '未计算标签重合度'}</strong>{selected.overlap.shared.length > 0 && <div>{selected.overlap.shared.map(topic => <span key={topic}>{topic}</span>)}</div>}</div>
        <div className="tg-node-actions"><a href={projectPath(selected.repo)} onClick={event => props.onNavigate(event, projectPath(selected.repo))}>查看项目<ArrowUpRight size={13} /></a>{safeUrl(selected.repo.html_url) && <a href={safeUrl(selected.repo.html_url)!} target="_blank" rel="noopener noreferrer"><Github size={13} />原仓库</a>}</div>
        {selected.id !== root && <><button className="tg-trace-button" disabled={busy || !canExpand} onClick={() => void analyze(selected.repo.full_name)} aria-label={`继续追溯 ${selected.repo.full_name}`}>{busy && target === selected.id ? <LoaderCircle size={14} className="spinning" /> : <GitBranch size={14} />}{analyzed.includes(selected.id) ? '此节点已分析' : selected.depth >= MAX_GRAPH_DEPTH ? '已达层级上限' : (graph?.nodes.length || 0) >= MAX_GRAPH_NODES ? '已达节点上限' : '继续追溯'}</button><a className="tg-new-root" href={graphPath(selected.repo.full_name)} onClick={event => props.onNavigate(event, graphPath(selected.repo.full_name))}>以此节点为新根<ArrowUpRight size={12} /></a></>}
        {graph?.nodes.length === 1 && !busy && !error && <p className="tg-empty-result">在本次公开 README、明确依赖及人员扫描范围内，未发现引用或关联项目。</p>}
        <h4>技术关系与证据</h4>
        {selectedEdges.length > 0 ? <div className="tg-relation-list"><p className="tg-muted">箭头：技术来源 → 使用方。每项关系相对于列出的分析仓库。</p>{selectedEdges.map(edge => <GraphRelationDetails key={`${edge.source}:${edge.target}`} edge={edge} sourceName={graph?.nodes.find(node => node.id === edge.source)?.repo.full_name} targetName={graph?.nodes.find(node => node.id === edge.target)?.repo.full_name} />)}</div> : <EvidenceList evidence={selected.evidence} />}
      </div> : <p className="tg-muted">分析完成后，选择节点查看技术关系、证据与共同 topics。</p>}
    </div>
  </aside>;
  return <section className={`technology-graph ${props.embedded ? 'tg-embedded' : 'tg-workbench'} ${expanded ? '' : 'tg-collapsed'} ${fullscreen ? 'tg-fullscreen' : ''}`} ref={frameRef} aria-label="技术来源图谱">
    <div className="tg-heading"><div><Network size={19} /><h2>技术来源图谱</h2>{props.embedded && <span>一级公开来源分析</span>}</div><div>{props.embedded && <a className="tg-workbench-link" href={graphPath(rootFullName)} onClick={event => props.onNavigate(event, graphPath(rootFullName))}>独立工作台<ArrowUpRight size={14} /></a>}{rootFullName && <button className="icon-button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? '折叠图谱' : '展开图谱'} title={expanded ? '折叠图谱' : '展开图谱'}>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>}</div></div>
    {!props.embedded && <form className="tg-repo-form" onSubmit={submit}><Github size={18} /><input aria-label="GitHub 仓库" placeholder="owner/repo 或 https://github.com/owner/repo" value={input} onChange={event => setInput(event.target.value)} /><button className="button primary" type="submit"><Search size={15} />分析仓库</button>{inputError && <p role="alert">{inputError}</p>}</form>}
    {!rootFullName ? <div className="tg-start"><Network size={42} /><h3>选择一个 GitHub 仓库</h3><p>查看 README 引用、明确依赖与公开开发者关联。每次只分析一级，下一层由你继续追溯。</p></div> : <>
      <div className="tg-status"><CircleProgress job={job} busy={busy} /><div className="tg-status-copy" role="status"><strong>{status}</strong><span>{busy ? target : graph ? `${graph.nodes.length} 个节点 · ${graph.analyses.length} 次一级分析 · 数据时间 ${graphTime(graph.generatedAt)}` : rootFullName}</span>{job && <small>{job.message} · 请求预算 {job.requests}/{job.requestLimit}</small>}</div><button className="tg-refresh" disabled={busy || !props.csrfToken} onClick={() => void analyze(rootFullName, true)} aria-label="重新分析根仓库" title="重新分析根仓库"><RefreshCw size={15} /><span>刷新</span></button></div>
      {(error || props.sessionError || notice) && <div className="tg-message" role={error || props.sessionError ? 'alert' : 'status'}><span>{error || props.sessionError || notice}</span>{error && <button onClick={() => void analyze(target || rootFullName)}>重试分析</button>}{props.sessionError && !props.csrfToken && <button onClick={props.onSessionRetry}>重试会话</button>}</div>}
      {paused.target && !busy && <div className="tg-message" role="status"><span>离开页面时已停止等待 {paused.target} 的分析。{graph ? '已完成的图谱与手动追溯记录仍保留。' : '本次尚无已完成结果。'}</span><button disabled={!props.csrfToken} onClick={() => void analyze(paused.target, paused.refresh)}>继续上次分析</button></div>}
      {expanded && <>
        <div className="tg-toolbar">
          <div className="tg-legend"><span><i className="tg-dot tier-0" />根仓库</span><span><i className="tg-dot tier-1" />README / 依赖链接</span><span><i className="tg-dot tier-2" />人员关联</span><span className="tg-size-legend">大小：topic 重合度</span></div>
          <div className="tg-view-controls">
            <button className="icon-button" disabled={!graph} aria-label="缩小图谱" title="缩小" onClick={() => changeZoom(1 / 1.25)}><ZoomOut size={17} /></button><span>{Math.round(zoom * 100)}%</span>
            <button className="icon-button" disabled={!graph} aria-label="放大图谱" title="放大" onClick={() => changeZoom(1.25)}><ZoomIn size={17} /></button>
            <button className="icon-button" disabled={!selected} aria-label="聚焦选中节点" title="聚焦选中节点" aria-pressed={viewScope === 'selection' && camera.mode === 'focus' && !camera.fitAll} onClick={focusSelected}><Focus size={16} /></button>
            <button className="icon-button" disabled={!graph} aria-label="查看全图" title="查看全图" aria-pressed={viewScope === 'all'} onClick={showOverview}><Scan size={16} /></button>
            <button className="icon-button" disabled={!graph} aria-label="重置图谱视图" title="重置视图" onClick={resetView}><RotateCcw size={16} /></button>
            <button className="icon-button" aria-label={fullscreen ? '退出图谱全屏' : '全屏图谱'} title={fullscreen ? '退出图谱全屏' : '全屏图谱'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          </div>
        </div>
        <div className="tg-relation-legend" aria-label="技术关系图例"><span><i className="tg-legend-line directional" />技术来源 → 使用方</span><span><i className="tg-legend-line relation-related" />相关项目</span><span><i className="tg-legend-line relation-reference" />文档引用</span><span><i className="tg-legend-line relation-ambiguous" />方向不确定</span><small>无箭头线不推断技术方向</small></div>
        <div className="tg-content"><div className="tg-canvas" ref={canvasRef}>
          {graph ? <svg className="tg-svg" viewBox="0 0 1200 1000" role="group" aria-label="技术图谱，可拖动平移，使用节点列表访问所有项目" tabIndex={0} data-camera-mode={camera.mode} data-view-scope={viewScope} data-density={density} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Home') { event.preventDefault(); showOverview(); return; }
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const delta = 35 / camera.scale; setCamera(value => ({ ...value, mode: 'manual', x: value.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), y: value.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0) })); }
          }}>
            <defs><marker id={`${markerId}-flow`} viewBox="0 0 8 8" markerWidth={7 * worldPixel} markerHeight={7 * worldPixel} refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path className="tg-flow-marker" d="M0 1L7 4L0 7" fill="none" stroke="#348879" strokeWidth="1.5" /></marker></defs>
            <g className="tg-world" transform={`translate(600 500) scale(${camera.scale * svgUnit}) translate(${-camera.x} ${-camera.y})`}>
              {[...graph.edges].sort((a, b) => Number(a.source === selected?.id || a.target === selected?.id) - Number(b.source === selected?.id || b.target === selected?.id)).map(edge => {
                const a = positions.get(edge.source), b = positions.get(edge.target), sourceNode = graph.nodes.find(node => node.id === edge.source), targetNode = graph.nodes.find(node => node.id === edge.target);
                if (!a || !b || !sourceNode || !targetNode) return null;
                const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), highlighted = viewScope === 'selection' && (selected?.id === edge.source || selected?.id === edge.target);
                if (!length) return null;
                const relation = relationFromEvidence(edge.evidence), sourceGap = nodeRadius(sourceNode) + (relation === 'upstream' ? 5 : 3) * worldPixel, targetGap = nodeRadius(targetNode) + (relation === 'downstream' ? 5 : 3) * worldPixel;
                if (length <= sourceGap + targetGap) return null;
                return <GraphRelationLine key={`${edge.source}:${edge.target}`} edge={edge} markerId={markerId} emphasis={highlighted ? 'highlighted' : viewScope === 'selection' ? 'dimmed' : ''} sourceName={sourceNode.repo.full_name} targetName={targetNode.repo.full_name} x1={a.x + dx / length * sourceGap} y1={a.y + dy / length * sourceGap} x2={b.x - dx / length * targetGap} y2={b.y - dy / length * targetGap} />;
              })}
              {[...graph.nodes].sort((a, b) => (a.id === selected?.id ? 2 : neighborhood.has(a.id) ? 1 : 0) - (b.id === selected?.id ? 2 : neighborhood.has(b.id) ? 1 : 0)).map(node => {
                const point = positions.get(node.id); if (!point) return null;
                const radius = nodeRadius(node), label = labelPositions.get(node.id), lines = label?.lines || nodeLabelLines(node.repo.name), branch = branches.has(node.id), persistent = labelIds.has(node.id), fontSize = label?.fontSize || 11, labelX = label ? label.x + 4 : 0, labelY = (label?.y ?? radius / worldPixel + 6) + fontSize;
                return <g key={node.id} data-node-id={node.id} data-tier={node.tier} data-depth={node.depth} data-parent-id={point.parentId} data-overlap-method={node.overlap.method} data-overlap-score={node.overlap.score} className={`tg-node tier-${node.tier} ${selected?.id === node.id ? 'selected' : ''} ${analyzed.includes(node.id) ? 'analyzed' : ''} ${viewScope === 'selection' && !neighborhood.has(node.id) ? 'dimmed' : ''}`} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`选择 ${node.repo.full_name}`} aria-pressed={selected?.id === node.id} onClick={event => { if (event.detail === 0 || Date.now() > suppressClickUntil.current) select(node); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node); } }}>
                  <title>{`${node.repo.full_name} · ${node.depth ? `第 ${node.depth} 层` : '根仓库'} · ${node.overlap.method === 'topics' ? `${Math.round(node.overlap.score * 100)}% topic 重合度` : node.overlap.method === 'language-fallback' ? '主要语言回退' : '无 topic 重合度'} · ${formatNumber(node.repo.stargazers_count)} Stars`}</title>
                  <circle className="tg-node-hit" r={Math.max(radius + 3 * worldPixel, (comfortable ? 14 : 8) * worldPixel)} fill="transparent" />
                  <circle className="tg-node-halo" r={radius + 4 * worldPixel} vectorEffect="non-scaling-stroke" />
                  <circle className="tg-node-core" r={radius} vectorEffect="non-scaling-stroke" />
                  <text className="tg-node-initial" style={{ fontSize: (node.tier === 0 ? 17 : Math.min(9, radius / worldPixel * 1.1)) * worldPixel, opacity: node.tier === 0 || radius / worldPixel >= 5 ? 1 : 0 }} textAnchor="middle" dominantBaseline="central">{node.tier === 0 ? '⌘' : node.repo.name.slice(0, 1).toUpperCase()}</text>
                  {label?.leader && <line className={`tg-label-leader ${persistent ? 'persistent' : ''}`} x1={label.leader.x / Math.hypot(label.leader.x, label.leader.y) * (radius + 2 * worldPixel)} y1={label.leader.y / Math.hypot(label.leader.x, label.leader.y) * (radius + 2 * worldPixel)} x2={label.leader.x * worldPixel} y2={label.leader.y * worldPixel} vectorEffect="non-scaling-stroke" />}
                  <text className={`tg-node-label ${persistent ? 'persistent' : ''}`} data-label-persistent={persistent} style={{ fontSize: fontSize * worldPixel, strokeWidth: (comfortable ? 3 : 2.5) * worldPixel }} textAnchor={label ? 'start' : 'middle'} x={labelX * worldPixel} y={labelY * worldPixel}>
                    {lines.map((line, index) => <tspan key={index} x={labelX * worldPixel} dy={index ? (label?.lineHeight || 12) * worldPixel : 0}>{line}</tspan>)}
                    {branch && <tspan className="tg-branch-label" x={labelX * worldPixel} dy={13 * worldPixel} style={{ fontSize: 9 * worldPixel }}>第 {node.depth} 层分支 · {children.get(node.id)} 个后续节点</tspan>}
                  </text>
                </g>;
              })}
            </g>
          </svg> : <div className="tg-await"><CircleProgress job={job} busy={busy} /><strong>{status}</strong><span>{error ? '请重试，README 与项目浏览仍可使用。' : '进度随后台实际阶段更新，不代表剩余时间。'}</span></div>}
          <div className="tg-canvas-caption">{viewScope === 'all' ? '全图 · ' : selected ? `${selected.repo.name} 及直接相连项目 · ` : ''}拖动平移 · 名称常驻：topic ≥ 30%</div>
        </div>{inspector}</div>
      </>}
      {(coverage || graph?.warnings.length) && <div className="tg-coverage">{coverage && <span>直接引用 {coverage.referencesResolved}/{coverage.referencesFound} · 人员 {coverage.peopleScanned}/{coverage.peopleFound} · 已查候选 {coverage.candidatesScanned}</span>}{graph && graph.warnings.length > 0 && <details open={openDetails.includes('warnings')} onToggle={event => toggleDetail('warnings', event.currentTarget.open)}><summary>{graph.warnings.length} 条覆盖提示</summary><ul>{graph.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</div>}
    </>}
  </section>;
}
