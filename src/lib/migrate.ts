/**
 * 项目旧名叫 StarScout，本地数据的键名是 starscout:xxx。
 * 改名为 Gitube 后，把旧数据（登录状态、收藏夹、稍后再看等）搬到 gitube:xxx 下。
 * 这个文件要在所有 store 之前导入。
 */
try {
  const OLD = 'starscout:'
  const NEW = 'gitube:'
  const oldKeys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(OLD)) oldKeys.push(k)
  }
  for (const k of oldKeys) {
    const nk = NEW + k.slice(OLD.length)
    if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k)!)
    localStorage.removeItem(k)
  }
} catch {
  /* localStorage 不可用时忽略 */
}

export {}
