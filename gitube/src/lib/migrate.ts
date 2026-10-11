import { INTEREST_BY_ID } from './interests'
import type { Repo } from '../api/types'
/** 本地内容迁移；认证凭据只删除、不读取。原 RepoFlow 键保留给旧界面。 */
try{
 for(const storage of [localStorage,sessionStorage]){
  for(const key of ['gitube:token','gitube:viewer','starscout:token','starscout:viewer'])storage.removeItem(key)
 }
 const keys:string[]=[]
 for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('starscout:library:'))keys.push(key)}
 for(const key of keys){const next='gitube:'+key.slice('starscout:'.length);if(!localStorage.getItem(next))localStorage.setItem(next,localStorage.getItem(key)!)}
 const read=(key:string)=>{try{return JSON.parse(localStorage.getItem(key)??'null')}catch{return null}}
 const library=read('repoflow.library.v2'),preferences=read('repoflow.preferences.v1')
 const scopes=new Set<string>()
 for(const field of ['bookmarks','watchLater','history'])if(library?.[field]&&typeof library[field]==='object')Object.keys(library[field]).forEach(scope=>scopes.add(scope))
 if(preferences&&typeof preferences==='object')Object.keys(preferences).forEach(scope=>scopes.add(scope))
 const convert=(value:unknown):Repo|null=>{
  if(!value||typeof value!=='object')return null
  const repo=value as Record<string,any>
  if(typeof repo.id!=='number'||repo.id<=0||typeof repo.name!=='string'||typeof repo.owner?.login!=='string'||repo.full_name!==repo.owner.login+'/'+repo.name||!/^https?:\/\//i.test(repo.html_url??'')||!Array.isArray(repo.topics))return null
  return {id:'repo:'+repo.full_name.toLowerCase(),nameWithOwner:repo.full_name,name:repo.name,owner:repo.owner.login,ownerId:null,ownerType:null,ownerAvatar:typeof repo.owner.avatar_url==='string'?repo.owner.avatar_url:'',description:typeof repo.description==='string'?repo.description:null,url:repo.html_url,homepageUrl:typeof repo.homepage==='string'?repo.homepage:null,stars:Number.isFinite(repo.stargazers_count)?repo.stargazers_count:0,forks:Number.isFinite(repo.forks_count)?repo.forks_count:0,language:typeof repo.language==='string'?repo.language:null,languageColor:null,topics:repo.topics.filter((topic:unknown)=>typeof topic==='string'),pushedAt:typeof repo.updated_at==='string'?repo.updated_at:null,createdAt:typeof repo.created_at==='string'?repo.created_at:null,viewerHasStarred:repo.viewer_starred===true,coverImage:null,isArchived:false,license:typeof repo.license?.spdx_id==='string'?repo.license.spdx_id:null,defaultBranch:null}
 }
 for(const rawScope of scopes){
  if(rawScope!=='guest'&&!/^github:[a-z0-9-]+$/i.test(rawScope))continue
  const scope=rawScope.toLowerCase(),key='gitube:library:'+scope
  if(localStorage.getItem(key)!==null)continue
  const items=(field:string)=>Array.isArray(library?.[field]?.[rawScope])?library[field][rawScope].map(convert).filter((repo:Repo|null)=>repo!==null).map((repo:Repo)=>({repo,at:null})).slice(0,1000):[]
  const interests=Array.isArray(preferences?.[rawScope]?.topics)?preferences[rawScope].topics.filter((id:unknown)=>typeof id==='string'&&INTEREST_BY_ID.has(id)):[]
  const bookmarks=items('bookmarks'),later=items('watchLater'),history=items('history')
  if(!bookmarks.length&&!later.length&&!history.length&&!interests.length)continue
  localStorage.setItem(key,JSON.stringify({version:1,onboarded:interests.length>0,interests,folders:[{id:'default',name:'默认收藏夹',createdAt:Date.now(),items:bookmarks}],later,history,events:[],dislikedRepos:[],blockedTopics:[],blockedLangs:[],seen:{}}))
 }
}catch{/* Storage is optional */}
export {}
