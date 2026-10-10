import { create } from 'zustand'
import { fetchViewer, onUnauthorized, setApiToken } from '../api/github'
import type { Viewer } from '../api/types'

const TOKEN_KEY = 'gitube:token'
const VIEWER_KEY = 'gitube:viewer'

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* 隐私模式等情况下 localStorage 不可用，忽略 */
  }
}

interface AuthState {
  token: string | null
  viewer: Viewer | null
  /** 被动退出登录时给登录页的提示 */
  notice: string | null
  loginWithToken: (token: string) => Promise<Viewer>
  logout: (notice?: string) => void
}

const initialToken = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
})()
setApiToken(initialToken)

export const useAuth = create<AuthState>((set) => ({
  token: initialToken,
  viewer: initialToken ? readJSON<Viewer>(VIEWER_KEY) : null,
  notice: null,

  async loginWithToken(raw) {
    const token = raw.trim()
    const viewer = await fetchViewer(token)
    setApiToken(token)
    safeSet(TOKEN_KEY, token)
    safeSet(VIEWER_KEY, JSON.stringify(viewer))
    set({ token, viewer, notice: null })
    return viewer
  },

  logout(notice) {
    setApiToken(null)
    safeSet(TOKEN_KEY, null)
    safeSet(VIEWER_KEY, null)
    set({ token: null, viewer: null, notice: notice ?? null })
  },
}))

onUnauthorized(() => {
  useAuth.getState().logout('登录已失效（Token 过期或被撤销），请重新登录')
})
