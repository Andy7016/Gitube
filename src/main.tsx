import './lib/migrate'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/wdth.css'
import './styles/global.css'
import './styles/markdown.css'
import { App } from './App'
import { applyTheme, getTheme } from './lib/theme'
import { useAuth } from './store/auth'
import { useFeed } from './store/feed'
import { useLibrary } from './store/library'
import { useSeeds } from './store/seeds'

applyTheme(getTheme())

// 滚动位置由应用自己管理（首页会记住每个频道刷到哪了）
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

// 登录用户变化时，载入这个用户的本地数据（收藏夹、稍后再看、历史等）
const syncLibrary = () => {
  const { viewer, token } = useAuth.getState()
  if (viewer) useLibrary.getState().load(viewer.login)
  if (!token) {
    // 退出登录：清掉内存里的信息流和画像数据
    useFeed.getState().resetAll()
    useSeeds.getState().reset()
  }
}
syncLibrary()
useAuth.subscribe(syncLibrary)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
