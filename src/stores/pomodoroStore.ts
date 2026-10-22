import { create } from 'zustand'
import type { PomodoroSnapshot } from '@shared/api'
import { getApi } from '@/lib/ipc'

interface PomodoroStore {
  snapshot: PomodoroSnapshot
  load: () => Promise<void>
  start: () => Promise<void>
  pause: () => Promise<void>
  reset: () => Promise<void>
  apply: (snapshot: PomodoroSnapshot) => void
}

const initial: PomodoroSnapshot = {
  mode: 'idle',
  running: false,
  endsAt: null,
  remainingMs: 25 * 60_000,
  completedFocus: 0
}

export const usePomodoroStore = create<PomodoroStore>((set) => ({
  snapshot: initial,
  load: async () => {
    const snapshot = await getApi().pomodoro.get()
    set({ snapshot })
  },
  start: async () => {
    const snapshot = await getApi().pomodoro.start()
    set({ snapshot })
  },
  pause: async () => {
    const snapshot = await getApi().pomodoro.pause()
    set({ snapshot })
  },
  reset: async () => {
    const snapshot = await getApi().pomodoro.reset()
    set({ snapshot })
  },
  apply: (snapshot) => set({ snapshot })
}))
