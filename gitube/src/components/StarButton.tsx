import { useRef, useState } from 'react'
import { Star } from 'lucide-react'
import type { Repo } from '../api/types'
import { formatCount } from '../lib/format'
import { tripleAction } from '../lib/actions'
import { useStars, useStarState } from '../store/stars'

interface Props {
  repo: Repo
  variant?: 'icon' | 'pill'
  /** 长按触发一键三连（详情页使用） */
  triple?: boolean
}

const HOLD_MS = 800

export function StarButton({ repo, variant = 'icon', triple = false }: Props) {
  const { starred, stars, pending } = useStarState(repo)
  const toggle = useStars((s) => s.toggle)
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)

  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }

  const holdHandlers = triple
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          fired.current = false
          setHolding(true)
          timer.current = setTimeout(() => {
            fired.current = true
            setHolding(false)
            navigator.vibrate?.(30)
            tripleAction(repo)
          }, HOLD_MS)
        },
        onPointerUp: cancelHold,
        onPointerLeave: cancelHold,
        onPointerCancel: cancelHold,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {}

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (fired.current) {
      fired.current = false
      return
    }
    toggle(repo)
  }

  const label = starred ? `取消 Star ${repo.nameWithOwner}` : `Star ${repo.nameWithOwner}`

  if (variant === 'pill') {
    return (
      <button
        type="button"
        className={`star-pill${starred ? ' is-on' : ''}${holding ? ' is-holding' : ''}`}
        aria-pressed={starred}
        aria-label={label}
        title={triple ? `${starred ? '取消 Star' : 'Star'}（快捷键 S，长按一键三连）` : undefined}
        disabled={pending}
        onClick={onClick}
        {...holdHandlers}
      >
        <span className="star-pill__icon">
          <Star size={18} fill={starred ? 'currentColor' : 'none'} strokeWidth={2.2} aria-hidden="true" />
          {triple && <span className="star-pill__ring" aria-hidden="true" />}
        </span>
        <span>{starred ? '已 Star' : 'Star'}</span>
        <span className="star-pill__count">{formatCount(stars)}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`icon-btn star-icon${starred ? ' is-on' : ''}`}
      aria-pressed={starred}
      aria-label={label}
      title={starred ? '取消 Star' : 'Star'}
      disabled={pending}
      onClick={onClick}
    >
      <Star size={18} fill={starred ? 'currentColor' : 'none'} strokeWidth={2.2} aria-hidden="true" />
    </button>
  )
}
