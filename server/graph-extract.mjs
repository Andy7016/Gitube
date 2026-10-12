import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

const parser = unified().use(remarkParse).use(remarkGfm)
const ownerPattern = /^[a-zA-Z0-9-]{1,39}$/
const repoPattern = /^[a-zA-Z0-9_.-]{1,100}$/
const navigation = new Set(['about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features', 'issues', 'join', 'login', 'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls', 'readme', 'search', 'security', 'settings', 'site', 'sponsors', 'topics', 'trending', 'users'])
const topicPattern = /^[a-z0-9][a-z0-9-]{0,49}$/

export function validRepository(owner, repo) {
  return typeof owner === 'string' && ownerPattern.test(owner) && typeof repo === 'string' && repoPattern.test(repo) && !['.', '..'].includes(repo)
}

export function normalizedTopics(topics) {
  return [...new Set((Array.isArray(topics) ? topics : []).filter((x) => typeof x === 'string').map((x) => x.toLowerCase()).filter((x) => topicPattern.test(x)))].sort()
}

export function repositoryFromUrl(value) {
  if (typeof value !== 'string') return null
  let text = value.trim().replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/')
  if (/^github:/i.test(text)) text = `https://github.com/${text.slice(7)}`
  let url
  try { url = new URL(text) } catch { return null }
  if (!['https:', 'http:', 'git:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password) return null
  let parts
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent) } catch { return null }
  const owner = parts[0]
  const repo = parts[1]?.replace(/@[^/]*$/, '').replace(/\.git$/i, '')
  if (!validRepository(owner, repo) || navigation.has(owner.toLowerCase())) return null
  if (parts.some((part) => part === '.' || part === '..') || parts.includes('badge.svg') || parts.includes('badges')) return null
  return { owner, repo, fullName: `${owner}/${repo}`, id: `${owner}/${repo}`.toLowerCase() }
}

const compact = (value) => String(value).replace(/\s+/g, ' ').trim().slice(0, 180)
const textOf = (node) => node.value ?? (node.children ?? []).map(textOf).join(' ')
const walk = (node, fn) => { fn(node); if (!['image', 'imageReference'].includes(node.type)) for (const child of node.children ?? []) walk(child, fn) }
const lineUrl = (url, line) => `${String(url).split('#')[0]}${line ? `#L${line}` : ''}`
function sectionKind(text) {
  if (/copyright|licen[cs]e|attributions?|版权|许可证?|许可协议|授权声明/i.test(text)) return 'copyright'
  if (/related(?:\s+projects?)?|see\s+also|alternatives?|downstream|^used\s+by$|projects?\s+(?:using|that\s+use|built\s+with)|相关|关联项目|另见|另请参阅|类似项目|替代方案|下游/i.test(text)) return 'readme-related'
  if (/credits?|acknowledg|inspired\s+by|based\s+on|built\s+(?:on|with)|^dependencies$|(?:forked|ported|derived)\s+from|致谢|鸣谢|灵感|^依赖(?:项目)?$/i.test(text)) return 'credit'
  if (/citations?|references?|bibliograph|引用|参考/i.test(text)) return 'citation'
  if (/maintainers?|authors?|core\s+team|维护者|作者|开发者/i.test(text)) return 'readme-maintainer'
  return null
}

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const upstreamCue = /\b(?:based\s+on|(?:built|build)\s+(?:on(?:\s+top\s+of)?|with|using)|(?:forked|ported|derived)\s+from|inspired\s+by|uses?|using|depends?\s+on|(?:code|source)\s+(?:was\s+)?(?:taken|copied|adapted)\s+from)\b|基于|构建[于在]|建立在|依赖(?:于)?|使用|源自|派生自|移植自|借鉴|(?:代码|源码)(?:取自|来自|改编自)|受.{0,20}启发/i
const negativeCue = /\b(?:not|never|without|no\s+longer)\b|(?:doesn|isn|wasn|aren)['’]t|不(?:再|是|会|依赖|使用|基于)|并未|没有|未曾|非(?:基于|依赖)/i
const comparisonCue = /\b(?:compared\s+(?:with|to)|rather\s+than|instead\s+of|(?:better|faster|slower|different)\s+than|unlike|versus|vs)\b|对比|相比|比较|不同于|而非|而不是|并非/i
const relatedCue = /\b(?:related|see\s+also|alternatives?|similar\s+projects?)\b|相关|关联项目|另见|另请参阅|类似项目|替代方案/i
const evidenceLabels = { credit: 'README 技术致谢或灵感来源', citation: 'README 引用或参考来源', copyright: 'README 版权、许可或归属声明', 'readme-related': 'README 关联项目或延伸阅读', 'readme-reference': 'README 提及的项目' }
const referencePriority = { credit: 0, citation: 1, dependency: 2, copyright: 3, 'readme-reference': 4, 'readme-related': 5 }

function inferReadmeRelation(context, headings, kind, rootFullName, code) {
  if (code) return { relation: 'reference', relationReason: '引用条目提供项目地址，未声明技术流向。' }
  const marker = context.indexOf('\uE000')
  const originalBefore = context.slice(0, marker)
  let before = originalBefore
  let after = context.slice(marker + 1)
  // A cue belonging to another linked project cannot become this target's cue.
  // Coordinated objects, such as "based on A and B", may share the predicate.
  const other = before.lastIndexOf('\uE001')
  if (other >= 0 && !/^(?:\s|[,、/&]|and\b|or\b|以及|和|及)*$/i.test(before.slice(other + 1))) before = ''
  const next = after.indexOf('\uE001')
  if (next >= 0) after = after.slice(0, next)
  const local = `${before}\uE000${after}`
  const current = `(?:(?:this\\s+(?:project|repository|repo|library|framework|package|tool|code)|our\\s+(?:project|library|framework|code)|${[rootFullName, rootFullName.split('/')[1]].map(escapePattern).join('|')})(?![\\w./-])|本项目|本仓库|此项目|该项目)`
  const ownSubject = new RegExp(`^\\s*(?:[-+>]\\s*)?(?:the\\s+)?(?:${current}|we)(?:\\s|$|基于|使用|依赖|源自|派生|移植|借鉴|构建)`, 'i')
  const consumers = new RegExp(`(?:\\b(?:projects?|applications?|tools?|libraries|consumers?)\\s+(?:that\\s+use|using|built\\s+(?:with|on)|based\\s+on)\\s+${current}|\\bdownstream\\s+(?:projects?|consumers?|users?)\\b|(?:使用|依赖|基于)${current}的(?:项目|应用)|下游(?:项目|应用))`, 'i')
  const consumesCurrent = new RegExp(`(?:\\b(?:uses?|depends?\\s+on|(?:is\\s+)?built\\s+(?:with|on)|(?:is\\s+)?based\\s+on)\\s+${current}|(?:使用|依赖|基于)${current})`, 'i')
  const usedByCurrent = new RegExp(`(?:\\b(?:is\\s+)?(?:used|consumed)\\s+by\\s+${current}|被${current}(?:使用|依赖))`, 'i')
  const heading = [...headings].reverse().find((value) => sectionKind(value.text))?.text.slice(0, 240) ?? ''
  const association = relatedCue.test(local) || relatedCue.test(heading) || kind === 'readme-related'
  if (negativeCue.test(local) || comparisonCue.test(local) || negativeCue.test(heading) || comparisonCue.test(heading)) return { relation: association ? 'related' : 'reference', relationReason: '局部语句包含否定或比较，未据此确认技术流向。' }
  const passiveConsumer = ownSubject.test(originalBefore) && /\b(?:is|was)\s+used\s+by\s+(?:the\s+)?$/i.test(originalBefore)
  const downstreamHeading = consumers.test(heading) || /^used\s+by$/i.test(heading.trim())
  const downstream = passiveConsumer || consumers.test(before) || consumesCurrent.test(after) || downstreamHeading
  const implicitSource = /^\s*(?:[-+>]\s*)?(?:(?:originally|partly|directly|heavily)\s+)?(?:based\s+on|(?:built|build)\s+(?:on|with|using)|(?:forked|ported|derived)\s+from|inspired\s+by|(?:code|source)\s+(?:was\s+)?(?:taken|copied|adapted)\s+from|基于|依赖|使用|源自|派生自|移植自|借鉴|(?:代码|源码)(?:取自|来自|改编自))/i
  // Consumer headings contain "using" too; that word must not also imply upstream.
  const upstream = (!consumers.test(before) && (ownSubject.test(before) || implicitSource.test(before)) && upstreamCue.test(before)) || usedByCurrent.test(after) || (!downstreamHeading && (implicitSource.test(heading) || /^(?:dependencies|依赖(?:项目)?)$/i.test(heading.trim())))
  if (upstream && downstream) return { relation: 'ambiguous', relationReason: '局部声明同时支持上游与下游，方向存在冲突。' }
  if (upstream) return { relation: 'upstream', relationReason: '局部语句明确声明当前项目基于、使用或借鉴该项目。' }
  if (downstream) return { relation: 'downstream', relationReason: '局部语句或下游项目标题明确声明该项目使用当前项目。' }
  if (association) return { relation: 'related', relationReason: 'README 将该项目列为关联项目、替代方案或延伸阅读。' }
  return { relation: 'reference', relationReason: ['credit', 'citation', 'copyright'].includes(kind) ? '归属或引用声明提供项目地址，未明确声明技术流向。' : 'README 提供项目链接，未明确声明技术流向。' }
}

function htmlAnchors(value) {
  return [...value.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>(?:([\s\S]*?)<\/a\s*>)?/gi)].map((match) => ({ url: match[1] ?? match[2], start: match.index, end: match.index + match[0].length, label: (match[3] ?? '').replace(/<[^>]*>/g, ''), image: /<img\b/i.test(match[3] ?? '') }))
}

function upperBound(values, offset) {
  let left = 0
  let right = values.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (values[middle] <= offset) left = middle + 1
    else right = middle
  }
  return left
}

function lineLookup(value, startLine) {
  const newlines = [...value.matchAll(/\n/g)].map((match) => match.index)
  return (offset) => startLine + upperBound(newlines, offset - 1)
}

function rangeLookup(ranges) {
  const merged = []
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (merged.length && range.start <= merged.at(-1).end) merged.at(-1).end = Math.max(merged.at(-1).end, range.end)
    else merged.push({ start: range.start, end: range.end })
  }
  const starts = merged.map((range) => range.start)
  return (offset) => {
    const range = merged[upperBound(starts, offset) - 1]
    return Boolean(range && offset < range.end)
  }
}

function scopeContexts(occurrences, content) {
  const groups = new Map()
  for (const occurrence of occurrences) {
    if (!groups.has(occurrence.scope)) groups.set(occurrence.scope, [])
    groups.get(occurrence.scope).push(occurrence)
  }
  const result = new Map()
  for (const [scope, siblings] of groups) {
    const chunks = []
    let cursor = scope.position.start.offset
    for (const item of siblings.sort((a, b) => a.start - b.start)) {
      chunks.push(content.slice(cursor, item.start), `\u0000${item.index}\u0000`)
      cursor = item.end
    }
    chunks.push(content.slice(cursor, scope.position.end.offset))
    const text = chunks.join('').replace(/\r?\n/g, ' ').replace(/<\/(?:p|li|tr|div|h[1-6])\s*>|<br\s*\/?\s*>/gi, ';').replace(/<[^>]*>/g, '').replace(/&(?:amp|quot|apos|lt|gt|#39);/g, ' ').replace(/[*_~`]/g, '')
    const positions = new Map([...text.matchAll(/\u0000(\d+)\u0000/g)].map((match) => [Number(match[1]), match.index]))
    result.set(scope, { text, positions })
  }
  return result
}

function linkContext(occurrence, occurrences, contexts) {
  const { text, positions } = contexts.get(occurrence.scope)
  const token = `\u0000${occurrence.index}\u0000`
  const marker = positions.get(occurrence.index)
  let left = marker
  let right = marker + token.length
  const boundary = (index) => /[!?。！？;]/.test(text[index]) || (text[index] === '.' && (index + 1 === text.length || /\s/.test(text[index + 1])))
  // Direction rules intentionally inspect at most a short local sentence window.
  while (left > Math.max(0, marker - 400) && !boundary(left - 1)) left--
  while (right < Math.min(text.length, marker + token.length + 400) && !boundary(right)) right++
  const sentence = text.slice(left, right).trim()
  return {
    relationText: sentence.replace(/\u0000(\d+)\u0000/g, (_, index) => Number(index) === occurrence.index ? '\uE000' : '\uE001'),
    excerpt: sentence.replace(/\u0000(\d+)\u0000/g, (_, index) => occurrences[Number(index)].label || occurrences[Number(index)].url),
  }
}

export function extractReadme(readme, rootFullName) {
  if (!readme || typeof readme.content !== 'string') return { references: [], people: [] }
  const tree = parser.parse(readme.content)
  const definitions = new Map()
  walk(tree, (node) => { if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node.url) })
  const references = new Map()
  const people = new Map()
  const headings = []
  const root = rootFullName.toLowerCase()
  function addPerson(login, node, excerpt) {
    if (!ownerPattern.test(login) || login.toLowerCase().endsWith('-bot')) return
    const key = login.toLowerCase()
    if (!people.has(key)) people.set(key, { login, evidence: [] })
    people.get(key).evidence.push({ kind: 'readme-maintainer', url: lineUrl(readme.html_url, node.position?.start.line), label: 'README 明确列出的维护者或作者', excerpt: compact(excerpt), person: login })
  }
  function addLink(url, node, context, kind, relation, line, image, linkLabel) {
    if (image) return
    if ((node.children ?? []).some((child) => ['image', 'imageReference'].includes(child.type))) return
    if (/badge|build\s+status|codecov|coverage|license\s+badge/i.test(linkLabel ?? textOf(node)) || /\/(?:actions\/workflows\/[^?#]+\/badge\.svg|workflows\/[^?#]+\/badge\.svg)/i.test(url)) return
    const target = repositoryFromUrl(url)
    if (target && target.id !== root) {
      const evidenceKind = ['credit', 'citation', 'copyright', 'readme-related'].includes(kind) ? kind : 'readme-reference'
      if (!references.has(target.id)) references.set(target.id, { ...target, evidence: [] })
      references.get(target.id).evidence.push({ kind: evidenceKind, url: lineUrl(readme.html_url, line ?? node.position?.start.line), label: evidenceLabels[evidenceKind], excerpt: compact(context), targetUrl: `https://github.com/${target.fullName}`, ...relation })
    }
    if (kind === 'readme-maintainer') {
      try {
        const parsed = new URL(url)
        const parts = parsed.pathname.split('/').filter(Boolean)
        if (parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'github.com' && parts.length === 1 && !navigation.has(parts[0].toLowerCase())) addPerson(parts[0], node, context)
      } catch { /* An ordinary non-URL link is not a person. */ }
    }
  }
  for (const block of tree.children) {
    if (block.type === 'heading') {
      while (headings.length && headings.at(-1).depth >= block.depth) headings.pop()
      headings.push({ depth: block.depth, kind: sectionKind(textOf(block)), text: textOf(block) })
    }
    const kind = [...headings].reverse().find((heading) => heading.kind)?.kind
    const occurrences = []
    const personMentions = []
    function collect(node, ancestors = []) {
      if (['image', 'imageReference', 'definition'].includes(node.type)) return
      const scope = [...ancestors].reverse().find((parent) => parent.type === 'tableRow') ?? [...ancestors].reverse().find((parent) => ['paragraph', 'heading'].includes(parent.type)) ?? node
      const add = (url, details = {}) => occurrences.push({ node, url, label: textOf(node), start: node.position.start.offset, end: node.position.end.offset, line: node.position.start.line, scope, index: occurrences.length, ...details })
      if (node.type === 'link' || node.type === 'linkReference') {
        const url = node.type === 'link' ? node.url : definitions.get(node.identifier.toLowerCase())
        if (url) add(url)
        return
      }
      if (node.type === 'html') {
        const lineAt = lineLookup(node.value, node.position.start.line)
        const opaque = [...node.value.matchAll(/<(?:pre|code|script|style)\b[^>]*>[\s\S]*?<\/(?:pre|code|script|style)\s*>|<!--[\s\S]*?-->/gi)].map((match) => ({ start: match.index, end: match.index + match[0].length }))
        const isOpaque = rangeLookup(opaque)
        const anchors = htmlAnchors(node.value).filter((anchor) => !isOpaque(anchor.start))
        for (const anchor of anchors) add(anchor.url, { start: node.position.start.offset + anchor.start, end: node.position.start.offset + anchor.end, line: lineAt(anchor.start), label: anchor.label, image: anchor.image })
        if (['credit', 'citation', 'copyright', 'readme-related'].includes(kind)) {
          const isExcluded = rangeLookup([...anchors, ...opaque, ...[...node.value.matchAll(/<[^>]*>/gi)].map((match) => ({ start: match.index, end: match.index + match[0].length }))])
          let cursor = 0
          for (const value of githubUrls(node.value)) {
            const offset = node.value.indexOf(value, cursor)
            cursor = offset + value.length
            if (isExcluded(offset)) continue
            add(value, { start: node.position.start.offset + offset, end: node.position.start.offset + offset + value.length, line: lineAt(offset), label: value })
          }
        }
      }
      // Citation formats are data; arbitrary fenced snippets remain outside extraction.
      if (node.type === 'code' && kind === 'citation' && /^(?:bibtex|biblatex)$/i.test(node.lang ?? '')) {
        const raw = readme.content.slice(node.position.start.offset, node.position.end.offset)
        const lineAt = lineLookup(raw, node.position.start.line)
        let cursor = 0
        for (const value of githubUrls(raw)) {
          const offset = raw.indexOf(value, cursor)
          cursor = offset + value.length
          add(value, { start: node.position.start.offset + offset, end: node.position.start.offset + offset + value.length, line: lineAt(offset), label: value, code: true })
        }
      }
      if (kind === 'readme-maintainer' && node.type === 'text') {
        for (const match of node.value.matchAll(/(?:^|[\s(])@([a-zA-Z0-9-]{1,39})(?![\w/@.-])/g)) personMentions.push({ login: match[1], node, excerpt: textOf(scope), start: node.position.start.offset + match.index })
      }
      if (node.type !== 'code') for (const child of node.children ?? []) collect(child, [...ancestors, node])
    }
    collect(block)
    const contexts = scopeContexts(occurrences, readme.content)
    for (const occurrence of [...occurrences, ...personMentions].sort((a, b) => a.start - b.start)) {
      if (occurrence.login) { addPerson(occurrence.login, occurrence.node, occurrence.excerpt); continue }
      const context = linkContext(occurrence, occurrences, contexts)
      const heading = [...headings].reverse().find((item) => item.kind)?.text
      const excerpt = heading && occurrence.node.type !== 'heading' ? `${heading}: ${context.excerpt}` : context.excerpt
      addLink(occurrence.url, occurrence.node, excerpt, kind, inferReadmeRelation(context.relationText, headings, kind, rootFullName, occurrence.code), occurrence.line, occurrence.image, occurrence.label)
    }
  }
  const priority = (reference) => Math.min(...reference.evidence.map((item) => referencePriority[item.kind]))
  return { references: [...references.values()].sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id, 'en')), people: [...people.values()] }
}

export function extractCodeowners(content, url) {
  const people = new Map()
  for (const [index, raw] of String(content).split(/\r?\n/).entries()) {
    const line = raw.replace(/(?<!\\)#.*$/, '').trim()
    if (!line || line.startsWith('!')) continue
    for (const item of line.split(/\s+/).slice(1)) {
      if (!/^@[a-zA-Z0-9-]{1,39}$/.test(item)) continue
      const login = item.slice(1)
      const key = login.toLowerCase()
      if (!people.has(key)) people.set(key, { login, evidence: [] })
      people.get(key).evidence.push({ kind: 'codeowner', url: lineUrl(url, index + 1), label: 'CODEOWNERS 中的个人负责人', excerpt: compact(line), person: login })
    }
  }
  return [...people.values()]
}

function githubUrls(text) {
  return String(text).match(/(?:git\+)?(?:https?|git|ssh):\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+(?:\.git)?(?:[^\s"'<>),}\]]*)?|git@github\.com:[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+(?:\.git)?|github:[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+/gi) ?? []
}

export function extractDependencies(path, content, url, rootFullName) {
  const lines = String(content).split(/\r?\n/)
  const selected = []
  if (path === 'package.json') {
    let value
    try { value = JSON.parse(content) } catch { return [] }
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(value[key] ?? {})) {
        if (typeof version !== 'string') continue
        const line = lines.findIndex((item) => item.includes(JSON.stringify(name)) && item.includes(version)) + 1
        selected.push({ text: version, line, excerpt: `${name}: ${version}` })
      }
    }
  } else {
    let section = ''
    let dependencyArray = false
    lines.forEach((text, index) => {
      if (text.trim().startsWith('#')) return
      text = text.replace(/\s+#.*$/, '')
      const trimmed = text.trim()
      const match = trimmed.match(/^\[([^\]]+)\]/)
      if (match) { section = match[1].toLowerCase(); dependencyArray = false }
      let allowed = false
      if (path === 'requirements.txt') allowed = Boolean(trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('--'))
      if (path === 'Cargo.toml') allowed = /(?:^|\.)(?:dev-|build-)?dependencies(?:\.|$)/.test(section) && /\bgit\s*=/.test(text)
      if (path === 'pyproject.toml') {
        if (section === 'project' && /^dependencies\s*=\s*\[/.test(trimmed)) dependencyArray = true
        allowed = dependencyArray || /^(?:project\.optional-dependencies|tool\.poetry(?:\.group\.[^.]+)?\.(?:dev-)?dependencies)(?:\.|$)/.test(section)
      }
      if (allowed) selected.push({ text, line: index + 1, excerpt: trimmed })
      if (dependencyArray && trimmed.includes(']')) dependencyArray = false
    })
  }
  const references = new Map()
  for (const entry of selected) {
    for (const value of githubUrls(entry.text)) {
      const target = repositoryFromUrl(value)
      if (!target || target.id === rootFullName.toLowerCase()) continue
      if (!references.has(target.id)) references.set(target.id, { ...target, evidence: [] })
      references.get(target.id).evidence.push({ kind: 'dependency', url: lineUrl(url, entry.line), label: `${path} 明确声明的 GitHub 依赖`, excerpt: compact(entry.excerpt), relation: 'upstream', relationReason: '依赖清单明确声明当前项目使用该 GitHub 项目。', targetUrl: `https://github.com/${target.fullName}` })
    }
  }
  return [...references.values()]
}

export function topicOverlap(root, candidate) {
  const a = normalizedTopics(root.topics)
  const b = normalizedTopics(candidate.topics)
  if (a.length) {
    const shared = a.filter((topic) => b.includes(topic))
    return { score: shared.length / new Set([...a, ...b]).size, shared, method: 'topics' }
  }
  if (typeof root.language === 'string' && root.language && typeof candidate.language === 'string' && root.language.toLowerCase() === candidate.language.toLowerCase()) return { score: 1, shared: [], method: 'language-fallback' }
  return { score: 0, shared: [], method: 'none' }
}

export function compareGraphNodes(a, b) {
  return a.tier - b.tier || b.overlap.score - a.overlap.score || b.repo.stargazers_count - a.repo.stargazers_count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
