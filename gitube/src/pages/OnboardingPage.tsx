import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { InterestPicker } from '../components/InterestPicker'
import { Logo } from '../components/Layout'
import { suggestInterests, TOPIC_STOPLIST } from '../lib/interests'
import { useAuth } from '../store/auth'
import { useLibrary } from '../store/library'
import { useSeeds } from '../store/seeds'

/** 第一次登录：选兴趣（会根据 Star 记录预先勾上几个） */
export function OnboardingPage() {
  const viewer = useAuth((s) => s.viewer)
  const seeds = useSeeds((s) => s.seeds)
  const complete = useLibrary((s) => s.completeOnboarding)
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string[]>([])
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    useSeeds.getState().loadSeeds().catch(() => {})
  }, [])

  const suggested = useMemo(() => {
    if (!seeds) return []
    const counts = new Map<string, number>()
    if(seeds.profile){for(const item of seeds.profile.topics)counts.set(item.name,item.weight);for(const item of seeds.profile.languages)counts.set(item.name.toLowerCase().replace('c++','cpp'),item.weight);return suggestInterests(counts)}
    for (const r of seeds.starred) {
      for (const t of r.topics) if (!TOPIC_STOPLIST.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
      if (r.language) {
        const l = r.language.toLowerCase().replace('c++', 'cpp')
        counts.set(l, (counts.get(l) ?? 0) + 0.5)
      }
    }
    return suggestInterests(counts)
  }, [seeds])

  // 预选：用户还没动过时，自动勾上猜测的兴趣
  useEffect(() => {
    if (!touched && suggested.length) setSelected(suggested)
  }, [suggested, touched])

  const finish = (ids: string[]) => {
    complete(ids)
    navigate('/', { replace: true })
  }

  return (
    <div className="onboarding">
      <Logo />
      <h1 className="onboarding__title">{viewer?.name || viewer?.login || '你'}，平时关注哪些方向？</h1>
      <p className="onboarding__lead">
        选几个方向，首页就会按这些给你推项目。之后你 Star、收藏、点「不感兴趣」，推荐会跟着变。随时可以在偏好设置里改。
      </p>
      {suggested.length > 0 && (
        <p className="onboarding__hint">根据你 Star 过的项目，先帮你勾了几个。</p>
      )}
      <InterestPicker
        selected={selected}
        suggested={suggested}
        onChange={(ids) => {
          setTouched(true)
          setSelected(ids)
        }}
      />
      <div className="onboarding__actions">
        <button type="button" className="btn btn--ghost" onClick={() => finish([])}>
          跳过
        </button>
        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={selected.length === 0}
          onClick={() => finish(selected)}
        >
          选好了，开始刷{selected.length > 0 && `（${selected.length}）`}
        </button>
      </div>
    </div>
  )
}
