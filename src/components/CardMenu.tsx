import { useEffect, useRef, useState } from 'react'
import { Ban, Bookmark, Clock, Copy, EllipsisVertical, ExternalLink, ThumbsDown } from 'lucide-react'
import type { Repo } from '../api/types'
import { copyClone, dislike, toggleLater } from '../lib/actions'
import { TOPIC_STOPLIST } from '../lib/interests'
import { useIsLater } from '../store/library'
import { useSaveDialog } from '../store/ui'

interface Props {
  repo: Repo
  /** 推荐流里才显示「不感兴趣」 */
  feedback?: boolean
}

export function CardMenu({ repo, feedback = true }: Props) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const later = useIsLater(repo.nameWithOwner)
  const openSave = useSaveDialog((s) => s.open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    wrap.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggleMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!open && btn.current) {
      // 靠近屏幕底部时向上展开
      const r = btn.current.getBoundingClientRect()
      setUp(window.innerHeight - r.bottom < 340)
    }
    setOpen((v) => !v)
  }

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  const topics = repo.topics.filter((t) => !TOPIC_STOPLIST.has(t)).slice(0, 2)

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="icon-btn"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <EllipsisVertical size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className={`menu${up ? ' menu--up' : ''}`} role="menu">
          <button role="menuitem" className="menu__item" onClick={run(() => openSave(repo))}>
            <Bookmark size={16} aria-hidden="true" /> 收藏到…
          </button>
          <button role="menuitem" className="menu__item" onClick={run(() => toggleLater(repo))}>
            <Clock size={16} aria-hidden="true" /> {later ? '移出稍后再看' : '稍后再看'}
          </button>
          <button role="menuitem" className="menu__item" onClick={run(() => copyClone(repo))}>
            <Copy size={16} aria-hidden="true" /> 复制 git clone 命令
          </button>
          <a role="menuitem" className="menu__item" href={repo.url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <ExternalLink size={16} aria-hidden="true" /> 在 GitHub 打开
          </a>
          {feedback && (
            <>
              <div className="menu__sep" role="separator" />
              <button role="menuitem" className="menu__item" onClick={run(() => dislike(repo, { type: 'repo' }))}>
                <ThumbsDown size={16} aria-hidden="true" /> 不感兴趣
              </button>
              {topics.map((t) => (
                <button
                  key={t}
                  role="menuitem"
                  className="menu__item"
                  onClick={run(() => dislike(repo, { type: 'topic', topic: t }))}
                >
                  <Ban size={16} aria-hidden="true" /> 不想看 #{t}
                </button>
              ))}
              {repo.language && (
                <button
                  role="menuitem"
                  className="menu__item"
                  onClick={run(() => dislike(repo, { type: 'lang', lang: repo.language! }))}
                >
                  <Ban size={16} aria-hidden="true" /> 不想看 {repo.language} 项目
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
