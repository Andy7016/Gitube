import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { ExternalLink, KeyRound } from 'lucide-react'
import type { Repo } from '../api/types'
import { GeneratedCover } from '../components/Cover'
import { DeviceLogin } from '../components/DeviceLogin'
import { Logo } from '../components/Layout'
import { DEVICE_CLIENT_ID } from '../lib/deviceLogin'
import { useAuth } from '../store/auth'

/** 桌面版里运行时为 true */
export const IS_DESKTOP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** 桌面版可以「使用 GitHub 账号登录」（设备码登录，见 lib/deviceLogin.ts） */
export const DEVICE_LOGIN = IS_DESKTOP && !!DEVICE_CLIENT_ID

const TOKEN_URL =
  'https://github.com/settings/tokens/new?description=Gitube&scopes=public_repo,read:user,user:follow'

/** 登录页背景里滚动的封面墙（只是装饰） */
const WALL: [string, string | null][] = [
  ['pytorch/pytorch', '#3572A5'],
  ['tauri-apps/tauri', '#dea584'],
  ['vuejs/core', '#3178c6'],
  ['ollama/ollama', '#00ADD8'],
  ['biopython/biopython', '#3572A5'],
  ['godotengine/godot', '#f34b7d'],
  ['neovim/neovim', '#199f4b'],
  ['google-deepmind/alphafold', '#3572A5'],
  ['excalidraw/excalidraw', '#3178c6'],
  ['astral-sh/uv', '#dea584'],
  ['rdkit/rdkit', '#f34b7d'],
  ['jupyterlab/jupyterlab', '#DA5B0B'],
  ['flutter/flutter', '#00B4AB'],
  ['scverse/scanpy', '#3572A5'],
  ['ziglang/zig', '#ec915c'],
  ['tidyverse/ggplot2', '#198CE7'],
  ['microsoft/vscode', '#3178c6'],
  ['huggingface/transformers', '#3572A5'],
  ['openmm/openmm', '#f34b7d'],
  ['sveltejs/svelte', '#f1e05a'],
  ['nushell/nushell', '#dea584'],
  ['home-assistant/core', '#3572A5'],
  ['kubernetes/kubernetes', '#00ADD8'],
  ['torvalds/linux', '#555555'],
]

function wallRepo([nameWithOwner, color]: [string, string | null], i: number): Repo {
  const [owner, name] = nameWithOwner.split('/')
  return {
    id: nameWithOwner,
    nameWithOwner,
    name,
    owner,
    ownerId: owner,
    ownerType: 'Organization',
    ownerAvatar: '',
    description: null,
    url: '',
    homepageUrl: null,
    stars: 0,
    forks: 0,
    language: null,
    languageColor: color,
    topics: [],
    // 让格子的亮度有变化
    pushedAt: new Date(Date.now() - ((i * 7) % 60) * 86_400_000).toISOString(),
    createdAt: '',
    viewerHasStarred: false,
    coverImage: null,
    isArchived: false,
    license: null,
    defaultBranch: null,
  }
}

function CoverWall() {
  const columns = useMemo(() => {
    const repos = WALL.map(wallRepo)
    return [0, 1, 2].map((c) => repos.filter((_, i) => i % 3 === c))
  }, [])
  return (
    <div className="wall" aria-hidden="true">
      {columns.map((col, c) => (
        <div key={c} className={`wall__col wall__col--${c}`}>
          {[...col, ...col].map((r, i) => (
            <div key={i} className="wall__tile">
              <GeneratedCover repo={r} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function LoginPage() {
  const token = useAuth((s) => s.token)
  const notice = useAuth((s) => s.notice)
  const loginWithToken = useAuth((s) => s.loginWithToken)
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (token) return <Navigate to="/" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      await loginWithToken(value)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Token 登录的表单和步骤：桌面版收进折叠框里当备用，网页版直接显示
  const tokenLogin = (
    <>
      <form className="token-form" onSubmit={submit}>
        <label htmlFor="token" className="token-form__label">
          <KeyRound size={16} aria-hidden="true" /> GitHub Personal Access Token
        </label>
        <div className="token-form__row">
          <input
            id="token"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_xxxxxxxxxxxxxxxx"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'token-error' : 'token-help'}
          />
          <button type="submit" className={`btn ${DEVICE_LOGIN ? '' : 'btn--primary'}`} disabled={busy || !value.trim()}>
            {busy ? '验证中…' : '登录'}
          </button>
        </div>
        {error && (
          <p id="token-error" className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      <ol id="token-help" className="steps">
        <li>
          打开{' '}
          <a href={TOKEN_URL} target="_blank" rel="noreferrer">
            GitHub 生成 Token 的页面 <ExternalLink size={13} aria-hidden="true" />
          </a>
          ，需要的权限已经帮你勾好了
        </li>
        <li>Expiration 选一个有效期，拉到页面底部点 Generate token</li>
        <li>复制以 ghp_ 开头的 Token，粘贴到上面</li>
      </ol>
    </>
  )

  return (
    <div className="login">
      <CoverWall />
      <section className="login__panel">
        <Logo />
        <h1 className="login__title">像刷视频一样刷 GitHub</h1>
        <p className="login__lead">
          Gitube 根据你 Star 过的项目和你选的兴趣，一屏一屏地给你推开源项目。看到喜欢的，一键 Star，或者先收藏起来。
        </p>

        {notice && (
          <p className="login__notice" role="alert">
            {notice}
          </p>
        )}

        {DEVICE_LOGIN && <DeviceLogin />}

        {DEVICE_LOGIN ? (
          <details className="token-details">
            <summary>或者用 Personal Access Token 登录</summary>
            <div className="token-details__body">{tokenLogin}</div>
          </details>
        ) : (
          tokenLogin
        )}

        <p className="login__fine">
          {DEVICE_LOGIN
            ? '登录信息只保存在你这台设备上，只用来直接请求 GitHub，可以随时在 GitHub 的 Settings → Applications 里撤销授权。用到的权限：public_repo（Star / 取消 Star）、read:user（读取你的资料）、user:follow（一键三连时关注作者）。'
            : 'Token 只保存在你这台设备上，只用来直接请求 GitHub。用到的权限：public_repo（Star / 取消 Star）、read:user（读取你的资料）、user:follow（一键三连时关注作者，可不勾）。'}
        </p>
      </section>
    </div>
  )
}
