import { create } from 'zustand'
import type { Note } from '@shared/api'
import { getApi } from '@/lib/ipc'

interface NotesStore {
  notes: Note[]
  loading: boolean
  load: () => Promise<void>
  add: (body: string) => Promise<void>
  edit: (id: string, body: string) => Promise<void>
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
  add: async (body) => {
    const note = await getApi().notes.create(body)
    set((state) => ({ notes: [note, ...state.notes].slice(0, 50) }))
  },
  edit: async (id, body) => {
    const notes = await getApi().notes.update(id, body)
    set({ notes })
  },
  remove: async (id) => {
    const notes = await getApi().notes.remove(id)
    set({ notes })
  }
}))
