import './lib/migrate'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/wdth.css'
import './styles/global.css'
import './styles/markdown.css'
import './styles/integration.css'
import { App } from './App'
import { applyTheme,getTheme } from './lib/theme'
import { resetEngines } from './lib/recommend'
import { useAuth } from './store/auth'
import { useFeed } from './store/feed'
import { useLibrary } from './store/library'
import { useSeeds } from './store/seeds'
import { useStars } from './store/stars'
import { useSaveDialog } from './store/ui'
applyTheme(getTheme())
if('scrollRestoration' in history)history.scrollRestoration='manual'
let currentAccount='pending'
useLibrary.subscribe((state, previous) => {
 if (!state.login || state.login !== previous.login) return
 if (state.recommendationMode !== previous.recommendationMode) useFeed.getState().cancelPending('foryou', previous.recommendationMode, state.login)
 if (state.interests !== previous.interests || state.followingWeights !== previous.followingWeights || state.blockedTopics !== previous.blockedTopics || state.blockedLangs !== previous.blockedLangs) useFeed.getState().cancelPending('foryou', state.recommendationMode, state.login)
})
useAuth.subscribe(state=>{
 if(state.account===currentAccount)return
 const initialAccount=currentAccount==='pending'
 currentAccount=state.account
 useFeed.getState().resetAll(initialAccount);useSeeds.getState().reset();useStars.getState().reset();useSaveDialog.getState().close();resetEngines()
 if(state.account!=='pending')useLibrary.getState().load(state.account)
})
void useAuth.getState().bootstrap()
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
