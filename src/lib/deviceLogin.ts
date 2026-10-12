/**
 * 桌面版的「使用 GitHub 账号登录」：GitHub 设备码登录（OAuth Device Flow）
 * https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 *
 * 1. 向 GitHub 申请一个验证码
 * 2. 用户在浏览器里打开 github.com/login/device，输入验证码，点 Authorize
 * 3. 应用按 GitHub 要求的间隔反复查询，授权完成后拿到 access token，之后和 Token 登录完全一样
 *
 * GitHub 的这两个接口不允许网页跨域调用，所以请求由桌面版的 Rust 代码代发（src-tauri/src/lib.rs）。
 * 网页版没有自己的服务器，只能用 Token 登录。
 */

/** Gitube 在 GitHub 上注册的 OAuth App 的 Client ID（公开信息，可以写在代码里；留空就不显示这种登录方式） */
export const DEVICE_CLIENT_ID = 'Ov23liSWF8My4Og3ars8'

/** 和 Token 登录需要的权限一样 */
export const DEVICE_SCOPES = 'read:user public_repo user:follow'

export interface DeviceCode {
  deviceCode: string
  /** 用户要在浏览器里输入的验证码，形如 ABCD-1234 */
  userCode: string
  verificationUri: string
  /** 验证码过期的时间点（毫秒时间戳） */
  expiresAt: number
  /** 两次查询之间至少等几秒 */
  interval: number
}

type Json = Record<string, unknown>

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

/** 调用 src-tauri/src/lib.rs 里的命令。Rust 返回的错误是字符串，这里统一转成 Error */
async function invoke(cmd: string, args: Record<string, unknown>): Promise<Json> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (!internals) throw new Error('只有桌面版支持用 GitHub 账号登录，网页版请用 Token 登录')
  try {
    return (await internals.invoke(cmd, args)) as Json
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

/** 把 GitHub 返回的错误代码翻译成用户看得懂的话 */
function describe(data: Json): string {
  switch (data.error) {
    case 'expired_token':
    case 'token_expired':
      return '验证码过期了，请重新获取'
    case 'access_denied':
      return '你在 GitHub 上取消了授权'
    case 'device_flow_disabled':
      return 'Gitube 的 GitHub 应用没有开启设备码登录，请先用 Token 登录'
    case 'incorrect_client_credentials':
    case 'Not Found': // Client ID 写错时 GitHub 返回的是这个
      return 'Gitube 的 GitHub 应用设置有误，请先用 Token 登录'
    case 'incorrect_device_code':
      return '验证码无效，请重新获取'
    default:
      return String(data.error_description ?? data.error ?? 'GitHub 登录失败，请稍后再试')
  }
}

function aborted() {
  return new DOMException('已取消', 'AbortError')
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(aborted())
    const onAbort = () => {
      clearTimeout(timer)
      reject(aborted())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 第 1 步：申请验证码 */
export async function requestDeviceCode(): Promise<DeviceCode> {
  const data = await invoke('github_device_code', { clientId: DEVICE_CLIENT_ID, scope: DEVICE_SCOPES })
  if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string') {
    throw new Error(describe(data))
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri:
      typeof data.verification_uri === 'string' ? data.verification_uri : 'https://github.com/login/device',
    expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000,
    interval: Number(data.interval) || 5,
  }
}

/** 第 2 步：等用户在浏览器里授权，返回 access token。可以用 signal 取消 */
export async function waitForToken(code: DeviceCode, signal: AbortSignal): Promise<string> {
  let interval = code.interval
  let networkErrors = 0
  for (;;) {
    await sleep(interval * 1000, signal)
    if (Date.now() > code.expiresAt) throw new Error('验证码过期了，请重新获取')

    let data: Json
    try {
      data = await invoke('github_device_token', { clientId: DEVICE_CLIENT_ID, deviceCode: code.deviceCode })
      networkErrors = 0
    } catch (err) {
      // 网络偶尔抖一下就再等等，连续失败 3 次才报错
      if (signal.aborted) throw aborted()
      if (++networkErrors >= 3) throw err
      continue
    }
    if (signal.aborted) throw aborted()

    if (typeof data.access_token === 'string' && data.access_token) return data.access_token
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      // GitHub 嫌查得太勤，会给出新的间隔
      interval = Number(data.interval) || interval + 5
      continue
    }
    throw new Error(describe(data))
  }
}
