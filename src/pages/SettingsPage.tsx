import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ChevronRight, History, LogOut, Monitor, Moon, Star, Sun, X } from 'lucide-react'
import { useApiMeta } from '../api/github'
import { Avatar } from '../components/Avatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { InterestPicker } from '../components/InterestPicker'
import { buildProfile, getEngine, topTopics } from '../lib/recommend'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { useAuth } from '../store/auth'
import { useFeed } from '../store/feed'
import { useLibrary } from '../store/library'
import { useSeeds } from '../store/seeds'
import { toast } from '../store/toast'

function Account() {
  const viewer = useAuth((s) => s.viewer)
  const logout = useAuth((s) => s.logout)
  const apiMeta = useApiMeta()
  const scopes = apiMeta.scopes
  const canStar = scopes === null || scopes.includes('public_repo') || scopes.includes('repo')
  if (!viewer) return null

  return (
    <section className="panel" aria-labelledby="account-title">
      <h2 id="account-title" className="visually-hidden">
        账号
      </h2>
      <div className="account">
        <Avatar src={viewer.avatarUrl} name={viewer.login} size={56} />
        <div className="account__text">
          <strong>{viewer.name || viewer.login}</strong>
          <a href={`https://github.com/${viewer.login}`} target="_blank" rel="noreferrer">
            @{viewer.login}
          </a>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            useFeed.getState().resetAll()
            useSeeds.getState().reset()
            logout()
          }}
        >
          <LogOut size={16} aria-hidden="true" /> 退出登录
        </button>
      </div>
      <dl className="facts">
        <div>
          <dt>Token 权限</dt>
          <dd>{scopes === null ? 'Fine-grained token 或尚未请求' : scopes.length ? scopes.join('，') : '无'}</dd>
        </div>
        {apiMeta.rateRemaining !== null && (
          <div>
            <dt>本小时剩余接口额度</dt>
            <dd>
              {apiMeta.rateRemaining} / {apiMeta.rateLimit}
            </dd>
          </div>
        )}
      </dl>
      {!canStar && (
        <p className="warn">这个 Token 没有 public_repo 权限，Star 会失败。重新生成一个勾上 public_repo 的 Token 再登录。</p>
      )}
      <div className="shortcuts show-mobile-flex">
        <Link to="/stars" className="shortcut">
          <Star size={18} aria-hidden="true" /> 我的 Star <ChevronRight size={16} aria-hidden="true" />
        </Link>
        <Link to="/history" className="shortcut">
          <History size={18} aria-hidden="true" /> 历史记录 <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

function Interests() {
  const interests = useLibrary((s) => s.interests)
  const setInterests = useLibrary((s) => s.setInterests)
  return (
    <section className="panel" id="interests" aria-labelledby="interests-title">
      <h2 id="interests-title">兴趣方向</h2>
      <p className="panel__lead">选中的方向会出现在首页频道栏，也会让推荐更偏向这些内容。</p>
      <InterestPicker
        selected={interests}
        onChange={(ids) => {
          setInterests(ids)
          useFeed.getState().clearChannel('foryou')
        }}
      />
    </section>
  )
}

function ProfileView() {
  const seeds = useSeeds((s) => s.seeds)
  const following = useSeeds((s) => s.following)
  const lib = useLibrary()
  useEffect(() => {
    useSeeds.getState().loadSeeds().catch(() => {})
    useSeeds.getState().loadFollowing().catch(() => {})
  }, [])
  const profile = useMemo(() => buildProfile(seeds, lib, following ?? []), [seeds, lib, following])
  const topics = topTopics(profile, 14)
  const langs = [...profile.langW.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = topics[0]?.[1] ?? 1
  const maxL = langs[0]?.[1] ?? 1

  return (
    <section className="panel" aria-labelledby="profile-title">
      <h2 id="profile-title">Gitube 眼中的你</h2>
      <p className="panel__lead">
        根据你最近 Star 的 {seeds?.starred.length ?? '…'} 个项目、选的兴趣、关注者的 Star 采样和在这里的操作算出来的。正常推荐主要从这些方向里找。
      </p>
      {topics.length === 0 ? (
        <p className="muted">还没有足够的数据，先去首页刷一会儿。</p>
      ) : (
        <div className="weights">
          <div>
            <h3>话题</h3>
            <ul className="bars">
              {topics.map(([t, w]) => (
                <li key={t}>
                  <span className="bars__label">#{t}</span>
                  <span className="bars__track">
                    <span className="bars__fill" style={{ width: `${Math.max(6, (w / max) * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>语言</h3>
            <ul className="bars">
              {langs.map(([l, w]) => (
                <li key={l}>
                  <span className="bars__label">{l}</span>
                  <span className="bars__track">
                    <span className="bars__fill bars__fill--lang" style={{ width: `${Math.max(6, (w / maxL) * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

function FollowingWeights() {
  const following = useSeeds((s) => s.following)
  const weights = useLibrary((s) => s.followingWeights)
  const setWeight = useLibrary((s) => s.setFollowingWeight)
  useEffect(() => {
    useSeeds.getState().loadFollowing().catch(() => {})
  }, [])
  const people = useMemo(() => {
    const byLogin = new Map<string, { login: string; avatarUrl: string; count: number }>()
    for (const star of following ?? []) {
      const key = star.login.toLowerCase()
      const person = byLogin.get(key) ?? { login: star.login, avatarUrl: star.avatarUrl, count: 0 }
      person.count++
      byLogin.set(key, person)
    }
    return [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login))
  }, [following])

  return (
    <section className="panel" aria-labelledby="following-weights-title">
      <h2 id="following-weights-title">关注者的推荐影响</h2>
      <p className="panel__lead">调整这些关注者的 Star 对正常推荐画像和社交推荐的影响。默认 1 倍，0 倍表示不参与推荐；修改会用于后续分页或换批。</p>
      <p className="panel__fine">Gitube 当前最多采样 50 位关注者，每人最近 6 个 Star。这里只列出本次实际取得 Star 样本的账号，不保证覆盖全部关注者或他们的全部兴趣。设为 0 不会取消 GitHub 关注，也不会清空原来的「关注」频道。</p>
      {following === null ? (
        <p className="muted" role="status">正在读取关注者的 Star 采样…</p>
      ) : people.length === 0 ? (
        <p className="muted">当前没有可用的关注者 Star 样本。</p>
      ) : (
        <ul className="following-weights">
          {people.map(({ login, avatarUrl, count }) => {
            const weight = weights[login.toLowerCase()] ?? 1
            const inputId = `following-weight-${login.toLowerCase()}`
            return (
              <li className="following-weight" key={login.toLowerCase()}>
                <Avatar src={avatarUrl} name={login} size={32} />
                <label className="following-weight__person" htmlFor={inputId}>
                  <strong>@{login}</strong>
                  <span>{count} 个 Star 样本</span>
                </label>
                <input
                  id={inputId}
                  type="range"
                  min="0"
                  max="3"
                  step="0.25"
                  value={weight}
                  aria-valuetext={`${weight} 倍推荐影响`}
                  onChange={(event) => setWeight(login, Number(event.target.value))}
                />
                <output htmlFor={inputId}>{weight} 倍</output>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Blocked() {
  const blockedTopics = useLibrary((s) => s.blockedTopics)
  const blockedLangs = useLibrary((s) => s.blockedLangs)
  const disliked = useLibrary((s) => s.dislikedRepos.length)
  const { unblockTopic, unblockLang, resetRecommendations } = useLibrary.getState()
  const login = useAuth((s) => s.viewer?.login)

  return (
    <section className="panel" aria-labelledby="blocked-title">
      <h2 id="blocked-title">不想看的内容</h2>
      {blockedTopics.length + blockedLangs.length === 0 ? (
        <p className="muted">还没有屏蔽任何话题或语言。在卡片的「⋮」菜单里可以选「不想看 #某话题」。</p>
      ) : (
        <div className="chips">
          {blockedTopics.map((t) => (
            <button key={t} type="button" className="chip" onClick={() => unblockTopic(t)} aria-label={`取消屏蔽 #${t}`}>
              #{t} <X size={14} aria-hidden="true" />
            </button>
          ))}
          {blockedLangs.map((l) => (
            <button key={l} type="button" className="chip" onClick={() => unblockLang(l)} aria-label={`取消屏蔽 ${l}`}>
              {l} <X size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <p className="panel__lead">另外有 {disliked} 个项目被标记为不感兴趣。</p>
      <ConfirmButton
        className="btn btn--ghost"
        confirmText="确认重置？再点一次"
        onConfirm={() => {
          resetRecommendations()
          if (login) getEngine(login).reset()
          useFeed.getState().resetAll()
          toast('推荐记录已重置，回首页看看新的推荐')
        }}
      >
        重置推荐记录
      </ConfirmButton>
      <p className="panel__fine">会清空不感兴趣、屏蔽、已推荐过的记录和在本应用里的操作偏好；收藏夹、稍后再看和历史记录不受影响。</p>
    </section>
  )
}

function Appearance() {
  const [theme, setT] = useState<Theme>(getTheme())
  const options: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: 'system', label: '跟随系统', icon: Monitor },
    { id: 'light', label: '浅色', icon: Sun },
    { id: 'dark', label: '深色', icon: Moon },
  ]
  return (
    <section className="panel" aria-labelledby="look-title">
      <h2 id="look-title">外观</h2>
      <div className="segmented" role="radiogroup" aria-label="主题">
        {options.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={theme === id}
            className="segmented__item"
            onClick={() => {
              setTheme(id)
              setT(id)
            }}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
    </section>
  )
}

export function SettingsPage() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <div className="page page--narrow settings">
      <h1 className="page-title">偏好设置</h1>
      <Account />
      <Interests />
      <FollowingWeights />
      <ProfileView />
      <Blocked />
      <Appearance />
    </div>
  )
}
