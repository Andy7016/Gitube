import { useId } from 'react'
import { hasTasteInterests, RECOMMENDATION_MODES } from '../lib/recommendationMode'
import { useLibrary } from '../store/library'

/** 首页与设置页共用同一个账号偏好。 */
export function RecommendationModePicker() {
  const mode = useLibrary((s) => s.recommendationMode)
  const interests = useLibrary((s) => s.interests)
  const blockedTopics = useLibrary((s) => s.blockedTopics)
  const setMode = useLibrary((s) => s.setRecommendationMode)
  const hintId = useId()
  const canTaste = hasTasteInterests(interests, blockedTopics)
  const selected = RECOMMENDATION_MODES.find((option) => option.id === mode)!

  return (
    <div className="recommendation-mode">
      <div className="segmented recommendation-mode__options" role="radiogroup" aria-label="推荐模式" aria-describedby={hintId}>
        {RECOMMENDATION_MODES.map(({ id, label, description }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            className="segmented__item"
            disabled={id === 'taste' && !canTaste}
            title={id === 'taste' && !canTaste ? '先选择至少一个未屏蔽的兴趣方向' : description}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p id={hintId} className="panel__fine">
        {selected.description}。{!canTaste && '选择至少一个未屏蔽的兴趣方向后可用「换换口味」。'}
        {mode !== 'normal' && 'Star、收藏、稍后再看、不感兴趣和有效阅读仍会记录，供正常推荐学习。'}
      </p>
    </div>
  )
}
