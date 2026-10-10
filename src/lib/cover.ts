/**
 * 自动生成的封面：
 *   底色 = 仓库主语言在 GitHub 上的颜色（没有语言就由仓库名算出一个颜色）
 *   右上角 = 一块「贡献格子」，格子越亮越密，说明最近越活跃
 * 设置了自定义社交预览图的仓库直接用那张图。
 */
import type { Repo } from '../api/types'
import { daysSince } from './format'

export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 可复现的伪随机数，同一个仓库每次生成的封面一样 */
export function seededRandom(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s * 100, l * 100]
}

/**
 * 在语言颜色附近做一点偏移（色相 ±14°，明度 ±7%），
 * 这样一屏都是 Python 项目时封面也不会是同一种蓝。
 */
function jitter(rgb: [number, number, number], seed: number): [number, number, number] {
  const [h, s, l] = rgbToHsl(rgb)
  const dh = (seed % 29) - 14
  const dl = ((seed >>> 5) % 15) - 7
  return hslToRgb((h + dh + 360) % 360, Math.min(90, s + 4), Math.max(18, Math.min(78, l + dl)))
}

function relLuminance([r, g, b]: [number, number, number]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

export interface CoverDesign {
  bg: string
  /** 'light' 表示底色较亮，文字用深色 */
  tone: 'light' | 'dark'
  cells: { x: number; y: number; level: number }[]
  cols: number
  rows: number
}

export function designCover(repo: Pick<Repo, 'nameWithOwner' | 'languageColor' | 'pushedAt'>): CoverDesign {
  const seed = hashString(repo.nameWithOwner)
  const rand = seededRandom(seed)
  const langRgb = repo.languageColor ? hexToRgb(repo.languageColor) : null
  const rgb = langRgb ? jitter(langRgb, seed) : hslToRgb(seed % 360, 42 + (seed % 17), 40 + (seed % 9))
  const tone = relLuminance(rgb) > 0.36 ? 'light' : 'dark'

  // 最近 40 天内更新过的仓库，格子会更亮更密
  const activity = Math.exp(-daysSince(repo.pushedAt) / 40)
  const cols = 14
  const rows = 7
  const cells: CoverDesign['cells'] = []
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      // 越靠右越「近期」，越可能亮
      const p = (0.08 + 0.6 * activity) * (0.45 + 0.55 * (x / (cols - 1)))
      const lit = rand() < p
      cells.push({ x, y, level: lit ? 1 + Math.floor(rand() * 3) : 0 })
    }
  }

  return { bg: `rgb(${rgb.join(',')})`, tone, cells, cols, rows }
}

/** 名字越长字越小；用容器宽度单位 cqw，卡片多大字就多大 */
export function nameSize(name: string): string {
  const n = name.length
  if (n <= 6) return '12.5cqw'
  if (n <= 10) return '10cqw'
  if (n <= 15) return '8.2cqw'
  if (n <= 22) return '6.6cqw'
  if (n <= 32) return '5.4cqw'
  return '4.6cqw'
}
