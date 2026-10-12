import { Check } from 'lucide-react'
import { INTERESTS } from '../lib/interests'

interface Props {
  selected: string[]
  onChange: (ids: string[]) => void
  /** 根据 Star 记录猜的兴趣，会加个小标记 */
  suggested?: string[]
}

export function InterestPicker({ selected, onChange, suggested = [] }: Props) {
  const set = new Set(selected)
  const sug = new Set(suggested)
  return (
    <div className="interests" role="group" aria-label="兴趣方向">
      {INTERESTS.map((it) => {
        const on = set.has(it.id)
        return (
          <button
            key={it.id}
            type="button"
            className={`interest${on ? ' is-on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((x) => x !== it.id) : [...selected, it.id])}
          >
            {on && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}
            <span>{it.label}</span>
            {sug.has(it.id) && <span className="interest__hint">常 Star</span>}
          </button>
        )
      })}
    </div>
  )
}
