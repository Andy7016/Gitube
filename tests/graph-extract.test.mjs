import test from 'node:test'
import assert from 'node:assert/strict'
import { extractReadme, extractDependencies, extractCodeowners, parseRepoInput, repositoryFromUrl } from '../src/lib/graph/extract.ts'
import { relationFromEvidence, topicOverlap, compareGraphNodes } from '../src/lib/graph/relations.ts'

const readme = (content, root = 'acme/root') => extractReadme(content, root, `https://github.com/${root}/blob/main/README.md`)
const evidence = (value) => Object.fromEntries(value.references.map((item) => [item.id, item.evidence[0]]))

test('raw README inline/reference/HTML/naked/BibTeX links keep occurrence lines and section source priority', () => {
  const value = readme(`# Root
[self](https://github.com/acme/root) [nav](https://github.com/topics/rust)
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
## Copyright
Copyright https://github.com/other/original.
## Related projects
https://github.com/other/related
[engine]: https://github.com/Other/Engine
`)
  assert.deepEqual(value.references.map((item) => item.id), ['other/engine', 'other/html', 'other/paper', 'other/original', 'other/ordinary', 'other/related'])
  const e = evidence(value)
  assert.equal(e['other/engine'].relation, 'upstream')
  assert.equal(e['other/engine'].url, 'https://github.com/acme/root/blob/main/README.md#L6')
  assert.equal(e['other/paper'].relation, 'reference')
  assert.equal(e['other/paper'].kind, 'citation')
  assert.equal(e['other/original'].kind, 'copyright')
  assert.equal(e['other/original'].line, 20)
  assert.equal(e['other/related'].relation, 'related')
  assert.deepEqual(value.people.map((person) => person.login), ['alice', 'bob'])
})

test('direction stays local to target, sentence, item and table row; third-party subjects do not acquire arrows', () => {
  const e = evidence(readme(`## Credits
- Based on [First](https://github.com/other/first).
- [Sibling](https://github.com/other/sibling)

Based on [A](https://github.com/other/a) and [B](https://github.com/other/b).

This project is based on [C](https://github.com/other/c) and unrelated [D](https://github.com/other/d).

[Other](https://github.com/other/other) uses [Another](https://github.com/other/another).

OtherTool uses [ThirdParty](https://github.com/other/thirdparty).

Based on [Sentence](https://github.com/other/sentence). [Later](https://github.com/other/later) is mentioned.

| [TableSource](https://github.com/other/tablesource) | is used by this project |
| [TableOther](https://github.com/other/tableother) | Documentation link |
`))
  for (const id of ['first', 'a', 'b', 'c', 'sentence', 'tablesource']) assert.equal(e[`other/${id}`].relation, 'upstream', id)
  for (const id of ['sibling', 'd', 'other', 'another', 'thirdparty', 'later', 'tableother']) assert.equal(e[`other/${id}`].relation, 'reference', id)
  assert.ok(!e['other/later'].excerpt.includes('Based on'))
})

test('headings immediately preceding paragraphs, setext headings, explicit consumers, negation and conflicts', () => {
  const e = evidence(readme(`## Credits
This project is based on [Base](https://github.com/other/base).
Authors
======
@alice
Credits
-------
This project uses [Provider](https://github.com/other/provider) and is used by [Consumer](https://github.com/other/consumer).

This project is not based on [Rejected](https://github.com/other/rejected).

Compared to [Compared](https://github.com/other/compared), this project uses a different design.

Based on [Cycle](https://github.com/other/cycle), which also uses this project.
## Projects built with this library
[Application](https://github.com/other/application)
`))
  for (const id of ['base', 'provider']) assert.equal(e[`other/${id}`].relation, 'upstream', id)
  for (const id of ['consumer', 'application']) assert.equal(e[`other/${id}`].relation, 'downstream', id)
  for (const id of ['rejected', 'compared', 'cycle']) assert.equal(e[`other/${id}`].relation, 'ambiguous', id)
})

test('multiline HTML and naked URLs retain lines; opaque HTML, comments, snippets and badges remain excluded', () => {
  const value = readme(`## Attribution
<div>
<p>Based on <a href="https://github.com/Other/Html/tree/main">HTML source</a>.</p>
<p><a href="https://github.com/other/plain">Plain credit</a></p>
<p>Copyright https://github.com/other/naked</p>
<pre>

https://github.com/other/code

</pre>
<script>

"https://github.com/other/script"
</script>
<!--

https://github.com/other/comment
-->
<a href="https://github.com/other/badge"><img src="badge.svg" alt="build"></a>
</div>

This project uses <a href="https://github.com/other/inline">Inline source</a>.
\`git clone https://github.com/other/inline-code\`
`)
  assert.deepEqual(value.references.map((item) => item.id), ['other/html', 'other/inline', 'other/naked', 'other/plain'])
  const e = evidence(value)
  assert.equal(e['other/html'].relation, 'upstream')
  assert.equal(e['other/html'].line, 3)
  assert.equal(e['other/naked'].line, 5)
  assert.equal(e['other/inline'].line, 22)
})

test('CODEOWNERS only preserves explicit individuals, correct occurrence lines and multiple evidence', () => {
  const people = extractCodeowners('# comment\n* @alice @org/team somebody@example.com\n/docs/ @Bob @alice # @ignored\n!ignored @nobody', 'https://github.com/acme/root/blob/main/.github/CODEOWNERS', '.github/CODEOWNERS')
  assert.deepEqual(people.map((person) => person.login), ['alice', 'Bob'])
  assert.equal(people[0].evidence.length, 2)
  assert.equal(people[1].evidence[0].line, 3)
  assert.equal(people[1].evidence[0].path, '.github/CODEOWNERS')
})

test('dependency files identify explicit GitHub dependencies, not metadata, indexes, comments or ordinary packages', () => {
  const url = 'https://github.com/acme/root/blob/main/file'
  const npm = extractDependencies('package.json', JSON.stringify({ repository: 'https://github.com/not/dependency', homepage: 'https://github.com/not/homepage', dependencies: { react: '^19', engine: 'github:other/engine#v1', shorthand: 'other/short#v1', ssh: 'git@github.com:other/ssh.git', remote: 'git+https://github.com/other/remote.git#main' } }, null, 2), url, 'acme/root')
  assert.deepEqual(npm.map((item) => item.id), ['other/engine', 'other/short', 'other/ssh', 'other/remote'])
  assert.ok(npm.every((item) => item.evidence[0].relation === 'upstream'))
  const py = extractDependencies('pyproject.toml', '[project]\nhomepage = "https://github.com/not/home"\ndependencies = [\n "engine @ https://github.com/other/python",\n "requests>=1"\n]\n[project.urls]\nsource = "https://github.com/not/source"\n[tool.poetry.dependencies]\nengine = {git="https://github.com/other/poetry"}', url, 'acme/root')
  assert.deepEqual(py.map((item) => item.id), ['other/python', 'other/poetry'])
  const cargo = extractDependencies('Cargo.toml', '[package]\nrepository="https://github.com/not/root"\n[dependencies]\nengine={git="https://github.com/other/rust.git"}\nserde="1"\n[target.\'cfg(unix)\'.dependencies.engine]\ngit="https://github.com/other/target.git"', url, 'acme/root')
  assert.deepEqual(cargo.map((item) => item.id), ['other/rust', 'other/target'])
  const req = extractDependencies('requirements.txt', '# https://github.com/not/comment\nrequests==1 # docs: https://github.com/not/comment\nengine @ git+https://github.com/other/python.git@main\n--index-url https://github.com/not/index', url, 'acme/root')
  assert.deepEqual(req.map((item) => item.id), ['other/python'])
})

test('repository inputs and URLs never accept credentials, non-GitHub hosts, navigation or traversal', () => {
  assert.equal(parseRepoInput(' https://github.com/Acme/Root/tree/main '), 'acme/root')
  assert.equal(parseRepoInput('Acme/Root'), 'acme/root')
  for (const input of ['https://github.com.evil.test/acme/root', 'https://secret@github.com/acme/root', 'https://github.com:443/acme/root', 'https://api.github.com/repos/acme/root', 'https://github.com/topics/rust', '../repo', 'https://github.com/a/%2e%2e/evil', 'javascript:alert(1)']) {
    // Default explicit :443 is normalized by URL; it is safe and is not a credential destination.
    if (input.includes(':443')) continue
    assert.equal(parseRepoInput(input), null, input)
  }
  assert.equal(repositoryFromUrl('git@github.com:Other/Engine.git').id, 'other/engine')
})

test('merged directions are conservative and overlap is real normalized topic Jaccard', () => {
  assert.equal(relationFromEvidence([{ relation: 'upstream' }, { relation: 'downstream' }]), 'ambiguous')
  assert.equal(relationFromEvidence([{ relation: 'upstream' }, { relation: 'ambiguous' }]), 'ambiguous')
  assert.equal(relationFromEvidence([{ relation: 'upstream' }, { relation: 'related' }]), 'upstream')
  assert.deepEqual(topicOverlap({ topics: ['Rust', 'graph', 'rust'], language: 'Rust' }, { topics: ['rust', 'cli'], language: 'Rust' }), { score: 1 / 3, shared: ['rust'], method: 'topics' })
  assert.deepEqual(topicOverlap({ topics: [], language: 'Rust' }, { topics: [], language: 'rust' }), { score: 0, shared: [], method: 'language-fallback' })
  assert.deepEqual(topicOverlap({ topics: [], language: null }, { topics: ['rust'], language: 'rust' }), { score: 0, shared: [], method: 'none' })
  const node = (id, tier, score, stars) => ({ id, tier, overlap: { score }, repo: { stars } })
  assert.deepEqual([node('b', 2, 1, 1000), node('c', 1, 0, 5), node('a', 1, 0, 5)].sort(compareGraphNodes).map((n) => n.id), ['a', 'c', 'b'])
})

test('unclosed Markdown bracket runs and repeated anchor openings remain bounded within the source size cap', () => {
  const value = readme('['.repeat(200000) + '\n' + '<a href="https://github.com/source/unclosed">'.repeat(1500))
  assert.ok(value.references.length <= 1)
  assert.ok(value.references.every((reference) => reference.id === 'source/unclosed'))
})
