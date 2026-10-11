import { create } from 'zustand'
import { GitHubError, isAbort, repoCache, setStarred } from '../api/github'
import type { Repo } from '../api/types'
import { useAuth } from './auth'
import { useLibrary } from './library'
import { toast, toastError, useToasts } from './toast'
interface StarEntry { starred:boolean;stars:number }
interface StarState {
 overrides:Record<string,StarEntry>;pending:Record<string,boolean>
 toggle:(repo:Repo)=>Promise<boolean>;ensureStarred:(repo:Repo)=>Promise<boolean>;reset:()=>void
}
let version=0
export const useStars=create<StarState>((set,get)=>{
 const apply=async(repo:Repo,want:boolean,silent=false)=>{
  if(!useAuth.getState().viewer){toast('登录 GitHub 后才能 Star 项目',{label:'登录 GitHub',onClick:()=>useAuth.getState().login()});return false}
  const previous=get().overrides[repo.id]??{starred:repo.viewerHasStarred,stars:repo.stars}
  if(get().pending[repo.id]||previous.starred===want)return previous.starred
  const current=version
  repoCache.set(repo.id,{...repo,viewerHasStarred:previous.starred,stars:previous.stars})
  set({pending:{...get().pending,[repo.id]:true}})
  try{
   const result=await setStarred(repo.id,want)
   if(current!==version)return false
   set({overrides:{...get().overrides,[repo.id]:result}})
   if(want)useLibrary.getState().addEvent('star',repo)
   if(!silent)toast(want?`已 Star ${repo.name}`:`已取消 Star ${repo.name}`)
   return result.starred
  }catch(error){
   if(current===version&&!isAbort(error)){
    if(error instanceof GitHubError&&error.code==='STAR_OAUTH_REQUIRED'){
     useToasts.getState().push({text:error.message,tone:'error',action:{label:'启用站内 Star',onClick:()=>window.location.assign('/api/setup/oauth')}})
    }else if(error instanceof GitHubError&&error.code==='STAR_PERMISSION_REQUIRED'){
     useToasts.getState().push({text:error.message,tone:'error',action:{label:'在 GitHub 打开',onClick:()=>window.open(`https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,'_blank','noopener,noreferrer')}})
    }else toastError(error)
   }
   return previous.starred
  }
  finally{if(current===version){const {[repo.id]:_drop,...rest}=get().pending;set({pending:rest})}}
 }
 return {overrides:{},pending:{},toggle:repo=>apply(repo,!(get().overrides[repo.id]?.starred??repo.viewerHasStarred)),ensureStarred:repo=>apply(repo,true,true),reset(){++version;set({overrides:{},pending:{}})}}
})
export function useStarState(repo:Repo){const entry=useStars(s=>s.overrides[repo.id]);const pending=useStars(s=>!!s.pending[repo.id]);return {starred:entry?.starred??repo.viewerHasStarred,stars:entry?.stars??repo.stars,pending}}
export function isStarredNow(repo:Repo){return useStars.getState().overrides[repo.id]?.starred??repo.viewerHasStarred}
