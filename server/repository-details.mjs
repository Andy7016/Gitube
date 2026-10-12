import { createHash } from 'node:crypto'
import { ApiError, normalizeRepo } from './github.mjs'

const README_LIMIT = 2 * 1024 * 1024
const expired = (error) => error?.status === 401 || error?.code === 'SESSION_EXPIRED'

function responseError(response) {
  if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
    return new ApiError(429, 'GitHub 请求额度暂时用尽，请稍后重试。', 'RATE_LIMITED')
  }
  return response.status === 401
    ? new ApiError(401, 'GitHub 登录已失效，请重新登录。', 'SESSION_EXPIRED')
    : new ApiError(response.status >= 400 ? response.status : 502, 'GitHub 暂时无法读取该项目。')
}

function decodeReadme(value) {
  if (!value || value.encoding !== 'base64' || typeof value.content !== 'string' || typeof value.path !== 'string' || !value.path || typeof value.html_url !== 'string' || !value.html_url) {
    throw new ApiError(502, 'GitHub 返回的 README 格式无效，请稍后重试。', 'README_INVALID_FORMAT')
  }
  const encoded = value.content.replace(/[\r\n\t ]/g, '')
  if (encoded.length > Math.ceil(README_LIMIT / 3) * 4) {
    throw new ApiError(413, 'README 超过 2 MiB，无法在此完整显示，请到 GitHub 查看。', 'README_TOO_LARGE')
  }
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) {
    throw new ApiError(502, 'GitHub 返回的 README Base64 格式无效，请稍后重试。', 'README_INVALID_FORMAT')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > README_LIMIT) throw new ApiError(413, 'README 超过 2 MiB，无法在此完整显示，请到 GitHub 查看。', 'README_TOO_LARGE')
  if (bytes.toString('base64') !== encoded) throw new ApiError(502, 'GitHub 返回的 README Base64 格式无效，请稍后重试。', 'README_INVALID_FORMAT')
  let content
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new ApiError(502, 'README 不是有效的 UTF-8 文本，请到 GitHub 查看原文件。', 'README_INVALID_ENCODING') }
  return { content, path: value.path, html_url: value.html_url, download_url: typeof value.download_url === 'string' ? value.download_url : null }
}

function readmeError(error) {
  if (error?.code?.startsWith('README_')) return { code: error.code, message: error.message }
  if (error?.code === 'INVALID_GITHUB_DATA') return { code: 'README_INVALID_FORMAT', message: 'GitHub 返回的 README 格式无效，请稍后重试。' }
  if (error?.status === 403) return { code: 'README_PERMISSION_DENIED', message: 'GitHub 暂时未允许读取此 README，请稍后重试。' }
  if (error?.status === 429 || error?.code === 'RATE_LIMITED') return { code: 'RATE_LIMITED', message: 'GitHub 请求额度暂时用尽，请稍后重试。' }
  return { code: 'README_UNAVAILABLE', message: '暂时无法读取 GitHub README，请稍后重试。' }
}

export function createRepositoryDetailsService({ request, now = () => Date.now() }) {
  if (typeof request !== 'function') throw new TypeError('request 必须是函数。')
  const cache = new Map()
  const pending = new Map()

  async function read(path, token, options = {}) {
    const response = await request(path, token, options)
    if (!response.ok) throw responseError(response)
    try { return await response.json() }
    catch { throw new ApiError(502, 'GitHub 返回的数据格式无效。', 'INVALID_GITHUB_DATA') }
  }

  async function load(owner, repo, token) {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    const metadata = await read(path, token)
    if (metadata?.private === true) throw new ApiError(403, '此页面只支持公开 GitHub 仓库。', 'PRIVATE_REPOSITORY')
    if (metadata?.private !== false || typeof metadata.default_branch !== 'string' || !metadata.default_branch || !metadata.owner || typeof metadata.owner.login !== 'string' || typeof metadata.full_name !== 'string') {
      throw new ApiError(502, 'GitHub 返回的项目资料格式无效。', 'INVALID_REPOSITORY')
    }
    const result = { repo: normalizeRepo(metadata), defaultBranch: metadata.default_branch, readme: null, readmeError: null }
    const options = { headers: { Accept: 'application/vnd.github+json' } }
    try {
      let value
      try { value = await read(`${path}/readme`, token, options) }
      catch (error) {
        if (expired(error)) throw error
        // GitHub Apps with only Metadata/Starring permissions can still read a
        // verified public repository's README through the anonymous public API.
        if (error?.status !== 403 || !token || error?.code === 'RATE_LIMITED') throw error
        value = await read(`${path}/readme`, null, options)
      }
      result.readme = decodeReadme(value)
    } catch (error) {
      if (expired(error)) throw error
      if (error?.status !== 404) result.readmeError = readmeError(error)
    }
    return result
  }

  function getDetails(owner, repo, token, { refresh = false } = {}) {
    if (typeof owner !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(owner) || typeof repo !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo)) {
      throw new ApiError(400, '项目地址无效。', 'INVALID_REPO')
    }
    if (token != null && typeof token !== 'string') throw new ApiError(400, '登录凭据格式无效。', 'INVALID_TOKEN')
    const identity = token ? createHash('sha256').update(token).digest('hex') : 'anonymous'
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}:${identity}`
    if (pending.has(key)) return pending.get(key)
    const cached = cache.get(key)
    if (!refresh && cached && cached.expires > Number(now())) {
      cache.delete(key)
      cache.set(key, cached)
      return Promise.resolve(cached.value)
    }
    cache.delete(key)
    const work = load(owner, repo, token).then((value) => {
      // An unavailable README remains explicitly retryable, never an empty
      // successful entry that poisons later requests or another account.
      if (!value.readmeError) {
        if (cache.size >= 128) cache.delete(cache.keys().next().value)
        cache.set(key, { value, expires: Number(now()) + 5 * 60000 })
      }
      return value
    }).finally(() => pending.delete(key))
    pending.set(key, work)
    return work
  }

  return { getDetails }
}
