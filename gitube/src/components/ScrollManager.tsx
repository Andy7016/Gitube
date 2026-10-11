import { createContext,useCallback,useContext,useLayoutEffect,useRef,useState,type ReactNode } from 'react'
import { useLocation,useNavigationType } from 'react-router'
import { useAuth } from '../store/auth'
import { useFeed,type ChannelFeed } from '../store/feed'
type Snapshot={scope:string;scroll:number;channel?:string;feed?:ChannelFeed;search?:unknown}
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
function restoreFeed(){const saved=readPageSnapshot();if(saved?.channel&&saved.feed&&Array.isArray(saved.feed.items))useFeed.setState(s=>({channels:{...s.channels,[saved.channel!]:{...saved.feed!,status:saved.feed!.status==='loading'?'idle':saved.feed!.status}}}))}
export function ScrollManager({children}:{children:ReactNode}){
 const location=useLocation(),type=useNavigationType(),scope=useAuth(s=>s.account)
 const pending=useRef<{key:string;y:number}|null>(null),entry=useRef(location.key),timer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const [initialized]=useState(()=>{restoreFeed();return true})
 const restore=useCallback(()=>{
  const target=pending.current;if(!target)return
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(pending.current!==target||(history.state?.key??'default')!==target.key)return
   window.scrollTo(0,target.y)
   timer.current=setTimeout(()=>{if(pending.current===target){window.scrollTo(0,target.y);pending.current=null;document.documentElement.style.overflowAnchor=''}},150)
  }))
 },[])
 useLayoutEffect(()=>{
  if(timer.current)clearTimeout(timer.current)
  entry.current=location.key
  const saved=type==='POP'?readPageSnapshot():null
  restoreFeed()
  pending.current={key:location.key,y:saved?.scroll??0}
  document.documentElement.style.overflowAnchor='none'
  if(!/^\/(repo|project)\//.test(location.pathname))restore()
  else if(type!=='POP'||!saved){window.scrollTo(0,0);pending.current=null;document.documentElement.style.overflowAnchor=''}
  const persist=()=>{
   if(pending.current||(history.state?.key??'default')!==entry.current)return
   const old=readPageSnapshot(),channel=new URLSearchParams(window.location.search).get('c')??'foryou'
   const feed=window.location.pathname==='/'?useFeed.getState().channels[channel]:undefined
   const snapshot:Snapshot={...old,scope,scroll:window.scrollY,...(feed?{channel,feed:{...feed,items:feed.items.slice(0,180)}}:{})}
   try{history.replaceState({...history.state,gitubeSnapshot:snapshot},'')}catch{/* History quota can vary by browser */}
  }
  window.addEventListener('scroll',persist,{passive:true})
  const unsub=useFeed.subscribe(persist)
  return()=>{window.removeEventListener('scroll',persist);unsub();if(timer.current)clearTimeout(timer.current)}
 },[location.key,location.pathname,scope,type,restore,initialized])
 return <ReadyContext.Provider value={restore}>{children}</ReadyContext.Provider>
}
