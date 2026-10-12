import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, Copy, ExternalLink, Github } from 'lucide-react'
import { requestDeviceCode, waitForToken, type DeviceCode } from '../lib/deviceLogin'
import { useAuth } from '../store/auth'

type Phase =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'waiting'; code: DeviceCode }
  | { kind: 'finishing' }
  | { kind: 'error'; message: string }

/** 复制到剪贴板；不支持时退回老办法，再不行就算了（用户可以自己输入验证码） */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

/** 桌面版登录页上的「使用 GitHub 账号登录」（设备码登录） */
export function DeviceLogin() {
  const loginWithToken = useAuth((s) => s.loginWithToken)
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // 离开登录页时停止查询
  useEffect(() => () => abortRef.current?.abort(), [])

  const start = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setCopied(false)
    setPhase({ kind: 'requesting' })
    try {
      const code = await requestDeviceCode()
      if (ctrl.signal.aborted) return
      setPhase({ kind: 'waiting', code })
      const token = await waitForToken(code, ctrl.signal)
      setPhase({ kind: 'finishing' })
      await loginWithToken(token)
      navigate('/', { replace: true })
    } catch (err) {
      if (ctrl.signal.aborted) return
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase({ kind: 'idle' })
  }

  const copy = async (text: string) => {
    if (await copyText(text)) setCopied(true)
  }

  if (phase.kind === 'waiting' || phase.kind === 'finishing') {
    const code = phase.kind === 'waiting' ? phase.code : null
    return (
      <div className="device-login">
        {code && (
          <>
            <p className="device-login__hint">
              在浏览器里打开 GitHub，输入下面的验证码，然后点 <b>Authorize</b>：
            </p>
            <div className="device-login__code-row">
              <code className="device-login__code" aria-label={`验证码 ${code.userCode}`}>
                {code.userCode}
              </code>
              <button type="button" className="btn btn--ghost" onClick={() => copy(code.userCode)}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <a
              className="btn btn--primary btn--block btn--lg"
              href={code.verificationUri}
              target="_blank"
              rel="noreferrer"
              onClick={() => copy(code.userCode)}
            >
              <ExternalLink size={18} aria-hidden="true" /> 复制验证码并打开 GitHub
            </a>
          </>
        )}
        <p className="device-login__status" role="status">
          <span className="device-login__dot" aria-hidden="true" />
          {phase.kind === 'finishing' ? '授权成功，正在登录…' : '等你在浏览器里授权，授权后这里会自动登录'}
        </p>
        {code && (
          <button type="button" className="text-btn device-login__cancel" onClick={cancel}>
            取消
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="device-login">
      <button
        type="button"
        className="btn btn--primary btn--block btn--lg"
        onClick={start}
        disabled={phase.kind === 'requesting'}
      >
        <Github size={20} aria-hidden="true" />
        {phase.kind === 'requesting' ? '正在连接 GitHub…' : '使用 GitHub 账号登录'}
      </button>
      {phase.kind === 'error' && (
        <p className="form-error" role="alert">
          {phase.message}
        </p>
      )}
    </div>
  )
}
