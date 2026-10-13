import type { EvidenceKind, GraphEvidence, GraphRelation } from './types'

const ownerPattern = /^[a-zA-Z0-9-]{1,39}$/
const repoPattern = /^[a-zA-Z0-9_.-]{1,100}$/
const navigation = new Set(['about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features', 'issues', 'join', 'login', 'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls', 'readme', 'search', 'security', 'settings', 'site', 'sponsors', 'topics', 'trending', 'users'])
export interface GraphReference { id: string; fullName: string; evidence: GraphEvidence[] }
export interface PersonReference { login: string; evidence: GraphEvidence[] }
type Section = { depth: number; kind: EvidenceKind | null; text: string }

export function repositoryFromUrl(value: string): { id: string; fullName: string } | null {
  const text = value.trim().replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/').replace(/^github:/i, 'https://github.com/')
  let url: URL
  try { url = new URL(text) } catch { return null }
  if (!['https:', 'http:', 'git:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password) return null
  let parts: string[]
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent) } catch { return null }
  const owner = parts[0]
  const repo = parts[1]?.replace(/@[^/]*$/, '').replace(/\.git$/i, '')
  if (!ownerPattern.test(owner ?? '') || !repoPattern.test(repo ?? '') || ['.', '..'].includes(repo) || navigation.has(owner.toLowerCase())) return null
  if (parts.some((x) => x === '.' || x === '..' || /badge(?:s|\.svg)?$/i.test(x)) || /\/(?:actions\/workflows|workflows)\/.*badge\.svg/i.test(url.pathname)) return null
  return { id: `${owner}/${repo}`.toLowerCase(), fullName: `${owner}/${repo}` }
}

/** Inputs are repository names, never API URLs. */
export function parseRepoInput(value: string): string | null {
  const input = value.trim()
  if (/^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/.test(input)) return repositoryFromUrl(`https://github.com/${input}`)?.id ?? null
  if (!/^https?:\/\//i.test(input)) return null
  return repositoryFromUrl(input)?.id ?? null
}

const compact = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 300)
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const lineUrl = (url: string, line: number) => `${url.split('#')[0]}#L${line}`
const clean = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|apos|lt|gt|#39);/g, ' ').replace(/[*_~`]/g, '')
export const referencePriority: Partial<Record<EvidenceKind, number>> = { credit: 0, citation: 1, dependency: 2, copyright: 3, 'readme-reference': 4, 'readme-related': 5 }
export function sortReferences(references: GraphReference[]): GraphReference[] {
  const priority = (reference: GraphReference) => Math.min(...reference.evidence.map((item) => referencePriority[item.kind] ?? 9))
  return references.sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id, 'en'))
}

function sectionKind(text: string): EvidenceKind | null {
  if (/copyright|licen[cs]e|attributions?|版权|许可证?|许可协议|授权声明/i.test(text)) return 'copyright'
  if (/related|see\s+also|alternatives?|downstream|^used\s+by$|projects?\s+(?:using|that\s+use|built\s+with)|相关|关联项目|另见|类似项目|替代方案|下游/i.test(text)) return 'readme-related'
  if (/credits?|acknowledg|inspired\s+by|based\s+on|built\s+(?:on|with)|^dependencies$|(?:forked|ported|derived)\s+from|致谢|鸣谢|灵感|^依赖(?:项目)?$/i.test(text)) return 'credit'
  if (/citations?|references?|bibliograph|引用|参考/i.test(text)) return 'citation'
  if (/maintainers?|authors?|core\s+team|维护者|作者|开发者/i.test(text)) return 'readme-maintainer'
  return null
}

function inferRelation(context: string, heading: string, kind: EvidenceKind | null, root: string, citationCode = false): Pick<GraphEvidence, 'relation' | 'relationReason'> {
  const result = (relation: GraphRelation, relationReason: string) => ({ relation, relationReason })
  if (citationCode) return result('reference', '引用条目提供项目地址，未声明技术流向。')
  const marker = context.indexOf('\uE000')
  const originalBefore = context.slice(0, marker)
  let before = originalBefore
  let after = context.slice(marker + 1)
  const other = before.lastIndexOf('\uE001')
  if (other >= 0 && !/^(?:\s|[,、/&]|and\b|or\b|以及|和|及)*$/i.test(before.slice(other + 1))) before = ''
  const next = after.indexOf('\uE001')
  if (next >= 0) after = after.slice(0, next)
  const local = `${before}\uE000${after}`
  const current = `(?:(?:this\\s+(?:project|repository|repo|library|framework|package|tool|code)|our\\s+(?:project|library|framework|code)|${[root, root.split('/')[1]].map(escapePattern).join('|')})(?![\\w./-])|本项目|本仓库|此项目|该项目)`
  const ownSubject = new RegExp(`^\\s*(?:[-+>]\\s*)?(?:the\\s+)?(?:${current}|we)(?:\\s|$|基于|使用|依赖|源自|派生|移植|借鉴|构建)`, 'i')
  const consumers = new RegExp(`(?:\\b(?:projects?|applications?|tools?|libraries|consumers?)\\s+(?:that\\s+use|using|built\\s+(?:with|on)|based\\s+on)\\s+${current}|\\bdownstream\\s+(?:projects?|consumers?|users?)\\b|(?:使用|依赖|基于)${current}的(?:项目|应用)|下游(?:项目|应用))`, 'i')
  const consumesCurrent = new RegExp(`(?:\\b(?:uses?|depends?\\s+on|(?:is\\s+)?built\\s+(?:with|on)|(?:is\\s+)?based\\s+on)\\s+${current}|(?:使用|依赖|基于)${current})`, 'i')
  const usedByCurrent = new RegExp(`(?:\\b(?:is\\s+)?(?:used|consumed)\\s+by\\s+${current}|被${current}(?:使用|依赖))`, 'i')
  const implicitSource = /^\s*(?:[-+>]\s*)?(?:(?:originally|partly|directly|heavily)\s+)?(?:based\s+on|(?:built|build)\s+(?:on|with|using)|(?:forked|ported|derived)\s+from|inspired\s+by|(?:code|source)\s+(?:was\s+)?(?:taken|copied|adapted)\s+from|基于|依赖|使用|源自|派生自|移植自|借鉴|(?:代码|源码)(?:取自|来自|改编自))/i
  const upstreamCue = /\b(?:based\s+on|(?:built|build)\s+(?:on(?:\s+top\s+of)?|with|using)|(?:forked|ported|derived)\s+from|inspired\s+by|uses?|using|depends?\s+on|(?:code|source)\s+(?:was\s+)?(?:taken|copied|adapted)\s+from)\b|基于|构建[于在]|建立在|依赖|使用|源自|派生自|移植自|借鉴|(?:代码|源码)(?:取自|来自|改编自)|受.{0,20}启发/i
  if (/\b(?:not|never|without|no\s+longer)\b|(?:doesn|isn|wasn|aren)['’]t|不(?:再|是|会|依赖|使用|基于)|并未|没有|未曾|非(?:基于|依赖)|\b(?:rather\s+than|instead\s+of|unlike|versus|vs|compared\s+(?:with|to))\b|对比|相比|比较|不同于|而非|并非/i.test(`${local} ${heading}`)) return result('ambiguous', '局部语句包含否定或比较，需要人工核对技术关系。')
  const downstreamHeading = consumers.test(heading) || /^used\s+by$/i.test(heading.trim())
  const downstream = (ownSubject.test(originalBefore) && /\b(?:is|was)\s+used\s+by\s+(?:the\s+)?$/i.test(originalBefore)) || consumers.test(before) || consumesCurrent.test(after) || downstreamHeading
  const upstream = (!consumers.test(before) && (ownSubject.test(before) || implicitSource.test(before)) && upstreamCue.test(before)) || usedByCurrent.test(after) || (!downstreamHeading && (implicitSource.test(heading) || /^(?:dependencies|依赖(?:项目)?)$/i.test(heading.trim())))
  if (upstream && downstream) return result('ambiguous', '局部声明同时支持上游与下游，方向存在冲突。')
  if (upstream) return result('upstream', '局部语句明确声明当前项目基于、使用或借鉴该项目。')
  if (downstream) return result('downstream', '局部语句或下游项目标题明确声明该项目使用当前项目。')
  if (kind === 'readme-related' || /related|see\s+also|alternatives?|similar\s+projects?|相关|关联项目|另见|类似项目|替代方案/i.test(`${local} ${heading}`)) return result('related', 'README 将该项目列为关联项目或延伸阅读。')
  return result('reference', 'README 提供项目地址，未明确声明技术流向。')
}

interface Occurrence { url: string; start: number; end: number; label: string }
const githubPattern = /(?:git\+)?(?:https?|git|ssh):\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+(?:[^\s"'<>),}\]]*)?|git@github\.com:[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+(?:\.git)?|github:[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+/gi
const githubUrls = (text: string) => [...text.matchAll(githubPattern)].map((x) => ({ value: x[0].replace(/[.;:]+$/, ''), index: x.index }))

/** A small Markdown lexer preserves raw line offsets without fetching or executing links. */
export function extractReadme(content: string, root: string, url: string, path = 'README.md'): { references: GraphReference[]; people: PersonReference[] } {
  const lines = content.split(/\r?\n/)
  const sections: Section[] = []
  const headings: { kind: EvidenceKind | null; text: string; code: boolean; opaque: boolean; heading: boolean }[] = []
  let fence: { marker: string; citation: boolean } | null = null
  let comment = false
  let htmlOpaque: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})([^ ]*)/)
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/)
    const setext = i + 1 < lines.length && /^\s{0,3}(?:=+|-+)\s*$/.test(lines[i + 1]) && line.trim()
    if (!fence && !comment && !htmlOpaque && (heading || setext)) {
      const depth = heading ? heading[1].length : lines[i + 1].trim().startsWith('=') ? 1 : 2
      const text = clean(heading ? heading[2] : line).trim()
      while (sections.length && sections.at(-1)!.depth >= depth) sections.pop()
      sections.push({ depth, kind: sectionKind(text), text })
    }
    const section = [...sections].reverse().find((x) => x.kind)
    const htmlStart = line.match(/<(pre|code|script|style)\b/i)
    const opaque = comment || /<!--/.test(line) || Boolean(htmlOpaque || htmlStart)
    if (htmlStart) htmlOpaque = htmlStart[1].toLowerCase()
    if (htmlOpaque && new RegExp(`<\\/${htmlOpaque}\\s*>`, 'i').test(line)) htmlOpaque = null
    if (/<!--/.test(line)) comment = true
    if (/-->/.test(line)) comment = false
    headings.push({ kind: section?.kind ?? null, text: section?.text ?? '', code: Boolean(fence), opaque, heading: Boolean(heading || setext) })
    if (fenced) {
      if (fence && fenced[1][0] === fence.marker[0] && fenced[1].length >= fence.marker.length) fence = null
      else if (!fence) fence = { marker: fenced[1], citation: section?.kind === 'citation' && /^(bibtex|biblatex)$/i.test(fenced[2]) }
      headings[i].opaque = true
    } else if (fence && !fence.citation) headings[i].opaque = true
  }
  const definitions = new Map<string, string>()
  lines.forEach((line, i) => {
    const match = line.match(/^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/)
    if (match && !headings[i].opaque) definitions.set(match[1].toLowerCase().replace(/\s+/g, ' '), match[2])
  })
  const references = new Map<string, GraphReference>()
  const people = new Map<string, PersonReference>()
  function addPerson(login: string, line: number, excerpt: string) {
    if (!ownerPattern.test(login) || navigation.has(login.toLowerCase()) || /(?:-bot|\[bot\])$/i.test(login)) return
    const key = login.toLowerCase()
    if (!people.has(key)) people.set(key, { login, evidence: [] })
    people.get(key)!.evidence.push({ kind: 'readme-maintainer', url: lineUrl(url, line), label: 'README 明确列出的维护者或作者', excerpt: compact(excerpt), person: login, relation: 'related', relationReason: '维护者信息用于发现相关人员，不声明技术流向。', path, line })
  }
  // Paragraphs join wrapped Markdown while list/table rows retain their own subjects.
  for (let index = 0; index < lines.length;) {
    const startLine = index
    const state = headings[index]
    if (state.opaque || !lines[index].trim() || /^\s{0,3}\[[^\]]+\]:/.test(lines[index]) || (index > 0 && headings[index - 1].heading && /^\s{0,3}(?:=+|-+)\s*$/.test(lines[index]))) { index++; continue }
    let raw = lines[index++]
    while (!state.heading && index < lines.length && lines[index].trim() && !headings[index].opaque && !headings[index].heading && headings[index].text === state.text && !/^\s*(?:[-+*]\s|\d+[.)]\s|#{1,6}\s|\||<\/?(?:p|li|tr|div)\b)/.test(lines[index]) && !/^\s*(?:[-+*]\s|\d+[.)]\s|\|)/.test(raw) && !/^\s{0,3}\[[^\]]+\]:/.test(lines[index])) raw += `\n${lines[index++]}`
    const spans: { start: number; end: number }[] = []
    const occurrences: Occurrence[] = []
    const occupied = (start: number) => spans.some((x) => start >= x.start && start < x.end)
    const reserve = (start: number, end: number) => spans.push({ start, end })
    const add = (value: string, start: number, end: number, label: string, image = false) => {
      if (occupied(start)) return
      reserve(start, end)
      if (!image && !/badge|build\s+status|codecov|coverage/i.test(label)) occurrences.push({ url: value, start, end, label })
    }
    for (const match of raw.matchAll(/<(?:pre|code|script|style)\b[^>]*>[\s\S]*?<\/(?:pre|code|script|style)\s*>|<!--[\s\S]*?-->|`+[^`]*`+/gi)) if (!state.code) reserve(match.index, match.index + match[0].length)
    for (const match of raw.matchAll(/\[\s*!\[[^\]\[]*\](?:\([^)]*\)|\[[^\]\[]*\])\s*\](?:\([^)]*\)|\[[^\]\[]*\])/g)) reserve(match.index, match.index + match[0].length)
    for (const match of raw.matchAll(/!?\[([^\]\[\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) add(match[2], match.index, match.index + match[0].length, match[1], match[0].startsWith('!'))
    // Match the opening tag first: unclosed or repeated <a> tags cannot cause
    // repeated scans of the whole remaining README looking for a closing tag.
    for (const match of raw.matchAll(/<a\b[^<>]*\bhref\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')[^<>]*>/gi)) {
      const after = raw.slice(match.index + match[0].length, match.index + match[0].length + 4000)
      const next = after.search(/<a\b/i)
      const close = (next < 0 ? after : after.slice(0, next)).match(/^([\s\S]*?)<\/a\s*>/i)
      const label = close?.[1] ?? ''
      add(match[1] ?? match[2], match.index, match.index + match[0].length + (close?.[0].length ?? 0), clean(label), /<img\b/i.test(label))
    }
    for (const match of raw.matchAll(/!?\[([^\]\[]+)\](?:\[([^\]\[]*)\])?/g)) {
      const key = (match[2] || match[1]).toLowerCase().replace(/\s+/g, ' ')
      const value = definitions.get(key)
      if (value) add(value, match.index, match.index + match[0].length, match[1], match[0].startsWith('!'))
    }
    for (const match of raw.matchAll(/<[^>]+>/g)) if (!/^<https?:\/\/github\.com\//i.test(match[0])) reserve(match.index, match.index + match[0].length)
    for (const match of githubUrls(raw)) add(match.value, match.index, match.index + match.value.length, match.value)
    occurrences.sort((a, b) => a.start - b.start)
    let marked = ''; let cursor = 0
    occurrences.forEach((occurrence, i) => { marked += raw.slice(cursor, occurrence.start) + `\u0000${i}\u0000`; cursor = occurrence.end })
    marked += raw.slice(cursor)
    const text = clean(marked).replace(/\n/g, ' ')
    for (const [i, occurrence] of occurrences.entries()) {
      const line = startLine + 1 + raw.slice(0, occurrence.start).split('\n').length - 1
      if (state.kind === 'readme-maintainer') {
        try {
          const profile = new URL(occurrence.url)
          const parts = profile.pathname.split('/').filter(Boolean)
          if (profile.protocol === 'https:' && profile.hostname === 'github.com' && !profile.username && !profile.password && !profile.port && parts.length === 1) addPerson(parts[0], line, raw)
        } catch { /* Other links are ordinary references. */ }
      }
      const target = repositoryFromUrl(occurrence.url)
      if (!target || target.id === root.toLowerCase()) continue
      const token = `\u0000${i}\u0000`
      const marker = text.indexOf(token)
      let left = marker; let right = marker + token.length
      const boundary = (at: number) => /[!?。！？;]/.test(text[at]) || (text[at] === '.' && (at + 1 === text.length || /\s/.test(text[at + 1])))
      while (left > Math.max(0, marker - 400) && !boundary(left - 1)) left--
      while (right < Math.min(text.length, marker + token.length + 400) && !boundary(right)) right++
      const sentence = text.slice(left, right).trim()
      const relationText = sentence.replace(/\u0000(\d+)\u0000/g, (_, number: string) => Number(number) === i ? '\uE000' : '\uE001')
      const excerpt = sentence.replace(/\u0000(\d+)\u0000/g, (_, number: string) => occurrences[Number(number)].label)
      const kind = (['credit', 'citation', 'copyright', 'readme-related'].includes(state.kind ?? '') ? state.kind : 'readme-reference') as EvidenceKind
      if (!references.has(target.id)) references.set(target.id, { ...target, evidence: [] })
      references.get(target.id)!.evidence.push({ kind, url: lineUrl(url, line), label: ({ credit: 'README 技术致谢或灵感来源', citation: 'README 引用或参考来源', copyright: 'README 版权、许可或归属声明', 'readme-related': 'README 关联项目或延伸阅读' } as Partial<Record<EvidenceKind, string>>)[kind] ?? 'README 提及的项目', excerpt: compact(`${state.text ? `${state.text}: ` : ''}${excerpt}`), targetUrl: `https://github.com/${target.fullName}`, ...inferRelation(relationText, state.text, state.kind, root, state.code), path, line })
    }
    if (state.kind === 'readme-maintainer' && !state.code) for (const match of raw.matchAll(/(?:^|[\s(])@([a-zA-Z0-9-]{1,39})(?![\w/@.-])/g)) addPerson(match[1], startLine + 1 + raw.slice(0, match.index).split('\n').length - 1, raw)
  }
  return { references: sortReferences([...references.values()]), people: [...people.values()] }
}

export function extractCodeowners(content: string, url: string, path = 'CODEOWNERS'): PersonReference[] {
  const people = new Map<string, PersonReference>()
  content.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(?<!\\)#.*$/, '').trim()
    if (!line || line.startsWith('!')) return
    for (const item of line.split(/\s+/).slice(1)) {
      if (!/^@[a-zA-Z0-9-]{1,39}$/.test(item) || /-bot$/i.test(item)) continue
      const login = item.slice(1); const key = login.toLowerCase()
      if (!people.has(key)) people.set(key, { login, evidence: [] })
      people.get(key)!.evidence.push({ kind: 'codeowner', url: lineUrl(url, i + 1), label: 'CODEOWNERS 中的个人负责人', excerpt: compact(line), person: login, relation: 'related', relationReason: '代码负责人用于发现相关人员，不声明技术流向。', path, line: i + 1 })
    }
  })
  return [...people.values()]
}

export function extractDependencies(path: string, content: string, url: string, root: string): GraphReference[] {
  const lines = content.split(/\r?\n/)
  const selected: { text: string; line: number; excerpt: string }[] = []
  if (path === 'package.json') {
    let value: Record<string, unknown>
    try { value = JSON.parse(content) as Record<string, unknown> } catch { return [] }
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) continue
      for (const [name, version] of Object.entries(value[key] as Record<string, unknown>)) {
        if (typeof version !== 'string') continue
        const text = /^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+(?:#.*)?$/.test(version) ? `github:${version}` : version
        selected.push({ text, line: Math.max(1, lines.findIndex((item) => item.includes(JSON.stringify(name)) && item.includes(version)) + 1), excerpt: `${name}: ${version}` })
      }
    }
  } else {
    let section = ''; let dependencyArray = false
    lines.forEach((raw, i) => {
      if (raw.trim().startsWith('#')) return
      const text = raw.replace(/\s+#.*$/, ''); const trimmed = text.trim()
      const match = trimmed.match(/^\[([^\]]+)\]/)
      if (match) { section = match[1].toLowerCase(); dependencyArray = false }
      let allowed = false
      if (path === 'requirements.txt') allowed = Boolean(trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('-r ') && !trimmed.startsWith('-c '))
      if (path === 'Cargo.toml') allowed = /(?:^|\.)(?:dev-|build-)?dependencies(?:\.|$)/.test(section) && /\bgit\s*=/.test(text)
      if (path === 'pyproject.toml') {
        if (section === 'project' && /^dependencies\s*=\s*\[/.test(trimmed)) dependencyArray = true
        allowed = dependencyArray || /^(?:project\.optional-dependencies|tool\.poetry(?:\.group\.[^.]+)?\.(?:dev-)?dependencies|tool\.uv\.sources)(?:\.|$)/.test(section)
      }
      if (allowed) selected.push({ text, line: i + 1, excerpt: trimmed })
      if (dependencyArray && trimmed.includes(']')) dependencyArray = false
    })
  }
  const references = new Map<string, GraphReference>()
  for (const entry of selected) for (const value of githubUrls(entry.text)) {
    const target = repositoryFromUrl(value.value)
    if (!target || target.id === root.toLowerCase()) continue
    if (!references.has(target.id)) references.set(target.id, { ...target, evidence: [] })
    references.get(target.id)!.evidence.push({ kind: 'dependency', url: lineUrl(url, entry.line), label: `${path} 明确声明的 GitHub 依赖`, excerpt: compact(entry.excerpt), relation: 'upstream', relationReason: '依赖清单明确声明当前项目使用该 GitHub 项目。', targetUrl: `https://github.com/${target.fullName}`, path, line: entry.line })
  }
  return [...references.values()]
}
