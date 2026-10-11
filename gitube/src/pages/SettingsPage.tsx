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
import { ProfileStatus } from '../components/ProfileStatus'
import { toast,toastError } from '../store/toast'

function Account() {
 const {viewer,logout,login}=useAuth()
 const apiMeta=useApiMeta()
 return <section className="panel" aria-label="账号"><div className="account">{viewer?<><Avatar src={viewer.avatarUrl} name={viewer.login} size={56}/><div className="account__text"><strong>{viewer.name||viewer.login}</strong><a href={`https://github.com/${viewer.login}`} target="_blank" rel="noreferrer">@{viewer.login}</a></div><button className="btn btn--ghost" onClick={()=>void logout().catch(toastError)}><LogOut size={16}/>退出登录</button></>:<><div className="account__text"><strong>访客</strong><p>公开项目可以直接浏览；连接 GitHub 后读取账号画像与同步 Star。</p></div><button className="btn btn--primary" onClick={login}>登录 GitHub</button></>}</div>{apiMeta.rateRemaining!==null&&<dl className="facts"><div><dt>最近响应的 GitHub 剩余额度</dt><dd>{apiMeta.rateRemaining}{apiMeta.rateLimit!==null&&` / ${apiMeta.rateLimit}`}{apiMeta.rateReset&&` · ${new Date(apiMeta.rateReset).toLocaleTimeString('zh-CN')} 重置`}</dd></div></dl>}<div className="shortcuts show-mobile-flex"><Link to="/stars" className="shortcut"><Star size={18}/>我的 Star<ChevronRight size={16}/></Link><Link to="/history" className="shortcut"><History size={18}/>历史记录<ChevronRight size={16}/></Link></div></section>
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
  const lib = useLibrary()
  useEffect(() => {
    useSeeds.getState().loadSeeds().catch(() => {})
  }, [])
  const profile = useMemo(() => buildProfile(seeds, lib), [seeds, lib])
  const topics = topTopics(profile, 14)
  const langs = [...profile.langW.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = topics[0]?.[1] ?? 1
  const maxL = langs[0]?.[1] ?? 1

  return (
    <section className="panel" aria-labelledby="profile-title">
      <h2 id="profile-title">兴趣画像</h2>
      <p className="panel__lead">
        使用公开 Star 与本人公开仓库的服务端画像，并结合你手动选择的兴趣和本地操作；手选偏好不会被覆盖。
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
      <ProfileView />
      <Blocked />
      <Appearance />
    </div>
  )
}
