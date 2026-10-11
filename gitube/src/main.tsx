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
useAuth.subscribe(state=>{
 if(state.account===currentAccount)return
 currentAccount=state.account
 useFeed.getState().resetAll();useSeeds.getState().reset();useStars.getState().reset();useSaveDialog.getState().close();resetEngines()
 if(state.account!=='pending')useLibrary.getState().load(state.account)
})
void useAuth.getState().bootstrap()
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
