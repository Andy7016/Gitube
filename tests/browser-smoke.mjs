// Optional browser acceptance: point GITUBE_PLAYWRIGHT_MODULE at an installed Playwright module.
// All GitHub responses below are isolated fixtures; this never needs a real token.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const moduleName = process.env.GITUBE_PLAYWRIGHT_MODULE
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright')
const baseURL = process.env.GITUBE_TEST_URL ?? 'http://127.0.0.1:5173'
const stage = process.env.GITUBE_TEST_STAGE ?? 'exploration'
const output = process.env.GITUBE_SCREENSHOTS ?? '.scratch/acceptance/images'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.route('https://github.com/**', (route) => route.fulfill({ status: 200, body: 'Isolated repository-link fixture' }))
let searches = 0
let feedSearches = 0
const pageErrors = []
const rawRepo = (name, familiar = false) => ({
  id: name, name, nameWithOwner: `fixture-labs/${name}`,
  description: familiar ? '用于验收的开源前端项目，探索组件、工具与实际应用。' : '用于验收的公开项目，发现其他技术方向和新的工具。',
  url: `https://github.com/fixture-labs/${name}`, homepageUrl: null,
  stargazerCount: 1200, forkCount: 80, primaryLanguage: { name: familiar ? 'TypeScript' : 'Python', color: familiar ? '#3178c6' : '#3572A5' },
  repositoryTopics: { nodes: (familiar ? ['frontend', 'react'] : ['data-science', 'python']).map((name) => ({ topic: { name } })) },
  owner: { __typename: 'Organization', id: 'fixture-labs', login: 'fixture-labs', avatarUrl: '' },
  pushedAt: new Date().toISOString(), createdAt: '2024-01-01T00:00:00Z', viewerHasStarred: false,
  usesCustomOpenGraphImage: false, openGraphImageUrl: '', isArchived: false,
  licenseInfo: { spdxId: 'MIT' }, defaultBranchRef: { name: 'main' },
})
await context.route('https://api.github.com/**', async (route) => {
  if (route.request().url().includes('/readme')) {
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Fixture README</h1><p>Browser acceptance fixture. No live GitHub data.</p>' })
  }
  const { query, variables = {} } = route.request().postDataJSON()
  let data
  if (query.includes('following(first:')) {
    data = { viewer: { following: { nodes: ['sample-alice', 'sample-bob', 'sample-carol'].map((login, i) => ({
      login, avatarUrl: '', starredRepositories: { edges: [{ starredAt: new Date().toISOString(), node: rawRepo(`shared-${i}`, i !== 1) }] },
    })) } } }
  } else if (query.includes('starredRepositories(first: 100')) {
    data = { viewer: { starredRepositories: { nodes: [] }, repositories: { nodes: [] } } }
  } else if (query.includes('repository(owner:')) {
    data = { repository: { ...rawRepo(variables.name, true), watchers: { totalCount: 10 }, issues: { totalCount: 3 }, latestRelease: null } }
  } else if (query.includes('mutation')) {
    const kind = query.includes('addStar') ? 'addStar' : 'removeStar'
    data = { [kind]: { starrable: { stargazerCount: 1201, viewerHasStarred: kind === 'addStar' } } }
  } else if (query.includes('s0: search')) {
    searches++
    if (Object.keys(variables).filter((key) => /^q\d+$/.test(key)).length > 2) feedSearches++
    data = Object.fromEntries(Object.keys(variables).filter((key) => /^q\d+$/.test(key)).map((key) => {
      const i = Number(key.slice(1))
      const familiar = /topic:(frontend|react|vue)/.test(variables[key]) && !/-topic:(frontend|react|vue)/.test(variables[key])
      return [`s${i}`, { repositoryCount: 1000, pageInfo: { endCursor: `cursor-${searches}-${i}`, hasNextPage: true },
        nodes: Array.from({ length: 12 }, (_, j) => rawRepo(`project-${searches}-${i}-${j}`, familiar)) }]
    }))
  } else {
    throw new Error(`Unhandled fixture request: ${query.slice(0, 100)}`)
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) })
})
await context.addInitScript(() => {
  localStorage.setItem('gitube:token', 'browser-acceptance-fixture')
  localStorage.setItem('gitube:viewer', JSON.stringify({ id: 'fixture-viewer', login: 'fixture-viewer', name: '验收账号', avatarUrl: '' }))
  localStorage.setItem('gitube:library:fixture-viewer', JSON.stringify({ version: 1, onboarded: true, interests: ['frontend', 'rust'], followingWeights: { 'sample-alice': 1.5 } }))
  localStorage.setItem('gitube:theme', 'light')
})
const page = await context.newPage()
page.on('pageerror', (error) => pageErrors.push(error.message))
const result = { fixtureOnly: true, stage, checks: [] }
const check = (name) => result.checks.push(name)
try {
  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('heading', { name: '关注者的推荐影响' }).waitFor()
  const sliders = page.getByRole('slider')
  await sliders.first().waitFor()
  assert.equal(await sliders.count(), 3)
  await sliders.first().focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('gitube:library:fixture-viewer')).followingWeights['sample-alice'] === 1.75)
  check('following slider and account-local persistence')
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '关注者的推荐影响' }) })
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/${stage}-settings-light.png` })
  await page.evaluate(async () => (await import('/src/lib/theme.ts')).setTheme('dark'))
  await page.screenshot({ path: `${output}/${stage}-settings-dark.png` })
  check('light and dark settings screenshots')
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: `${output}/${stage}-settings-mobile.png` })
  check('390px settings layout has no horizontal overflow')
  if (stage === 'following') {
    assert.deepEqual(pageErrors, [])
    console.log(JSON.stringify(result))
  } else {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(async () => (await import('/src/lib/theme.ts')).setTheme('light'))
    await page.getByRole('link', { name: '首页', exact: true }).first().click()
    await page.locator('.card__title').first().waitFor()
    const mode = (name) => page.getByRole('radio', { name, exact: true })
    await mode('完全随机').click()
    await page.waitForFunction(async () => {
      const { useFeed, feedKey } = await import('/src/store/feed.ts')
      return useFeed.getState().channels[feedKey('fixture-viewer', 'foryou', 'random')]?.items.length > 0
    })
    const randomNames = await page.locator('.card__title').allTextContents()
    await page.evaluate(() => window.scrollTo(0, 400))
    await page.waitForTimeout(60)
    const randomScroll = await page.evaluate(() => scrollY)
    await mode('换换口味').dispatchEvent('click')
    await page.waitForFunction(async () => {
      const { useFeed, feedKey } = await import('/src/store/feed.ts')
      return useFeed.getState().channels[feedKey('fixture-viewer', 'foryou', 'taste')]?.items.length > 0
    })
    const countBeforeReturn = feedSearches
    await mode('完全随机').dispatchEvent('click')
    await page.waitForTimeout(180)
    assert.deepEqual(await page.locator('.card__title').allTextContents(), randomNames)
    assert.equal(feedSearches, countBeforeReturn)
    const restoredScroll = await page.evaluate(() => scrollY)
    assert.ok(Math.abs(restoredScroll - randomScroll) <= 2, JSON.stringify({ randomScroll, restoredScroll,
      cached: await page.evaluate(async () => Object.fromEntries(Object.entries((await import('/src/store/feed.ts')).useFeed.getState().channels).map(([key, feed]) => [key, { scrollY: feed.scrollY, count: feed.items.length }]))),
    }))
    check('mode round trip preserves order and scroll without another search')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${output}/exploration-home-light.png` })
    await page.evaluate(async () => (await import('/src/lib/theme.ts')).setTheme('dark'))
    await page.screenshot({ path: `${output}/exploration-home-dark.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${output}/exploration-home-mobile.png` })
    check('home light, dark and 390px screenshots')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('.card__title a').first().click()
    await page.locator('.watch__title').waitFor()
    await page.locator('.watch__readme h1').waitFor()
    const afterDetail = feedSearches
    // Emulate a previously saved bottom position even when the viewport has changed.
    await page.evaluate(async () => (await import('/src/store/feed.ts')).useFeed.getState().saveScroll('foryou', 100_000, 'random', 'fixture-viewer'))
    await page.goBack()
    await page.locator('.card__title').first().waitFor()
    await page.waitForTimeout(120)
    assert.deepEqual(await page.locator('.card__title').allTextContents(), randomNames)
    assert.equal(feedSearches, afterDetail)
    check('detail return restores cached feed without another search')
    const bottom = await page.evaluate(() => ({ y: scrollY, height: innerHeight, doc: document.documentElement.scrollHeight }))
    assert.ok(bottom.y + bottom.height >= bottom.doc - 2, JSON.stringify(bottom))
    await page.mouse.wheel(0, 40)
    await page.waitForFunction(async () => {
      const { useFeed, feedKey } = await import('/src/store/feed.ts')
      return useFeed.getState().channels[feedKey('fixture-viewer', 'foryou', 'random')]?.items.length > 18
    })
    check('restored bottom sentinel waits for a real wheel event before paging')
    const clockStart = new Date()
    await page.clock.install({ time: clockStart })
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1000))
    await page.locator('.card__title a').first().dispatchEvent('click', { button: 0 })
    await page.locator('.watch__title').waitFor()
    await page.locator('.watch__readme h1').waitFor()
    await page.clock.runFor(60_000)
    const dwellCount = () => page.evaluate(async () => (await import('/src/store/library.ts')).useLibrary.getState().events.filter((e) => e.kind === 'dwell').length)
    assert.equal(await dwellCount(), 0)
    await page.locator('.actionbar a').dispatchEvent('click', { button: 0 })
    assert.equal(await dwellCount(), 0)
    await page.bringToFront()
    await page.clock.runFor(1)
    assert.equal(await dwellCount(), 1)
    await page.clock.runFor(180_000)
    assert.equal(await dwellCount(), 1)
    check('mounted detail hook honors strict outbound threshold and deduplicates')
    assert.deepEqual(pageErrors, [])
    console.log(JSON.stringify(result))
  }
  await writeFile(`${output}/${stage}-browser-result.json`, `${JSON.stringify(result, null, 2)}\n`)
} finally {
  await browser.close()
}
