import { useEffect, useRef } from 'react'
import { getApi } from '@/lib/ipc'
import { usePromptStore } from '@/stores/promptStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTranslateStore } from '@/stores/translateStore'
import { StopIcon, XIcon } from '@/components/icons'

const BAR_COUNT = 9
/** Amplification for small RMS values (speech sits around 0.02-0.12). */
const LEVEL_GAIN = 2.4

/**
 * Prompt page: dictate into whatever text field has focus.
 *
 * The island stays open but compact (PROMPT_ON): waveform, live text, Stop. Stop flushes the
 * take, then main pastes it with ⌘V (or copies it when macOS Accessibility has not been
 * granted). No translation happens here.
 */
export function PromptPage({ onClose }: { onClose(): void }): JSX.Element {
  const phase = usePromptStore((store) => store.phase)
  const lines = usePromptStore((store) => store.lines)
  const partial = usePromptStore((store) => store.partial)
  const level = usePromptStore((store) => store.level)
  const result = usePromptStore((store) => store.result)
  const message = usePromptStore((store) => store.message)
  const start = usePromptStore((store) => store.start)
  const stop = usePromptStore((store) => store.stop)
  const again = usePromptStore((store) => store.again)
  const applyEvent = usePromptStore((store) => store.applyEvent)
  const captureMessage = useTranslateStore((store) => store.status?.message ?? null)
  const aiEnabled = useSettingsStore((store) => store.settings.promptAiEnabled)
  const updateSettings = useSettingsStore((store) => store.update)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listening = phase === 'live' || phase === 'starting'
  const working = phase === 'finishing' || phase === 'enhancing'
  const text = [...lines, partial].join(' ').replace(/\s+/g, ' ').trim()

  useEffect(() => {
    if (typeof window === 'undefined' || !window.fispeak) return
    return getApi().translate.onEvent(applyEvent)
  }, [applyEvent])

  // Opening the page starts the microphone; the store guards StrictMode's double mount and
  // keeps a finished result on screen until the user asks for another take.
  useEffect(() => {
    if (usePromptStore.getState().phase === 'idle') void start()
  }, [start])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [text])

  // Esc finishes the take instead of dropping it, matching the Stop button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (phase !== 'live' && phase !== 'starting') return
      event.preventDefault()
      void stop()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, stop])

  const normalized = Math.min(1, Math.sqrt(Math.max(0, level)) * LEVEL_GAIN)

  const hint =
    phase === 'enhancing'
      ? 'Enhancing with AI…'
      : result?.enhanced
        ? 'AI prompt'
        : result?.aiFailed
          ? 'AI failed · raw text'
          : result?.pasted
            ? 'Pasted'
            : result?.reason === 'accessibility'
              ? 'Copied · allow Accessibility'
              : result?.reason === 'empty'
                ? 'Nothing captured'
                : result?.copied
                  ? 'Copied · ⌘V'
                  : phase === 'error'
                    ? 'Engine error'
                    : phase === 'finishing'
                      ? 'Saving…'
                      : 'Auto-paste on stop'

  return (
    <div className="flex h-full items-center gap-3 px-4">
      {/* Microphone level: 9 bars, tallest in the middle. */}
      <div className="flex h-9 w-[68px] shrink-0 items-center justify-center gap-[3px]" aria-hidden>
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const center = (BAR_COUNT - 1) / 2
          const shape = 1 - Math.abs(index - center) / (center + 1.6)
          const height = 3 + normalized * shape * 30
          return (
            <span
              key={index}
              className="w-[3px] rounded-full bg-gradient-to-t from-[#0A84FF] to-[#7C4DFF] transition-[height,opacity] duration-75 ease-out"
              style={{ height: `${height}px`, opacity: 0.35 + normalized * 0.65 }}
            />
          )
        })}
      </div>

      <div className="min-w-0 flex-1">
        <div ref={scrollRef} className="scrollbar-none max-h-[42px] overflow-y-auto">
          {text ? (
            <p className="text-[13px] leading-snug text-white/90">
              {lines.join(' ')}
              {partial && <span className="text-white/45"> {partial}</span>}
            </p>
          ) : (
            <p className="text-[13px] leading-snug text-white/35">
              {phase === 'error' ? 'Could not start the engine.' : 'Speak, then it lands here…'}
            </p>
          )}
        </div>
        <p className="mt-0.5 truncate text-[9px] text-white/30">
          {message ?? (listening ? 'Listening' : hint)}
        </p>
        {!message && listening && captureMessage && phase === 'live' && (
          <p className="truncate text-[9px] text-amber-300/70">{captureMessage}</p>
        )}
      </div>

      {/* Prompt AI toggle: remembered in Settings, applied on the next Stop. */}
      <button
        type="button"
        onClick={() => void updateSettings({ promptAiEnabled: !aiEnabled })}
        aria-pressed={aiEnabled}
        aria-label="Rewrite with AI"
        title={aiEnabled ? 'AI prompt on' : 'AI prompt off'}
        className={`h-7 shrink-0 rounded-full px-2.5 text-[10px] font-semibold tracking-wide transition ${
          aiEnabled
            ? 'bg-[#7C4DFF]/90 text-white shadow-[0_0_16px_rgba(124,77,255,0.35)]'
            : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.12] hover:text-white/70'
        }`}
      >
        AI
      </button>

      {listening ? (
        <button
          type="button"
          onClick={() => void stop()}
          aria-label="Stop"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FF3B30]/20 text-[#FF6B6B] transition hover:bg-[#FF3B30]/30 active:scale-95"
        >
          <StopIcon className="h-3.5 w-3.5" />
        </button>
      ) : working ? (
        <div
          className={`h-10 w-10 shrink-0 rounded-full border ${
            phase === 'enhancing'
              ? 'animate-pulse border-[#7C4DFF]/60 bg-[#7C4DFF]/15'
              : 'border-white/10'
          }`}
        />
      ) : (
        <button
          type="button"
          onClick={() => void again()}
          className="shrink-0 rounded-full bg-[#0A84FF]/90 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-[#0A84FF]"
        >
          Again
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close prompt"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/35 transition hover:bg-white/10 hover:text-white/70"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  )
}
