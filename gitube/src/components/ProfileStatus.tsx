import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../store/auth'
import { useSeeds } from '../store/seeds'
import { useFeed } from '../store/feed'
import { useApiMeta } from '../api/github'
export function ProfileStatus({following=false}:{following?:boolean}){
 const viewer=useAuth(s=>s.viewer),{seeds,loading,error,followingError}=useSeeds(),warnings=useApiMeta(s=>s.warnings)
 useEffect(()=>{if(viewer&&!following)void useSeeds.getState().loadSeeds().catch(()=>{})},[viewer,following])
 if(following)return <>{followingError&&<div className="session-banner" role="alert"><span>关注动态无法读取：{followingError}</span><button className="text-btn" onClick={()=>void useFeed.getState().refresh('following')}>重试动态</button></div>}{warnings.length>0&&<div className="profile-status"><details><summary>公开动态读取范围与提示</summary>{warnings.map((warning,index)=><p key={index}>{warning}</p>)}</details></div>}</>
 if(!viewer)return <div className="profile-status"><span>访客推荐依据你选择的兴趣和本地浏览反馈。</span><button className="text-btn" onClick={()=>useAuth.getState().login()}>连接 GitHub</button></div>
 const profile=seeds?.profile
 const retry=()=>{useSeeds.getState().reset();void useFeed.getState().refresh('foryou')}
 return <div className="profile-status" role={error?'alert':'status'}>{loading?<span>正在读取 Star 与公开仓库…</span>:error?<><span>账号画像暂时不可用：{error}。仍可按本地兴趣浏览。</span><button className="text-btn" onClick={retry}>重试画像</button></>:profile?<><span>已分析 {profile.truncated.starred?'最近 ':''}{profile.counts.starred} 个 Star · {profile.truncated.owned?'最近 ':''}{profile.counts.owned} 个公开仓库</span><button className="text-btn" onClick={retry}><RefreshCw size={13}/>刷新兴趣</button>{<details><summary>分析范围与提示</summary><p>读取上限：最近 {profile.limits.starred} 个 Star · 最近 {profile.limits.owned} 个公开仓库。</p><p>{profile.truncated.starred?'Star 已达到读取上限，未覆盖更早的记录。':'Star 未因数量上限截断。'}{profile.truncated.owned?'公开仓库已达到读取上限，未覆盖更早的仓库。':'公开仓库未因数量上限截断。'}</p><p>画像更新于 {new Date(profile.generatedAt).toLocaleString('zh-CN')}。</p>{profile.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</details>}</>:<span>正在准备账号画像…</span>}{followingError&&<details><summary>关注动态未能加入推荐</summary><p>{followingError}</p><button className="text-btn" onClick={()=>{useSeeds.setState({following:null,followingError:null});void useFeed.getState().refresh('foryou')}}>重试读取</button></details>}</div>
}
