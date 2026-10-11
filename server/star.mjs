import { ApiError } from './github.mjs'

const fields = 'id nameWithOwner isPrivate viewerHasStarred'
const permissionError = () => new ApiError(403, 'GitHub 未允许此应用修改 Star，请在 GitHub 打开项目进行操作。', 'STAR_PERMISSION_REQUIRED')
const dataError = () => new ApiError(502, 'GitHub 返回的 Star 数据无效，请稍后重试。', 'INVALID_GITHUB_DATA')
const unavailable = () => new ApiError(404, '项目不存在、不是公开仓库，或当前账号无权访问。', 'STAR_TARGET_UNAVAILABLE')
const forbidden = (error) => error instanceof ApiError && error.status === 403 && error.code === 'UPSTREAM_ERROR'

async function graphql(request, token, query, variables) {
  let response
  try {
    response = await request('/graphql', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) })
  } catch (error) {
    if (forbidden(error)) throw permissionError()
    throw error
  }
  if (response.status !== 200) throw dataError()
  let body
  try { body = await response.json() } catch { throw dataError() }
  if (body?.errors !== undefined) {
    if (!Array.isArray(body.errors)) throw dataError()
    if (body.errors.length) {
      // Classify only fixed codes; upstream messages and partial data can hold
      // secrets and cannot establish whether a write succeeded.
      const types = body.errors.flatMap((error) => [error?.type, error?.extensions?.code])
      if (types.some((type) => ['UNAUTHENTICATED', 'BAD_CREDENTIALS'].includes(type))) throw new ApiError(401, 'GitHub 登录已失效，请重新登录。', 'SESSION_EXPIRED')
      if (types.includes('RATE_LIMITED')) throw new ApiError(429, 'GitHub 请求额度暂时用尽，请稍后重试。', 'RATE_LIMITED')
      if (types.includes('FORBIDDEN')) throw permissionError()
      if (types.includes('NOT_FOUND')) throw unavailable()
      throw dataError()
    }
  }
  if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw dataError()
  return body.data
}

function repository(value, fullName, expectedId) {
  if (value?.isPrivate === true) throw unavailable()
  if (!value || typeof value.id !== 'string' || !value.id.length || value.id.length > 256 || /[\x00-\x20\x7f]/.test(value.id)
    || typeof value.nameWithOwner !== 'string' || value.nameWithOwner.toLowerCase() !== fullName.toLowerCase()
    || value.isPrivate !== false || typeof value.viewerHasStarred !== 'boolean' || (expectedId !== undefined && value.id !== expectedId)) throw dataError()
  return value
}

export async function writeStar(request, { owner, repo, token, starred }) {
  const fullName = `${owner}/${repo}`
  try {
    const response = await request(`/user/starred/${[owner, repo].map(encodeURIComponent).join('/')}`, token, {
      method: starred ? 'PUT' : 'DELETE', ...(starred ? { headers: { 'Content-Length': '0' } } : {}),
    })
    if (response.status !== 204) throw dataError()
    return
  } catch (error) {
    // githubRequest has already separated 401 and rate-limited 403 responses.
    // Keep REST compatibility and use the same account for one bounded fallback.
    if (!forbidden(error)) throw error
  }
  const data = await graphql(request, token, `query RepositoryStarTarget($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, { owner, name: repo })
  if (data.repository === null) throw unavailable()
  const target = repository(data.repository, fullName)
  if (target.viewerHasStarred === starred) return
  const operation = starred ? 'addStar' : 'removeStar'
  const input = starred ? 'AddStarInput!' : 'RemoveStarInput!'
  const result = await graphql(request, token, `mutation RepositoryStarWrite($input: ${input}) { ${operation}(input: $input) { starrable { ... on Repository { ${fields} } } } }`, { input: { starrableId: target.id } })
  const confirmed = repository(result[operation]?.starrable, fullName, target.id)
  if (confirmed.viewerHasStarred !== starred) throw new ApiError(502, 'GitHub 未确认 Star 状态，请刷新后重试或在 GitHub 中操作。', 'STAR_STATE_UNCONFIRMED')
}
