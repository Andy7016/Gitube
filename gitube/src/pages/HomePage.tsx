import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { RefreshCw, Settings2 } from 'lucide-react'
import { ProfileStatus } from '../components/ProfileStatus'
import { FeedGrid } from '../components/FeedGrid'
import { channelsFor } from '../lib/channels'
import { useFeed } from '../store/feed'
import { useLibrary } from '../store/library'

function ChannelBar({ active, onPick }: { active: string; onPick: (id: string) => void }) {
  const interests = useLibrary((s) => s.interests)
  const channels = channelsFor(interests)
  const bar = useRef<HTMLDivElement>(null)

  // 当前频道滚动到可见区域
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div className="channels-wrap">
      <div className="channels" role="tablist" aria-label="频道" ref={bar}>
        {channels.map((c) => (
          <button
            key={c.id}
            role="tab"
            type="button"
            aria-selected={c.id === active}
            className="channel"
            onClick={() => onPick(c.id)}
          >
            {c.label}
          </button>
        ))}
        <Link to="/settings#interests" className="channel channel--edit" aria-label="编辑兴趣频道">
          <Settings2 size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

export function HomePage() {
  const [params, setParams] = useSearchParams()
  const active = params.get('c') ?? 'foryou'
  const feed = useFeed((s) => s.channels[active])
  const loadMore = useFeed((s) => s.loadMore)
  const refresh = useFeed((s) => s.refresh)
  const saveScroll = useFeed((s) => s.saveScroll)

  const load = useCallback(() => loadMore(active), [loadMore, active])

  // 回到首页时恢复滚动位置；离开时记下来
  useLayoutEffect(() => {
    const y = useFeed.getState().channels[active]?.scrollY ?? 0
    window.scrollTo(0, y)
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => saveScroll(active, window.scrollY))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [active, saveScroll])

  const pick = (id: string) => {
    if (id === active) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setParams(id === 'foryou' ? {} : { c: id })
  }

  const items = feed?.items ?? []
  const status = feed?.status ?? 'idle'

  return (
    <div className="page page--feed">
      <ChannelBar active={active} onPick={pick} />
      {(active==='foryou'||active==='following')&&<ProfileStatus following={active==='following'}/> }
      {(active === 'foryou' || active === 'following') && items.length > 0 && (
        <div className="feed-tools">
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              window.scrollTo(0, 0)
              refresh(active)
            }}
            disabled={status === 'loading'}
          >
            <RefreshCw size={15} aria-hidden="true" /> 换一批
          </button>
        </div>
      )}
      <FeedGrid
        items={items}
        status={status}
        error={feed?.error}
        loadMore={load}
        feedback={active === 'foryou'}
        empty={
          <div className="empty">
            {active === 'following' ? (
              <>
                <h2>你关注的人最近没有 Star 新项目</h2>
                <p>在 GitHub 上多关注几位你欣赏的开发者，他们 Star 的项目会出现在这里。</p>
              </>
            ) : active === 'foryou' ? (
              <>
                <h2>这一轮推荐看完了</h2>
                <p>去偏好设置里多选几个兴趣方向，或者重置推荐记录，就会有新的内容。</p>
                <Link className="btn btn--primary" to="/settings#interests">
                  调整兴趣
                </Link>
              </>
            ) : (
              <>
                <h2>这个频道暂时没有内容</h2>
                <p>换个频道看看。</p>
              </>
            )}
          </div>
        }
        endNote={
          <p className="feed-note">
            {active === 'following' ? '关注动态就这些了' : '到底了'}
          </p>
        }
      />
    </div>
  )
}
