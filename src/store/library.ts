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
  /** 小写 GitHub login；省略时使用默认的 1 倍。 */
  followingWeights: Record<string, number>
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
  followingWeights: {},
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const loginKey = (value: string) => value.trim().toLowerCase()
const validLogin = (value: string) => /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value)
const isWeight = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3 && Number.isInteger(value * 4)
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function savedItems(value: unknown): SavedItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SavedItem => isRecord(item) && isRecord(item.repo) &&
    typeof item.repo.nameWithOwner === 'string' && Array.isArray(item.repo.topics) &&
    typeof item.at === 'number' && Number.isFinite(item.at))
}

function loadData(login: string): LibraryData {
  try {
    const raw = localStorage.getItem(storageKey(login))
    if (!raw) return emptyData()
    const parsed: unknown = JSON.parse(raw)
    const data = emptyData()
    if (!isRecord(parsed)) return data
    data.onboarded = parsed.onboarded === true
    for (const key of ['interests', 'dislikedRepos', 'blockedTopics', 'blockedLangs'] as const) data[key] = strings(parsed[key])
    data.later = savedItems(parsed.later)
    data.history = savedItems(parsed.history).slice(0, MAX_HISTORY)
    if (Array.isArray(parsed.folders)) {
      data.folders = parsed.folders.filter((folder): folder is Record<string, unknown> =>
        isRecord(folder) && typeof folder.id === 'string' && typeof folder.name === 'string' &&
        typeof folder.createdAt === 'number' && Number.isFinite(folder.createdAt),
      ).map((folder) => ({ id: folder.id as string, name: folder.name as string, createdAt: folder.createdAt as number, items: savedItems(folder.items) }))
    }
    if (!data.folders.some((f) => f.id === DEFAULT_FOLDER_ID)) {
      data.folders.unshift(emptyData().folders[0])
    }
    const now = Date.now()
    if (Array.isArray(parsed.events)) {
      data.events = parsed.events.filter((event): event is FeedbackEvent => isRecord(event) &&
        ['star', 'save', 'later', 'open', 'dislike'].includes(event.kind as string) &&
        typeof event.at === 'number' && Number.isFinite(event.at) &&
        Array.isArray(event.topics) && event.topics.every((topic) => typeof topic === 'string') &&
        (event.lang === null || typeof event.lang === 'string'),
      ).slice(0, MAX_EVENTS)
    }
    if (isRecord(parsed.seen)) {
      data.seen = Object.fromEntries(Object.entries(parsed.seen).filter(([, at]) =>
        typeof at === 'number' && Number.isFinite(at) && at <= now && now - at < SEEN_TTL,
      )) as Record<string, number>
    }
    // 新增偏好逐项校验，非法字段不会影响既有收藏和浏览数据。
    if (isRecord(parsed.followingWeights)) {
      data.followingWeights = Object.fromEntries(Object.entries(parsed.followingWeights)
        .filter(([login, weight]) => validLogin(loginKey(login)) && isWeight(weight))
        .map(([login, weight]) => [loginKey(login), weight])) as Record<string, number>
    }
    return data
  } catch {
    return emptyData()
  }
}

const pickData = (s: LibraryState): LibraryData => ({
  version: 1,
  onboarded: s.onboarded,
  interests: s.interests,
  followingWeights: s.followingWeights,
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
  setFollowingWeight: (login: string, value: number) => void

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
      flushPendingWrite(get().login)
      set({ ...loadData(login), login })
    },

    completeOnboarding(interests) {
      set({ interests, onboarded: true })
    },
    setInterests(interests) {
      set({ interests })
    },
    setFollowingWeight(login, value) {
      const key = loginKey(login)
      if (!validLogin(key) || !isWeight(value)) return
      set({ followingWeights: { ...get().followingWeights, [key]: value } })
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
        const blockedTopics = [...new Set([...s.blockedTopics, reason.topic])]
        set({ blockedTopics })
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
      set({ events: [], dislikedRepos: [], blockedTopics: [], blockedLangs: [], seen: {}, followingWeights: {} })
    },
  }
})

/* 按账号保存当次快照，合并 300ms 内的多次修改；切换前先落盘旧账号。 */
const pendingWrites = new Map<string, { serialized: string; timer: ReturnType<typeof setTimeout> }>()
function flushPendingWrite(login: string | null) {
  if (!login) return
  const key = storageKey(login)
  const pending = pendingWrites.get(key)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingWrites.delete(key)
  try { localStorage.setItem(key, pending.serialized) } catch { /* 存储不可用时仍允许使用应用 */ }
}

useLibrary.subscribe((state) => {
  if (!state.login) return
  const key = storageKey(state.login)
  const pending = pendingWrites.get(key)
  if (pending) clearTimeout(pending.timer)
  const serialized = JSON.stringify(pickData(state))
  const login = state.login
  pendingWrites.set(key, { serialized, timer: setTimeout(() => flushPendingWrite(login), 300) })
})

/* ---------- 便捷 selector ---------- */

export const useIsSaved = (name: string) =>
  useLibrary((s) => s.folders.some((f) => f.items.some((i) => i.repo.nameWithOwner === name)))

export const useIsLater = (name: string) => useLibrary((s) => s.later.some((i) => i.repo.nameWithOwner === name))
