import { Link,Navigate } from 'react-router'
import { Github,ArrowLeft } from 'lucide-react'
import { Logo } from '../components/Layout'
import { useAuth } from '../store/auth'
export function LoginPage(){
 const {viewer,notice,redirecting,login}=useAuth()
 if(viewer)return <Navigate to="/" replace/>
 return <main className="session-page"><Link to="/"><Logo/></Link><section className="panel"><h1>登录 GitHub</h1><p>连接账号后，读取公开 Star 与仓库来推荐项目，并同步你的 Star 操作。</p>{notice&&<p role="status" className="warn">{notice}</p>}<button className="btn btn--primary" disabled={redirecting} onClick={login}><Github size={19}/>{redirecting?'正在前往 GitHub…':'使用 GitHub 登录'}</button><p className="muted">收藏夹、稍后再看和浏览历史保存在当前浏览器，并按账号分别保存。</p><Link className="text-btn" to="/"><ArrowLeft size={16}/>继续以访客浏览</Link></section></main>
}
