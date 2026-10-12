import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function validate(value) {
  if (!value || typeof value.clientId !== 'string' || !value.clientId || typeof value.clientSecret !== 'string' || !value.clientSecret || value.kind !== 'github-app' || typeof value.origin !== 'string') {
    throw new Error('GitHub 应用连接信息无效。')
  }
  const origin = new URL(value.origin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.origin) throw new Error('GitHub 应用站点地址无效。')
  return { clientId: value.clientId, clientSecret: value.clientSecret, kind: 'github-app', origin: value.origin, ...(typeof value.slug === 'string' ? { slug: value.slug } : {}), ...(Number.isInteger(value.id) ? { id: value.id } : {}) }
}

export function createConfigStore(root) {
  const directory = resolve(root, '.local')
  const filename = resolve(directory, 'github-app.json')
  let current = null
  try { current = validate(JSON.parse(readFileSync(filename, 'utf8'))) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取服务端 GitHub 应用连接信息。', { cause: error }) }
  return {
    get: () => current ? { ...current } : null,
    async save(value) {
      const safe = validate(value)
      if (current) throw new Error('本站已连接 GitHub 应用，不能覆盖。')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      // Exclusive creation prevents two registration callbacks from replacing credentials.
      await writeFile(filename, JSON.stringify(safe, null, 2), { flag: 'wx', mode: 0o600 })
      current = safe
    },
  }
}
