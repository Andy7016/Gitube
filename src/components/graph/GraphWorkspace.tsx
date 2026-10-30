import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ExternalLink, GitBranch, RefreshCw, X } from 'lucide-react'
import type { GraphEdge, GraphEvidence, GraphPerson } from '../../api/graph'
import { useGraph, graphKey, graphPath, MAX_GRAPH_DEPTH, MAX_GRAPH_NODES, type GraphMode } from '../../store/graph'
import { GraphCanvas } from './GraphCanvas'
import { layoutGraph } from './layout'

const evidenceLabels: Record<GraphEvidence['kind'], string> = { credit: '致谢', citation: '引用', dependency: '明确依赖', copyright: '版权来源', 'readme-reference': 'README 提及', 'readme-related': '相关项目', contributor: '贡献者', codeowner: 'CODEOWNERS', 'readme-maintainer': 'README 维护者', owner: '仓库所有者' }
const roleLabels: Record<GraphPerson['roles'][number], string> = { contributor: '贡献者', codeowner: '代码负责人', 'readme-maintainer': 'README 维护者', owner: '仓库所有者' }
const relationLabels: Record<GraphEdge['relation'], string> = { upstream: '技术上游', downstream: '下游使用方', related: '相关项目', reference: '提及，方向未定', ambiguous: '证据含糊或冲突' }
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function EvidenceList({ evidence }: { evidence: GraphEvidence[] }) {
  return <ul className="graph-evidence-list">{evidence.map((item, index) => <li key={`${item.url}:${index}`}>
    <a href={item.url} target="_blank" rel="noreferrer">{evidenceLabels[item.kind]} · {item.label}<ExternalLink size={12} aria-hidden="true" /></a>
    {item.excerpt && <blockquote>{item.excerpt}</blockquote>}
    <p className="muted">{item.relationReason}</p>
  </li>)}</ul>
}

/** 详情页明确点击后才挂载会采集数据的工作区。 */
export function DetailGraph({ root }: { root: string }) {
  const scopeVersion = useGraph(s => s.scopeVersion)
  const requestKey = `${scopeVersion}:${root.toLowerCase()}`
  const [requested, setRequested] = useState<string | null>(null)
  if (requested === requestKey) return <GraphWorkspace root={root} mode="embedded" />
  return <div className="graph-launch"><button type="button" className="graph-button" onClick={() => setRequested(requestKey)}><GitBranch size={16} aria-hidden="true" />分析技术来源</button></div>
}

export function GraphWorkspace({ root, mode = 'standalone' }: { root?: string; mode?: GraphMode }) {
  const navigate = useNavigate(), titleId = useId()
  const last = useGraph(s => s.lastStandalone)
  const scopeVersion = useGraph(s => s.scopeVersion)
  const target = root || (mode === 'standalone' ? last : null)
  const key = target ? graphKey(mode, target) : null
  const view = useGraph(s => key ? s.views[key] : undefined)
  const panelContent = useRef<HTMLDivElement>(null)
  useEffect(() => { if (panelContent.current) panelContent.current.scrollTop = 0 }, [key, view?.selected, view?.panel])
  useEffect(() => {
    const opened = useGraph.getState().open(mode, root)
    if (!opened) return
    useGraph.getState().retain(opened)
    void useGraph.getState().ensure(opened)
    return () => useGraph.getState().release(opened)
  }, [root, mode, scopeVersion])
  if (!key || !view) return <div className="graph-intro"><GitBranch size={36} aria-hidden="true" /><h2>从一个项目，追溯它的技术来源</h2><p>输入 GitHub 仓库，查看文档中的直接来源和开发者关联项目。选择节点后可核对原文，或继续展开一级。</p><p className="muted">分析在本设备运行，所有请求直接发给 GitHub。工作区保留到本次应用关闭。</p></div>
  const graph = view.graph, selected = graph?.nodes.find(n => n.id === view.selected) ?? graph?.nodes[0]
  const loading = view.status === 'loading'
  const relations = selected ? graph?.edges.filter(e => e.source === selected.id || e.target === selected.id) ?? [] : []
  const positions = graph ? layoutGraph(graph.nodes, graph.edges) : new Map()
  const parent = selected ? positions.get(selected.id)?.parentId : undefined
  const canExpand = selected && selected.depth < MAX_GRAPH_DEPTH && !view.expanded.includes(selected.id) && selected.id !== graph?.root && (graph?.nodes.length ?? 0) < MAX_GRAPH_NODES
  return <section className={`graph-workspace${mode === 'embedded' ? ' graph-workspace--embedded' : ''}`} aria-labelledby={titleId} data-graph-status={view.status} data-graph-root={view.root.toLowerCase()} data-selected-node={view.selected}>
    <header className="graph-heading">
      <div><h2 id={titleId}><GitBranch size={19} aria-hidden="true" />技术来源图谱</h2><p>{view.root}{graph && <span> · {graph.nodes.length} 个节点 · {time(graph.generatedAt)}</span>}</p></div>
      <div className="graph-heading__actions">
        {mode === 'embedded' && <Link className="graph-button" to={graphPath(view.root)}>独立工作台<ExternalLink size={14} aria-hidden="true" /></Link>}
        <button type="button" className="graph-button" disabled={loading} onClick={() => void useGraph.getState().reanalyze(key)}><RefreshCw size={14} aria-hidden="true" />重新分析</button>
        {loading && <button type="button" className="graph-button" onClick={() => useGraph.getState().cancel(key)}><X size={14} aria-hidden="true" />取消分析</button>}
      </div>
    </header>
    {loading && <div className="graph-progress" role="status"><progress max="100" value={view.progress?.progress ?? 0} /><span>{view.progress?.message ?? '正在读取公开仓库…'} · {view.progress?.requests ?? 0}/{view.progress?.requestLimit ?? 48} 次请求</span></div>}
    {view.error && <div className="graph-message" role={view.status === 'error' ? 'alert' : 'status'}><p>{view.error}</p>{graph && <p>已有图谱仍可查看。</p>}{!loading && !graph && <button className="graph-button" type="button" onClick={() => void useGraph.getState().reanalyze(key)}>继续分析</button>}</div>}
    {graph && selected ? <>
      <div className="graph-body">
        <GraphCanvas workspaceKey={key} view={view} />
        <aside className="graph-panel" aria-label="节点来源">
          <div className="graph-tabs" role="tablist" aria-label="图谱信息">{([['evidence', '来源'], ['nodes', '节点'], ['people', '开发者']] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={view.panel === tab} onClick={() => useGraph.getState().updateView(key, { panel: tab })}>{label}{tab === 'nodes' ? ` ${graph.nodes.length}` : tab === 'people' ? ` ${graph.people.length}` : ''}</button>)}</div>
          <div className="graph-panel__content" ref={panelContent}>
            {view.panel === 'evidence' && <>
              <h3>{selected.repo.nameWithOwner}</h3><p className="muted">{selected.repo.description || '暂无项目描述'}</p>
              <dl className="graph-facts"><div><dt>手动层级</dt><dd>{selected.depth} / {MAX_GRAPH_DEPTH}</dd></div>{parent && <div><dt>来源路径</dt><dd>{parent} → {selected.id}</dd></div>}<div><dt>比较基准</dt><dd>{selected.overlapRoot}</dd></div><div><dt>标签重合</dt><dd>{selected.id === graph.root ? '根节点，固定突出' : selected.overlap.method === 'topics' ? `${Math.round(selected.overlap.score * 100)}%（交集 / 并集）` : selected.overlap.method === 'language-fallback' ? `同为 ${selected.repo.language}，语言回退；无标签百分比` : '没有可比较的标签'}</dd></div></dl>
              {selected.overlap.shared.length > 0 && <p className="graph-shared">{selected.overlap.shared.map(topic => `#${topic}`).join(' · ')}</p>}
              <div className="graph-node-actions"><a className="graph-button" href={selected.repo.url} target="_blank" rel="noreferrer">GitHub<ExternalLink size={13} /></a><button className="graph-button" type="button" disabled={loading || !canExpand} onClick={() => void useGraph.getState().expand(key, selected.id)}>{view.expanded.includes(selected.id) || selected.id === graph.root ? '已分析一级' : '继续追溯'}</button>{selected.id !== graph.root && <button className="graph-button" type="button" onClick={() => navigate(graphPath(selected.repo.nameWithOwner))}>以此为新根</button>}</div>
              {selected.depth >= MAX_GRAPH_DEPTH && <p className="graph-limit">已达 5 层上限，可设为新根继续探索。</p>}
              <h4>与选中项目相连的证据</h4>
              {relations.length === 0 && <p className="muted">没有发现可验证的项目来源关系。</p>}
              {relations.map(edge => <section className="graph-relation" key={`${edge.source}:${edge.target}`}><h5>{edge.relation === 'upstream' ? `${edge.target} → ${edge.source}` : edge.relation === 'downstream' ? `${edge.source} → ${edge.target}` : `${edge.source} — ${edge.target}`}</h5><span className="graph-relation__label">{relationLabels[edge.relation]}</span><EvidenceList evidence={edge.evidence} /></section>)}
              {selected.evidence.length > 0 && <details><summary>全部节点来源（{selected.evidence.length}）</summary><EvidenceList evidence={selected.evidence} /></details>}
            </>}
            {view.panel === 'nodes' && <ul className="graph-node-list" aria-label="图谱节点" onKeyDown={event => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')], index = buttons.indexOf(event.target as HTMLButtonElement)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click()
            }}>{graph.nodes.map(node => <li key={node.id}><button type="button" aria-label={`选择 ${node.repo.nameWithOwner}`} aria-pressed={node.id === view.selected} onClick={() => useGraph.getState().updateView(key, { selected: node.id })}><span>{node.repo.nameWithOwner}</span><small>{node.depth} 层 · {node.overlap.method === 'topics' ? `${Math.round(node.overlap.score * 100)}% 标签重合` : node.overlap.method === 'language-fallback' ? '语言回退' : '无标签重合'}</small></button></li>)}</ul>}
            {view.panel === 'people' && <><p className="muted">人员关系用于发现关联项目，不代表技术上下游。</p>{graph.people.length === 0 && <p>未发现可核实的公开开发者。</p>}{graph.people.map(person => <section className="graph-person" key={person.login}><a href={person.url} target="_blank" rel="noreferrer">@{person.login}</a><p>{person.roles.map(r => roleLabels[r]).join(' · ')}{person.contributions !== null && ` · ${person.contributions} 次贡献`}</p><EvidenceList evidence={person.evidence} /></section>)}</>}
          </div>
        </aside>
      </div>
      <details className="graph-coverage"><summary>采集范围与请求预算 · {graph.analyses.length} 次一级分析{graph.warnings.length ? ` · ${graph.warnings.length} 条覆盖说明` : ''}</summary><p>自动分析只读取当前项目一级，后代需要手动继续追溯。最多 120 个节点、5 层；距离用于展开布局，节点面积才表示真实标签重合。</p>{graph.analyses.map(analysis => <p key={analysis.root}><strong>{analysis.root}</strong>：{analysis.counts.requests}/{analysis.limits.requests} 次请求，解析 {analysis.counts.referencesResolved}/{analysis.counts.referencesFound} 个直接引用，扫描 {analysis.counts.peopleScanned}/{analysis.counts.peopleFound} 位开发者、{analysis.counts.candidatesScanned} 个关联候选。单次上限：{analysis.limits.references} 个引用、{analysis.limits.people} 人 × {analysis.limits.reposPerPerson} 个仓库，{analysis.limits.totalTimeoutMs / 1000} 秒。</p>)}{graph.warnings.map(w => <p key={w} className="graph-limit">{w}</p>)}</details>
    </> : !loading && !view.error ? <p className="graph-message">等待分析公开仓库。</p> : null}
  </section>
}
