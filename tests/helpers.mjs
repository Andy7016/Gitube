import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { createApp } from '../server/app.mjs'

export const APP_ORIGIN = 'http://127.0.0.1:5173'
export const TOKEN = 'test-only-oauth-token'
export const profile = { login: 'octocat', name: 'The Octocat', avatar_url: 'https://avatars.example/octocat', html_url: 'https://github.com/octocat' }
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
export const empty = (status = 204, headers = {}) => new Response(null, { status, headers })
export const repo = (id, name, extra = {}) => ({
  id, name, full_name: `sample/${name}`, html_url: `https://github.com/sample/${name}`,
  owner: { login: 'sample', avatar_url: 'https://avatars.example/sample' },
  description: `${name} description`, stargazers_count: id * 100, forks_count: id,
  language: 'JavaScript', topics: ['web'], created_at: '2026-09-01T00:00:00Z', pushed_at: '2026-10-01T00:00:00Z',
  license: { spdx_id: 'MIT' }, ...extra,
})

export function memoryConfigStore(initial = null) {
  let value = initial
  const saves = []
  return { get: () => value, saves, save: async (next) => { saves.push(next); value = next } }
}

export function memoryGraphStore() {
  const values = new Map()
  return { get: async (key) => values.get(key), set: async (key, value) => { values.set(key, structuredClone(value)) } }
}

export async function fixture(t, options = {}) {
  const calls = []
  const authDiagnostics = []
  const fetchImpl = async (input, init = {}) => {
    const call = { url: new URL(input), init }
    calls.push(call)
    if (call.url.href === 'https://github.com/login/oauth/access_token') {
      return options.exchange ? options.exchange(call) : json({ access_token: TOKEN })
    }
    if (call.url.href === 'https://api.github.com/user') {
      return options.identity ? options.identity(call) : json(profile)
    }
    if (options.upstream) return options.upstream(call)
    throw new Error(`Unexpected mock request: ${call.url.href}`)
  }
  const app = createApp({
    env: {
      NODE_ENV: 'test', APP_URL: APP_ORIGIN, SESSION_SECRET: 'test-session-secret-with-enough-entropy',
      GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-client-secret', ...options.env,
    },
    fetchImpl,
    configStore: options.configStore ?? memoryConfigStore(),
    graphStore: options.graphStore ?? memoryGraphStore(),
    authDiagnostics: options.authDiagnostics ?? ((diagnostic) => authDiagnostics.push(diagnostic)),
    ...(options.sessionStore ? { sessionStore: options.sessionStore } : {}),
    ...(options.root ? { root: options.root } : {}),
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  let cookie = ''
  const origin = `http://127.0.0.1:${server.address().port}`
  const request = async (path, { headers = {}, ...init } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual', ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return response
  }
  // Node's fetch replaces Host with the URL host. Use a raw local HTTP request
  // for the one test that must exercise Express's actual Host validation.
  const requestHost = (path, host) => new Promise((resolve, reject) => {
    const pending = httpRequest(new URL(path, origin), { headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) } }, (incoming) => {
      const chunks = []
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.on('error', reject)
      incoming.on('end', () => {
        const headers = new Headers()
        for (const [name, values] of Object.entries(incoming.headers)) {
          for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values]) headers.append(name, value)
        }
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers }))
      })
    })
    pending.on('error', reject)
    pending.end()
  })
  return { request, requestHost, calls, authDiagnostics, get cookie() { return cookie } }
}

export async function beginLogin(client) {
  const response = await client.request('/api/auth/github')
  assert.equal(response.status, 302)
  return { response, authorize: new URL(response.headers.get('location')) }
}

export async function login(client) {
  const { authorize } = await beginLogin(client)
  const callback = await client.request(`/api/auth/callback?${new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'test-authorization-code' })}`)
  assert.equal(callback.status, 302)
  assert.equal(callback.headers.get('location'), '/')
  const response = await client.request('/api/session')
  const session = await response.json()
  assert.equal(session.user.login, 'octocat')
  return session
}
