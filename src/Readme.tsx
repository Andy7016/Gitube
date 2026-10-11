import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import { safeUrl, type RepoDetailData } from './data';

const schema = {
  ...defaultSchema,
  clobberPrefix: 'readme-',
  clobber: ['id', 'name'],
  tagNames: ['a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
  attributes: { '*': ['id', 'title'], a: ['href', 'name', 'dataFootnoteRef', 'dataFootnoteBackref', 'ariaDescribedBy', 'ariaLabel', ['className', 'data-footnote-backref']], img: ['src', 'alt', 'title', 'width', 'height', 'align'], input: [['type', 'checkbox'], 'checked', 'disabled'], code: [['className', /^language-[\w+-]+$/]], details: ['open'], ol: ['start', ['className', 'contains-task-list']], ul: [['className', 'contains-task-list']], li: [['className', 'task-list-item']], section: ['dataFootnotes', ['className', 'footnotes']], h2: [['className', 'sr-only']], td: ['align', 'colSpan', 'rowSpan'], th: ['align', 'colSpan', 'rowSpan'] },
  protocols: { href: ['http', 'https'], src: ['http', 'https'] },
  required: { input: { disabled: true, type: 'checkbox' } },
  strip: ['script', 'iframe', 'style', 'object', 'embed', 'form', 'textarea', 'button', 'link', 'meta', 'base', 'svg', 'math', 'video', 'audio'],
};
function decode(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
export function readmeUrl(value: string | undefined, data: RepoDetailData, image = false): string | null {
  if (!value) return null;
  if (!image && value.startsWith('#')) return `#readme-${decode(value.slice(1))}`;
  const fallback = `https://raw.githubusercontent.com/${data.repo.full_name.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(data.defaultBranch)}/${data.readme?.path.split('/').map(encodeURIComponent).join('/') || 'README.md'}`;
  const base = image ? safeUrl(data.readme?.download_url) || fallback : safeUrl(data.readme?.html_url) || `${data.repo.html_url}/blob/${encodeURIComponent(data.defaultBranch)}/${data.readme?.path || 'README.md'}`;
  try {
    const root = image ? `https://raw.githubusercontent.com/${data.repo.full_name.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(data.defaultBranch)}/` : `${safeUrl(data.repo.html_url) || `https://github.com/${data.repo.full_name}`}/blob/${encodeURIComponent(data.defaultBranch)}/`;
    const url = value.startsWith('/') && !value.startsWith('//') ? new URL(value.slice(1), root) : new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (image && url.hostname === 'github.com') { const parts = url.pathname.split('/').filter(Boolean); if (parts.length >= 5 && parts[2] === 'blob') { url.hostname = 'raw.githubusercontent.com'; url.pathname = `/${[...parts.slice(0, 2), ...parts.slice(3)].join('/')}`; url.search = ''; } }
    return url.href;
  } catch { return null; }
}
function scrollToHash(hash: string) { const id = decode(hash.replace(/^#/, '')); const element = document.getElementById(id) || document.getElementById(id.replace(/^readme-user-content-/, 'readme-')); element?.scrollIntoView({ block: 'start' }); return !!element; }

export default function Readme({ data }: { data: RepoDetailData }) {
  useEffect(() => { if (location.hash.startsWith('#readme-')) { const frame = requestAnimationFrame(() => scrollToHash(location.hash)); return () => cancelAnimationFrame(frame); } }, [data.readme?.content]);
  return <div className="readme-document"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSlug, [rehypeSanitize, schema]]} urlTransform={value => value} components={{
    a: ({ href, children, title, node }) => { const anchorId = typeof node?.properties.id === 'string' ? node.properties.id : typeof node?.properties.name === 'string' ? node.properties.name : undefined; const url = readmeUrl(href, data); if (!url) return <span id={anchorId}>{children}</span>; if (url.startsWith('#')) { const properties = node?.properties || {}, describedBy = properties.ariaDescribedBy as unknown; const references = (Array.isArray(describedBy) ? describedBy : typeof describedBy === 'string' ? describedBy.split(/\s+/) : []).map((value: unknown) => `readme-${String(value)}`).join(' '); return <a id={anchorId} href={url} title={title} data-footnote-ref={properties.dataFootnoteRef != null ? '' : undefined} data-footnote-backref={properties.dataFootnoteBackref != null ? '' : undefined} aria-describedby={references || undefined} aria-label={typeof properties.ariaLabel === 'string' ? properties.ariaLabel : undefined} onClick={event => { event.preventDefault(); if (scrollToHash(url)) history.replaceState(history.state, '', url); }}>{children}</a>; } return <a id={anchorId} href={url} title={title} target="_blank" rel="noopener noreferrer">{children}</a>; },
    img: ({ src, alt, title }) => { const url = readmeUrl(typeof src === 'string' ? src : undefined, data, true); return url ? <img src={url} alt={alt || ''} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="readme-image-unavailable">{alt || '图片地址不可用'}</span>; },
    table: ({ children }) => <div className="readme-table-scroll"><table>{children}</table></div>,
  }}>{data.readme?.content || ''}</ReactMarkdown></div>;
}
