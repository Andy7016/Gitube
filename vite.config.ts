import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 可选的 GitHub OAuth 登录。
 *
 * 浏览器不能直接用 OAuth code 换 token（需要 client secret，且 GitHub 的这个接口不支持跨域），
 * 所以这里在 Vite 的开发/预览服务器上挂一个很小的接口：
 *   POST /api/github/oauth/token  { code, redirect_uri }  ->  { access_token, scope }
 *
 * 只有在 .env 里同时配置了 VITE_GITHUB_CLIENT_ID 和 GITHUB_CLIENT_SECRET 时才会启用。
 * 没配置也没关系：登录页会只显示 Personal Access Token 登录方式。
 */
function githubOAuth(clientId?: string, clientSecret?: string): Plugin {
  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (!req.url?.startsWith('/api/github/oauth/token')) return next()

    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    }

    if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' })
    if (!clientId || !clientSecret) {
      return send(501, {
        error: 'oauth_not_configured',
        error_description: '服务器没有配置 VITE_GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET',
      })
    }

    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const { code, redirect_uri } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      if (!code) return send(400, { error: 'missing_code' })

      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri,
        }),
      })
      const data = await r.json()
      if (data.error) return send(400, data)
      return send(200, { access_token: data.access_token, scope: data.scope })
    } catch (err) {
      return send(502, {
        error: 'exchange_failed',
        error_description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    name: 'gitube-github-oauth',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // 用相对路径打包：同一份 dist/ 既能放在 GitHub Pages 的子路径 /Gitube/ 下，也能被桌面版直接加载
    base: './',
    plugins: [react(), githubOAuth(env.VITE_GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET)],
    // 下面几项是给桌面版（Tauri）开发时用的
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    server: {
      port: 5173,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    preview: { port: 4173 },
  }
})
