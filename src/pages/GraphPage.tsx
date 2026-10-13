import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Search } from 'lucide-react'
import { parseRepoInput } from '../api/graph'
import { GraphWorkspace } from '../components/graph/GraphWorkspace'
import { graphPath, useGraph } from '../store/graph'

export function GraphPage() {
  const { owner, name } = useParams(), navigate = useNavigate()
  const last = useGraph(s => s.lastStandalone)
  const root = owner && name ? `${owner}/${name}` : undefined
  const [input, setInput] = useState(root || last || ''), [error, setError] = useState<string | null>(null)
  useEffect(() => { setInput(root || last || ''); setError(null) }, [root, last])
  useEffect(() => { document.title = `${root || '技术来源图谱'} · Gitube`; return () => { document.title = 'Gitube' } }, [root])
  return <div className="page graph-page"><div className="graph-page__heading"><h1>技术来源图谱</h1><p className="muted">沿公开证据追溯开源项目，逐层探索它的来源和关联。</p></div>
    <form className="graph-search" onSubmit={event => {
      event.preventDefault()
      const parsed = parseRepoInput(input)
      if (!parsed) { setError('请输入 GitHub 仓库 URL 或 owner/repo。'); return }
      setError(null)
      const key = useGraph.getState().open('standalone', parsed)
      if (key) void useGraph.getState().reanalyze(key)
      navigate(graphPath(parsed))
    }}><label className="visually-hidden" htmlFor="graph-root">GitHub 仓库</label><input id="graph-root" aria-label="GitHub 仓库" placeholder="https://github.com/owner/repo 或 owner/repo" value={input} onChange={event => setInput(event.target.value)} aria-describedby={error ? 'graph-input-error' : undefined} /><button type="submit" className="btn btn--primary"><Search size={17} aria-hidden="true" />分析图谱</button></form>
    {error && <p id="graph-input-error" className="graph-input-error" role="alert">{error}</p>}
    <GraphWorkspace root={root} />
  </div>
}
