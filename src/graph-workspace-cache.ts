import { canonicalId, mergeGraph, type GraphJob, type GraphWorkspace } from './graph-data';

export type GraphSurface = 'workbench' | 'embedded';
export type GraphCamera = { x: number; y: number; scale: number; mode: 'overview' | 'focus' | 'manual'; focusId?: string; fitAll?: boolean };
export type GraphCanvasSize = { width: number; height: number };
export interface GraphWorkspaceView {
  selectedId: string; camera: GraphCamera; canvasSize: GraphCanvasSize; viewScope: 'selection' | 'all';
  tab: 'sources' | 'nodes' | 'people'; expanded: boolean; input: string; openDetails: string[];
}
interface WorkspaceData {
  graph: GraphWorkspace | null; analyzed: string[]; job: GraphJob | null; hasAttempted: boolean;
  target: string; pausedTarget: string; pausedRefresh: boolean; error: string; cached: boolean;
}
export interface GraphWorkspaceSnapshot extends WorkspaceData { view: GraphWorkspaceView }
interface Entry { account: string; root: string; fullName: string; data: WorkspaceData; views: Partial<Record<GraphSurface, GraphWorkspaceView>>; revision: number; refreshRequested: boolean }
export interface GraphRequestLease { account: string; root: string; target: string; refresh: boolean; revision: number }

export function initialGraphView(fullName: string): GraphWorkspaceView {
  return { selectedId: canonicalId(fullName), camera: { x: 0, y: 0, scale: 1, mode: 'focus' }, canvasSize: { width: 600, height: 300 }, viewScope: 'selection', tab: 'sources', expanded: true, input: fullName, openDetails: [] };
}
const initialData = (): WorkspaceData => ({ graph: null, analyzed: [], job: null, hasAttempted: false, target: '', pausedTarget: '', pausedRefresh: false, error: '', cached: false });
const copyView = (view: GraphWorkspaceView): GraphWorkspaceView => ({ ...view, camera: { ...view.camera }, canvasSize: { ...view.canvasSize }, openDetails: [...view.openDetails] });
const keyFor = (account: string, root: string) => JSON.stringify([account, canonicalId(root)]);

// This cache lasts only for the current SPA runtime. Public results can survive a
// new login, but neither CSRF credentials nor a session-owned polling ID can.
export class GraphWorkspaceCache {
  private entries = new Map<string, Entry>();
  private recent = new Map<string, string>();
  private revision = 0;
  constructor(private readonly limit = 8) { if (!Number.isInteger(limit) || limit < 1) throw new Error('Graph workspace cache needs a positive limit.'); }
  private touch(entry: Entry) { const key = keyFor(entry.account, entry.root); this.entries.delete(key); this.entries.set(key, entry); }
  private ensure(account: string, fullName: string) {
    const key = keyFor(account, fullName); let entry = this.entries.get(key);
    if (!entry) {
      entry = { account, root: canonicalId(fullName), fullName, data: initialData(), views: {}, revision: ++this.revision, refreshRequested: false };
      this.entries.set(key, entry);
      while (this.entries.size > this.limit) {
        // Browsing many details must not evict this account's last workbench.
        // Other accounts and older roots still use the same bounded LRU budget.
        const keys = [...this.entries.keys()];
        const oldest = keys.find(candidate => candidate !== key && !(this.entries.get(candidate)!.account === account && this.recent.get(account) === this.entries.get(candidate)!.root)) || keys.find(candidate => candidate !== key)!;
        const removed = this.entries.get(oldest)!; this.entries.delete(oldest);
        if (this.recent.get(removed.account) === removed.root) this.recent.delete(removed.account);
      }
    } else this.touch(entry);
    return entry;
  }
  read(account: string, fullName: string, surface: GraphSurface): GraphWorkspaceSnapshot | null {
    const entry = this.entries.get(keyFor(account, fullName)); if (!entry) return null; this.touch(entry);
    const view = entry.views[surface] || entry.views.workbench || entry.views.embedded || initialGraphView(entry.fullName);
    return { ...entry.data, analyzed: [...entry.data.analyzed], view: copyView(view) };
  }
  saveView(account: string, fullName: string, surface: GraphSurface, view: GraphWorkspaceView) {
    if (!fullName) return;
    this.ensure(account, fullName).views[surface] = copyView(view);
  }
  rememberWorkbench(account: string, fullName: string) { if (fullName) { this.recent.set(account, canonicalId(fullName)); this.ensure(account, fullName); } }
  latestWorkbenchRoot(account: string) { const root = this.recent.get(account); return root ? this.entries.get(keyFor(account, root))?.fullName || '' : ''; }
  requestRefresh(account: string, fullName: string) { this.ensure(account, fullName).refreshRequested = true; }
  takeRefreshRequest(account: string, fullName: string) {
    const entry = this.entries.get(keyFor(account, fullName)); if (!entry?.refreshRequested) return false;
    entry.refreshRequested = false; return true;
  }
  begin(account: string, fullName: string, target: string, refresh: boolean): GraphRequestLease {
    const entry = this.ensure(account, fullName); entry.revision = ++this.revision;
    entry.data = { ...entry.data, hasAttempted: true, target: canonicalId(target), pausedTarget: canonicalId(target), pausedRefresh: refresh, error: '' };
    return { account, root: entry.root, target: canonicalId(target), refresh, revision: entry.revision };
  }
  isCurrent(lease: GraphRequestLease) { return this.entries.get(keyFor(lease.account, lease.root))?.revision === lease.revision; }
  pause(lease: GraphRequestLease) { if (this.isCurrent(lease)) this.entries.get(keyFor(lease.account, lease.root))!.revision = ++this.revision; }
  finish(lease: GraphRequestLease, job: GraphJob, cached = false): GraphWorkspaceSnapshot | null {
    if (!this.isCurrent(lease) || !['complete', 'partial', 'failed'].includes(job.status) || job.status !== 'failed' && !job.result || canonicalId(job.rootFullName) !== lease.target || job.result && canonicalId(job.result.root) !== lease.target) return null;
    const entry = this.entries.get(keyFor(lease.account, lease.root))!;
    let graph = entry.data.graph, analyzed = entry.data.analyzed;
    if (job.result && job.status !== 'failed') {
      const replacing = lease.refresh && lease.target === entry.root;
      graph = mergeGraph(replacing ? null : graph, job.result);
      analyzed = [...new Set([...(replacing ? [] : analyzed), lease.target])];
    }
    // Keep only the public terminal summary, never the session-owned job ID.
    const summary: GraphJob = { id: '', rootFullName: job.rootFullName, status: job.status, phase: job.phase, progress: job.progress, message: job.message, requests: job.requests, requestLimit: job.requestLimit, updatedAt: job.updatedAt, result: job.result, error: job.error };
    entry.data = { graph, analyzed, job: summary, hasAttempted: true, target: lease.target, pausedTarget: '', pausedRefresh: false, error: job.status === 'failed' ? job.error?.message || '图谱分析失败，请重试。' : '', cached };
    entry.revision = ++this.revision;
    return this.read(lease.account, lease.root, 'workbench');
  }
  fail(lease: GraphRequestLease, error: string) {
    if (!this.isCurrent(lease)) return false;
    const entry = this.entries.get(keyFor(lease.account, lease.root))!;
    entry.data = { ...entry.data, pausedTarget: '', pausedRefresh: false, error };
    entry.revision = ++this.revision; return true;
  }
}

export function restoreGraphCamera(camera: GraphCamera, previous: GraphCanvasSize, next: GraphCanvasSize): GraphCamera {
  if (camera.mode !== 'manual' || previous.width === next.width && previous.height === next.height) return camera;
  return { ...camera, scale: camera.scale * Math.min(next.width / previous.width, next.height / previous.height) };
}
export const graphWorkspaceCache = new GraphWorkspaceCache();
