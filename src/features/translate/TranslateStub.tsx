import { MicIcon, SpeakerIcon, StopIcon } from '@/components/icons'
import { usePillStore } from '@/stores/pillStore'

/**
 * Phase 1 placeholder for TRANSLATE_ON / TRANSLATE_MINI. Audio capture and the sidecar
 * arrive in Phases 2-3; this keeps the layout and state machine honest until then.
 */
export function TranslateStub({ variant }: { variant: 'full' | 'mini' }): JSX.Element {
  const dispatch = usePillStore((state) => state.dispatch)

  if (variant === 'mini') {
    return (
      <div className="flex h-full items-center gap-2 px-3">
        <SpeakerIcon className="h-3 w-3 shrink-0 text-[#4CD964]" />
        <span className="truncate text-[11px] text-white/70">
          Live translation lands in Phase 3
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-end gap-[3px]" aria-hidden>
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              key={index}
              className="audio-bar w-[3px] rounded-full bg-[#0A84FF]"
              style={{ animationDelay: `${index * 120}ms` }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => dispatch('stop-translate')}
          className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70 transition hover:bg-white/20"
        >
          <StopIcon className="h-2.5 w-2.5" /> stop
        </button>
      </div>

      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40">
        <span>EN → ID</span>
        <span className="text-white/20">selectors in Phase 3</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-center">
        <MicIcon className="h-5 w-5 text-white/25" />
        <p className="text-[11px] text-white/45">Live transcript &amp; translation arrive in Phase 3.</p>
        <p className="text-[10px] text-white/25">Sidecar, audio capture and models are not wired yet.</p>
      </div>

      <div className="flex items-center justify-between text-[10px] text-white/30">
        <span className="flex items-center gap-1">
          <MicIcon className="h-3 w-3" /> you: id
        </span>
        <span className="flex items-center gap-1">
          <SpeakerIcon className="h-3 w-3" /> tts: en
        </span>
      </div>
    </div>
  )
}
