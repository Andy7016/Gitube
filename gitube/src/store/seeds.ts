import { create } from 'zustand'
import { fetchFollowingStars, fetchSeeds, isAbort, type Seeds } from '../api/github'
import type { FollowingStar } from '../api/types'
interface SeedState {
  seeds: Seeds | null; following: FollowingStar[] | null; loading: boolean; error: string | null; followingError: string | null
  loadSeeds: () => Promise<Seeds>; loadFollowing: () => Promise<FollowingStar[]>; reset: () => void
}
let version = 0
let seedsPromise: Promise<Seeds> | null = null, followingPromise: Promise<FollowingStar[]> | null = null
export const useSeeds = create<SeedState>((set,get)=>({
  seeds:null,following:null,loading:false,error:null,followingError:null,
  loadSeeds() {
    if(get().seeds) return Promise.resolve(get().seeds!)
    if(!seedsPromise){
      const current=version
      set({loading:true,error:null})
      seedsPromise=fetchSeeds().then(seeds=>{if(current===version) set({seeds});return seeds})
        .catch(error=>{if(current===version&&!isAbort(error))set({error:error.message});throw error})
        .finally(()=>{if(current===version){seedsPromise=null;set({loading:false})}})
    }
    return seedsPromise
  },
  loadFollowing(){
    if(get().following)return Promise.resolve(get().following!)
    if(!followingPromise){
      const current=version
      set({followingError:null})
      followingPromise=fetchFollowingStars().then(following=>{if(current===version)set({following});return following})
        .catch(error=>{if(current===version&&!isAbort(error))set({followingError:error.message});throw error})
        .finally(()=>{if(current===version)followingPromise=null})
    }
    return followingPromise
  },
  reset(){++version;seedsPromise=null;followingPromise=null;set({seeds:null,following:null,loading:false,error:null,followingError:null})}
}))
