import { MicIcon, PlayIcon, StopIcon } from '@/components/icons'

interface ModeSwitchProps {
  mode: 'listen' | 'speak'
  onChange(mode: 'listen' | 'speak'): void
}

const OPTIONS: ReadonlyArray<{ id: 'listen' | 'speak'; label: string }> = [
  { id: 'listen', label: 'Listen' },
  { id: 'speak', label: 'Speak' }
]

/**
 * Listen = system audio of the meeting partner, Speak = microphone only.
 * The two capture paths are exclusive (05-audio-capture).
 */
export function ModeSwitch({ mode, onChange }: ModeSwitchProps): JSX.Element {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-white/[0.06] p-0.5" role="tablist">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={mode === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition ${
            mode === option.id ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export type SpeakPhase = 'live' | 'ready' | 'played'

interface SpeakCardProps {
  phase: SpeakPhase
  /** Live source text while the user is speaking (partial + last committed line). */
  liveText: string | null
  /** Editable draft (owned by the parent so switching phases needs no effect). */
  draft: string
  onDraftChange(text: string): void
  /** Translation returned by the sidecar after `Putar`. */
  translation: string | null
  targetLang: string
  /** False when the partner language is still `auto` (no concrete target to translate into). */
  canTranslate: boolean
  autoPlay?: boolean
  autoPlayCancelled?: boolean
  onCancelAutoPlay?(): void
  onFinish(): void
  onPlay(text: string): void
  onCopy(text: string): void
  onRetry(): void
  onSpeakAgain(): void
}

/**
 * SPEAK flow (owner decision 2026-10-25):
 * `[Speak]` live ID -> `[Selesai]` (text locked, still editable) -> `[Putar]`
 * (translate + TTS, locked after play) -> `[Ulangi]` (discard, start over).
 */
export function SpeakCard({
  phase,
  liveText,
  draft,
  onDraftChange,
  translation,
  targetLang,
  canTranslate,
  autoPlay = false,
  autoPlayCancelled = false,
  onCancelAutoPlay,
  onFinish,
  onPlay,
  onCopy,
  onRetry,
  onSpeakAgain
}: SpeakCardProps): JSX.Element {
  if (phase === 'live') {
    return (
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <MicIcon className="h-5 w-5 text-white/25" />
          {liveText ? (
            <p className="max-w-[420px] text-[13px] leading-snug text-white/60">{liveText}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-white/30">
              Speak to translate.
            </p>
          )}
        </div>
        <div className="mt-auto flex items-center gap-2">
          <button
            type="button"
            disabled={!liveText}
            onClick={onFinish}
            className="flex items-center gap-1.5 rounded-full bg-[#0A84FF] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-[#0A84FF]/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            <StopIcon className="h-2.5 w-2.5" /> Selesai
          </button>
          <span className="text-[9px] uppercase tracking-[0.08em] text-white/25">
            {targetLang.toUpperCase()}
          </span>
        </div>
      </div>
    )
  }

  if (phase === 'ready') {
    return (
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-[9px] uppercase tracking-[0.08em] text-white/30">
          Review &amp; edit
        </p>
        {autoPlay && !autoPlayCancelled && canTranslate && draft.trim() && (
          <div className="flex items-center gap-2 text-[9px] text-white/35">
            <span>Auto-play in 2s</span>
            <button
              type="button"
              onClick={onCancelAutoPlay}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] text-white/60 transition hover:bg-white/20"
            >
              Cancel
            </button>
          </div>
        )}
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          rows={3}
          aria-label="Source text before translating"
          className="w-full resize-none rounded-md bg-white/10 px-2 py-1.5 text-[12px] leading-snug text-white/90 outline-none focus:ring-1 focus:ring-[#0A84FF]/50"
        />
        <div className="mt-auto flex items-center gap-2">
          <button
            type="button"
            disabled={!canTranslate || !draft.trim()}
            onClick={() => onPlay(draft.trim())}
            title={canTranslate ? 'Translate and play' : 'Pick the partner language first'}
            className="flex items-center gap-1.5 rounded-full bg-[#0A84FF] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-[#0A84FF]/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            <PlayIcon className="h-3 w-3" /> Putar
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/20"
          >
            Ulangi
          </button>
          {!canTranslate && (
            <span className="text-[9px] text-amber-300/70">Pick partner language</span>
          )}
        </div>
      </div>
    )
  }

  // played: the translation is committed and locked; only replay / copy / restart remain.
  return (
    <div className="flex flex-1 flex-col gap-2">
      <p className="text-[11px] leading-snug text-white/45">{draft || liveText}</p>
      <p className="text-[15px] leading-snug text-white/95">
        {translation ?? <span className="text-[11px] italic text-white/25">translating…</span>}
      </p>
      <div className="mt-auto flex items-center gap-2">
        <button
          type="button"
          disabled={!translation}
          onClick={() => onPlay(draft.trim())}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/20 disabled:opacity-40"
        >
          <PlayIcon className="h-2.5 w-2.5" /> Play again
        </button>
        <button
          type="button"
          onClick={onSpeakAgain}
          className="rounded-full bg-[#0A84FF] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-[#0A84FF]/85 active:scale-[0.98]"
        >
          Speak lagi
        </button>
        <button
          type="button"
          disabled={!translation}
          onClick={() => translation && onCopy(translation)}
          className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/20 disabled:opacity-40"
        >
          Copy
        </button>
        <span className="ml-auto text-[9px] uppercase tracking-[0.08em] text-white/25">
          {targetLang.toUpperCase()}
        </span>
      </div>
    </div>
  )
}

export { StopIcon }
