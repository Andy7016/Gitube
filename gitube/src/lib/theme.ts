export type Theme = 'system' | 'light' | 'dark'
const KEY = 'gitube:theme'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'system') delete root.dataset.theme
  else root.dataset.theme = t
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* ignore */
  }
  applyTheme(t)
}
