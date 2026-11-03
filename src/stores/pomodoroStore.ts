import { create } from 'zustand'
import type { PomodoroConfig, PomodoroMode, PomodoroSnapshot } from '@shared/api'
import { DEFAULT_POMODORO_CONFIG } from '@shared/pomodoro'
import { getApi } from '@/lib/ipc'

interface PomodoroStore {
  snapshot: PomodoroSnapshot
  load: () => Promise<void>
  start: () => Promise<void>
  pause: () => Promise<void>
  reset: () => Promise<void>
  setMode: (mode: PomodoroMode) => Promise<void>
  configure: (patch: Partial<PomodoroConfig>) => Promise<void>
  apply: (snapshot: PomodoroSnapshot) => void
}

const initial: PomodoroSnapshot = {
  mode: 'idle',
  running: false,
  endsAt: null,
  remainingMs: DEFAULT_POMODORO_CONFIG.focusMs,
  totalMs: DEFAULT_POMODORO_CONFIG.focusMs,
  completedFocus: 0,
  config: DEFAULT_POMODORO_CONFIG
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
  setMode: async (mode) => {
    const snapshot = await getApi().pomodoro.setMode(mode)
    set({ snapshot })
  },
  configure: async (patch) => {
    const snapshot = await getApi().pomodoro.configure(patch)
    set({ snapshot })
  },
  apply: (snapshot) => set({ snapshot })
}))
