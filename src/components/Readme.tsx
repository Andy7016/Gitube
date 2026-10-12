import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { fetchReadmeHtml } from '../api/github'
import type { Repo } from '../api/types'

/**
 * README 用 GitHub 渲染好的 HTML（和 GitHub 网页上看到的一致），
 * 再用 DOMPurify 清洗，并把相对路径的图片 / 链接改成绝对地址。
 */
function prepare(html: string, repo: Repo): string {
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style'] })
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html')
  const branch = repo.defaultBranch ?? 'HEAD'
  const raw = `https://raw.githubusercontent.com/${repo.nameWithOwner}/${branch}/`
  const blob = `https://github.com/${repo.nameWithOwner}/blob/${branch}/`
  const isAbsolute = (u: string) => /^(https?:|data:|mailto:|#)/i.test(u)

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (src && !isAbsolute(src)) {
      img.setAttribute('src', src.startsWith('/') ? `https://github.com${src}` : raw + src.replace(/^\.\//, ''))
    }
    img.setAttribute('loading', 'lazy')
    img.removeAttribute('srcset')
  })
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')!
    if (href.startsWith('#')) return
    if (!isAbsolute(href)) {
      a.setAttribute('href', href.startsWith('/') ? `https://github.com${href}` : blob + href.replace(/^\.\//, ''))
    }
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noreferrer')
  })
  return doc.body.firstElementChild!.innerHTML
}

const COLLAPSED_HEIGHT = 720

export function Readme({ repo }: { repo: Repo }) {
  const [html, setHtml] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setHtml(undefined)
    setError(null)
    setExpanded(false)
    fetchReadmeHtml(repo.owner, repo.name)
      .then((h) => alive && setHtml(h))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [repo.owner, repo.name])

  const prepared = useMemo(() => (html ? prepare(html, repo) : null), [html, repo])

  // 短 README 不需要折叠
  useLayoutEffect(() => {
    if (prepared && box.current && box.current.scrollHeight <= COLLAPSED_HEIGHT + 120) setExpanded(true)
  }, [prepared])

  // 页内锚点：GitHub 给标题 id 加了 user-content- 前缀
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (!href?.startsWith('#')) return
    e.preventDefault()
    const id = decodeURIComponent(href.slice(1))
    const el = box.current?.querySelector(`[id="user-content-${CSS.escape(id)}"], [id="${CSS.escape(id)}"]`)
    if (el) {
      setExpanded(true)
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  if (error) return <p className="muted">README 加载失败：{error}</p>
  if (html === undefined) {
    return (
      <div className="readme-loading" aria-label="README 加载中">
        {[90, 70, 84, 40, 76, 62].map((w, i) => (
          <div key={i} className="sk sk-line" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }
  if (!prepared) return <p className="muted">这个项目没有 README。</p>

  return (
    <div className={`readme${expanded ? ' is-expanded' : ''}`}>
      <div ref={box} className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: prepared }} />
      {!expanded && (
        <div className="readme__fade">
          <button type="button" className="btn" onClick={() => setExpanded(true)}>
            展开完整 README
          </button>
        </div>
      )}
    </div>
  )
}
