import { createContext,useCallback,useContext,useLayoutEffect,useRef,useState,type ReactNode } from 'react'
import { useLocation,useNavigationType } from 'react-router'
import { useAuth } from '../store/auth'
import { isRepo } from '../api/validate'
import { feedKey,feedSnapshotToken,useFeed,type ChannelFeed } from '../store/feed'
import { useLibrary,type RecommendationMode } from '../store/library'
type Snapshot={scope:string;scroll:number;channel?:string;mode?:RecommendationMode;token?:string;feed?:ChannelFeed;search?:unknown}
const ReadyContext=createContext<()=>void>(()=>{})
export const usePageReady=()=>useContext(ReadyContext)
export function readPageSnapshot():Snapshot|null{
 const value=history.state?.gitubeSnapshot
 return value?.scope===useAuth.getState().account&&typeof value.scroll==='number'&&Number.isFinite(value.scroll)?value:null
}
export function saveSearchSnapshot(search:unknown){
 const scope=useAuth.getState().account,old=readPageSnapshot()
 history.replaceState({...history.state,gitubeSnapshot:{...old,scope,scroll:old?.scroll??0,search}},'')
}
export function restoreFeedSnapshot(saved=readPageSnapshot()){
 if(!saved?.channel||saved.scope!==useAuth.getState().account||!saved.feed||!Array.isArray(saved.feed.items)||!saved.feed.items.every(item=>typeof item?.key==='string'&&isRepo(item.repo)))return
 const mode=saved.mode??'normal',feed=saved.feed
 if(!['normal','taste','random'].includes(mode)||!['idle','loading','error','end'].includes(feed.status)||(feed.cursor!==null&&typeof feed.cursor!=='string')||!Number.isFinite(feed.scrollY))return
 useFeed.getState().restoreChannel(feedKey(saved.channel,mode,saved.scope),feed,saved.token)
}
export function ScrollManager({children}:{children:ReactNode}){
 const location=useLocation(),type=useNavigationType(),scope=useAuth(s=>s.account)
 const mode=useLibrary(s=>s.recommendationMode)
 const pending=useRef<{key:string;y:number}|null>(null),entry=useRef(location.key),timer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const persistRef=useRef(()=>{})
 const [initialized]=useState(()=>{restoreFeedSnapshot();return true})
 const restore=useCallback(()=>{
  const target=pending.current;if(!target)return
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(pending.current!==target||(history.state?.key??'default')!==target.key)return
   window.scrollTo(0,target.y)
   timer.current=setTimeout(()=>{if(pending.current===target){window.scrollTo(0,target.y);pending.current=null;document.documentElement.style.overflowAnchor='';persistRef.current()}},150)
  }))
 },[])
 useLayoutEffect(()=>{
  if(timer.current)clearTimeout(timer.current)
  entry.current=location.key
  const saved=type==='POP'?readPageSnapshot():null
  restoreFeedSnapshot()
  const channel=new URLSearchParams(location.search).get('c')??'foryou',key=feedKey(channel,mode,scope)
  const savedKey=saved?.channel?feedKey(saved.channel,saved.mode??'normal',saved.scope):null
  const y=location.pathname==='/'?(savedKey===key?saved!.scroll:useFeed.getState().channels[key]?.scrollY??0):saved?.scroll??0
  pending.current={key:location.key,y}
  document.documentElement.style.overflowAnchor='none'
  if(!/^\/(repo|project)\//.test(location.pathname))restore()
  else if(type!=='POP'||!saved){window.scrollTo(0,0);pending.current=null;document.documentElement.style.overflowAnchor=''}
  const persist=()=>{
   if(pending.current||(history.state?.key??'default')!==entry.current)return
   const old=readPageSnapshot()
   const feed=location.pathname==='/'?useFeed.getState().channels[key]:undefined
   const snapshot:Snapshot={...old,scope,scroll:window.scrollY,...(feed?{channel,mode,token:feedSnapshotToken(key),feed:{...feed,items:feed.items.slice(0,180)}}:{})}
   try{history.replaceState({...history.state,gitubeSnapshot:snapshot},'')}catch{/* History quota can vary by browser */}
  }
  persistRef.current=persist
  window.addEventListener('scroll',persist,{passive:true})
  const unsub=useFeed.subscribe(persist)
  return()=>{window.removeEventListener('scroll',persist);unsub();if(timer.current)clearTimeout(timer.current)}
 },[location.key,location.pathname,location.search,scope,mode,type,restore,initialized])
 return <ReadyContext.Provider value={restore}>{children}</ReadyContext.Provider>
}
