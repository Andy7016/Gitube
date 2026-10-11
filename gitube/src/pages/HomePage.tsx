import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { RefreshCw, Settings2 } from 'lucide-react'
import { ProfileStatus } from '../components/ProfileStatus'
import { FeedGrid } from '../components/FeedGrid'
import { RecommendationModePicker } from '../components/RecommendationModePicker'
import { channelsFor } from '../lib/channels'
import { feedDisplayStatus, feedKey, feedSnapshotToken, useFeed, visibleFeedItems } from '../store/feed'
import { useAuth } from '../store/auth'
import { useLibrary } from '../store/library'
import { isStarredNow, useStars } from '../store/stars'

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
  const account = useAuth(s => s.account)
  const mode = useLibrary(s => s.recommendationMode)
  const key = feedKey(active, mode, account)
  const feed = useFeed((s) => s.channels[key])
  const library = useLibrary()
  const dismissed = useFeed(s => s.dismissed)
  useStars(s => s.overrides)
  const loadMore = useFeed((s) => s.loadMore)
  const refresh = useFeed((s) => s.refresh)
  const saveScroll = useFeed((s) => s.saveScroll)

  const load = useCallback(() => loadMore(active, mode, account), [loadMore, active, mode, account])

  // 回到首页时恢复滚动位置；离开时记下来
  useLayoutEffect(() => {
    const y = useFeed.getState().channels[key]?.scrollY ?? 0
    window.scrollTo(0, y)
    const onScroll = () => saveScroll(key, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [key, saveScroll])

  const pick = (id: string) => {
    if (id === active) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setParams(id === 'foryou' ? {} : { c: id })
  }

  const items = active === 'foryou' ? visibleFeedItems(feed?.items ?? [], library, isStarredNow, dismissed) : feed?.items ?? []
  const status = feedDisplayStatus(feed, items.length)
  const filteredBatch = !!feed?.items.length && items.length === 0

  return (
    <div className="page page--feed">
      <ChannelBar active={active} onPick={pick} />
      {(active === 'following' || active === 'foryou' && mode === 'normal') && <ProfileStatus following={active === 'following'} />}
      {(active === 'foryou' || active === 'following') && (
        <div className={`feed-tools${active === 'foryou' ? ' feed-tools--recommend' : ''}`}>
          {active === 'foryou' && <RecommendationModePicker />}
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              window.scrollTo(0, 0)
              refresh(active, mode, account)
            }}
            disabled={status === 'loading'}
          >
            <RefreshCw size={15} aria-hidden="true" /> 换一批
          </button>
        </div>
      )}
      <FeedGrid
        key={`${key}:${feedSnapshotToken(key)}`}
        pauseOnRestore={!!feed?.items.length}
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
                <h2>{filteredBatch ? '这一批项目已被筛除' : mode === 'normal' ? '这一轮推荐看完了' : '这一批没有新的候选'}</h2>
                <p>{filteredBatch ? '当前批次中的项目已 Star、屏蔽或标记不感兴趣。可以主动换一批继续浏览。' : mode === 'normal' ? '去偏好设置里多选几个兴趣方向，或者重置推荐记录，就会有新的内容。' : '可以换一批重新抽取，或切回正常推荐。已看过和屏蔽的内容仍会过滤。'}</p>
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
