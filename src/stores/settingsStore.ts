import { create } from 'zustand'
import type { Settings } from '@shared/api'
import { DEFAULT_SETTINGS } from '@shared/api'
import { getApi } from '@/lib/ipc'

interface SettingsStore {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
}

/**
 * Settings are written through the main process (SQLite). Two rules keep the UI honest:
 *
 * 1. The local state is updated optimistically, so a slider never jumps back while the IPC
 *    round-trip is in flight.
 * 2. Only the response of the *latest* write is applied. Without the sequence guard a slow
 *    earlier response could overwrite a newer value - which is how a dragged slider used to
 *    snap back to its old position.
 */
let writeSeq = 0

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await getApi().settings.get()
    set({ settings, loaded: true })
  },
  update: async (patch) => {
    const seq = ++writeSeq
    const current = get().settings
    const optimistic: Settings = {
      ...current,
      ...patch,
      ai: patch.ai
        ? { ...current.ai, ...patch.ai, models: { ...current.ai.models, ...patch.ai.models } }
        : current.ai
    }
    set({ settings: optimistic })

    const settings = await getApi().settings.set(patch)
    if (seq === writeSeq) set({ settings })
  }
}))
