import { readFileSync, statSync } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

const fields = ['clientId', 'clientSecret', 'kind', 'origin']

export function validateOAuthConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key)) ||
      typeof value.clientId !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(value.clientId) || value.clientId.trim() !== value.clientId ||
      typeof value.clientSecret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(value.clientSecret) || value.clientSecret.trim() !== value.clientSecret ||
      value.kind !== 'oauth' || typeof value.origin !== 'string' || value.origin.length > 2048) {
    throw new Error('OAuth 连接信息无效。')
  }
  let origin
  try { origin = new URL(value.origin) } catch { throw new Error('OAuth 站点地址无效。') }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.origin) throw new Error('OAuth 站点地址无效。')
  return { clientId: value.clientId, clientSecret: value.clientSecret, kind: 'oauth', origin: value.origin }
}

export function createOAuthConfigStore(root) {
  const directory = resolve(root, '.local')
  const filename = resolve(directory, 'github-oauth.json')
  let current = null
  try {
    if (statSync(filename).size > 4096) throw new Error('Invalid configuration size')
    current = validateOAuthConfig(JSON.parse(readFileSync(filename, 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法读取服务端 OAuth 连接信息。')
  }
  return {
    get: () => current ? { ...current } : null,
    async save(value) {
      const safe = validateOAuthConfig(value)
      if (current) throw new Error('本站已配置 OAuth 连接，不能覆盖。')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      let handle
      try {
        // Only a verified callback may create this separate file. Never replace
        // credentials written by another callback or alter github-app.json.
        handle = await open(filename, 'wx', 0o600)
        await handle.writeFile(JSON.stringify(safe, null, 2), 'utf8')
        await handle.close()
        handle = null
        current = safe
      } catch {
        if (handle) {
          try { await handle.close() } catch { /* retain a fixed error boundary */ }
          try { await unlink(filename) } catch { /* never touch another store */ }
        }
        throw new Error('无法保存服务端 OAuth 连接信息。')
      }
    },
  }
}
