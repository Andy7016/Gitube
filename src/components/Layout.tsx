import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Bookmark, Clock, GitBranch, History, House, Menu, Search, Settings, Star, UserRound } from 'lucide-react'
import { useAuth } from '../store/auth'
import { useLibrary } from '../store/library'
import { Avatar } from './Avatar'
import { SaveDialog } from './SaveDialog'
import { Toasts } from './Toasts'

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--ink)" />
        <path
          d="M16 6.5l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L16 20.9 10.3 24l1.2-6.4-4.7-4.4 6.4-.8z"
          fill="var(--gold)"
        />
      </svg>
      {!compact && (
        <span className="logo__word">
          Gitube
        </span>
      )}
    </span>
  )
}

function SearchBox({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const location = useLocation()
  const [q, setQ] = useState(location.pathname === '/search' ? (params.get('q') ?? '') : '')

  useEffect(() => {
    if (location.pathname === '/search') setQ(params.get('q') ?? '')
  }, [location.pathname, params])

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (!q.trim()) return
        navigate(`/search?q=${encodeURIComponent(q.trim())}`)
        onDone?.()
      }}
    >
      <input
        className="search__input"
        type="search"
        placeholder="搜索项目、topic 或 language:rust"
        aria-label="搜索 GitHub 项目"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={!!onDone}
      />
      <button type="submit" className="search__btn" aria-label="搜索">
        <Search size={18} aria-hidden="true" />
      </button>
    </form>
  )
}

const NAV = [
  { to: '/', label: '首页', icon: House, end: true },
  { to: '/graph', label: '技术图谱', icon: GitBranch },
  { to: '/later', label: '稍后再看', icon: Clock },
  { to: '/saved', label: '收藏夹', icon: Bookmark },
  { to: '/stars', label: '我的 Star', icon: Star },
  { to: '/history', label: '历史记录', icon: History },
  { to: '/settings', label: '偏好设置', icon: Settings },
]

const MOBILE_NAV = [
  { to: '/', label: '首页', icon: House, end: true },
  { to: '/saved', label: '收藏', icon: Bookmark },
  { to: '/later', label: '稍后再看', icon: Clock },
  { to: '/history', label: '历史', icon: History },
  { to: '/settings', label: '我的', icon: UserRound },
]

export function Layout() {
  const viewer = useAuth((s) => s.viewer)
  const laterCount = useLibrary((s) => s.later.length)
  const [mini, setMini] = useState(() => {
    try {
      return localStorage.getItem('gitube:mini-nav') === '1'
    } catch {
      return false
    }
  })
  const [mobileSearch, setMobileSearch] = useState(false)

  const toggleMini = () => {
    setMini((v) => {
      try {
        localStorage.setItem('gitube:mini-nav', v ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !v
    })
  }

  return (
    <div className={`shell${mini ? ' shell--mini' : ''}`}>
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById('main')?.focus()}
      >
        跳到主要内容
      </button>
      <header className="topbar">
        {mobileSearch ? (
          <div className="topbar__mobile-search">
            <button type="button" className="icon-btn" aria-label="返回" onClick={() => setMobileSearch(false)}>
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
            <SearchBox onDone={() => setMobileSearch(false)} />
          </div>
        ) : (
          <>
            <div className="topbar__start">
              <button type="button" className="icon-btn hide-mobile" aria-label="收起或展开导航" onClick={toggleMini}>
                <Menu size={20} aria-hidden="true" />
              </button>
              <Link to="/" aria-label="Gitube 首页">
                <Logo />
              </Link>
            </div>
            <div className="topbar__center hide-mobile">
              <SearchBox />
            </div>
            <div className="topbar__end">
              <Link to="/graph" className="icon-btn show-mobile" aria-label="技术图谱"><GitBranch size={20} aria-hidden="true" /></Link>
              <button
                type="button"
                className="icon-btn show-mobile"
                aria-label="搜索"
                onClick={() => setMobileSearch(true)}
              >
                <Search size={20} aria-hidden="true" />
              </button>
              {viewer && (
                <Link to="/settings" className="topbar__me" aria-label={`${viewer.login} 的偏好设置`}>
                  <Avatar src={viewer.avatarUrl} name={viewer.login} size={32} />
                </Link>
              )}
            </div>
          </>
        )}
      </header>

      <nav className="sidenav" aria-label="主导航">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="sidenav__item" title={mini ? label : undefined}>
            <Icon size={20} aria-hidden="true" />
            <span className="sidenav__label">{label}</span>
            {to === '/later' && laterCount > 0 && <span className="sidenav__badge">{laterCount}</span>}
          </NavLink>
        ))}
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="bottomnav" aria-label="主导航">
        {MOBILE_NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="bottomnav__item">
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <SaveDialog />
      <Toasts />
    </div>
  )
}
