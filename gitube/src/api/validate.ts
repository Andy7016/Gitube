import type { Repo } from './types'
export function isRepo(value:unknown):value is Repo {
 if(!value||typeof value!=='object')return false
 const repo=value as Partial<Repo>
 return typeof repo.id==='string'&&typeof repo.name==='string'&&typeof repo.owner==='string'&&typeof repo.nameWithOwner==='string'&&repo.nameWithOwner===repo.owner+'/'+repo.name&&/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(repo.owner)&&/^[A-Za-z0-9_.-]+$/.test(repo.name)&&typeof repo.url==='string'&&Array.isArray(repo.topics)&&repo.topics.every(topic=>typeof topic==='string')&&typeof repo.stars==='number'&&Number.isFinite(repo.stars)&&typeof repo.forks==='number'&&Number.isFinite(repo.forks)&&typeof repo.viewerHasStarred==='boolean'&&(repo.language===null||typeof repo.language==='string')&&(repo.description===null||typeof repo.description==='string')
}
export function safeURL(value:string|null|undefined){if(!value)return undefined;try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:undefined}catch{return undefined}}
