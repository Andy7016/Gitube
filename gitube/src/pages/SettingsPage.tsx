import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ChevronRight, History, LogOut, Monitor, Moon, Star, Sun, X } from 'lucide-react'
import { useApiMeta } from '../api/github'
import { Avatar } from '../components/Avatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { InterestPicker } from '../components/InterestPicker'
import { RecommendationModePicker } from '../components/RecommendationModePicker'
import { buildProfile, getEngine, topTopics } from '../lib/recommend'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { useAuth } from '../store/auth'
import { useFeed } from '../store/feed'
import { useLibrary } from '../store/library'
import { useSeeds } from '../store/seeds'
import { ProfileStatus } from '../components/ProfileStatus'
import { toast,toastError } from '../store/toast'

function Account() {
 const {viewer,logout,login}=useAuth()
 const apiMeta=useApiMeta()
 const localConnection=['127.0.0.1','localhost','[::1]'].includes(window.location.hostname)
 return <section className="panel" aria-label="账号">
  <div className="account">{viewer?<><Avatar src={viewer.avatarUrl} name={viewer.login} size={56}/><div className="account__text"><strong>{viewer.name||viewer.login}</strong><a href={`https://github.com/${viewer.login}`} target="_blank" rel="noreferrer">@{viewer.login}</a></div><button className="btn btn--ghost" onClick={()=>void logout().catch(toastError)}><LogOut size={16}/>退出登录</button></>:<><div className="account__text"><strong>访客</strong><p>公开项目可以直接浏览；连接 GitHub 后读取账号画像与同步 Star。</p></div><button className="btn btn--primary" onClick={login}>登录 GitHub</button></>}</div>
  {viewer&&localConnection&&<p className="panel__fine"><a href="/api/setup/oauth">站内 Star 连接设置</a></p>}
  {apiMeta.rateRemaining!==null&&<dl className="facts"><div><dt>最近响应的 GitHub 剩余额度</dt><dd>{apiMeta.rateRemaining}{apiMeta.rateLimit!==null&&` / ${apiMeta.rateLimit}`}{apiMeta.rateReset&&` · ${new Date(apiMeta.rateReset).toLocaleTimeString('zh-CN')} 重置`}</dd></div></dl>}
  <div className="shortcuts show-mobile-flex"><Link to="/stars" className="shortcut"><Star size={18}/>我的 Star<ChevronRight size={16}/></Link><Link to="/history" className="shortcut"><History size={18}/>历史记录<ChevronRight size={16}/></Link></div>
 </section>
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
        }}
      />
    </section>
  )
}

function ProfileView() {
  const seeds = useSeeds((s) => s.seeds)
  const following = useSeeds(s => s.following)
  const lib = useLibrary()
  useEffect(() => {
    useSeeds.getState().loadSeeds().catch(() => {})
  }, [])
  const profile = useMemo(() => buildProfile(seeds, lib, following ?? []), [seeds, lib, following])
  const topics = topTopics(profile, 14)
  const langs = [...profile.langW.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = topics[0]?.[1] ?? 1
  const maxL = langs[0]?.[1] ?? 1

  return (
    <section className="panel" aria-labelledby="profile-title">
      <h2 id="profile-title">兴趣画像</h2>
      <p className="panel__lead">
        结合公开 Star、本人仓库、关注者权重、手选兴趣与本地浏览反馈。探索模式下的行为也会累计，回到正常推荐时使用。
      </p>
      <ProfileStatus />
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

function RecommendationSettings() {
  return <section className="panel" aria-labelledby="recommendation-title">
    <h2 id="recommendation-title">推荐模式</h2>
    <RecommendationModePicker />
    <p className="panel__fine">前台阅读超过 3 分钟，或超过 1 分钟并打开原仓库，会小幅增加相关标签权重。同一项目每天最多记录一次，保存在当前账号的本地浏览器中。</p>
  </section>
}

function FollowingWeights() {
  const viewer = useAuth(s => s.viewer)
  const account = useAuth(s => s.account)
  const following = useSeeds(s => s.following)
  const error = useSeeds(s => s.followingError)
  const weights = useLibrary(s => s.followingWeights)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!viewer) return
    let live = true
    setLoading(true)
    void useSeeds.getState().loadFollowing().catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [account, viewer])
  const people = useMemo(() => {
    const grouped = new Map<string, { login: string; avatar: string; count: number }>()
    for (const entry of following ?? []) {
      const id = entry.login.toLowerCase()
      const person = grouped.get(id) ?? { login: entry.login, avatar: entry.avatarUrl, count: 0 }
      person.count++
      grouped.set(id, person)
    }
    return [...grouped.values()].sort((a, b) => a.login.localeCompare(b.login))
  }, [following])
  const refresh = () => {
    setLoading(true)
    useSeeds.setState({ following: null, followingError: null })
    void useSeeds.getState().loadFollowing().catch(() => {}).finally(() => {
      if (useAuth.getState().account === account) setLoading(false)
    })
  }
  return <section className="panel" id="following-weights" aria-labelledby="following-weights-title">
    <div className="following-weights__heading">
      <h2 id="following-weights-title">关注者推荐权重</h2>
      {viewer && <button className="text-btn" type="button" disabled={loading} onClick={refresh}>刷新关注动态</button>}
    </div>
    <p className="panel__lead">调整每位关注者的兴趣对正常推荐的影响，也会调整其 Star 项目的推荐优先级。0× 表示不参考，1× 为默认；关注动态频道保留原始动态。</p>
    {!viewer ? <p className="muted">登录 GitHub 后，可以分别调整你关注的开发者。</p>
      : loading ? <p className="muted" role="status">正在读取关注动态…</p>
        : error ? <p className="warn" role="alert">关注动态暂时不可用：{error}</p>
          : people.length === 0 ? <p className="muted">当前采样中没有可用的公开 Star 动态。</p> : null}
    {people.length > 0 && <div className="following-weights__list">
      {people.map(person => {
        const id = person.login.toLowerCase()
        const weight = weights[id] ?? 1
        return <div className="following-weight" key={id}>
          <Avatar src={person.avatar} name={person.login} size={32} />
          <div className="following-weight__person"><a href={`https://github.com/${person.login}`} target="_blank" rel="noreferrer">@{person.login}</a><span>已采样 {person.count} 个公开 Star</span></div>
          <div className="following-weight__control">
            <input id={`following-weight-${id}`} type="range" min="0" max="3" step="0.25" value={weight}
              aria-label={`@${person.login} 的推荐权重`} aria-valuetext={weight === 0 ? '不参考' : `${weight} 倍`}
              onChange={event => useLibrary.getState().setFollowingWeight(id, Number(event.target.value))} />
            <output htmlFor={`following-weight-${id}`}>{weight}×</output>
          </div>
        </div>
      })}
      <button className="text-btn" type="button" onClick={() => {
        for (const person of people) useLibrary.getState().setFollowingWeight(person.login, 1)
      }}>将这些关注者恢复为默认权重</button>
    </div>}
    {viewer && <p className="panel__fine">沿用公开动态的采样范围：前 12 位关注用户，每人最近 6 个公开 Star。这里只列出本次读取到有效动态的账号；采样不能代表其全部兴趣。</p>}
  </section>
}

function Blocked() {
  const blockedTopics = useLibrary((s) => s.blockedTopics)
  const blockedLangs = useLibrary((s) => s.blockedLangs)
  const disliked = useLibrary((s) => s.dislikedRepos.length)
  const { unblockTopic, unblockLang, resetRecommendations } = useLibrary.getState()
  const account = useAuth((s) => s.account)

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
          for (const mode of ['normal', 'taste', 'random'] as const) getEngine(account, mode).reset()
          useFeed.getState().resetAll()
          toast('推荐记录已重置，回首页看看新的推荐')
        }}
      >
        重置推荐记录
      </ConfirmButton>
      <p className="panel__fine">会清空不感兴趣、屏蔽、已推荐过的记录与本地操作偏好，恢复默认关注者权重及正常推荐模式；收藏夹、稍后再看和历史记录不受影响。</p>
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
      <RecommendationSettings />
      <FollowingWeights />
      <ProfileView />
      <Blocked />
      <Appearance />
    </div>
  )
}
