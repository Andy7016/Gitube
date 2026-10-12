/** 1234 -> 1234，12345 -> 1.2万，像 B 站的播放量写法 */
export function formatCount(n: number): string {
  if (n < 10000) return String(n)
  if (n < 100000000) {
    const v = n / 10000
    return `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}万`
  }
  return `${Number((n / 100000000).toFixed(1))}亿`
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 相对时间：刚刚 / 5分钟前 / 3小时前 / 昨天 / 4天前 / 3个月前 / 2年前 */
export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return ''
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`
  if (diff < 2 * DAY) return '昨天'
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}天前`
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}个月前`
  return `${Math.floor(diff / (365 * DAY))}年前`
}

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 9999
  return (Date.now() - new Date(iso).getTime()) / DAY
}

/** 今天 / 昨天 / 本周 / 更早，用于历史记录分组 */
export function dayBucket(ts: number): string {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfToday) return '今天'
  if (ts >= startOfToday - DAY) return '昨天'
  if (ts >= startOfToday - 6 * DAY) return '近一周'
  return '更早'
}

/** 搜索语法里用的日期 YYYY-MM-DD */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10)
}

export function cloneCommand(nameWithOwner: string) {
  return `git clone https://github.com/${nameWithOwner}.git`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 某些环境（非 https）没有 clipboard API，退回老办法
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
