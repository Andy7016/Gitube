import { useEffect, useRef, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import type { FeedItem } from '../api/types'
import { RepoCard } from './RepoCard'

interface Props {
  items: FeedItem[]
  status: 'idle' | 'loading' | 'error' | 'end'
  error?: string | null
  loadMore: () => void
  /** 列表为空且已到底时显示 */
  empty?: ReactNode
  /** 已到底时显示的内容 */
  endNote?: ReactNode
  feedback?: boolean
  /** Returning to an existing batch must not page just because its sentinel remounts. */
  pauseOnRestore?: boolean
}

export function isFeedScrollIntent(event: Event): boolean {
  if (event.type === 'wheel' || event.type === 'touchmove') return true
  const key = event as KeyboardEvent
  const target = key.target as HTMLElement | null
  return event.type === 'keydown' && !key.defaultPrevented && !key.altKey && !key.ctrlKey && !key.metaKey && !target?.closest?.('input, textarea, select, [contenteditable="true"]') && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key.key)
}

export function SkeletonCard() {
  return (
    <div className="card card--skeleton" aria-hidden="true">
      <div className="sk sk-cover" />
      <div className="card__body">
        <div className="sk sk-avatar" />
        <div className="card__text">
          <div className="sk sk-line" style={{ width: '70%' }} />
          <div className="sk sk-line" style={{ width: '92%' }} />
          <div className="sk sk-line" style={{ width: '40%' }} />
        </div>
      </div>
    </div>
  )
}

/** 卡片网格 + 无限滚动 */
export function FeedGrid({ items, status, error, loadMore, empty, endNote, feedback = true, pauseOnRestore = false }: Props) {
  const sentinel = useRef<HTMLDivElement>(null)
  const allowPaging = useRef(!pauseOnRestore)

  // 第一页直接加载，不依赖滚动
  useEffect(() => {
    if (items.length === 0 && status === 'idle' && allowPaging.current) loadMore()
  }, [items.length, status, loadMore])

  // 每次加载完重新建 observer：如果底部哨兵还在可视范围内（内容不够一屏），会立刻再加载一页
  useEffect(() => {
    if (status !== 'idle' || !sentinel.current) return
    let atBoundary = false
    const onIntent = (event: Event) => {
      if (!isFeedScrollIntent(event)) return
      allowPaging.current = true
      if (atBoundary) loadMore()
    }
    const io = new IntersectionObserver(
      (entries) => {
        atBoundary = entries.some((e) => e.isIntersecting)
        if (atBoundary && allowPaging.current) loadMore()
      },
      { rootMargin: '800px 0px' },
    )
    io.observe(sentinel.current)
    if (!allowPaging.current) {
      window.addEventListener('wheel', onIntent, {passive:true})
      window.addEventListener('touchmove', onIntent, {passive:true})
      window.addEventListener('keydown', onIntent)
    }
    return () => {
      io.disconnect()
      window.removeEventListener('wheel', onIntent)
      window.removeEventListener('touchmove', onIntent)
      window.removeEventListener('keydown', onIntent)
    }
  }, [status, items.length, loadMore])

  const initialLoading = items.length === 0 && status !== 'error' && status !== 'end'

  return (
    <>
      <div className="grid">
        {items.map((item) => (
          <RepoCard key={item.key} item={item} feedback={feedback} />
        ))}
        {(initialLoading || status === 'loading') &&
          Array.from({ length: initialLoading ? 8 : 4 }, (_, i) => <SkeletonCard key={`sk${i}`} />)}
      </div>

      {status === 'error' && (
        <div className="feed-note feed-note--error" role="alert">
          <p>{error ?? '加载失败'}</p>
          <button type="button" className="btn" onClick={loadMore}>
            <RefreshCw size={16} aria-hidden="true" /> 重试
          </button>
        </div>
      )}
      {status === 'end' && items.length === 0 && empty}
      {status === 'end' && items.length > 0 && endNote}
      <div ref={sentinel} className="sentinel" aria-hidden="true" />
    </>
  )
}
