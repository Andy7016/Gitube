import { Fragment, useMemo, useState } from 'react'
import { GitFork, Star } from 'lucide-react'
import { safeURL } from '../api/validate'
import type { Repo } from '../api/types'
import { designCover, nameSize } from '../lib/cover'
import { formatCount } from '../lib/format'
import { useStarState } from '../store/stars'

/** 在 - _ . 后面允许断行，长名字不会把封面撑破 */
function breakable(name: string) {
  const parts = name.replace(/([-_.])/g, '$1\u0000').split('\u0000')
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 && <wbr />}
    </Fragment>
  ))
}

export function GeneratedCover({ repo }: { repo: Repo }) {
  const d = useMemo(() => designCover(repo), [repo])
  const cell = 10
  const gap = 3
  const w = d.cols * (cell + gap)
  const h = d.rows * (cell + gap)
  return (
    <div className={`gen-cover gen-cover--${d.tone}`} style={{ background: d.bg }}>
      <svg className="gen-cover__grid" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {d.cells.map((c, i) => (
          <rect
            key={i}
            x={c.x * (cell + gap)}
            y={c.y * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            className={`lvl${c.level}`}
          />
        ))}
      </svg>
      <div className="gen-cover__text">
        <span className="gen-cover__owner">{repo.owner}</span>
        <span className="gen-cover__name" style={{ fontSize: nameSize(repo.name) }}>
          {breakable(repo.name)}
        </span>
      </div>
    </div>
  )
}

interface CoverProps {
  repo: Repo
  /** 底部的 Star 数 / Fork 数 / 语言 */
  stats?: boolean
}

export function Cover({ repo, stats = true }: CoverProps) {
  const [broken, setBroken] = useState(false)
  const { stars } = useStarState(repo)
  const useImage = safeURL(repo.coverImage) && !broken

  return (
    <div className="cover">
      {useImage ? (
        <img
          className="cover__img"
          src={safeURL(repo.coverImage)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <GeneratedCover repo={repo} />
      )}
      {stats && (
        <div className="cover__stats">
          <span className="cover__stat" title={`${stars} 个 Star`}>
            <Star size={13} strokeWidth={2.4} aria-hidden="true" />
            {formatCount(stars)}
          </span>
          <span className="cover__stat" title={`${repo.forks} 个 Fork`}>
            <GitFork size={13} strokeWidth={2.4} aria-hidden="true" />
            {formatCount(repo.forks)}
          </span>
          {repo.language && <span className="cover__lang">{repo.language}</span>}
        </div>
      )}
    </div>
  )
}
