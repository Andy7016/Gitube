import { create } from 'zustand'
import { apiRequest, isAbort, onUnauthorized, setApiSession } from '../api/github'
import type { Viewer } from '../api/types'

interface SessionResponse { user: { login: string; name: string | null; avatar_url: string; html_url: string } | null; csrfToken: string | null; oauthConfigured: boolean }
interface AuthState {
  viewer: Viewer | null; csrfToken: string | null; account: string; ready: boolean; loading: boolean; error: string | null; notice: string | null; redirecting: boolean
  bootstrap: () => Promise<void>; login: () => void; logout: () => Promise<void>; expire: () => void
}
let bootstrapVersion = 0
let bootstrapController: AbortController | null = null
try { ['gitube:token', 'gitube:viewer', 'starscout:token', 'starscout:viewer'].forEach((key) => localStorage.removeItem(key)) } catch { /* storage is optional */ }
export const useAuth = create<AuthState>((set, get) => ({
  viewer: null, csrfToken: null, account: 'pending', ready: false, loading: false, error: null, notice: null, redirecting: false,
  async bootstrap() {
    const version = ++bootstrapVersion
    bootstrapController?.abort(); const controller = new AbortController(); bootstrapController = controller
    set({ loading: true, error: null })
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort()},20000)
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin', signal: controller.signal })
      if (!response.ok) throw new Error(`读取会话失败（${response.status}）`)
      const data = await response.json() as SessionResponse
      if (version !== bootstrapVersion || controller.signal.aborted) return
      const viewer = data.user ? { id: data.user.login, login: data.user.login, name: data.user.name, avatarUrl: data.user.avatar_url } : null
      const account = viewer ? `github:${viewer.login.toLowerCase()}` : 'guest'
      setApiSession(data.csrfToken, account)
      set({ viewer, csrfToken: data.csrfToken, account, ready: true, loading: false, error: null })
    } catch (error) {
      if (version !== bootstrapVersion || isAbort(error)&&!timedOut) return
      set({ loading: false, error: timedOut?'会话请求超时，请重试':error instanceof Error ? error.message : '读取会话失败' })
    } finally { clearTimeout(timeout) }
  },
  login() { set({ redirecting: true }); window.location.assign('/api/auth/github') },
  async logout() {
    await apiRequest('/api/logout', { method: 'POST' })
    setApiSession(null, 'guest')
    set({ viewer: null, csrfToken: null, account: 'guest', ready:false, notice: null })
    await get().bootstrap()
  },
  expire() {
    ++bootstrapVersion; bootstrapController?.abort(); setApiSession(null, 'guest')
    set({ viewer: null, csrfToken: null, account: 'guest', ready: false, notice: 'GitHub 会话已失效，请重新登录', error: null, loading: false })
    void get().bootstrap()
  },
}))
onUnauthorized(() => useAuth.getState().expire())
