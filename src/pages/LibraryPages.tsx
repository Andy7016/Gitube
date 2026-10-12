import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react'
import { fetchMyStars } from '../api/github'
import type { FeedItem } from '../api/types'
import { ConfirmButton } from '../components/ConfirmButton'
import { FeedGrid } from '../components/FeedGrid'
import { RepoRow } from '../components/RepoRow'
import { StarButton } from '../components/StarButton'
import { dayBucket, timeAgo } from '../lib/format'
import { DEFAULT_FOLDER_ID, useLibrary } from '../store/library'

function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      <X size={18} aria-hidden="true" />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 稍后再看                                                              */
/* ------------------------------------------------------------------ */

export function LaterPage() {
  const later = useLibrary((s) => s.later)
  const removeLater = useLibrary((s) => s.removeLater)
  const clearLater = useLibrary((s) => s.clearLater)

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <h1>稍后再看</h1>
        <span className="page-head__count">{later.length} 个项目</span>
        {later.length > 0 && (
          <ConfirmButton confirmText="再点一次清空" onConfirm={clearLater}>
            清空
          </ConfirmButton>
        )}
      </header>
      {later.length === 0 ? (
        <div className="empty">
          <h2>还没有要稍后再看的项目</h2>
          <p>刷首页时把鼠标移到封面上，点右上角的时钟，就能先存到这里。</p>
          <Link className="btn btn--primary" to="/">
            去首页
          </Link>
        </div>
      ) : (
        <div className="rows">
          {later.map(({ repo, at }) => (
            <RepoRow
              key={repo.nameWithOwner}
              repo={repo}
              note={`${timeAgo(at)}加入`}
              trailing={
                <>
                  <StarButton repo={repo} />
                  <RemoveBtn label="移出稍后再看" onClick={() => removeLater(repo.nameWithOwner)} />
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 收藏夹                                                                */
/* ------------------------------------------------------------------ */

export function SavedPage() {
  const { folderId = DEFAULT_FOLDER_ID } = useParams()
  const navigate = useNavigate()
  const folders = useLibrary((s) => s.folders)
  const { createFolder, renameFolder, deleteFolder, removeFromFolder } = useLibrary.getState()
  const folder = folders.find((f) => f.id === folderId) ?? folders[0]
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setRenaming(false)
  }, [folderId])

  return (
    <div className="page library">
      <nav className="folders" aria-label="收藏夹列表">
        <h1 className="folders__title">收藏夹</h1>
        {folders.map((f) => (
          <NavLink
            key={f.id}
            to={f.id === DEFAULT_FOLDER_ID ? '/saved' : `/saved/${f.id}`}
            end
            aria-current={f.id === folder.id ? 'page' : undefined}
            className={`folder${f.id === folder.id ? ' active' : ''}`}
          >
            <span className="folder__name">{f.name}</span>
            <span className="folder__count">{f.items.length}</span>
          </NavLink>
        ))}
        {creating ? (
          <form
            className="new-folder"
            onSubmit={(e) => {
              e.preventDefault()
              if (!draft.trim()) return
              const id = createFolder(draft)
              setCreating(false)
              setDraft('')
              navigate(`/saved/${id}`)
            }}
          >
            <input
              className="input"
              autoFocus
              maxLength={30}
              placeholder="收藏夹名称"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => !draft.trim() && setCreating(false)}
            />
          </form>
        ) : (
          <button type="button" className="text-btn" onClick={() => setCreating(true)}>
            <FolderPlus size={16} aria-hidden="true" /> 新建收藏夹
          </button>
        )}
      </nav>

      <section className="library__content" aria-labelledby="folder-title">
        <header className="page-head">
          {renaming ? (
            <form
              className="rename"
              onSubmit={(e) => {
                e.preventDefault()
                renameFolder(folder.id, draft)
                setRenaming(false)
              }}
            >
              <input className="input" autoFocus maxLength={30} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" className="icon-btn" aria-label="保存名称">
                <Check size={18} aria-hidden="true" />
              </button>
            </form>
          ) : (
            <h2 id="folder-title">{folder.name}</h2>
          )}
          <span className="page-head__count">{folder.items.length} 个项目</span>
          {!renaming && (
            <button
              type="button"
              className="icon-btn"
              aria-label="重命名收藏夹"
              title="重命名"
              onClick={() => {
                setDraft(folder.name)
                setRenaming(true)
              }}
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          )}
          {folder.id !== DEFAULT_FOLDER_ID && (
            <ConfirmButton
              className="icon-btn"
              confirmText="确认删除"
              onConfirm={() => {
                deleteFolder(folder.id)
                navigate('/saved')
              }}
            >
              <Trash2 size={16} aria-label="删除收藏夹" />
            </ConfirmButton>
          )}
        </header>
        {folder.items.length === 0 ? (
          <div className="empty">
            <h2>这个收藏夹还是空的</h2>
            <p>在卡片封面上点书签图标，项目会先进「默认收藏夹」；在「收藏到…」里可以选别的收藏夹。</p>
          </div>
        ) : (
          <div className="rows">
            {folder.items.map(({ repo, at }) => (
              <RepoRow
                key={repo.nameWithOwner}
                repo={repo}
                note={`${timeAgo(at)}收藏`}
                trailing={
                  <>
                    <StarButton repo={repo} />
                    <RemoveBtn label="从收藏夹移除" onClick={() => removeFromFolder(folder.id, repo.nameWithOwner)} />
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 历史记录                                                              */
/* ------------------------------------------------------------------ */

export function HistoryPage() {
  const history = useLibrary((s) => s.history)
  const removeHistory = useLibrary((s) => s.removeHistory)
  const clearHistory = useLibrary((s) => s.clearHistory)

  const groups: { label: string; items: typeof history }[] = []
  for (const item of history) {
    const label = dayBucket(item.at)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <h1>历史记录</h1>
        <span className="page-head__count">{history.length} 个项目</span>
        {history.length > 0 && (
          <ConfirmButton confirmText="再点一次清空" onConfirm={clearHistory}>
            清空
          </ConfirmButton>
        )}
      </header>
      {history.length === 0 ? (
        <div className="empty">
          <h2>还没有浏览记录</h2>
          <p>点开过的项目会按时间记在这里。</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="history-group" aria-label={g.label}>
            <h2 className="section-title">{g.label}</h2>
            <div className="rows">
              {g.items.map(({ repo, at }) => (
                <RepoRow
                  key={repo.nameWithOwner}
                  repo={repo}
                  note={`${timeAgo(at)}看过`}
                  trailing={<RemoveBtn label="删除这条记录" onClick={() => removeHistory(repo.nameWithOwner)} />}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 我的 Star（来自 GitHub）                                               */
/* ------------------------------------------------------------------ */

export function StarsPage() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'end'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)

  const busy = useRef(false)

  const loadMore = useCallback(async () => {
    if (busy.current || status === 'end') return
    busy.current = true
    setStatus('loading')
    try {
      const page = await fetchMyStars(cursor)
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.repo.nameWithOwner))
        const fresh = page.repos.filter((r) => !seen.has(r.nameWithOwner))
        return [...prev, ...fresh.map((repo) => ({ key: `star:${repo.nameWithOwner}`, repo }))]
      })
      setCursor(page.endCursor)
      setTotal(page.total)
      setStatus(page.hasNextPage ? 'idle' : 'end')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    } finally {
      busy.current = false
    }
  }, [cursor, status])

  return (
    <div className="page page--feed">
      <header className="page-head">
        <h1>我的 Star</h1>
        {total !== null && <span className="page-head__count">共 {total} 个</span>}
      </header>
      <FeedGrid
        items={items}
        status={status}
        error={error}
        loadMore={loadMore}
        feedback={false}
        empty={
          <div className="empty">
            <h2>你还没有 Star 过项目</h2>
            <p>在首页看到喜欢的项目，点卡片右下角的星星就行。</p>
          </div>
        }
        endNote={<p className="feed-note">全部 Star 都在这了</p>}
      />
    </div>
  )
}
