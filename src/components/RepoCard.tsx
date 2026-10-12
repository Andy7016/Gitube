import { memo } from 'react'
import { Link } from 'react-router'
import { Bookmark, BookmarkCheck, Clock, Check } from 'lucide-react'
import type { FeedItem, Repo } from '../api/types'
import { quickSave, toggleLater, undoDislike } from '../lib/actions'
import { timeAgo } from '../lib/format'
import { useFeed } from '../store/feed'
import { useIsLater, useIsSaved } from '../store/library'
import { Avatar } from './Avatar'
import { CardMenu } from './CardMenu'
import { Cover } from './Cover'
import { StarButton } from './StarButton'

export const repoPath = (repo: Pick<Repo, 'nameWithOwner'>) => `/repo/${repo.nameWithOwner}`

/** 封面右上角的「稍后再看」「收藏」，鼠标悬停时出现（触屏设备上一直显示） */
function QuickActions({ repo }: { repo: Repo }) {
  const saved = useIsSaved(repo.nameWithOwner)
  const later = useIsLater(repo.nameWithOwner)
  return (
    <div className="quick">
      <button
        type="button"
        className={`quick__btn${later ? ' is-on' : ''}`}
        aria-label={later ? '移出稍后再看' : '稍后再看'}
        aria-pressed={later}
        onClick={(e) => {
          e.preventDefault()
          toggleLater(repo)
        }}
      >
        {later ? <Check size={16} aria-hidden="true" /> : <Clock size={16} aria-hidden="true" />}
        <span className="quick__tip">{later ? '已加入稍后再看' : '稍后再看'}</span>
      </button>
      <button
        type="button"
        className={`quick__btn${saved ? ' is-on' : ''}`}
        aria-label={saved ? '已收藏，管理收藏夹' : '收藏'}
        aria-pressed={saved}
        onClick={(e) => {
          e.preventDefault()
          quickSave(repo)
        }}
      >
        {saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
        <span className="quick__tip">{saved ? '已收藏' : '收藏'}</span>
      </button>
    </div>
  )
}

function DismissedCard({ repo }: { repo: Repo }) {
  const d = useFeed((s) => s.dismissed[repo.nameWithOwner])
  return (
    <article className="card card--dismissed">
      <div className="card__dismissed-box">
        <p>{d?.label ?? '已减少此类推荐'}</p>
        <button type="button" className="text-btn" onClick={() => d && undoDislike(repo, d.reason)}>
          撤销
        </button>
      </div>
    </article>
  )
}

interface Props {
  item: FeedItem
  feedback?: boolean
}

export const RepoCard = memo(function RepoCard({ item, feedback = true }: Props) {
  const { repo, reason } = item
  const dismissed = useFeed((s) => !!s.dismissed[repo.nameWithOwner])
  if (dismissed && feedback) return <DismissedCard repo={repo} />

  return (
    <article className="card">
      <div className="card__media">
        <Link to={repoPath(repo)} className="card__cover-link" aria-label={`打开 ${repo.nameWithOwner}`}>
          <Cover repo={repo} />
        </Link>
        <QuickActions repo={repo} />
      </div>
      <div className="card__body">
        <Link to={repoPath(repo)} tabIndex={-1} aria-hidden="true" className="card__avatar">
          <Avatar src={repo.ownerAvatar} name={repo.owner} size={36} square={repo.ownerType === 'Organization'} />
        </Link>
        <div className="card__text">
          <h3 className="card__title">
            <Link to={repoPath(repo)}>{repo.name}</Link>
          </h3>
          {repo.description && <p className="card__desc">{repo.description}</p>}
          <p className="card__meta">
            <span>{repo.owner}</span>
            {repo.pushedAt && <span>{timeAgo(repo.pushedAt)}更新</span>}
          </p>
          {reason && (
            <p className={`reason reason--${reason.kind}`}>
              {reason.avatar && <Avatar src={reason.avatar} name={reason.text.slice(1)} size={16} />}
              {reason.text}
            </p>
          )}
        </div>
        <div className="card__actions">
          <StarButton repo={repo} />
          <CardMenu repo={repo} feedback={feedback} />
        </div>
      </div>
    </article>
  )
})
