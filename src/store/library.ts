import { create } from 'zustand'
import type { Repo } from '../api/types'

/**
 * 「我的」数据：收藏夹、稍后再看、历史记录、推荐反馈。
 * 这些是本应用自己的功能（GitHub 没有对应的公开 API），保存在浏览器 localStorage 里，
 * 按 GitHub 用户名分开存，换账号登录互不影响。
 */

export interface SavedItem {
  repo: Repo
  at: number
}

export interface Folder {
  id: string
  name: string
  createdAt: number
  /** 新的在前 */
  items: SavedItem[]
}

export type EventKind = 'star' | 'save' | 'later' | 'open' | 'dislike'

export interface FeedbackEvent {
  kind: EventKind
  topics: string[]
  lang: string | null
  at: number
}

export type DislikeReason =
  | { type: 'repo' }
  | { type: 'topic'; topic: string }
  | { type: 'lang'; lang: string }

export interface LibraryData {
  version: 1
  onboarded: boolean
  interests: string[]
  folders: Folder[]
  later: SavedItem[]
  history: SavedItem[]
  events: FeedbackEvent[]
  dislikedRepos: string[]
  blockedTopics: string[]
  blockedLangs: string[]
  /** 推荐流里展示过的仓库 -> 时间戳，用来避免重复推荐 */
  seen: Record<string, number>
}

export const DEFAULT_FOLDER_ID = 'default'

const emptyData = (): LibraryData => ({
  version: 1,
  onboarded: false,
  interests: [],
  folders: [{ id: DEFAULT_FOLDER_ID, name: '默认收藏夹', createdAt: Date.now(), items: [] }],
  later: [],
  history: [],
  events: [],
  dislikedRepos: [],
  blockedTopics: [],
  blockedLangs: [],
  seen: {},
})

const storageKey = (login: string) => `gitube:library:${login.toLowerCase()}`
const SEEN_TTL = 3 * 24 * 3600_000
const MAX_HISTORY = 300
const MAX_EVENTS = 400

function loadData(login: string): LibraryData {
  try {
    const raw = localStorage.getItem(storageKey(login))
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as LibraryData
    const data = { ...emptyData(), ...parsed }
    if (!data.folders.some((f) => f.id === DEFAULT_FOLDER_ID)) {
      data.folders.unshift(emptyData().folders[0])
    }
    // 清理过期的「已看过」记录
    const now = Date.now()
    data.seen = Object.fromEntries(Object.entries(data.seen).filter(([, t]) => now - t < SEEN_TTL))
    return data
  } catch {
    return emptyData()
  }
}

const pickData = (s: LibraryState): LibraryData => ({
  version: 1,
  onboarded: s.onboarded,
  interests: s.interests,
  folders: s.folders,
  later: s.later,
  history: s.history,
  events: s.events,
  dislikedRepos: s.dislikedRepos,
  blockedTopics: s.blockedTopics,
  blockedLangs: s.blockedLangs,
  seen: s.seen,
})

interface LibraryState extends LibraryData {
  login: string | null
  load: (login: string) => void
  completeOnboarding: (interests: string[]) => void
  setInterests: (interests: string[]) => void

  quickSave: (repo: Repo) => void
  setFolders: (repo: Repo, folderIds: string[]) => void
  removeFromFolder: (folderId: string, nameWithOwner: string) => void
  createFolder: (name: string) => string
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => void

  toggleLater: (repo: Repo) => boolean
  removeLater: (nameWithOwner: string) => void
  clearLater: () => void

  pushHistory: (repo: Repo) => void
  removeHistory: (nameWithOwner: string) => void
  clearHistory: () => void

  addEvent: (kind: EventKind, repo: Repo) => void
  dislike: (repo: Repo, reason: DislikeReason) => void
  undoDislike: (repo: Repo, reason: DislikeReason) => void
  unblockTopic: (topic: string) => void
  unblockLang: (lang: string) => void
  markSeen: (names: string[]) => void
  resetRecommendations: () => void
}

const upsertFront = (list: SavedItem[], repo: Repo, max = Infinity) =>
  [{ repo, at: Date.now() }, ...list.filter((i) => i.repo.nameWithOwner !== repo.nameWithOwner)].slice(0, max)

export const useLibrary = create<LibraryState>((set, get) => {
  const addEvent = (kind: EventKind, repo: Repo) => {
    const ev: FeedbackEvent = { kind, topics: repo.topics, lang: repo.language, at: Date.now() }
    set({ events: [ev, ...get().events].slice(0, MAX_EVENTS) })
  }

  return {
    ...emptyData(),
    login: null,

    load(login) {
      if (get().login === login) return
      set({ ...loadData(login), login })
    },

    completeOnboarding(interests) {
      set({ interests, onboarded: true })
    },
    setInterests(interests) {
      set({ interests })
    },

    quickSave(repo) {
      set({
        folders: get().folders.map((f) =>
          f.id === DEFAULT_FOLDER_ID ? { ...f, items: upsertFront(f.items, repo) } : f,
        ),
      })
      addEvent('save', repo)
    },

    setFolders(repo, folderIds) {
      const wanted = new Set(folderIds)
      const before = get().folders.some((f) => f.items.some((i) => i.repo.nameWithOwner === repo.nameWithOwner))
      set({
        folders: get().folders.map((f) => {
          const has = f.items.some((i) => i.repo.nameWithOwner === repo.nameWithOwner)
          if (wanted.has(f.id) && !has) return { ...f, items: upsertFront(f.items, repo) }
          if (!wanted.has(f.id) && has)
            return { ...f, items: f.items.filter((i) => i.repo.nameWithOwner !== repo.nameWithOwner) }
          return f
        }),
      })
      if (!before && wanted.size > 0) addEvent('save', repo)
    },

    removeFromFolder(folderId, name) {
      set({
        folders: get().folders.map((f) =>
          f.id === folderId ? { ...f, items: f.items.filter((i) => i.repo.nameWithOwner !== name) } : f,
        ),
      })
    },

    createFolder(name) {
      const id = `f${Date.now().toString(36)}`
      set({ folders: [...get().folders, { id, name: name.trim() || '新收藏夹', createdAt: Date.now(), items: [] }] })
      return id
    },
    renameFolder(id, name) {
      set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)) })
    },
    deleteFolder(id) {
      if (id === DEFAULT_FOLDER_ID) return
      set({ folders: get().folders.filter((f) => f.id !== id) })
    },

    toggleLater(repo) {
      const has = get().later.some((i) => i.repo.nameWithOwner === repo.nameWithOwner)
      if (has) {
        set({ later: get().later.filter((i) => i.repo.nameWithOwner !== repo.nameWithOwner) })
        return false
      }
      set({ later: upsertFront(get().later, repo) })
      addEvent('later', repo)
      return true
    },
    removeLater(name) {
      set({ later: get().later.filter((i) => i.repo.nameWithOwner !== name) })
    },
    clearLater() {
      set({ later: [] })
    },

    pushHistory(repo) {
      set({ history: upsertFront(get().history, repo, MAX_HISTORY) })
      addEvent('open', repo)
    },
    removeHistory(name) {
      set({ history: get().history.filter((i) => i.repo.nameWithOwner !== name) })
    },
    clearHistory() {
      set({ history: [] })
    },

    addEvent,

    dislike(repo, reason) {
      const s = get()
      if (reason.type === 'repo') {
        set({ dislikedRepos: [...new Set([repo.nameWithOwner, ...s.dislikedRepos])].slice(0, 2000) })
        addEvent('dislike', repo)
      } else if (reason.type === 'topic') {
        set({ blockedTopics: [...new Set([...s.blockedTopics, reason.topic])] })
      } else {
        set({ blockedLangs: [...new Set([...s.blockedLangs, reason.lang])] })
      }
    },

    undoDislike(repo, reason) {
      const s = get()
      if (reason.type === 'repo') {
        set({
          dislikedRepos: s.dislikedRepos.filter((n) => n !== repo.nameWithOwner),
          events: s.events.filter((e, i) => !(i === 0 && e.kind === 'dislike')),
        })
      } else if (reason.type === 'topic') {
        set({ blockedTopics: s.blockedTopics.filter((t) => t !== reason.topic) })
      } else {
        set({ blockedLangs: s.blockedLangs.filter((l) => l !== reason.lang) })
      }
    },

    unblockTopic(topic) {
      set({ blockedTopics: get().blockedTopics.filter((t) => t !== topic) })
    },
    unblockLang(lang) {
      set({ blockedLangs: get().blockedLangs.filter((l) => l !== lang) })
    },

    markSeen(names) {
      const now = Date.now()
      const seen = { ...get().seen }
      for (const n of names) seen[n] = now
      set({ seen })
    },

    resetRecommendations() {
      set({ events: [], dislikedRepos: [], blockedTopics: [], blockedLangs: [], seen: {} })
    },
  }
})

/* 数据变化后写回 localStorage（合并 300ms 内的多次修改） */
let timer: ReturnType<typeof setTimeout> | null = null
useLibrary.subscribe((state) => {
  if (!state.login) return
  if (timer) clearTimeout(timer)
  const login = state.login
  timer = setTimeout(() => {
    try {
      localStorage.setItem(storageKey(login), JSON.stringify(pickData(useLibrary.getState())))
    } catch {
      /* 存储满了或不可用，忽略 */
    }
  }, 300)
})

/* ---------- 便捷 selector ---------- */

export const useIsSaved = (name: string) =>
  useLibrary((s) => s.folders.some((f) => f.items.some((i) => i.repo.nameWithOwner === name)))

export const useIsLater = (name: string) => useLibrary((s) => s.later.some((i) => i.repo.nameWithOwner === name))
