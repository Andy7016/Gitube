import express from 'express'
import session from 'express-session'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApiError, buildSearch, githubRequest, mapConcurrent, normalizeRepo } from './github.mjs'
import { createConfigStore } from './config.mjs'
import { createRecommendationService } from './recommendations.mjs'
import { createRepositoryDetailsService } from './repository-details.mjs'
import { createGraphService } from './graph-service.mjs'
import { createGraphStore } from './graph-store.mjs'
import { createGitubeApi } from './gitube-api.mjs'

const random = () => randomBytes(32).toString('base64url')
const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
const save = (req) => new Promise((ok, no) => req.session.save((e) => e ? no(e) : ok()))
const regenerate = (req) => new Promise((ok, no) => req.session.regenerate((e) => e ? no(e) : ok()))

// Only these fixed transport codes may leave the OAuth error boundary. Error
// messages, causes, requests, URLs and GitHub response bodies can hold secrets.
const transportCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'])
const timeoutCodes = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])
const transportCode = (error) => [error?.code, error?.cause?.code, error?.cause?.cause?.code].find((code) => transportCodes.has(code))
class OAuthFailure extends Error {
  constructor(stage, kind, { status, code } = {}) {
    super('GitHub OAuth failed')
    this.diagnostic = Object.freeze({ stage, kind, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}), ...(transportCodes.has(code) ? { code } : {}) })
    this.publicCode = stage === 'session' ? 'session_failed' : `${stage}_${kind}`
  }
}
const transportFailure = (stage, error, signal, status) => {
  const code = transportCode(error)
  const timeout = signal.aborted || ['TimeoutError', 'AbortError'].includes(error?.name) || timeoutCodes.has(code)
  return new OAuthFailure(stage, timeout ? 'timeout' : 'connection', { status, code })
}
const logAuthDiagnostic = ({ stage, kind, status, code }) => console.warn(`[github-oauth] stage=${stage} kind=${kind}${status === undefined ? '' : ` http=${status}`}${code ? ` code=${code}` : ''}`)

export function createApp({ env = process.env, fetchImpl = fetch, sessionStore, root = process.cwd(), configStore = createConfigStore(root), graphStore, authDiagnostics = logAuthDiagnostic } = {}) {
  const production = env.NODE_ENV === 'production'
  const appUrl = new URL(env.APP_URL || 'http://127.0.0.1:5173')
  if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.pathname !== '/' || appUrl.search || appUrl.hash || appUrl.username || appUrl.password) {
    throw new Error('APP_URL 必须是完整站点根地址，例如 http://127.0.0.1:5173。')
  }
  if (production && (appUrl.protocol !== 'https:' || (env.SESSION_SECRET?.length ?? 0) < 32)) {
    throw new Error('生产环境需要 HTTPS APP_URL 和至少 32 字符的 SESSION_SECRET。')
  }
  const credentials = () => {
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) return { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, kind: env.GITHUB_APP_TYPE === 'github-app' ? 'github-app' : 'oauth' }
    const stored = configStore.get()
    return stored?.origin === appUrl.origin ? stored : null
  }
  const callbackUrl = `${appUrl.origin}/api/auth/callback`
  const app = express()
  app.disable('x-powered-by')
  if (env.TRUST_PROXY === '1') app.set('trust proxy', 1)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use('/api', session({
    name: 'repoflow.sid',
    secret: env.SESSION_SECRET || random(),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 8 * 60 * 60 * 1000 },
  }))
  app.use('/api', express.json({ limit: '8kb' }))

  const request = (path, token, options) => githubRequest(fetchImpl, path, token, options)
  const oauthJson = async (stage, url, options) => {
    const signal = AbortSignal.timeout(12000)
    let response
    try { response = await fetchImpl(url, { ...options, signal }) }
    catch (error) { throw transportFailure(stage, error, signal) }
    const status = response.status
    if (!response.ok) {
      const rateLimited = status === 429 || (status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))
      const kind = rateLimited || status >= 500 ? 'upstream' : stage === 'exchange' ? 'rejected' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'upstream'
      throw new OAuthFailure(stage, kind, { status })
    }
    try { return { data: await response.json(), status } }
    catch (error) {
      if (signal.aborted || transportCode(error) || ['TimeoutError', 'AbortError'].includes(error?.name)) throw transportFailure(stage, error, signal, status)
      throw new OAuthFailure(stage, 'invalid_response', { status })
    }
  }
  const reportAuthFailure = (failure) => {
    // Observability must never change whether the login succeeds or expose the
    // original exception to a logger supplied by an embedding application.
    try { authDiagnostics(failure.diagnostic) } catch { /* ignore logger failures */ }
  }
  const discardFailedSession = async (req, res) => {
    if (req.session) {
      delete req.session.token
      delete req.session.user
      delete req.session.oauth
      delete req.session.csrfToken
      delete req.session.starCache
      try { await new Promise((ok, no) => req.session.destroy((error) => error ? no(error) : ok())) }
      catch { reportAuthFailure(new OAuthFailure('session', 'cleanup')) }
    }
    // express-session would otherwise save the changed session when redirecting,
    // including after a store reports failure despite already persisting it.
    req.session = null
    res.clearCookie('repoflow.sid', { httpOnly: true, sameSite: 'lax', secure: production, path: '/' })
  }
  const recommendations = createRecommendationService({ request })
  const gitube = createGitubeApi({ request, recommendations })
  const repositories = createRepositoryDetailsService({ request })
  const graphs = createGraphService({ request, getDetails: (...args) => repositories.getDetails(...args), store: graphStore ?? createGraphStore(root) })
  const requireUser = (req, _res, next) => req.session.token && req.session.user ? next() : next(new ApiError(401, '请先登录 GitHub。', 'LOGIN_REQUIRED'))
  const csrf = (req, _res, next) => {
    const origin = req.get('origin')
    if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== appUrl.origin) || !same(req.get('X-CSRF-Token'), req.session.csrfToken)) {
      return next(new ApiError(403, '操作验证已过期，请刷新页面后重试。', 'CSRF_INVALID'))
    }
    next()
  }
  const repoPath = (req) => {
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(req.params.owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(req.params.repo) || ['.', '..'].includes(req.params.repo)) {
      throw new ApiError(400, '项目地址无效。', 'INVALID_REPO')
    }
    return `/user/starred/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}`
  }

  app.get('/api/session', (req, res) => {
    req.session.csrfToken ||= random()
    res.json({ user: req.session.user ?? null, oauthConfigured: Boolean(credentials()), csrfToken: req.session.csrfToken })
  })

  const localSetup = (req, _res, next) => {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    const localHost = (host) => ['127.0.0.1', 'localhost', '[::1]'].includes(host)
    if (production || !loopback || !localHost(appUrl.hostname) || !localHost(req.hostname)) {
      return next(new ApiError(403, '首次应用接入仅支持本机运行；此站点请由管理员连接 GitHub。', 'SETUP_UNAVAILABLE'))
    }
    next()
  }
  let setupBusy = false
  app.get('/api/setup/github', localSetup, async (req, res) => {
    if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== appUrl.origin)) {
      throw new ApiError(403, '请从本站登录按钮开始连接 GitHub。', 'SETUP_ORIGIN_INVALID')
    }
    if (credentials()) return res.redirect('/api/auth/github')
    if (configStore.get()) throw new ApiError(409, '当前网址与已注册的 GitHub App 地址不同，请使用原站点网址。', 'SETUP_ORIGIN_CHANGED')
    req.session.githubSetup = { state: random(), createdAt: Date.now() }
    await save(req)
    const manifest = {
      name: `RepoFlow-${randomBytes(4).toString('hex')}`,
      url: appUrl.origin,
      description: 'Browse public GitHub repositories and manage your stars.',
      redirect_url: `${appUrl.origin}/api/setup/callback`,
      callback_urls: [callbackUrl],
      public: true,
      // RepoFlow polls the API and needs no webhook. GitHub validates even an
      // inactive hook URL, so omit this optional object for loopback installs.
      default_events: [],
      default_permissions: { metadata: 'read', starring: 'write' },
    }
    const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const nonce = random()
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'`)
    res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 GitHub · RepoFlow</title><style>body{font:15px/1.8 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:24px;color:#24292f}h1{font-size:24px}p{color:#57606a}button{background:#24292f;color:white;border:0;border-radius:8px;padding:12px 20px;font:inherit;cursor:pointer}</style><h1>正在前往 GitHub…</h1><p>首次连接时，在 GitHub 确认创建本站应用。连接信息会自动保存，之后可直接授权登录。</p><form id="github-registration" method="post" action="https://github.com/settings/apps/new?state=${encodeURIComponent(req.session.githubSetup.state)}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button type="submit">继续前往 GitHub</button></form><script nonce="${nonce}">document.getElementById('github-registration').submit()</script></html>`)
  })

  app.get('/api/setup/callback', localSetup, async (req, res) => {
    const attempt = req.session.githubSetup
    delete req.session.githubSetup
    await save(req)
    if (!attempt || !same(req.query.state, attempt.state) || Date.now() - attempt.createdAt > 10 * 60 * 1000) return res.redirect('/?auth_error=setup_invalid_state')
    if (credentials() || configStore.get()) return res.redirect('/api/auth/github')
    if (typeof req.query.code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(req.query.code)) return res.redirect('/?auth_error=setup_missing_code')
    if (setupBusy) return res.redirect('/?auth_error=setup_in_progress')
    setupBusy = true
    try {
      const response = await request(`/app-manifests/${encodeURIComponent(req.query.code)}/conversions`, null, { method: 'POST' })
      const registration = await response.json()
      if (typeof registration.client_id !== 'string' || !registration.client_id || typeof registration.client_secret !== 'string' || !registration.client_secret) return res.redirect('/?auth_error=setup_failed')
      await configStore.save({ clientId: registration.client_id, clientSecret: registration.client_secret, kind: 'github-app', origin: appUrl.origin, id: registration.id, slug: registration.slug })
      return res.redirect('/api/auth/github')
    } catch {
      return res.redirect('/?auth_error=setup_failed')
    } finally { setupBusy = false }
  })

  app.get('/api/auth/github', async (req, res) => {
    const config = credentials()
    if (!config) return res.redirect('/api/setup/github')
    req.session.oauth = { state: random(), verifier: random(), createdAt: Date.now() }
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: callbackUrl,
      state: req.session.oauth.state,
      code_challenge: createHash('sha256').update(req.session.oauth.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })
    if (config.kind === 'oauth') params.set('scope', 'read:user public_repo')
    await save(req)
    res.redirect(`https://github.com/login/oauth/authorize?${params}`)
  })

  app.get('/api/auth/callback', async (req, res) => {
    const attempt = req.session.oauth
    delete req.session.oauth
    try { await save(req) }
    catch {
      reportAuthFailure(new OAuthFailure('session', 'storage'))
      await discardFailedSession(req, res)
      return res.redirect('/?auth_error=session_failed')
    }
    const config = credentials()
    if (!config) return res.redirect('/?auth_error=not_configured')
    if (!attempt || !same(req.query.state, attempt.state) || Date.now() - attempt.createdAt > 10 * 60 * 1000) {
      return res.redirect('/?auth_error=invalid_state')
    }
    if (req.query.error) return res.redirect('/?auth_error=access_denied')
    if (typeof req.query.code !== 'string' || req.query.code.length > 512) return res.redirect('/?auth_error=missing_code')
    let stage = 'exchange'
    try {
      const { data, status } = await oauthJson(stage, 'https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code: req.query.code, redirect_uri: callbackUrl, code_verifier: attempt.verifier }),
      })
      if (data?.error) throw new OAuthFailure(stage, 'rejected', { status })
      if (typeof data?.access_token !== 'string' || !data.access_token) throw new OAuthFailure(stage, 'invalid_response', { status })
      // Always revalidate identity before associating any local data with this account.
      stage = 'identity'
      const { data: profile, status: identityStatus } = await oauthJson(stage, 'https://api.github.com/user', {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'RepoFlow/0.1', Authorization: `Bearer ${data.access_token}` },
      })
      if (typeof profile?.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(profile.login)) throw new OAuthFailure(stage, 'invalid_response', { status: identityStatus })
      stage = 'session'
      await regenerate(req)
      req.session.token = data.access_token
      req.session.user = { login: profile.login, name: profile.name, avatar_url: profile.avatar_url, html_url: profile.html_url }
      req.session.csrfToken = random()
      req.session.starCache = {}
      await save(req)
      return res.redirect('/')
    } catch (error) {
      const failure = error instanceof OAuthFailure ? error : new OAuthFailure(stage, stage === 'session' ? 'storage' : 'invalid_response')
      reportAuthFailure(failure)
      if (stage === 'session') await discardFailedSession(req, res)
      return res.redirect(`/?auth_error=${failure.publicCode}`)
    }
  })

  app.post('/api/logout', csrf, (req, res, next) => {
    const { user, token } = req.session
    req.session.destroy((error) => {
      if (error) return next(error)
      if (user && token) recommendations.invalidate(user.login, token)
      res.clearCookie('repoflow.sid', { httpOnly: true, sameSite: 'lax', secure: production, path: '/' })
      res.sendStatus(204)
    })
  })

  app.get('/api/recommendation-profile', requireUser, async (req, res) => {
    const profile = await recommendations.getProfile(req.session.user.login, req.session.token, { refresh: req.query.refresh === '1' })
    res.json(profile)
  })

  const searchCache = new Map()
  const searchPending = new Map()
  async function starred(req, fullName, { signal } = {}) {
    const key = fullName.toLowerCase()
    req.session.starCache ||= {}
    const cached = req.session.starCache[key]
    if (cached && cached.expires > Date.now()) return cached.value
    const response = await request(`/user/starred/${fullName.split('/').map(encodeURIComponent).join('/')}`, req.session.token, { allow404: true, ...(signal ? { signal } : {}) })
    const value = response.status === 204
    if (Object.keys(req.session.starCache).length >= 500) req.session.starCache = {}
    req.session.starCache[key] = { value, expires: Date.now() + 60000 }
    return value
  }

  app.post('/api/gitube', csrf, async (req, res) => {
    const controller = new AbortController()
    const cancel = () => { if (!res.writableEnded) controller.abort() }
    req.once('aborted', cancel)
    res.once('close', cancel)
    try { res.json(await gitube.execute(req.body, { user: req.session.user, token: req.session.token, starred: (fullName, options) => starred(req, fullName, options), signal: controller.signal })) }
    finally { req.removeListener('aborted', cancel); res.removeListener('close', cancel) }
  })

  app.get('/api/repos/:owner/:repo', async (req, res) => {
    const details = await repositories.getDetails(req.params.owner, req.params.repo, req.session.token, { refresh: req.query.refresh === '1' })
    // Viewer state belongs to the session, never the cached public repository.
    let viewerStarred
    if (req.session.token) {
      try { viewerStarred = await starred(req, details.repo.full_name) }
      catch (error) {
        if (error.code === 'SESSION_EXPIRED' || error.status === 401) throw error
        // Public documentation remains available if the separate Star check
        // fails. The write action rechecks the actual state before mutation.
      }
    }
    res.json({ ...details, repo: { ...details.repo, ...(viewerStarred === undefined ? {} : { viewer_starred: viewerStarred }) } })
  })

  const graphResponse = (res, job) => {
    if (job.status === 'failed' && job.error?.code === 'SESSION_EXPIRED') {
      throw new ApiError(401, 'GitHub 登录已过期，请重新登录。', 'SESSION_EXPIRED')
    }
    res.status(['queued', 'running'].includes(job.status) ? 202 : 200).json(job)
  }
  app.post('/api/graph/:owner/:repo', csrf, async (req, res) => {
    const body = req.body === undefined ? {} : req.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'refresh') || (body.refresh !== undefined && typeof body.refresh !== 'boolean')) {
      throw new ApiError(400, '图谱请求仅支持可选的 refresh 布尔值。', 'INVALID_GRAPH_REQUEST')
    }
    const job = await graphs.start(req.params.owner, req.params.repo, req.session.token, req.sessionID, { refresh: body.refresh === true })
    graphResponse(res, job)
  })
  app.get('/api/graph/jobs/:id', (req, res) => {
    const job = graphs.getJob(req.params.id, req.sessionID)
    graphResponse(res, job)
  })

  app.get('/api/feed', async (req, res) => {
    const { queries, page, perPage } = buildSearch(req.query)
    const key = queries.map((query) => query.toString()).join('|')
    let cached = searchCache.get(key)
    if (!cached || cached.expires < Date.now()) {
      if (!searchPending.has(key)) searchPending.set(key, (async () => {
      const batches = await mapConcurrent(queries, 3, async (query) => {
        const response = await request(`/search/repositories?${query}`, req.session.token)
        return response.json()
      })
      const seen = new Set()
      const items = []
      for (let i = 0; i < perPage; i++) {
        for (const batch of batches) {
          const repo = batch.items?.[i]
          if (repo && !seen.has(repo.id)) { seen.add(repo.id); items.push(normalizeRepo(repo)) }
        }
      }
      const value = { items, hasMore: page < 83 && batches.some((batch) => page * perPage < Math.min(batch.total_count ?? 0, 1000)), expires: Date.now() + 5 * 60000 }
      if (searchCache.size >= 128) searchCache.delete(searchCache.keys().next().value)
      searchCache.set(key, value)
      return value
      })().finally(() => searchPending.delete(key)))
      cached = await searchPending.get(key)
    }
    const items = req.session.token
      ? await mapConcurrent(cached.items, 4, async (repo) => ({ ...repo, viewer_starred: await starred(req, repo.full_name) }))
      : cached.items
    res.json({ items, hasMore: cached.hasMore, source: 'github' })
  })

  app.get('/api/starred', requireUser, async (req, res) => {
    const page = Number(req.query.page ?? 1)
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new ApiError(400, '页码无效。', 'INVALID_QUERY')
    const response = await request(`/user/starred?per_page=100&page=${page}&sort=created&direction=desc`, req.session.token)
    const repos = await response.json()
    res.json({ items: repos.map((r) => ({ ...normalizeRepo(r), viewer_starred: true })), hasMore: /rel="next"/.test(response.headers.get('link') ?? '') })
  })
  app.get('/api/starred/:owner/:repo', requireUser, async (req, res) => {
    const response = await request(repoPath(req), req.session.token, { allow404: true })
    res.json({ starred: response.status === 204 })
  })
  for (const method of ['put', 'delete']) {
    app[method]('/api/starred/:owner/:repo', requireUser, csrf, async (req, res) => {
      await request(repoPath(req), req.session.token, { method: method.toUpperCase() })
      req.session.starCache ||= {}
      req.session.starCache[`${req.params.owner}/${req.params.repo}`.toLowerCase()] = { value: method === 'put', expires: Date.now() + 60000 }
      recommendations.invalidate(req.session.user.login, req.session.token)
      res.sendStatus(204)
    })
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API 地址不存在。', code: 'NOT_FOUND' }))
  const dist = resolve(root, 'dist')
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist))
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')))
  }
  app.use((error, req, res, _next) => {
    if (error.code === 'SESSION_EXPIRED' && req.session) {
      delete req.session.token
      delete req.session.user
      delete req.session.starCache
    }
    const status = error instanceof ApiError ? error.status : error.type === 'entity.parse.failed' ? 400 : 500
    res.status(status).json({ error: status === 500 ? '服务器暂时无法处理请求。' : error.message, code: error.code ?? 'SERVER_ERROR' })
  })
  return app
}
