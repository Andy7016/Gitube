import { Compass, Shuffle, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router'
import { INTEREST_BY_ID } from '../lib/interests'
import { useLibrary, type RecommendationMode } from '../store/library'

const modes: { id: RecommendationMode; label: string; icon: typeof Compass }[] = [
  { id: 'normal', label: '正常推荐', icon: SlidersHorizontal },
  { id: 'taste', label: '换换口味', icon: Compass },
  { id: 'random', label: '完全随机', icon: Shuffle },
]

export function RecommendationModePicker() {
  const mode = useLibrary(s => s.recommendationMode)
  const interests = useLibrary(s => s.interests)
  const blocked = useLibrary(s => s.blockedTopics)
  const hasInterests = interests.some(id => INTEREST_BY_ID.get(id)?.topics.some(t => !blocked.includes(t)))
  const pick = (next: RecommendationMode) => {
    if (next === mode) return
    useLibrary.getState().setRecommendationMode(next)
  }

  return <div className="recommend-mode">
    <div className="segmented recommend-mode__buttons" role="group" aria-label="推荐模式">
      {modes.map(({ id, label, icon: Icon }) => <button key={id} type="button"
        className="segmented__item" aria-pressed={mode === id}
        disabled={id === 'taste' && !hasInterests} onClick={() => pick(id)}>
        <Icon size={15} aria-hidden="true" />{label}
      </button>)}
    </div>
    <p className="recommend-mode__hint" role="status">
      {mode === 'taste' ? '已关注方向与其他方向默认约各半；候选不足时互相补足。浏览偏好继续累计。'
        : mode === 'random' ? '从公开检索候选中随机抽取，不按兴趣排序。浏览偏好继续累计。'
          : '根据兴趣、账号画像、关注者权重与浏览反馈推荐。'}
      {!hasInterests && <><span> 换换口味需要先选择兴趣方向。</span><Link to="/settings#interests">选择兴趣</Link></>}
    </p>
  </div>
}
