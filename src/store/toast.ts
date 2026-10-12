import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  tone: 'default' | 'error'
  action?: { label: string; onClick: () => void }
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id' | 'tone'> & { tone?: Toast['tone'] }) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq
    const toast: Toast = { tone: 'default', ...t, id }
    // 最多同时显示 3 条
    set({ toasts: [...get().toasts.slice(-2), toast] })
    setTimeout(() => get().dismiss(id), t.action ? 5000 : 3000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}))

export function toast(text: string, action?: Toast['action']) {
  useToasts.getState().push({ text, action })
}

export function toastError(err: unknown) {
  const text = err instanceof Error ? err.message : String(err)
  useToasts.getState().push({ text, tone: 'error' })
}
