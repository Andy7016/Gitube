import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Repo } from '../api/types'
import { formatCount, timeAgo } from '../lib/format'
import { useStarState } from '../store/stars'
import { Cover } from './Cover'
import { repoPath } from './RepoCard'

interface Props {
  repo: Repo
  /** 右侧额外显示的操作按钮 */
  trailing?: ReactNode
  /** 额外的一行说明（例如收藏时间） */
  note?: string
  size?: 'sm' | 'md'
}

/** 横向的紧凑卡片：详情页右侧「相关推荐」、历史记录、稍后再看、收藏夹里用 */
export function RepoRow({ repo, trailing, note, size = 'md' }: Props) {
  const { stars, starred } = useStarState(repo)
  return (
    <div className={`row row--${size}`}>
      <Link to={repoPath(repo)} className="row__thumb" tabIndex={-1} aria-hidden="true">
        <Cover repo={repo} stats={false} />
      </Link>
      <div className="row__text">
        <Link to={repoPath(repo)} className="row__title">
          {repo.name}
        </Link>
        <p className="row__owner">{repo.owner}</p>
        {size === 'md' && repo.description && <p className="row__desc">{repo.description}</p>}
        <p className="row__meta">
          <span className={starred ? 'is-starred' : undefined}>★ {formatCount(stars)}</span>
          {repo.language && <span>{repo.language}</span>}
          {note ? <span>{note}</span> : repo.pushedAt && <span>{timeAgo(repo.pushedAt)}更新</span>}
        </p>
      </div>
      {trailing && <div className="row__trailing">{trailing}</div>}
    </div>
  )
}
