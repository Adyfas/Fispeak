import { useEffect, useRef } from 'react'
import type { PartialLine, TranscriptLine } from '@shared/api'
import { useTranslateStore } from '@/stores/translateStore'

function formatStamp(startedMs: number): string {
  const total = Math.max(0, Math.round(startedMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function Line({ line }: { line: TranscriptLine }): JSX.Element {
  const isYou = line.tag === 'you'
  return (
    <li
      className={`relative overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.028] px-2.5 py-1.5 pl-3 ${
        line.translated ? '' : 'opacity-80'
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-1 left-0 w-[2px] rounded-full ${isYou ? 'bg-[#0A84FF]' : 'bg-white/20'}`}
      />
      <div className="flex items-center gap-2">
        <span
          className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${
            isYou ? 'text-[#0A84FF]' : 'text-white/40'
          }`}
        >
          {isYou ? 'You' : 'Remote'}
        </span>
        <span className="text-[9px] tabular-nums text-white/25">{formatStamp(line.startedMs)}</span>
        {line.quality === 'warn' && (
          <span className="text-[9px] text-amber-300/70" title="The translation may be off">
            low confidence
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[10.5px] leading-snug text-white/40">{line.text}</p>
      {line.translated ? (
        <p className="mt-0.5 text-[13px] font-medium leading-snug text-white/95">{line.translated}</p>
      ) : (
        <p className="mt-0.5 text-[11px] italic leading-snug text-white/25">translating…</p>
      )}
    </li>
  )
}

/**
 * The in-progress line (15-revisi-listen-speak-realtime M-B). It is dimmed and may change at
 * any moment; once the sidecar commits it, the final row replaces it in the same position.
 */
function PartialRow({ line }: { line: PartialLine }): JSX.Element {
  const isYou = line.tag === 'you'
  return (
    <li className="relative overflow-hidden rounded-xl border border-dashed border-white/[0.06] bg-white/[0.018] px-2.5 py-1.5 pl-3">
      <span
        aria-hidden
        className={`absolute inset-y-1 left-0 w-[2px] rounded-full ${isYou ? 'bg-[#0A84FF]/40' : 'bg-white/10'}`}
      />
      <div className="flex items-center gap-2">
        <span
          className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${
            isYou ? 'text-[#0A84FF]/60' : 'text-white/25'
          }`}
        >
          {isYou ? 'You' : 'Remote'}
        </span>
        <span className="text-[9px] tabular-nums text-white/20">{formatStamp(line.startedMs)}</span>
        <span className="text-[9px] italic text-white/20">live</span>
      </div>
      <p className="mt-0.5 text-[10.5px] italic leading-snug text-white/45">
        {line.text}
        <span className="ml-0.5 animate-pulse text-white/30">…</span>
      </p>
    </li>
  )
}

/** Scrolling transcript, newest line at the bottom (04-ui-spec §4.3). */
export function TranscriptList(): JSX.Element {
  const lines = useTranslateStore((state) => state.lines)
  const mode = useTranslateStore((state) => state.mode)
  const partials = useTranslateStore((state) => state.partials)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // In LISTEN mode only show remote lines; in SPEAK the SpeakCard is shown instead.
  const visibleLines = mode === 'listen' ? lines.filter((l) => l.tag === 'remote') : lines.filter((l) => l.tag === 'you')

  // Partials change several times per second; scrolling on their text length keeps the live row
  // in view without re-rendering the committed list on every keystroke of the recogniser.
  const partialChars = (partials.you?.text.length ?? 0) + (partials.remote?.text.length ?? 0)
  useEffect(() => {
    // jsdom has no scrollIntoView implementation.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [visibleLines.length, partialChars])

  const live = [partials.you, partials.remote]
    .filter((line): line is PartialLine => line !== null)
    .sort((a, b) => a.startedMs - b.startedMs)

  if (visibleLines.length === 0 && live.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex h-full items-center justify-center text-center">
          <p className="text-[11px] leading-relaxed text-white/30">
            Listening…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <ul className="flex flex-col gap-2">
        {visibleLines.map((line) => (
          <Line key={line.chunkId} line={line} />
        ))}
        {live.map((line) => (
          <PartialRow key={`partial-${line.tag}`} line={line} />
        ))}
      </ul>
      <div ref={bottomRef} />
    </div>
  )
}
