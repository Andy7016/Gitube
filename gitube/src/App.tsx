import { useEffect } from 'react'
import { BrowserRouter,Navigate,Route,Routes,useParams,useLocation } from 'react-router'
import { Layout,Logo } from './components/Layout'
import { ScrollManager } from './components/ScrollManager'
import { GraphPage } from './components/GraphBridge'
import { Toasts } from './components/Toasts'
import { useAuth } from './store/auth'
import { toast } from './store/toast'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { RepoPage } from './pages/RepoPage'
import { HistoryPage,LaterPage,SavedPage,StarsPage } from './pages/LibraryPages'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { authErrorMessage } from './lib/auth-errors'
export function App(){
 const {ready,error,loading,account,bootstrap}=useAuth()
 useEffect(()=>{
  const query=new URLSearchParams(location.search),code=query.get('auth_error')
  if(code){toast(authErrorMessage(code));query.delete('auth_error');history.replaceState(history.state,'',location.pathname+(query.size?'?'+query:'')+location.hash)}
 },[])
 if(!ready)return <div className="session-page"><Logo/><section className="panel" role={error?'alert':'status'}><h1>{error?'会话暂时无法连接':'正在连接会话…'}</h1>{error&&<><p>{error}</p><button className="btn btn--primary" disabled={loading} onClick={()=>void bootstrap()}>重试连接</button></>}</section><Toasts/></div>
 return <BrowserRouter><ScrollManager key={account}><Routes><Route path="/login" element={<><LoginPage/><Toasts/></>}/><Route path="/onboarding" element={<OnboardingPage/>}/><Route element={<Layout/>}><Route index element={<HomePage/>}/><Route path="/repo/:owner/:name" element={<RepositoryRoute/>}/><Route path="/project/:owner/:name" element={<RepositoryRoute/>}/><Route path="/graph" element={<GraphPage/>}/><Route path="/graph/:owner/:name" element={<GraphPage/>}/><Route path="/later" element={<LaterPage/>}/><Route path="/saved" element={<SavedPage/>}/><Route path="/saved/:folderId" element={<SavedPage/>}/><Route path="/history" element={<HistoryPage/>}/><Route path="/stars" element={<StarsPage/>}/><Route path="/search" element={<SearchRoute/>}/><Route path="/settings" element={<SettingsPage/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes></ScrollManager></BrowserRouter>
}

function RepositoryRoute(){const {owner,name}=useParams();return <RepoPage key={`${owner}/${name}`}/>}

function SearchRoute(){const location=useLocation();return <SearchPage key={location.search}/>}
