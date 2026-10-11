import { createApp } from './app.mjs'

const development = process.argv.includes('--dev')
const port = Number(process.env.PORT || (development ? 5314 : 5173))
process.env.APP_URL ||= development ? 'http://127.0.0.1:5173' : `http://127.0.0.1:${port}`
const app = createApp()
app.listen(port, '127.0.0.1', (error) => {
  if (error) {
    console.error(`无法启动 RepoFlow（${error.code || 'LISTEN_FAILED'}）：127.0.0.1:${port}`)
    process.exitCode = 1
    return
  }
  console.log(`RepoFlow API: http://127.0.0.1:${port}`)
  console.log('GitHub 登录：/api/auth/github；首次本机连接可在 GitHub 页面自动注册应用。')
})
