import { useEffect } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { Layout } from './components/Layout'
import { Toasts } from './components/Toasts'
import { useAuth } from './store/auth'
import { useLibrary } from './store/library'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { RepoPage } from './pages/RepoPage'
import { HistoryPage, LaterPage, SavedPage, StarsPage } from './pages/LibraryPages'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { GraphPage } from './pages/GraphPage'

/** 没登录跳登录页；第一次登录先选兴趣 */
function RequireAuth({ onboarding = false }: { onboarding?: boolean }) {
  const token = useAuth((s) => s.token)
  const viewer = useAuth((s) => s.viewer)
  const libLogin = useLibrary((s) => s.login)
  const onboarded = useLibrary((s) => s.onboarded)

  if (!token || !viewer) return <Navigate to="/login" replace />
  if (libLogin !== viewer.login) return null // 本地数据还没载入
  if (!onboarding && !onboarded) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** 切换页面时回到顶部（首页自己会恢复之前的滚动位置） */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname !== '/') window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/**
 * 用 HashRouter（地址形如 index.html#/repo/x/y）：
 * 网页版放在 GitHub Pages 的子路径下、桌面版从本地文件加载，都不需要服务器做路由回退。
 */
export function App() {
  return (
    <HashRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<><LoginPage /><Toasts /></>} />
        <Route element={<RequireAuth onboarding />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="/repo/:owner/:name" element={<RepoPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/graph/:owner/:name" element={<GraphPage />} />
            <Route path="/later" element={<LaterPage />} />
            <Route path="/saved" element={<SavedPage />} />
            <Route path="/saved/:folderId" element={<SavedPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/stars" element={<StarsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
