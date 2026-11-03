import { create } from 'zustand'
import type { DictationResult, SidecarEvent } from '@shared/api'
import { getApi } from '@/lib/ipc'
import { useSettingsStore } from './settingsStore'

export type PromptPhase = 'idle' | 'starting' | 'live' | 'finishing' | 'enhancing' | 'done' | 'error'

interface PromptStore {
  phase: PromptPhase
  /** Committed sentences of the current take. */
  lines: string[]
  /** The sentence Whisper is still refining. */
  partial: string
  /** Raw RMS of the microphone (0..1). The UI curves it before drawing. */
  level: number
  result: DictationResult | null
  message: string | null
  start(): Promise<void>
  stop(): Promise<void>
  cancel(): void
  again(): Promise<void>
  applyEvent(event: SidecarEvent): void
  clearError(): void
}

/**
 * Prompt page (dictation): microphone -> text -> paste into the focused app.
 *
 * Kept outside the component so React StrictMode's double mount in dev cannot start two
 * dictations (the second `start()` sees `starting` and returns).
 */
export const usePromptStore = create<PromptStore>((set, get) => ({
  phase: 'idle',
  lines: [],
  partial: '',
  level: 0,
  result: null,
  message: null,

  start: async () => {
    const phase = get().phase
    if (phase === 'starting' || phase === 'live' || phase === 'finishing' || phase === 'enhancing') {
      return
    }
    set({ phase: 'starting', lines: [], partial: '', level: 0, result: null, message: null })
    try {
      const ok = await getApi().dictation.start()
      if (!ok) {
        set({ phase: 'error', message: 'Engine did not start. Open Settings and check the model.' })
        return
      }
      set({ phase: 'live' })
    } catch (error) {
      set({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  },

  stop: async () => {
    if (get().phase !== 'live' && get().phase !== 'starting') return
    const { lines, partial } = get()
    const local = [...lines, partial].join(' ').replace(/\s+/g, ' ').trim()
    // Show "Enhancing…" straight away when Prompt AI is on: the main process rewrites the
    // take before pasting, which takes a second or two.
    const aiOn = useSettingsStore.getState().settings.promptAiEnabled
    set({ phase: aiOn ? 'enhancing' : 'finishing', level: 0 })
    try {
      const result = await getApi().dictation.stop(local)
      set({ phase: 'done', result, lines: result.text ? [result.text] : [], partial: '' })
    } catch (error) {
      set({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  },

  cancel: () => {
    const phase = get().phase
    if (phase === 'idle' || phase === 'done' || phase === 'error') return
    getApi().dictation.cancel()
    set({ phase: 'idle', lines: [], partial: '', level: 0, result: null, message: null })
  },

  again: async () => {
    if (get().phase === 'finishing' || get().phase === 'enhancing') return
    set({ phase: 'idle', lines: [], partial: '', result: null, level: 0, message: null })
    await get().start()
  },

  applyEvent: (event) => {
    const { phase } = get()
    if (phase !== 'live' && phase !== 'starting' && phase !== 'finishing') return

    if (event.t === 'audio_level') {
      if (event.tag === 'you') set({ level: event.rms })
      return
    }

    if (event.t === 'partial') {
      if (event.tag !== 'you') return
      set({ partial: event.text })
      return
    }

    if (event.t === 'transcript') {
      if (event.tag !== 'you') return
      set((state) => ({
        lines: [...state.lines, event.text].slice(-40),
        partial: ''
      }))
    }
  },

  clearError: () => set({ phase: 'idle', message: null })
}))
