const messages: Record<string, string> = {
  access_denied: 'GitHub 授权已取消，请重新登录后完成授权。',
  invalid_state: '授权会话已过期，请重新登录。',
  missing_code: 'GitHub 未返回完整授权信息，请重新登录。',
  not_configured: 'GitHub 应用尚未连接，请重新点击登录。',
  session_expired: 'GitHub 会话已失效，请重新登录。',
  exchange_connection: '连接 GitHub 授权服务失败，请检查网络后重新登录。',
  exchange_timeout: 'GitHub 授权服务响应超时，请重新登录。',
  exchange_upstream: 'GitHub 授权服务暂时不可用，请稍后重新登录。',
  exchange_rejected: 'GitHub 未接受这次授权，请重新登录；若仍失败，请检查应用连接配置。',
  exchange_invalid_response: 'GitHub 授权服务返回异常，请稍后重新登录。',
  identity_connection: '无法连接 GitHub 读取账号信息，请检查网络后重新登录。',
  identity_timeout: '读取 GitHub 账号信息超时，请重新登录。',
  identity_upstream: 'GitHub 账号服务暂时不可用，请稍后重新登录。',
  identity_unauthorized: 'GitHub 登录凭据已失效，请重新登录。',
  identity_forbidden: 'GitHub 未允许读取账号信息，请检查应用授权后重新登录。',
  identity_invalid_response: 'GitHub 返回的账号信息不完整，请稍后重新登录。',
  session_failed: '登录会话保存失败，请稍后重新登录。',
  // Older callbacks may still be open while a new app version is loaded.
  exchange_failed: 'GitHub 授权未完成，请重新登录。',
  unavailable: '暂时无法连接 GitHub 或完成登录，请检查网络后重新登录。',
  setup_failed: 'GitHub App 注册未完成，请重试登录。',
  setup_invalid_state: '应用连接会话已过期，请重新登录。',
  setup_missing_code: 'GitHub 未返回应用连接信息，请重新登录。',
  setup_in_progress: 'GitHub 应用正在连接，请稍后重新登录。',
}

export function authErrorMessage(code: string): string {
  return Object.hasOwn(messages, code) ? messages[code] : 'GitHub 登录未完成，请稍后重新登录。'
}
