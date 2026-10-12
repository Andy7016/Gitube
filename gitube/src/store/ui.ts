import { create } from 'zustand'
import type { Repo } from '../api/types'

/** 「收藏到…」弹窗：全局只有一个，任何地方都可以打开 */
interface SaveDialogState {
  repo: Repo | null
  open: (repo: Repo) => void
  close: () => void
}

export const useSaveDialog = create<SaveDialogState>((set) => ({
  repo: null,
  open: (repo) => set({ repo }),
  close: () => set({ repo: null }),
}))
