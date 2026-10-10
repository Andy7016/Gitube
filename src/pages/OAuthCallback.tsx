import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../store/auth'
import { OAUTH_STATE_KEY, oauthRedirectUri } from './LoginPage'

/** 回到应用首页（去掉地址里的 ?code=...），重新加载后就是登录状态 */
function goHome(route = '/') {
  window.location.replace(`${window.location.pathname}#${route}`)
}

/** GitHub OAuth 授权后跳回这里：用 code 换 token，然后登录 */
export function OAuthCallback() {
  const loginWithToken = useAuth((s) => s.loginWithToken)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const expected = sessionStorage.getItem(OAUTH_STATE_KEY)
    sessionStorage.removeItem(OAUTH_STATE_KEY)

    if (params.get('error')) {
      setError(params.get('error_description') ?? '你取消了授权')
      return
    }
    if (!code || !state || state !== expected) {
      setError('授权信息不完整或已过期，请重新登录')
      return
    }

    ;(async () => {
      try {
        const res = await fetch('/api/github/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: oauthRedirectUri() }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.access_token) {
          throw new Error(data.error_description ?? data.error ?? '换取 token 失败')
        }
        await loginWithToken(data.access_token)
        goHome('/')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [loginWithToken])

  return (
    <div className="center-page">
      {error ? (
        <div className="empty">
          <h1>登录没有完成</h1>
          <p>{error}</p>
          <button type="button" className="btn btn--primary" onClick={() => goHome('/login')}>
            回到登录页
          </button>
        </div>
      ) : (
        <p className="muted">正在登录 GitHub…</p>
      )}
    </div>
  )
}
