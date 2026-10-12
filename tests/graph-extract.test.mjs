import test from 'node:test'
import assert from 'node:assert/strict'
import { compareGraphNodes, extractCodeowners, extractDependencies, extractReadme, normalizedTopics, repositoryFromUrl, topicOverlap } from '../server/graph-extract.mjs'

test('README AST retains credit/citation/reference evidence, reference links, HTML and BibTeX URLs without badge/navigation/self noise', () => {
  const content = `# Root
[Root](https://github.com/acme/root) [Navigation](https://github.com/topics/rust)
[![build](https://img.shields.io/badge/ok)](https://github.com/build/noise)
[ordinary](https://github.com/other/ordinary)
## Credits
Inspired by [Engine][engine].
### Details
<a href="https://github.com/other/html">HTML engine</a>
## Citation
\`\`\`bibtex
@software{source, url={https://github.com/other/paper}}
\`\`\`
## Authors
[Alice](https://github.com/alice), @bob; mail@example.com and @org/team
## Usage
\`\`\`sh
git clone https://github.com/other/example
\`\`\`
[engine]: https://github.com/Other/Engine
`
  const value = extractReadme({ content, html_url: 'https://github.com/acme/root/blob/main/README.md' }, 'acme/root')
  assert.deepEqual(value.references.map((item) => item.id), ['other/engine', 'other/html', 'other/paper', 'other/ordinary'])
  assert.equal(value.references[0].evidence[0].kind, 'credit')
  assert.match(value.references[0].evidence[0].url, /README\.md#L6$/)
  assert.equal(value.references[2].evidence[0].kind, 'citation')
  assert.equal(value.references[3].evidence[0].kind, 'readme-reference')
  assert.deepEqual(value.people.map((person) => person.login), ['alice', 'bob'])
  assert.ok(value.people.every((person) => person.evidence.every((item) => item.kind === 'readme-maintainer' && item.person === person.login)))
})

test('CODEOWNERS only identifies explicit personal handles with exact source lines', () => {
  const people = extractCodeowners('# comment\n* @alice @org/team somebody@example.com\n/docs/ @Bob @alice # @ignored\n!ignored @nobody', 'https://github.com/acme/root/blob/main/.github/CODEOWNERS')
  assert.deepEqual(people.map((value) => value.login), ['alice', 'Bob'])
  assert.equal(people[0].evidence.length, 2)
  assert.match(people[1].evidence[0].url, /#L3$/)
  assert.equal(people[1].evidence[0].person, 'Bob')
})

test('dependency extractors accept explicit GitHub dependency addresses only, never homepages or ordinary package names', () => {
  const root = 'acme/root'
  const url = 'https://github.com/acme/root/blob/main/package.json'
  const npm = extractDependencies('package.json', JSON.stringify({ repository: 'https://github.com/not/dependency', homepage: 'https://github.com/not/homepage', dependencies: { react: '^19', engine: 'github:other/engine#v1', ssh: 'git@github.com:other/ssh.git', remote: 'git+https://github.com/other/remote.git#main' } }, null, 2), url, root)
  assert.deepEqual(npm.map((item) => item.id), ['other/engine', 'other/ssh', 'other/remote'])
  assert.ok(npm.every((item) => item.evidence[0].kind === 'dependency'))
  assert.ok(npm.every((item) => item.evidence[0].relation === 'upstream' && item.evidence[0].targetUrl === `https://github.com/${item.fullName}` && item.evidence[0].relationReason.length <= 200))
  const python = extractDependencies('pyproject.toml', '[project]\nhomepage = "https://github.com/not/home"\ndependencies = [\n "engine @ https://github.com/other/python",\n "requests>=1"\n]\n[project.urls]\nsource = "https://github.com/not/source"\n[tool.poetry.dependencies]\nengine = {git="https://github.com/other/poetry"}', url, root)
  assert.deepEqual(python.map((item) => item.id), ['other/python', 'other/poetry'])
  const cargo = extractDependencies('Cargo.toml', '[package]\nrepository="https://github.com/not/root"\n[dependencies]\nengine={git="https://github.com/other/rust.git"}\nserde="1"', url, root)
  assert.deepEqual(cargo.map((item) => item.id), ['other/rust'])
  const requirements = extractDependencies('requirements.txt', '# https://github.com/not/comment\nrequests==1 # docs: https://github.com/not/comment\nengine @ git+https://github.com/other/python.git@main\n--index-url https://github.com/not/index', url, root)
  assert.deepEqual(requirements.map((item) => item.id), ['other/python'])
})

const readme = (content, root = 'acme/root') => extractReadme({ content, html_url: `https://github.com/${root}/blob/main/README.md` }, root)
const evidenceById = (value) => Object.fromEntries(value.references.map((item) => [item.id, item.evidence[0]]))

test('README related and copyright sections preserve canonical targets, exact lines and stable source priority', () => {
  const value = readme(`## See also
[Related](https://github.com/Other/Related/tree/main?tab=readme#intro)
## License and attribution
Copyright [Original](https://github.com/Other/Original/blob/main/LICENSE).
## Ordinary
[Ordinary](https://github.com/Other/Ordinary)
## References
[Paper](https://github.com/Other/Paper)
## Acknowledgements
[Credit](https://github.com/Other/Credit)
## 相关项目
[Alternative](https://github.com/other/alternative)
[self](https://github.com/acme/root)
`)
  assert.deepEqual(value.references.map((item) => item.id), ['other/credit', 'other/paper', 'other/original', 'other/ordinary', 'other/alternative', 'other/related'])
  const evidence = evidenceById(value)
  assert.equal(evidence['other/related'].kind, 'readme-related')
  assert.equal(evidence['other/related'].relation, 'related')
  assert.equal(evidence['other/related'].targetUrl, 'https://github.com/Other/Related')
  assert.equal(evidence['other/original'].kind, 'copyright')
  assert.equal(evidence['other/original'].relation, 'reference')
  assert.equal(evidence['other/original'].url, 'https://github.com/acme/root/blob/main/README.md#L4')
  assert.match(evidence['other/original'].excerpt, /License and attribution: Copyright Original/)
  for (const id of ['other/credit', 'other/paper', 'other/ordinary']) assert.equal(evidence[id].relation, 'reference')
  assert.ok(value.references.every((item) => item.evidence.every((evidence) => evidence.relationReason.length <= 200)))
})

test('README local source declarations support upstream while credit titles alone remain references', () => {
  const value = readme(`## Credits
- Based on [Base](https://github.com/other/base).
- This project depends on [Dependency](https://github.com/other/dependency).
- Code taken from [Source](https://github.com/other/source).
- 本项目移植自 [Port](https://github.com/other/port)。
- [Thanks](https://github.com/other/thanks)
## Inspired by
[Inspiration](https://github.com/other/inspiration)
## Dependencies
[Library](https://github.com/other/library)
## Built with
[Framework](https://github.com/other/framework)
`)
  const evidence = evidenceById(value)
  for (const id of ['base', 'dependency', 'source', 'port', 'inspiration', 'library', 'framework']) assert.equal(evidence[`other/${id}`].relation, 'upstream', id)
  assert.equal(evidence['other/thanks'].relation, 'reference')
  assert.ok(!evidence['other/thanks'].excerpt.includes('Code taken'))
})

test('README consumer headings and current-project passive clauses identify downstream independently of upstream', () => {
  const value = readme(`This project uses [Provider](https://github.com/other/provider) and is used by [Consumer](https://github.com/other/consumer).

This project is used by [Client](https://github.com/other/client).
## Projects built with this library
[Application](https://github.com/other/application)
## Downstream projects
[Downstream](https://github.com/other/downstream)
## Used by
[User](https://github.com/other/user)
`)
  const evidence = evidenceById(value)
  assert.equal(evidence['other/provider'].relation, 'upstream')
  for (const id of ['consumer', 'client', 'application', 'downstream', 'user']) assert.equal(evidence[`other/${id}`].relation, 'downstream', id)
})

test('README negation, comparisons and conflicting local direction remain conservative', () => {
  const value = readme(`This project is not based on [Rejected](https://github.com/other/rejected).

Compared to [Compared](https://github.com/other/compared), this project uses a different design.

Based on [Cycle](https://github.com/other/cycle), which also uses this project.

OtherTool uses [ThirdParty](https://github.com/other/thirdparty).

[Other](https://github.com/other/other) uses [Another](https://github.com/other/another).

[LongName](https://github.com/other/longname) uses rootkit.
`)
  const evidence = evidenceById(value)
  assert.equal(evidence['other/cycle'].relation, 'ambiguous')
  for (const id of ['rejected', 'compared', 'thirdparty', 'other', 'another', 'longname']) assert.equal(evidence[`other/${id}`].relation, 'reference', id)
})

test('README relation cues stay within the linked sentence, list item and table row', () => {
  const value = readme(`## Credits
- Based on [First](https://github.com/other/first).
- [Sibling](https://github.com/other/sibling)

Based on [Sentence](https://github.com/other/sentence). [Later](https://github.com/other/later) is also mentioned.

Based on [A](https://github.com/other/a) and [B](https://github.com/other/b).

| Project | Context |
| --- | --- |
| [TableSource](https://github.com/other/tablesource) | is used by this project |
| [TableOther](https://github.com/other/tableother) | Documentation link |
`)
  const evidence = evidenceById(value)
  for (const id of ['first', 'sentence', 'a', 'b', 'tablesource']) assert.equal(evidence[`other/${id}`].relation, 'upstream', id)
  for (const id of ['sibling', 'later', 'tableother']) assert.equal(evidence[`other/${id}`].relation, 'reference', id)
  assert.ok(!evidence['other/later'].excerpt.includes('Based on'))
  assert.ok(!evidence['other/tableother'].excerpt.includes('used by'))
})

test('README HTML anchors and naked attribution URLs retain independent context and exact occurrence lines', () => {
  const value = readme(`## Attribution
<div>
<p>Based on <a href="https://github.com/Other/Html/tree/main">HTML source</a>.</p>
<p><a href="https://github.com/other/plain">Plain credit</a></p>
<p>Copyright https://github.com/other/naked</p>
<pre>git clone https://github.com/other/code <a href="https://github.com/other/codelink">code link</a></pre>
<a href="https://github.com/other/badge"><img src="badge.svg" alt="build"></a>
</div>

This project uses <a href="https://github.com/other/inline">Inline source</a>.
`)
  const evidence = evidenceById(value)
  assert.deepEqual(value.references.map((item) => item.id), ['other/html', 'other/inline', 'other/naked', 'other/plain'])
  assert.equal(evidence['other/html'].relation, 'upstream')
  assert.equal(evidence['other/plain'].relation, 'reference')
  assert.equal(evidence['other/naked'].relation, 'reference')
  assert.equal(evidence['other/inline'].relation, 'upstream')
  assert.equal(evidence['other/html'].targetUrl, 'https://github.com/Other/Html')
  assert.match(evidence['other/html'].url, /#L3$/)
  assert.match(evidence['other/naked'].url, /#L5$/)
  assert.match(evidence['other/inline'].url, /#L10$/)
})

test('README reference links resolve at their use line and arbitrary code blocks do not become dependencies', () => {
  const value = readme(`## Credits
Based on [Engine][engine].
\`\`\`sh
git clone https://github.com/other/snippet
\`\`\`
## Citation
\`\`\`bibtex
@software{one, url={https://github.com/other/paper}}
@software{two, url={https://github.com/other/paper}}
\`\`\`
## License
\`\`\`text
Copyright https://github.com/other/example
\`\`\`
[engine]: https://github.com/Other/Engine.git#main
`.replace(/\n/g, '\r\n'))
  const evidence = evidenceById(value)
  assert.deepEqual(value.references.map((item) => item.id), ['other/engine', 'other/paper'])
  assert.equal(evidence['other/engine'].relation, 'upstream')
  assert.equal(evidence['other/engine'].targetUrl, 'https://github.com/Other/Engine')
  assert.match(evidence['other/engine'].url, /#L2$/)
  const paper = value.references.find((item) => item.id === 'other/paper')
  assert.deepEqual(paper.evidence.map((item) => item.url.split('#')[1]), ['L8', 'L9'])
  assert.ok(paper.evidence.every((item) => item.relation === 'reference'))
})

test('README dotted current repository names stay intact in source statements', () => {
  const value = readme('The llama.cpp project is build on top of the [ggml](https://github.com/ggml-org/ggml) library.', 'ggml-org/llama.cpp')
  assert.equal(value.references[0].evidence[0].relation, 'upstream')
  assert.match(value.references[0].evidence[0].excerpt, /^The llama\.cpp project/)
})

test('strict GitHub repository targets reject credentials, foreign hosts, encoded path injection and navigation', () => {
  for (const value of ['https://github.com.evil.test/acme/root', 'https://evil.test/acme/root', 'https://user:secret@github.com/acme/root', 'https://github.com/acme/..', 'https://github.com/acme/a%2Fb', 'https://github.com/topics/rust', 'javascript:alert(1)']) assert.equal(repositoryFromUrl(value), null, value)
  assert.equal(repositoryFromUrl('https://github.com/Acme/Engine.git/tree/main').id, 'acme/engine')
})

test('Jaccard topics and deterministic tiers preserve real overlap; language fallback only applies to untagged root', () => {
  assert.deepEqual(normalizedTopics(['Rust', 'rust', 'data-tools', 'bad topic', null]), ['data-tools', 'rust'])
  assert.deepEqual(topicOverlap({ topics: ['rust', 'cli'] }, { topics: ['RUST', 'web'] }), { score: 1 / 3, shared: ['rust'], method: 'topics' })
  assert.equal(topicOverlap({ topics: ['rust'], language: 'Rust' }, { topics: [], language: 'Rust' }).score, 0)
  assert.deepEqual(topicOverlap({ topics: [], language: 'Rust' }, { topics: ['web'], language: 'rust' }), { score: 1, shared: [], method: 'language-fallback' })
  const node = (id, tier, score, stars) => ({ id, tier, overlap: { score }, repo: { stargazers_count: stars } })
  const nodes = [node('b/z', 2, 1, 1000), node('b/b', 1, 0.5, 20), node('b/a', 1, 0.5, 20), node('b/c', 1, 0.5, 30), node('b/d', 1, 1, 1)]
  assert.deepEqual(nodes.sort(compareGraphNodes).map((item) => item.id), ['b/d', 'b/c', 'b/a', 'b/b', 'b/z'])
})
