import { create } from 'zustand'
import type { ChecklistItem, Note } from '@shared/api'
import { getApi } from '@/lib/ipc'

interface NotesStore {
  notes: Note[]
  loading: boolean
  load: () => Promise<void>
  add: (body: string, items?: ChecklistItem[]) => Promise<void>
  edit: (id: string, body: string, items?: ChecklistItem[]) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useNotesStore = create<NotesStore>((set) => ({
  notes: [],
  loading: false,
  load: async () => {
    set({ loading: true })
    try {
      const notes = await getApi().notes.list()
      set({ notes })
    } finally {
      set({ loading: false })
    }
  },
  add: async (body, items) => {
    const note = await getApi().notes.create(body, items)
    set((state) => ({ notes: [note, ...state.notes].slice(0, 50) }))
  },
  edit: async (id, body, items) => {
    const notes = await getApi().notes.update(id, body, items)
    set({ notes })
  },
  remove: async (id) => {
    const notes = await getApi().notes.remove(id)
    set({ notes })
  }
}))
