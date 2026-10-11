import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { isRepo } from '../api/validate'
import { readPageSnapshot,saveSearchSnapshot } from '../components/ScrollManager'
import { searchRepos } from '../api/github'
import type { FeedItem } from '../api/types'
import { FeedGrid } from '../components/FeedGrid'
import { formatCount } from '../lib/format'

const SORTS = [
  { id: 'best', label: '最佳匹配', suffix: '' },
  { id: 'stars', label: '最多 Star', suffix: ' sort:stars' },
  { id: 'updated', label: '最近更新', suffix: ' sort:updated' },
]

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const sort = params.get('sort') ?? 'best'
  const [saved]=useState(()=>{const value=readPageSnapshot()?.search as {key?:string;items?:FeedItem[];status?:'idle'|'end';cursor?:string|null;total?:number|null}|undefined;return value?.key===q+'|'+sort&&Array.isArray(value.items)&&value.items.every(item=>isRepo(item.repo))?value:undefined})
  const [items, setItems] = useState<FeedItem[]>(saved?.items??[])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'end'>(saved?.status??(q ? 'idle' : 'end'))
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(saved?.total??null)
  const cursor = useRef<string | null>(saved?.cursor??null)
  const gen = useRef(0)
  const busy = useRef(false)

  useLayoutEffect(()=>{saveSearchSnapshot({key:q+'|'+sort,items,status:status==='end'?'end':'idle',cursor:cursor.current,total})},[q,sort,items,status,total])
  // 搜索词或排序变了就从头开始
  const lastKey = useRef(`${q}|${sort}`)
  useEffect(() => {
    if (lastKey.current === `${q}|${sort}`) return
    lastKey.current = `${q}|${sort}`
    gen.current++
    busy.current = false
    cursor.current = null
    setItems([])
    setTotal(null)
    setError(null)
    setStatus(q ? 'idle' : 'end')
  }, [q, sort])

  const loadMore = useCallback(async () => {
    if (!q || busy.current || status === 'end') return
    const my = gen.current
    busy.current = true
    setStatus('loading')
    try {
      const suffix = /\bsort:/.test(q) ? '' : (SORTS.find((s) => s.id === sort)?.suffix ?? '')
      const page = await searchRepos(q + suffix, cursor.current, 18)
      if (my !== gen.current) return
      cursor.current = page.endCursor
      setTotal(page.total)
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.repo.nameWithOwner))
        return [
          ...prev,
          ...page.repos.filter((r) => !seen.has(r.nameWithOwner)).map((repo) => ({ key: `s:${repo.nameWithOwner}`, repo })),
        ]
      })
      setStatus(page.hasNextPage ? 'idle' : 'end')
    } catch (e) {
      if (my !== gen.current) return
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    } finally {
      if (my === gen.current) busy.current = false
    }
  }, [q, sort, status])

  return (
    <div className="page page--feed">
      <header className="page-head page-head--search">
        <h1>
          {q ? (
            <>
              搜索 <q>{q}</q>
            </>
          ) : (
            '搜索'
          )}
        </h1>
        {total !== null && <span className="page-head__count">约 {formatCount(total)} 个结果</span>}
        <div className="segmented" role="radiogroup" aria-label="排序">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={sort === s.id}
              className="segmented__item"
              onClick={() => {
                const next = new URLSearchParams(params)
                if (s.id === 'best') next.delete('sort')
                else next.set('sort', s.id)
                setParams(next)
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>
      {q ? (
        <FeedGrid
          items={items}
          status={status}
          error={error}
          loadMore={loadMore}
          feedback={false}
          empty={
            <div className="empty">
              <h2>没有找到「{q}」相关的项目</h2>
              <p>换个关键词试试，也可以用 GitHub 的搜索语法，比如 topic:bioinformatics 或 language:rust stars:&gt;1000。</p>
            </div>
          }
          endNote={<p className="feed-note">到底了</p>}
        />
      ) : (
        <div className="empty">
          <h2>想找什么项目？</h2>
          <p>在顶部搜索框输入关键词。支持 GitHub 搜索语法：topic:llm、language:python、stars:&gt;500、user:pytorch。</p>
        </div>
      )}
    </div>
  )
}
