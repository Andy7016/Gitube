// Browser acceptance using only public DOM/navigation/localStorage contracts.
// Every GitHub response is synthetic; no real credentials or account writes.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.GITUBE_PLAYWRIGHT_MODULE
  ?? 'C:/Users/17630/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const { chromium } = await import(pathToFileURL(modulePath).href)
const baseURL = new URL(process.env.GITUBE_TEST_URL ?? 'http://127.0.0.1:5173/')
baseURL.hash = ''
baseURL.search = ''
if (!baseURL.pathname.endsWith('/')) baseURL.pathname += '/'
const stage = process.env.GITUBE_TEST_STAGE ?? 'local-dev'
const output = resolve(process.env.GITUBE_SCREENSHOTS ?? `.scratch/acceptance/graph/${stage}`)
const expectedSourceSha = process.env.GITUBE_EXPECTED_SOURCE_SHA?.trim()
await mkdir(output, { recursive: true })
const result = {
  stage, baseURL: baseURL.href, fixtureOnly: true, browser: 'Chrome via Playwright',
  startedAt: new Date().toISOString(), checks: [], screenshots: [],
  requests: [], pageErrors: [], consoleErrors: [], fixtureErrors: [], failedRequests: [],
  unexpectedExternalRequests: [], credentialLeakRequests: [],
  counters: { github: 0, rest: 0, graphql: 0, searches: 0, feedSearches: 0, mutations: 0 },
  notCovered: ['Real GitHub credentials, OAuth, and account writes', 'Native desktop installers',
    'Live GitHub rate limits and network variability (covered with bounded engine fixtures separately)'],
  status: 'running',
}
let browser
let page
let failRoot = false
let failRootSources = false
let slowRelease
const slowGate = new Promise((resolve) => { slowRelease = resolve })
const slowPaths = new Set()
const expectedAborts = new WeakSet()
const textAttack = '<img src="https://malicious.invalid/leak" onerror="window.__graphInjected=true">'
const readmes = {
  root: `# Provenance fixture

## Upstream
Built on [Upstream](https://github.com/fixture-labs/upstream). ${textAttack}

## Downstream
[Downstream](https://github.com/fixture-labs/downstream) uses this project.

## References
See [Reference](https://github.com/fixture-labs/reference) for documentation.

## Related projects
Alternative [Sibling](https://github.com/fixture-labs/sibling).

## Attribution
Copyright [Archive](https://github.com/fixture-labs/credit).

## Conflicting evidence
Built on [Conflict](https://github.com/fixture-labs/conflict).
[Conflict](https://github.com/fixture-labs/conflict) depends on this project.

## Maintainers
Maintained by [fixture-alex](https://github.com/fixture-alex).

[Untrusted external input](https://malicious.invalid/leak)
<script>window.__graphInjected=true</script>
`,
  upstream: '# Expanded branch\nBuilt on [Root](https://github.com/fixture-labs/root).\nBuilt on [Shared](https://github.com/fixture-labs/shared).\nBuilt on [Deep leaf](https://github.com/fixture-labs/deep-leaf).\n',
  'detail-root': '# Detail fixture\nBuilt on [Detail child](https://github.com/fixture-labs/detail-child).\n',
}
const restRepo = (name, owner = 'fixture-labs') => ({
  id: `${owner}/${name}`, name, full_name: `${owner}/${name}`, private: false, visibility: 'public',
  html_url: `https://github.com/${owner}/${name}`, stargazers_count: 1234, forks_count: 23,
  topics: name === 'irrelevant' ? ['biology'] : name === 'topic-peer' ? ['frontend', 'react', 'typescript'] : ['frontend', 'react'],
  language: name === 'irrelevant' ? 'Python' : 'TypeScript',
  description: name === 'root' ? `Synthetic source graph. ${textAttack}` : `Synthetic ${name} repository`,
  owner: { login: owner, type: owner === 'fixture-labs' ? 'Organization' : 'User', avatar_url: '' },
  fork: false, archived: false,
})
const gqlRepo = (name, familiar = true, owner = 'fixture-labs') => ({
  id: `${owner}/${name}`, name, nameWithOwner: `${owner}/${name}`,
  description: '用于验收的公开项目与技术来源线索。', url: `https://github.com/${owner}/${name}`, homepageUrl: null,
  stargazerCount: 1200, forkCount: 80,
  primaryLanguage: { name: familiar ? 'TypeScript' : 'Python', color: familiar ? '#3178c6' : '#3572A5' },
  repositoryTopics: { nodes: (familiar ? ['frontend', 'react'] : ['python', 'data-science']).map((name) => ({ topic: { name } })) },
  owner: { __typename: 'Organization', id: owner, login: owner, avatarUrl: '' },
  pushedAt: '2026-10-10T00:00:00Z', createdAt: '2024-01-01T00:00:00Z', viewerHasStarred: false,
  usesCustomOpenGraphImage: false, openGraphImageUrl: '', isArchived: false,
  licenseInfo: { spdxId: 'MIT' }, defaultBranchRef: { name: 'main' },
})
const file = (path, content) => ({ path, name: path.split('/').at(-1), encoding: 'base64', content: Buffer.from(content).toString('base64'), size: Buffer.byteLength(content) })
const routeURL = (hash) => new URL(`#${hash}`, baseURL).href
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, details = {}) => result.checks.push({ name, status: 'passed', ...details })
const screenshot = async (name, fullPage = false) => {
  const path = resolve(output, `${name}.png`)
  await page.screenshot({ path, fullPage })
  result.screenshots.push(relative(process.cwd(), path).replaceAll('\\', '/'))
}
const graph = () => page.locator('[data-graph-root]').first()
const nodes = () => graph().locator('[data-node-id]')
const panel = () => graph().locator('aside[aria-label="节点来源"]')
const selectNode = async (id) => {
  await graph().getByRole('tab', { name: /^节点/ }).click()
  await graph().getByRole('button', { name: `选择 ${id}`, exact: true }).click()
  await graph().getByRole('tab', { name: '来源', exact: true }).click()
}
const waitForFixture = async (path) => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !result.requests.some((r) => r.path === path)) await sleep(25)
  assert.ok(result.requests.some((r) => r.path === path), `Expected fixture request within 5 seconds: ${path}`)
}
const ready = async (root) => {
  await page.waitForFunction((root) => {
    const g = [...document.querySelectorAll('[data-graph-root]')].find((g) => g.getAttribute('data-graph-root') === root)
    return g && g.getAttribute('data-graph-status') === 'ready'
  }, root)
}
const nodeIDs = () => graph().locator('[data-node-id]').evaluateAll((elements) => [...new Set(elements.map((e) => e.getAttribute('data-node-id')))].sort())
const camera = () => graph().locator('svg[data-camera]').getAttribute('data-camera')
const assertCameraRestored = (actual, expected) => {
  const a = actual.split(',').map(Number), b = expected.split(',').map(Number)
  assert.ok(Math.abs(a[0] - b[0]) <= .01 && Math.abs(a[1] - b[1]) <= .01 && Math.abs(a[2] - b[2]) <= Math.abs(b[2]) * .001,
    `Camera differs beyond subpixel/0.1% resize rounding: ${actual} vs ${expected}`)
}
const selection = () => graph().getAttribute('data-selected-node')
const requestCount = () => result.counters.rest
const goHash = async (hash) => page.evaluate((hash) => { location.hash = hash }, hash)
const submitRoot = async (value) => {
  await page.getByRole('textbox', { name: 'GitHub 仓库', exact: true }).fill(value)
  await page.getByRole('button', { name: '分析图谱', exact: true }).click()
}

try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => {
    if (!localStorage.getItem('gitube:token')) localStorage.setItem('gitube:token', 'graph-fixture-token-a')
    if (!localStorage.getItem('gitube:viewer')) localStorage.setItem('gitube:viewer', JSON.stringify({ id: 'graph-fixture-a', login: 'graph-fixture-a', name: '图谱验收账号 A', avatarUrl: '' }))
    for (const login of ['graph-fixture-a', 'graph-fixture-b']) {
      if (!localStorage.getItem(`gitube:library:${login}`)) localStorage.setItem(`gitube:library:${login}`, JSON.stringify({ version: 1, onboarded: true, interests: ['frontend', 'rust'], followingWeights: {}, recommendationMode: 'normal' }))
    }
    if (!localStorage.getItem('gitube:theme')) localStorage.setItem('gitube:theme', 'light')
  })
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = request.headers()
    if (url.origin !== 'https://api.github.com' && headers.authorization) result.credentialLeakRequests.push(url.href)
    if (url.origin === baseURL.origin) return route.continue()
    if (url.hostname === 'github.com') return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Isolated evidence-link fixture</h1>' })
    if (url.origin !== 'https://api.github.com') {
      result.unexpectedExternalRequests.push(url.href)
      return route.abort('blockedbyclient')
    }
    result.counters.github++
    if (failRootSources && url.pathname.startsWith('/repos/fixture-labs/root/')) expectedAborts.add(request)
    const log = { path: url.pathname + url.search, method: request.method(), accept: headers.accept ?? '', account: headers.authorization === 'Bearer graph-fixture-token-b' ? 'B' : 'A' }
    result.requests.push(log)
    const respond = async (body, status = 200, contentType = 'application/json', responseHeaders = {}) => {
      log.responseStatus = status
      try { await route.fulfill({ status, contentType, headers: responseHeaders, body: contentType === 'application/json' ? JSON.stringify(body) : body }) }
      catch (error) {
        if (!slowPaths.has(url.pathname) && !expectedAborts.has(request)) throw error
        log.finishedAfterAbort = true
      }
    }
    try {
      if (url.pathname === '/graphql') {
        result.counters.graphql++
        const { query, variables = {} } = request.postDataJSON()
        let data
        if (query.includes('mutation')) {
          result.counters.mutations++
          throw new Error('Account mutation attempted in isolated acceptance')
        } else if (query.includes('following(first:')) {
          data = { viewer: { following: { nodes: [] } } }
        } else if (query.includes('starredRepositories(first: 100')) {
          data = { viewer: { starredRepositories: { nodes: [] }, repositories: { nodes: [] } } }
        } else if (query.includes('repository(owner:')) {
          data = { repository: { ...gqlRepo(variables.name, true, variables.owner), watchers: { totalCount: 10 }, issues: { totalCount: 3 }, latestRelease: null } }
        } else if (query.includes('s0: search')) {
          const generation = ++result.counters.searches
          const keys = Object.keys(variables).filter((key) => /^q\d+$/.test(key))
          if (keys.length > 2) result.counters.feedSearches++
          data = Object.fromEntries(keys.map((key) => {
            const i = Number(key.slice(1))
            const familiar = /topic:(frontend|react|vue)/.test(variables[key]) && !/-topic:(frontend|react|vue)/.test(variables[key])
            return [`s${i}`, { repositoryCount: 1000, pageInfo: { endCursor: `fixture-${generation}-${i}`, hasNextPage: true }, nodes: Array.from({ length: 12 }, (_, j) => gqlRepo(`project-${generation}-${i}-${j}`, familiar)) }]
          }))
        } else if (query.includes('viewer { id login name avatarUrl')) {
          const b = headers.authorization === 'Bearer graph-fixture-token-b'
          data = { viewer: { id: b ? 'graph-fixture-b' : 'graph-fixture-a', login: b ? 'graph-fixture-b' : 'graph-fixture-a', name: b ? '图谱验收账号 B' : '图谱验收账号 A', avatarUrl: '' } }
        } else throw new Error(`Unhandled GraphQL fixture: ${String(query).slice(0, 120)}`)
        return respond({ data })
      }
      assert.equal(request.method(), 'GET', 'Graph REST must be read-only')
      result.counters.rest++
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (segments[0] === 'repos') {
        const [, owner, name, kind, ...tail] = segments
        if (!kind) {
          if (name.startsWith('slow')) { slowPaths.add(url.pathname); await slowGate }
          if (name === 'root' && failRoot) return respond({ message: 'Synthetic root refresh failure' }, 503)
          return respond(restRepo(name, owner))
        }
        if (kind === 'readme') {
          if (headers.accept?.includes('html')) return respond('<h1>Fixture README</h1><p>Browser-only fixture. No live GitHub data.</p>', 200, 'text/html')
          if (name === 'root' && failRootSources) return respond({ message: 'API rate limit exceeded for synthetic fixture' }, 403, 'application/json', { 'x-ratelimit-remaining': '0' })
          return respond(file('README.md', readmes[name] ?? '# Fixture with no direct source links\n'))
        }
        if (kind === 'contents') {
          const path = tail.join('/')
          if (name === 'root' && path === 'package.json') return respond(file(path, '{"dependencies":{"shared":"git+https://github.com/fixture-labs/shared.git#main"}}'))
          if (name === 'root' && path === '.github/CODEOWNERS') return respond(file(path, '* @fixture-alex\n'))
          return respond({ message: 'Not Found' }, 404)
        }
        if (kind === 'contributors') return respond(name === 'root' ? [{ login: 'fixture-alex', type: 'User', contributions: 7, avatar_url: '', html_url: 'https://github.com/fixture-alex' }] : [])
      }
      if (segments[0] === 'users') {
        const [, login, kind] = segments
        if (!kind) return respond({ login, type: 'User', avatar_url: '', html_url: `https://github.com/${login}` })
        if (kind === 'repos') return respond(login === 'fixture-alex' ? [restRepo('topic-peer', login), restRepo('irrelevant', login)] : [])
      }
      throw new Error(`Unhandled REST fixture: ${url.pathname}`)
    } catch (error) {
      result.fixtureErrors.push(error.message)
      return respond({ message: error.message }, 500)
    }
  })
  page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => result.pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()) })
  page.on('requestfailed', (request) => result.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText, expectedRateAbort: expectedAborts.has(request) }))
  const response = await page.goto(routeURL('/graph'), { waitUntil: 'networkidle' })
  assert.ok(response?.ok())
  if (expectedSourceSha) {
    assert.match(expectedSourceSha, /^[0-9a-f]{40}$/i)
    const manifest = await page.evaluate(async (url) => (await fetch(url)).json(), new URL('preview-source.json', baseURL).href)
    assert.equal(manifest.sourceSha, expectedSourceSha)
    check('preview source SHA matches expected commit', { sourceSha: manifest.sourceSha })
  }
  await page.getByRole('textbox', { name: 'GitHub 仓库', exact: true }).waitFor()
  await submitRoot('https://malicious.invalid/leak')
  await page.getByRole('alert').waitFor()
  assert.equal(requestCount(), 0)
  await submitRoot('https://github.com/fixture-labs/root.git')
  await ready('fixture-labs/root')
  const rootIDs = await nodeIDs()
  assert.ok(rootIDs.includes('fixture-labs/upstream'), JSON.stringify(rootIDs))
  assert.ok(rootIDs.includes('fixture-labs/shared'), JSON.stringify(rootIDs))
  assert.ok(rootIDs.includes('fixture-alex/topic-peer'), JSON.stringify(rootIDs))
  assert.ok(!rootIDs.includes('fixture-labs/deep-leaf'))
  const rawReadmes = result.requests.filter((r) => r.path.endsWith('/readme') && !r.accept.includes('html'))
  assert.deepEqual(rawReadmes.map((r) => r.path), ['/repos/fixture-labs/root/readme'])
  assert.ok(requestCount() <= 48)
  check('repository input rejects external URL locally and resolves GitHub URL; initial analysis is one level', { nodes: rootIDs, rawReadmes: rawReadmes.map((r) => r.path), restRequests: requestCount() })

  await graph().getByRole('tab', { name: /^节点/ }).click()
  const listButtons = graph().locator('.graph-node-list button')
  await listButtons.first().focus()
  await page.keyboard.press('End')
  assert.equal(await listButtons.last().getAttribute('aria-pressed'), 'true')
  await page.keyboard.press('Home')
  assert.equal(await listButtons.first().getAttribute('aria-pressed'), 'true')
  check('keyboard node list supports Home/End selection')

  await selectNode('fixture-labs/upstream')
  await panel().waitFor()
  const evidenceText = await panel().textContent()
  assert.match(evidenceText, /Built on/)
  assert.match(evidenceText, /README/)
  const evidenceLink = panel().locator('a[href*="README.md#L"]').first()
  await evidenceLink.waitFor()
  assert.match(await evidenceLink.getAttribute('href'), /^https:\/\/github\.com\/fixture-labs\/root\/blob\/[^/]+\/README\.md#L\d+/)
  const popupPromise = context.waitForEvent('page')
  await evidenceLink.click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  assert.match(popup.url(), /^https:\/\/github\.com\/fixture-labs\/root\/blob\//)
  await popup.close()
  await page.bringToFront()
  check('source evidence exposes original excerpt and file line; evidence link opens without credentials')

  const edgeSemantics = await graph().locator('[data-relation]').evaluateAll((edges) => edges.map((e) => {
    const source = e.getAttribute('data-source'), target = e.getAttribute('data-target'), relation = e.getAttribute('data-relation')
    const center = (id) => {
      const node = [...e.ownerSVGElement.querySelectorAll('[data-node-id]')].find((n) => n.getAttribute('data-node-id') === id)
      const circle = node.querySelector('circle:not(.graph-node__hit)')
      return { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }
    }
    const provider = center(relation === 'upstream' ? target : source), consumer = center(relation === 'upstream' ? source : target)
    const start = { x: Number(e.getAttribute('x1')), y: Number(e.getAttribute('y1')) }, end = { x: Number(e.getAttribute('x2')), y: Number(e.getAttribute('y2')) }
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
    return { relation, source, target, title: e.textContent, markerStart: e.getAttribute('marker-start'), markerEnd: e.getAttribute('marker-end'),
      startsAtProvider: distance(start, provider) < distance(start, consumer), endsAtConsumer: distance(end, consumer) < distance(end, provider) }
  }))
  const technical = edgeSemantics.filter((e) => e.relation === 'upstream' || e.relation === 'downstream')
  assert.ok(technical.length >= 2, JSON.stringify(edgeSemantics))
  assert.ok(technical.every((e) => e.markerStart || e.markerEnd), JSON.stringify(technical))
  assert.ok(technical.every((e) => e.startsAtProvider && e.endsAtConsumer), JSON.stringify(technical))
  const nondirectional = edgeSemantics.filter((e) => !['upstream', 'downstream'].includes(e.relation))
  assert.ok(nondirectional.length >= 2)
  assert.ok(nondirectional.every((e) => !e.markerStart && !e.markerEnd), JSON.stringify(nondirectional))
  assert.ok(edgeSemantics.some((e) => e.target === 'fixture-labs/conflict' && e.relation === 'ambiguous'))
  check('only upstream/downstream evidence has arrows; references/related/conflicting evidence has no arrow', { edges: edgeSemantics })

  await selectNode('fixture-labs/root')
  assert.ok((await panel().textContent()).includes(textAttack), 'Malicious repository text must be displayed literally')
  assert.equal(await page.evaluate(() => window.__graphInjected), undefined)
  assert.equal(await page.locator('img[src^="https://malicious.invalid"]').count(), 0)
  assert.equal(await page.evaluate(() => [...document.scripts].some((s) => s.textContent.includes('window.__graphInjected=true'))), false)
  assert.deepEqual(result.unexpectedExternalRequests, [])
  check('malicious descriptions and README input remain literal and never trigger an external fetch')
  await selectNode('fixture-labs/upstream')
  await graph().getByRole('button', { name: '放大', exact: true }).click()
  const svg = graph().locator('svg[data-camera]')
  const svgBox = await svg.boundingBox()
  await page.mouse.move(svgBox.x + 20, svgBox.y + 20)
  await page.mouse.down()
  await page.mouse.move(svgBox.x + 80, svgBox.y + 50, { steps: 4 })
  await page.mouse.up()
  const beforeCamera = await camera()
  const beforeSelected = await selection()
  await screenshot('graph-light')
  const beforeBackRequests = requestCount()
  await page.getByRole('link', { name: '偏好设置', exact: true }).first().click()
  await page.getByRole('radio', { name: '深色', exact: true }).click()
  await page.goBack()
  await ready('fixture-labs/root')
  assert.equal(requestCount(), beforeBackRequests)
  assertCameraRestored(await camera(), beforeCamera)
  assert.equal(await selection(), beforeSelected)
  await screenshot('graph-dark')
  check('browser back restores graph, selection, pan and zoom without any extra REST request', { camera: beforeCamera, selection: beforeSelected, extraRestRequests: 0 })

  const beforeExpansion = requestCount()
  await graph().getByRole('button', { name: '继续追溯', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-node-id]')].some((e) => e.getAttribute('data-node-id') === 'fixture-labs/deep-leaf'))
  await ready('fixture-labs/root')
  const expandedIDs = await nodeIDs()
  assert.equal(expandedIDs.filter((id) => id === 'fixture-labs/root').length, 1)
  assert.equal(expandedIDs.filter((id) => id === 'fixture-labs/shared').length, 1)
  assert.equal(expandedIDs.length, rootIDs.length + 1)
  assert.ok(requestCount() - beforeExpansion <= 48)
  assert.ok(!result.requests.some((r) => r.path === '/repos/fixture-labs/deep-leaf/readme'))
  check('manual expansion merges cycles/shared nodes and discovers one new level without recursion', { nodes: expandedIDs, expansionRestRequests: requestCount() - beforeExpansion })

  const rootBeforeCenter = await graph().getAttribute('data-graph-root')
  await graph().getByRole('button', { name: '选中居中', exact: true }).click()
  assert.equal(await graph().getAttribute('data-graph-root'), rootBeforeCenter)
  assert.deepEqual(await nodeIDs(), expandedIDs)
  const centeredCamera = await camera()
  await graph().getByRole('button', { name: '以此为新根', exact: true }).click()
  await ready('fixture-labs/upstream')
  assert.deepEqual(await nodeIDs(), ['fixture-labs/deep-leaf', 'fixture-labs/root', 'fixture-labs/shared', 'fixture-labs/upstream'])
  const restBeforeRerootReturn = requestCount()
  await page.goBack()
  await ready('fixture-labs/root')
  assert.equal(requestCount(), restBeforeRerootReturn)
  assert.deepEqual(await nodeIDs(), expandedIDs)
  assertCameraRestored(await camera(), centeredCamera)
  check('centering changes only camera; explicit re-root opens its own graph and back restores expanded workspace', { extraRestOnBack: 0 })

  const nodesBeforeFailure = await nodeIDs()
  failRoot = true
  await graph().getByRole('button', { name: '重新分析', exact: true }).click()
  await graph().getByRole('alert').waitFor()
  assert.deepEqual(await nodeIDs(), nodesBeforeFailure)
  await screenshot('graph-refresh-failure')
  failRoot = false
  check('failed explicit refresh retains the previous usable expanded graph', { retainedNodes: nodesBeforeFailure.length })
  const beforeSourceFailure = result.requests.length
  failRootSources = true
  await graph().getByRole('button', { name: '重新分析', exact: true }).click()
  await graph().getByRole('alert').waitFor()
  assert.deepEqual(await nodeIDs(), nodesBeforeFailure)
  const incompleteRequests = result.requests.slice(beforeSourceFailure)
  assert.ok(incompleteRequests.some((r) => r.path === '/repos/fixture-labs/root' && r.responseStatus === 200))
  assert.ok(incompleteRequests.some((r) => r.path === '/repos/fixture-labs/root/readme' && r.responseStatus === 403))
  failRootSources = false
  check('root metadata 200 followed by README rate failure retains the complete previous graph', { retainedNodes: nodesBeforeFailure.length, responses: incompleteRequests.map((r) => ({ path: r.path, status: r.responseStatus })) })
  await graph().getByRole('button', { name: '重新分析', exact: true }).click()
  await ready('fixture-labs/root')
  assert.deepEqual(await nodeIDs(), rootIDs)
  check('a later successful refresh replaces the retained graph with a fresh one-level result')

  await page.setViewportSize({ width: 390, height: 844 })
  await selectNode('fixture-labs/upstream')
  await page.waitForFunction(() => document.querySelector('.graph-panel__content')?.scrollTop === 0)
  assert.equal(await panel().getByRole('heading', { name: 'fixture-labs/upstream', exact: true }).count(), 1)
  const mobileWidth = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }))
  assert.ok(mobileWidth.scrollWidth <= mobileWidth.innerWidth, JSON.stringify(mobileWidth))
  await page.evaluate(() => window.scrollTo(0, 0))
  await screenshot('graph-mobile-390', true)
  check('dark 390px graph has no horizontal overflow and retains accessible node list', mobileWidth)
  await page.setViewportSize({ width: 1440, height: 1000 })

  await goHash('/repo/fixture-labs/detail-root')
  await page.locator('.watch__title').waitFor()
  await page.getByRole('region', { name: 'README', exact: true }).waitFor()
  await sleep(300)
  assert.equal(await graph().count(), 0)
  assert.ok(!result.requests.some((r) => r.path.startsWith('/repos/fixture-labs/detail-root') && !r.path.endsWith('/readme')))
  await screenshot('detail-before-analysis-dark')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await screenshot('detail-before-analysis-light')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '分析技术来源', exact: true }).scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await screenshot('detail-before-analysis-mobile')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  check('repository detail shows a compact button without graph collection until clicked')
  await page.getByRole('button', { name: '分析技术来源', exact: true }).click()
  await ready('fixture-labs/detail-root')
  assert.deepEqual(await nodeIDs(), ['fixture-labs/detail-child', 'fixture-labs/detail-root'])
  assert.ok(!result.requests.some((r) => r.path === '/repos/fixture-labs/detail-child/readme'))
  const detailHeight = await graph().evaluate((g) => g.getBoundingClientRect().height)
  assert.ok(detailHeight <= 1200, `Embedded graph unexpectedly large: ${detailHeight}px`)
  await graph().scrollIntoViewIfNeeded()
  await screenshot('detail-graph-dark')
  check('repository detail analyzes one level on demand and embeds a bounded graph', { embeddedHeight: detailHeight, nodes: await nodeIDs() })

  await page.getByRole('link', { name: '首页', exact: true }).first().click()
  const waitForFeed = async (mode) => page.waitForFunction((mode) => {
    const login = JSON.parse(localStorage.getItem('gitube:viewer')).login
    return JSON.parse(localStorage.getItem(`gitube:library:${login}`)).recommendationMode === mode && document.querySelectorAll('.card__title').length > 0 && !document.querySelector('.card--skeleton')
  }, mode)
  await waitForFeed('normal')
  const mode = (name) => page.getByRole('radio', { name, exact: true })
  await mode('完全随机').click()
  await waitForFeed('random')
  const randomNames = await page.locator('.card__title').allTextContents()
  await page.evaluate(() => window.scrollTo(0, 400))
  await sleep(150)
  const randomScroll = await page.evaluate(() => scrollY)
  await mode('换换口味').dispatchEvent('click')
  await waitForFeed('taste')
  const searchesBeforeReturn = result.counters.searches
  await mode('完全随机').dispatchEvent('click')
  await waitForFeed('random')
  assert.deepEqual(await page.locator('.card__title').allTextContents(), randomNames)
  assert.equal(result.counters.searches, searchesBeforeReturn)
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - randomScroll) <= 2)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(150)
  const bottomBefore = await page.evaluate(() => ({ y: scrollY, height: innerHeight, doc: document.documentElement.scrollHeight }))
  await page.locator('.card__title a').first().dispatchEvent('click', { button: 0 })
  await page.locator('.watch__title').waitFor()
  await page.locator('.watch__readme h1').waitFor()
  assert.equal(await graph().count(), 0)
  await page.getByRole('button', { name: '分析技术来源', exact: true }).waitFor()
  const searchesAfterDetail = result.counters.searches
  const restAfterDetail = requestCount()
  await page.goBack()
  await waitForFeed('random')
  assert.deepEqual(await page.locator('.card__title').allTextContents(), randomNames)
  assert.equal(result.counters.searches, searchesAfterDetail)
  assert.equal(requestCount(), restAfterDetail)
  const bottomAfter = await page.evaluate(() => ({ y: scrollY, height: innerHeight, doc: document.documentElement.scrollHeight }))
  assert.ok(bottomAfter.y + bottomAfter.height >= bottomAfter.doc - 2, JSON.stringify(bottomAfter))
  const beforeWheelCards = await page.locator('.card__title').count()
  await page.mouse.wheel(0, 40)
  await page.waitForFunction((count) => document.querySelectorAll('.card__title').length > count, beforeWheelCards)
  check('existing mode/feed/detail return restores order and bottom scroll; only a real wheel resumes pagination', { randomScroll, bottomBefore, bottomAfter, extraSearchesOnReturn: 0, extraRestOnReturn: 0 })

  await goHash('/graph/fixture-labs/slow-navigation')
  await page.waitForFunction(() => document.querySelector('[data-graph-status="loading"]'))
  await waitForFixture('/repos/fixture-labs/slow-navigation')
  // The metadata response stays held until navigation/account changes have occurred.
  await page.getByRole('link', { name: '偏好设置', exact: true }).first().click()
  await page.getByRole('heading', { name: '偏好设置', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-graph-root]'))
  check('leaving an in-flight graph unmounts its view before the delayed response')

  await goHash('/graph/fixture-labs/slow-account')
  await page.waitForFunction(() => document.querySelector('[data-graph-status="loading"]'))
  await waitForFixture('/repos/fixture-labs/slow-account')
  await page.getByRole('link', { name: '偏好设置', exact: true }).first().click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.getByLabel('GitHub Personal Access Token', { exact: true }).fill('graph-fixture-token-b')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('link', { name: 'graph-fixture-b 的偏好设置', exact: true }).waitFor()
  slowRelease()
  const bStart = result.requests.length
  await goHash('/graph/fixture-labs/root')
  await ready('fixture-labs/root')
  assert.deepEqual(await nodeIDs(), rootIDs)
  const bRequests = result.requests.slice(bStart).filter((r) => r.path !== '/graphql')
  assert.ok(bRequests.some((r) => r.path === '/repos/fixture-labs/root'))
  assert.ok(bRequests.every((r) => r.account === 'B'))
  assert.ok(!await graph().textContent().then((text) => text.includes('slow-account')))
  const aborted = result.failedRequests.filter((r) => /slow-(navigation|account)$/.test(new URL(r.url).pathname))
  assert.equal(aborted.length, 2, JSON.stringify(result.failedRequests))
  check('navigation and logout abort old requests; a different token/account gets a fresh isolated workspace', { abortedRequests: aborted, newAccountRestRequests: bRequests.length })

  assert.deepEqual(result.pageErrors, [])
  assert.deepEqual(result.fixtureErrors, [])
  assert.deepEqual(result.unexpectedExternalRequests, [])
  assert.deepEqual(result.credentialLeakRequests, [])
  assert.equal(result.counters.mutations, 0)
  // Optional 404 files and intentional 403/503 failures may log fetch errors in Chrome.
  const unexpectedConsole = result.consoleErrors.filter((message) => !/Failed to load resource: the server responded with a status of (403|404|503)/.test(message))
  assert.deepEqual(unexpectedConsole, [])
  const unexpectedFailures = result.failedRequests.filter((r) => !r.expectedRateAbort && !/slow-(navigation|account)$/.test(new URL(r.url).pathname))
  assert.deepEqual(unexpectedFailures, [])
  check('no application console errors, page errors, live account writes, arbitrary external requests, or credential leaks', { mutations: 0, pageErrors: 0, unexpectedConsoleErrors: 0, allowedIntentionalHTTPFailures: [403, 404, 503] })
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = { message: error.message, stack: error.stack }
  if (page && !page.isClosed()) {
    await screenshot('failure').catch(() => {})
    result.failureURL = page.url()
  }
  process.exitCode = 1
} finally {
  slowRelease()
  if (browser) await browser.close()
  result.finishedAt = new Date().toISOString()
  await writeFile(resolve(output, 'browser-result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
}
