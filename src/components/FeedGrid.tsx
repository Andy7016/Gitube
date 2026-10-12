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
  /** 恢复已有列表时，明确滚动意图之前不能自动翻页。 */
  pauseOnRestore?: boolean
}

export function isFeedScrollIntent(event: Event): boolean {
  if (event.type === 'wheel' || event.type === 'touchmove') return true
  if (event.type !== 'keydown') return false
  const key = event as KeyboardEvent
  const target = key.target as HTMLElement | null
  if (key.defaultPrevented || key.altKey || key.ctrlKey || key.metaKey) return false
  if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return false
  // 空格在按钮上用于激活控件，而不是滚动。
  if (key.key === ' ' && target?.closest?.('button, a, [role="button"], [role="radio"]')) return false
  return ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key.key)
}

/** 与网格生命周期一致，便于验证重挂 observer 和程序滚动不会开启分页。 */
export function createFeedPagingGate(paused: boolean) {
  let allowed = !paused
  return {
    canPage: () => allowed,
    accept(event: Event) {
      if (!isFeedScrollIntent(event)) return false
      allowed = true
      return true
    },
  }
}

export function observeFeedPaging(target: Element, paging: ReturnType<typeof createFeedPagingGate>, loadMore: () => void) {
  let atBoundary = false
  let active = true
  const onIntent = (event: Event) => {
    if (!active) return
    if (paging.accept(event) && atBoundary) loadMore()
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (!active) return
      atBoundary = entries.some((entry) => entry.isIntersecting)
      if (atBoundary && paging.canPage()) loadMore()
    },
    { rootMargin: '800px 0px' },
  )
  io.observe(target)
  if (!paging.canPage()) {
    window.addEventListener('wheel', onIntent, { passive: true })
    window.addEventListener('touchmove', onIntent, { passive: true })
    window.addEventListener('keydown', onIntent)
  }
  return () => {
    active = false
    io.disconnect()
    window.removeEventListener('wheel', onIntent)
    window.removeEventListener('touchmove', onIntent)
    window.removeEventListener('keydown', onIntent)
  }
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
  const paging = useRef(createFeedPagingGate(pauseOnRestore))

  // 第一页直接加载，不依赖滚动
  useEffect(() => {
    if (items.length === 0 && status === 'idle' && paging.current.canPage()) loadMore()
  }, [items.length, status, loadMore])

  // 每次加载完重新建 observer：如果底部哨兵还在可视范围内（内容不够一屏），会立刻再加载一页
  useEffect(() => {
    if (status !== 'idle' || !sentinel.current) return
    return observeFeedPaging(sentinel.current, paging.current, loadMore)
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
