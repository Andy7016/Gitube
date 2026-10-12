import { lazy,Suspense,useEffect,useLayoutEffect,useState } from 'react'
import { RefreshCw,BookOpen } from 'lucide-react'
import type { RepoDetailData } from '../../../src/data'
import { apiRequest,isAbort } from '../api/github'
import type { Repo } from '../api/types'
import { useAuth } from '../store/auth'
import { usePageReady } from './ScrollManager'
const Markdown=lazy(()=>import('../../../src/Readme'))
export function Readme({repo}:{repo:Repo}){
 const [data,setData]=useState<RepoDetailData|null>(null),[error,setError]=useState<string|null>(null),[refresh,setRefresh]=useState(0)
 const account=useAuth(s=>s.account),ready=usePageReady()
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError(null)
  apiRequest<RepoDetailData>(`/api/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}${refresh?'?refresh=1':''}`,{signal:controller.signal})
   .then(value=>{if(!controller.signal.aborted)setData(value)}).catch(error=>{if(!controller.signal.aborted&&!isAbort(error))setError(error.message)})
  return()=>controller.abort()
 },[repo.owner,repo.name,account,refresh])
 useLayoutEffect(()=>{if(error||data&&!data.readme)ready()},[error,data,ready])
 return <section className="readme-section"><header className="readme-heading"><h2><BookOpen size={19}/>README</h2><button className="icon-btn" aria-label="刷新 README" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={17}/></button></header>{error||data?.readmeError?<div className="empty" role="alert"><h3>README 暂时无法加载</h3><p>{error??data?.readmeError?.message}</p><button className="btn" onClick={()=>setRefresh(n=>n+1)}>重试读取 README</button></div>:!data?<p className="muted" role="status">正在读取 README…</p>:data.readme?<Suspense fallback={<p role="status">正在渲染 README…</p>}><RenderedReadme data={data} onReady={ready}/></Suspense>:<p className="muted">这个仓库尚未提供 README。</p>}</section>
}
function RenderedReadme({data,onReady}:{data:RepoDetailData;onReady:()=>void}){useLayoutEffect(()=>onReady(),[data,onReady]);return <Markdown data={data}/>}
