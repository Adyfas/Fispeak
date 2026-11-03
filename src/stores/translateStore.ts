import { create } from 'zustand'
import type {
  AudioTag,
  CaptureStatus,
  PartialLine,
  SidecarEvent,
  TranscriptLine,
  TranslateMode
} from '@shared/api'

const MAX_LINES = 60

interface SpeakTranslation {
  srcText: string
  text: string
  tgtLang: string
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Overlapping VAD windows can repeat the tail of the previous phrase; drop exact echoes. */
function isEcho(lines: TranscriptLine[], tag: AudioTag, text: string, startedMs: number): boolean {
  const normalized = normalize(text)
  if (!normalized) return false
  return lines
    .slice(-2)
    .some(
      (line) =>
        line.tag === tag &&
        Math.abs(line.startedMs - startedMs) < 4_000 &&
        normalize(line.text) === normalized
    )
}

interface TranslateStore {
  lines: TranscriptLine[]
  partials: Record<AudioTag, PartialLine | null>
  speakTranslation: SpeakTranslation | null
  speakFinalText: string | null
  levels: Record<AudioTag, number>
  status: CaptureStatus | null
  mode: TranslateMode
  sttMode: 'stream' | 'batch' | null
  lastError: string | null
  applyEvent(event: SidecarEvent): void
  setStatus(status: CaptureStatus): void
  setMode(mode: TranslateMode): void
  setLevel(tag: AudioTag, level: number): void
  reset(): void
  clearSpeakFinal(): void
  hydrate(lines: TranscriptLine[]): void
}

/**
 * Live transcript state of the island (04-ui-spec §4.3). The renderer only listens to the
 * events that main broadcasts from the sidecar socket.
 */
export const useTranslateStore = create<TranslateStore>((set) => ({
  lines: [],
  partials: { you: null, remote: null },
  speakTranslation: null,
  speakFinalText: null,
  levels: { you: 0, remote: 0 },
  status: null,
  mode: 'listen',
  sttMode: null,
  lastError: null,

  applyEvent: (event) => {
    if (event.t === 'partial') {
      // One live row per tag: a newer partial always replaces the previous text in place.
      set((state) => ({
        partials: {
          ...state.partials,
          [event.tag]: {
            windowId: event.window_id,
            tag: event.tag,
            text: event.text,
            startedMs: event.started_ms
          }
        }
      }))
      return
    }

    if (event.t === 'transcript') {
      set((state) => {
        if (isEcho(state.lines, event.tag, event.text, event.started_ms)) {
          return { partials: { ...state.partials, [event.tag]: null } }
        }
        const line: TranscriptLine = {
          chunkId: event.chunk_id,
          tag: event.tag,
          srcLang: event.lang,
          text: event.text,
          translated: null,
          tgtLang: null,
          quality: 'ok',
          startedMs: event.started_ms,
          endedMs: event.end_ms,
          confidence: event.conf
        }
        const lines = [...state.lines, line].slice(-MAX_LINES)
        // The committed row replaces the dim preview of the same tag.
        return { lines, partials: { ...state.partials, [event.tag]: null } }
      })
      return
    }

    if (event.t === 'translation') {
      set((state) => ({
        lines: state.lines.map((line) =>
          line.chunkId === event.chunk_id
            ? {
                ...line,
                translated: event.text_tgt,
                tgtLang: event.tgt_lang,
                quality: event.quality
              }
            : line
        )
      }))
      return
    }

    if (event.t === 'translated_text') {
      set({
        speakTranslation: {
          srcText: event.text_src,
          text: event.text_tgt,
          tgtLang: event.tgt_lang
        }
      })
      return
    }

    if (event.t === 'speak_final') {
      // SPEAK merge-on-finish: the sidecar merged all committed `you` lines.
      // Update the speak draft with the merged text.
      set((state) => ({
        ...state,
        speakFinalText: event.text
      }))
      return
    }

    if (event.t === 'stt_mode') {
      set({ sttMode: event.mode })
      return
    }

    if (event.t === 'audio_level') {
      set((state) => ({ levels: { ...state.levels, [event.tag]: event.rms } }))
      return
    }

    if (event.t === 'notice' && event.level === 'error') {
      set({ lastError: event.message })
    }
  },

  setStatus: (status) => set({ status, lastError: status.message }),
  // Switching LISTEN <-> SPEAK drops the live preview of the source that is now off.
  setMode: (mode) => set({ mode, partials: { you: null, remote: null }, lines: [] }),
  setLevel: (tag, level) =>
    set((state) => ({ levels: { ...state.levels, [tag]: level } })),
  reset: () =>
    set({
      lines: [],
      partials: { you: null, remote: null },
      speakTranslation: null,
      speakFinalText: null,
      levels: { you: 0, remote: 0 },
      lastError: null
    }),
  clearSpeakFinal: () => set({ speakFinalText: null }),
  hydrate: (lines) => set({ lines: lines.slice(-MAX_LINES) })
}))
