import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Maximize, Minus, Plus, Scan, LocateFixed, RotateCcw } from 'lucide-react'
import { useGraph, type GraphCamera, type GraphView } from '../../store/graph'
import { fitCamera, graphDensity, layoutGraph, placeGraphLabels } from './layout'

export function GraphCanvas({ workspaceKey, view }: { workspaceKey: string; view: GraphView }) {
  const graph = view.graph!
  const host = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; camera: GraphCamera; moved: boolean } | null>(null)
  const [size, setSize] = useState({ width: 640, height: 460 })
  const [fullscreen, setFullscreen] = useState(false)
  const marker = useId().replace(/:/g, '')
  const positions = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes, graph.edges])
  const fit = useMemo(() => fitCamera(graph.nodes, positions, size), [graph.nodes, positions, size])
  const camera = view.camera ?? fit
  const update = (next: GraphCamera) => useGraph.getState().updateView(workspaceKey, { camera: next, canvasSize: size })
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      useGraph.getState().updateView(workspaceKey, { camera: { ...camera, scale: Math.max(.00001, Math.min(6, camera.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12))), mode: 'custom' }, canvasSize: size })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [camera, size, workspaceKey])
  useEffect(() => {
    const element = host.current
    if (!element) return
    const resize = () => {
      const bounds = element.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) setSize({ width: bounds.width, height: bounds.height })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const previous = view.canvasSize
    // Keep the selected world point when dimensions change; overview fits anew.
    if (previous && (Math.abs(previous.width - size.width) > 1 || Math.abs(previous.height - size.height) > 1)) {
      const current = view.camera
      useGraph.getState().updateView(workspaceKey, { camera: current?.mode === 'overview' ? null : current ? { ...current, scale: current.scale * Math.min(size.width / previous.width, size.height / previous.height) } : null, canvasSize: size })
    } else if (!previous) useGraph.getState().updateView(workspaceKey, { canvasSize: size })
  }, [size.width, size.height, workspaceKey, view.canvasSize, view.camera])
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === host.current?.closest('.graph-workspace'))
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  const density = graphDensity(graph.nodes, positions, camera)
  const expanded = useMemo(() => new Set(view.expanded), [view.expanded])
  const names = useMemo(() => new Set(graph.nodes.filter(n => n.id === graph.root || n.id === view.selected || expanded.has(n.id) || n.overlap.method === 'topics' && n.overlap.score >= .3).map(n => n.id)), [graph.nodes, graph.root, view.selected, expanded])
  const labels = placeGraphLabels(graph.nodes, positions, names, expanded, camera, size, density, view.selected, camera.mode === 'focus')
  const nearby = new Set([view.selected])
  for (const edge of graph.edges) if (edge.source === view.selected || edge.target === view.selected) { nearby.add(edge.source); nearby.add(edge.target) }
  const screen = (id: string) => {
    const point = positions.get(id)!
    return { x: size.width / 2 + (point.x - camera.x) * camera.scale, y: size.height / 2 + (point.y - camera.y) * camera.scale, radius: point.radius * (id === graph.root ? 1 : density) }
  }
  const zoom = (factor: number) => update({ ...camera, scale: Math.max(.00001, Math.min(6, camera.scale * factor)), mode: 'custom' })
  const center = () => { const point = positions.get(view.selected); if (point) update({ x: point.x, y: point.y, scale: Math.max(camera.scale, Math.min(1.7, Math.max(size.width, size.height) / 540)), mode: 'focus' }) }
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-node-id]')) return
    drag.current = { x: event.clientX, y: event.clientY, camera, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current
    if (!start) return
    start.moved = true
    update({ x: start.camera.x - (event.clientX - start.x) / start.camera.scale, y: start.camera.y - (event.clientY - start.y) / start.camera.scale, scale: start.camera.scale, mode: 'custom' })
  }
  const fullscreenToggle = async () => {
    try {
      if (fullscreen) await document.exitFullscreen()
      else await host.current?.closest('.graph-workspace')?.requestFullscreen()
    } catch { /* Browsers without fullscreen keep the normal accessible view. */ }
  }
  return <div className="graph-canvas-shell">
    <div className="graph-toolbar" role="toolbar" aria-label="图谱视角">
      <button type="button" onClick={() => zoom(1.3)} aria-label="放大" title="放大"><Plus size={16} /></button>
      <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="缩小" title="缩小"><Minus size={16} /></button>
      <button type="button" onClick={() => update(fit)} aria-label="适配全图" title="适配全图"><Scan size={16} />全图</button>
      <button type="button" onClick={center} aria-label="选中居中" title="选中居中"><LocateFixed size={16} />居中</button>
      <button type="button" onClick={() => update(fit)} aria-label="重置视角" title="重置视角"><RotateCcw size={16} /></button>
      <button type="button" onClick={fullscreenToggle} aria-label={fullscreen ? '退出全屏' : '全屏图谱'} title={fullscreen ? '退出全屏' : '全屏图谱'}><Maximize size={16} /></button>
    </div>
    <div ref={host} className="graph-canvas">
      <svg ref={svg} viewBox={`0 0 ${size.width} ${size.height}`} width="100%" height="100%" role="img" aria-label={`${graph.root} 技术来源关系图；可通过节点列表选择项目`} data-camera={`${camera.x},${camera.y},${camera.scale}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
        {graph.edges.map(edge => {
          const a = screen(edge.source), b = screen(edge.target)
          const directional = edge.relation === 'upstream' || edge.relation === 'downstream'
          const source = edge.relation === 'upstream' ? b : a, target = edge.relation === 'upstream' ? a : b
          const distance = Math.hypot(target.x - source.x, target.y - source.y) || 1
          const dx = (target.x - source.x) / distance, dy = (target.y - source.y) / distance
          const active = edge.source === view.selected || edge.target === view.selected
          const description = edge.relation === 'upstream' ? `${edge.target} → ${edge.source}：技术提供方到使用方` : edge.relation === 'downstream' ? `${edge.source} → ${edge.target}：技术提供方到使用方` : `${edge.source} — ${edge.target}：${edge.relation === 'ambiguous' ? '证据含糊或冲突' : '关联或提及，方向未确定'}`
          return <line key={`${edge.source}:${edge.target}`} className={`graph-edge${directional ? ' graph-edge--directed' : ''}${active ? ' is-near' : ' is-dim'}`} data-source={edge.source} data-target={edge.target} data-relation={edge.relation} x1={source.x + dx * (source.radius + 3)} y1={source.y + dy * (source.radius + 3)} x2={target.x - dx * (target.radius + 5)} y2={target.y - dy * (target.radius + 5)} markerEnd={directional ? `url(#${marker})` : undefined}><title>{description}</title></line>
        })}
        {graph.nodes.map(node => {
          const point = screen(node.id), label = labels.get(node.id), visible = names.has(node.id)
          return <g key={node.id} data-node-id={node.id} className={`graph-node${node.id === graph.root ? ' graph-node--root' : ''}${node.id === view.selected ? ' is-selected' : ''}${nearby.has(node.id) ? '' : ' is-dim'}`} onClick={() => useGraph.getState().updateView(workspaceKey, { selected: node.id, panel: 'evidence' })}>
            <title>{node.repo.nameWithOwner}{node.overlap.method === 'topics' ? `，标签重合 ${Math.round(node.overlap.score * 100)}%` : '，无标签重合度'}</title>
            <circle className="graph-node__hit" cx={point.x} cy={point.y} r={Math.max(16, point.radius + 5)} />
            <circle cx={point.x} cy={point.y} r={point.radius} />
            {visible && label && <g className="graph-node__label" transform={`translate(${point.x},${point.y})`}>
              {label.leader && <line className="graph-label-leader" x1={0} y1={0} x2={label.leader.x} y2={label.leader.y} />}
              <rect x={label.x} y={label.y} width={label.width} height={label.height} rx={4} />
              <text x={label.x + label.width / 2} y={label.y + label.fontSize + 1} textAnchor="middle" fontSize={label.fontSize}>{label.lines.map((line, index) => <tspan key={index} x={label.x + label.width / 2} dy={index ? label.lineHeight : 0}>{line}</tspan>)}</text>
              {expanded.has(node.id) && <text x={label.x + label.width / 2} y={label.y + label.height - 3} textAnchor="middle" fontSize="9">已展开分支</text>}
            </g>}
          </g>
        })}
      </svg>
    </div>
    <p className="graph-canvas-tip">拖动画布平移 · Ctrl / ⌘ + 滚轮缩放 · 箭头：技术提供方 → 使用方 · 虚线：方向未定</p>
  </div>
}
