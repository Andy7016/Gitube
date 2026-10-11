import { lazy,Suspense } from 'react'
import { useNavigate,useParams } from 'react-router'
import { useAuth } from '../store/auth'
const TechnologyGraph=lazy(()=>import('../../../src/TechnologyGraph'))
export function GraphBridge({owner,name,embedded=false}:{owner?:string;name?:string;embedded?:boolean}){
 const auth=useAuth(),navigate=useNavigate()
 return <div className="gitube-graph"><Suspense fallback={<div className={`technology-graph ${embedded?'tg-embedded':'tg-workbench'}`}><div className="tg-await" role="status">正在加载技术来源图谱…</div></div>}><TechnologyGraph key={JSON.stringify([auth.account,owner??'',name??'',embedded])} owner={owner} name={name} account={auth.account} csrfToken={auth.csrfToken} embedded={embedded} sessionError={auth.error??undefined} onSessionRetry={()=>void auth.bootstrap()} onSessionExpired={auth.expire} onNavigate={(event,path)=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate(path)}}} onRoute={path=>navigate(path)}/></Suspense></div>
}
export function GraphPage(){const {owner,name}=useParams();return <div className="page graph-page"><GraphBridge owner={owner} name={name}/></div>}
