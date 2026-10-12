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
import { useStars } from './store/stars'

applyTheme(getTheme())

// 滚动位置由应用自己管理（首页会记住每个频道刷到哪了）
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

// 登录用户变化时，载入这个用户的本地数据（收藏夹、稍后再看、历史等）
let activeAccount: string | null = null
const syncLibrary = () => {
  const { viewer, token } = useAuth.getState()
  const account = viewer && token ? viewer.login.toLowerCase() : null
  if (account !== activeAccount) {
    activeAccount = account
    // 账号边界使旧在途请求失效，避免画像、Star 覆盖层或列表串到新账号。
    useFeed.getState().resetAll()
    useSeeds.getState().reset()
    useStars.getState().reset()
  }
  if (viewer && token) useLibrary.getState().load(viewer.login)
}
syncLibrary()
useAuth.subscribe(syncLibrary)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
