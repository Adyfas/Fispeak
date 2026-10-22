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

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await getApi().settings.get()
    set({ settings, loaded: true })
  },
  update: async (patch) => {
    const current = get().settings
    set({ settings: { ...current, ...patch } })
    const settings = await getApi().settings.set(patch)
    set({ settings })
  }
}))
