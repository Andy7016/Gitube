import { useEffect, useState } from 'react'
import type { MouseEventHandler } from 'react'
import { Link, useParams } from 'react-router'
import {
  Bookmark,
  BookmarkCheck,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  GitFork,
  Globe,
  CircleDot,
  Scale,
  Tag,
} from 'lucide-react'
import { fetchRepo, GitHubError, repoCache, searchMany } from '../api/github'
import type { Repo, RepoDetail } from '../api/types'
import { Avatar } from '../components/Avatar'
import { Cover } from '../components/Cover'
import { Readme } from '../components/Readme'
import { RepoRow } from '../components/RepoRow'
import { StarButton } from '../components/StarButton'
import { copyClone, quickSave, toggleLater } from '../lib/actions'
import { formatCount, isoDaysAgo, timeAgo } from '../lib/format'
import { TOPIC_STOPLIST } from '../lib/interests'
import { useRepoReading } from '../lib/useRepoReading'
import { useIsLater, useIsSaved, useLibrary } from '../store/library'
import { useStars, useStarState } from '../store/stars'
import { useSaveDialog } from '../store/ui'
import { GraphWorkspace } from '../components/graph/GraphWorkspace'

function Related({ repo }: { repo: Repo }) {
  const [items, setItems] = useState<Repo[] | null>(null)

  useEffect(() => {
    let alive = true
    setItems(null)
    const topics = repo.topics.filter((t) => !TOPIC_STOPLIST.has(t))
    const queries: string[] = []
    if (topics.length >= 2) queries.push(`topic:${topics[0]} topic:${topics[1]} stars:>=20 sort:stars`)
    if (topics.length >= 1) queries.push(`topic:${topics[0]} stars:>=50 sort:stars`)
    if (repo.language) queries.push(`language:"${repo.language}" stars:>=500 pushed:>=${isoDaysAgo(365)} sort:stars`)
    searchMany(queries.slice(0, 2).map((query) => ({ query, after: null, first: 12 })))
      .then((pages) => {
        if (!alive) return
        const seen = new Set([repo.nameWithOwner])
        const out: Repo[] = []
        for (const p of pages) {
          for (const r of p?.repos ?? []) {
            if (seen.has(r.nameWithOwner)) continue
            seen.add(r.nameWithOwner)
            out.push(r)
          }
        }
        setItems(out.slice(0, 14))
      })
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [repo.nameWithOwner, repo.topics, repo.language])

  return (
    <aside className="related" aria-labelledby="related-title">
      <h2 id="related-title" className="section-title">
        相关推荐
      </h2>
      {items === null ? (
        Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="row row--sm" aria-hidden="true">
            <div className="row__thumb sk" />
            <div className="row__text">
              <div className="sk sk-line" style={{ width: '80%' }} />
              <div className="sk sk-line" style={{ width: '50%' }} />
            </div>
          </div>
        ))
      ) : items.length === 0 ? (
        <p className="muted">没有找到相似的项目。</p>
      ) : (
        items.map((r) => <RepoRow key={r.nameWithOwner} repo={r} size="sm" />)
      )}
    </aside>
  )
}

function ActionBar({ repo, onOpenOriginal }: { repo: Repo; onOpenOriginal: MouseEventHandler<HTMLAnchorElement> }) {
  const saved = useIsSaved(repo.nameWithOwner)
  const later = useIsLater(repo.nameWithOwner)
  const [copied, setCopied] = useState(false)

  return (
    <div className="actionbar">
      <StarButton repo={repo} variant="pill" triple />
      <button
        type="button"
        className={`pill${saved ? ' is-on' : ''}`}
        aria-pressed={saved}
        title="收藏（快捷键 B）"
        onClick={() => quickSave(repo)}
      >
        {saved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
        {saved ? '已收藏' : '收藏'}
      </button>
      <button
        type="button"
        className={`pill${later ? ' is-on' : ''}`}
        aria-pressed={later}
        title="稍后再看（快捷键 L）"
        onClick={() => toggleLater(repo)}
      >
        {later ? <Check size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />}
        稍后再看
      </button>
      <button
        type="button"
        className="pill"
        onClick={async () => {
          await copyClone(repo)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
      >
        {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        clone
      </button>
      <a className="pill" href={repo.url} target="_blank" rel="noreferrer" onClick={onOpenOriginal} onAuxClick={onOpenOriginal}>
        <ExternalLink size={18} aria-hidden="true" />
        GitHub
      </a>
    </div>
  )
}

function InfoBox({ repo, detail }: { repo: Repo; detail: RepoDetail | null }) {
  const { stars } = useStarState(repo)
  const topics = repo.topics
  return (
    <section className="infobox" aria-label="项目信息">
      <p className="infobox__stats">
        <span>
          <strong>{formatCount(stars)}</strong> Star
        </span>
        <span>
          <GitFork size={14} aria-hidden="true" />
          {formatCount(repo.forks)} Fork
        </span>
        {detail && (
          <>
            <span>
              <Eye size={14} aria-hidden="true" />
              {formatCount(detail.watchers)} Watch
            </span>
            <span>
              <CircleDot size={14} aria-hidden="true" />
              {formatCount(detail.openIssues)} 个 open issue
            </span>
          </>
        )}
        {repo.pushedAt && <span>{timeAgo(repo.pushedAt)}更新</span>}
        {repo.createdAt && <span>创建于 {new Date(repo.createdAt).getFullYear()} 年</span>}
      </p>
      {repo.description && <p className="infobox__desc">{repo.description}</p>}
      <div className="infobox__links">
        {repo.homepageUrl && (
          <a href={repo.homepageUrl} target="_blank" rel="noreferrer">
            <Globe size={15} aria-hidden="true" />
            {repo.homepageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        )}
        {repo.license && (
          <span>
            <Scale size={15} aria-hidden="true" />
            {repo.license}
          </span>
        )}
        {detail?.latestRelease && (
          <span>
            <Tag size={15} aria-hidden="true" />
            {detail.latestRelease.tagName}（{timeAgo(detail.latestRelease.publishedAt)}）
          </span>
        )}
        {repo.language && <span>{repo.language}</span>}
      </div>
      {topics.length > 0 && (
        <div className="topics">
          {topics.map((t) => (
            <Link key={t} className="topic" to={`/search?q=${encodeURIComponent(`topic:${t}`)}`}>
              #{t}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export function RepoPage() {
  const { owner = '', name = '' } = useParams()
  const nameWithOwner = `${owner}/${name}`
  const [detail, setDetail] = useState<RepoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cached = repoCache.get(nameWithOwner) ?? null
  // 路由切换后的首帧仍可能保留上个详情结果，不能展示或计时为新仓库。
  const repo: Repo | null = detail?.nameWithOwner.toLowerCase() === nameWithOwner.toLowerCase() ? detail : cached
  const onOpenOriginal = useRepoReading(repo, nameWithOwner)

  useEffect(() => {
    let alive = true
    setDetail(null)
    setError(null)
    fetchRepo(owner, name)
      .then((d) => {
        if (!alive) return
        setDetail(d)
        useLibrary.getState().pushHistory(d)
        document.title = `${d.nameWithOwner} · Gitube`
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof GitHubError && e.kind === 'not_found' ? '找不到这个仓库，可能已被删除或改名。' : String(e?.message ?? e))
      })
    return () => {
      alive = false
      document.title = 'Gitube'
    }
  }, [owner, name])

  // 快捷键：S = Star，B = 收藏到…，L = 稍后再看
  useEffect(() => {
    if (!repo) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], dialog[open]')) return
      const k = e.key.toLowerCase()
      if (k === 's') useStars.getState().toggle(repo)
      else if (k === 'b') useSaveDialog.getState().open(repo)
      else if (k === 'l') toggleLater(repo)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repo])

  if (error && !repo) {
    return (
      <div className="page">
        <div className="empty">
          <h1>打不开这个项目</h1>
          <p>{error}</p>
          <Link to="/" className="btn btn--primary">
            回首页
          </Link>
        </div>
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="page watch">
        <div className="watch__main">
          <div className="watch__hero sk" />
          <div className="sk sk-line" style={{ width: '40%', height: 28, marginTop: 20 }} />
          <div className="sk sk-line" style={{ width: '70%', marginTop: 16 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="page watch">
      <div className="watch__main">
        <div className="watch__hero">
          <Cover repo={repo} stats={false} />
        </div>
        <h1 className="watch__title">
          <Link to={`/search?q=${encodeURIComponent(`user:${repo.owner}`)}`} className="watch__owner-link">
            {repo.owner}
          </Link>
          <span className="watch__slash">/</span>
          {repo.name}
          {repo.isArchived && <span className="badge">已归档</span>}
        </h1>
        <div className="watch__byline">
          <Avatar src={repo.ownerAvatar} name={repo.owner} size={40} square={repo.ownerType === 'Organization'} />
          <div className="watch__byline-text">
            <a href={`https://github.com/${repo.owner}`} target="_blank" rel="noreferrer">
              {repo.owner}
            </a>
            <span>{repo.ownerType === 'Organization' ? '组织' : '个人开发者'}</span>
          </div>
          <ActionBar repo={repo} onOpenOriginal={onOpenOriginal} />
        </div>
        <p className="watch__tip">长按 Star 一键三连：Star + 收藏 + 关注作者</p>
        <InfoBox repo={repo} detail={detail?.nameWithOwner === repo.nameWithOwner ? detail : null} />
        <GraphWorkspace key={nameWithOwner.toLowerCase()} root={nameWithOwner} mode="embedded" />
        <section className="watch__readme" aria-label="README">
          <Readme repo={repo} />
        </section>
      </div>
      <Related repo={repo} />
    </div>
  )
}
