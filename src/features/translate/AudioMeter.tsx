import { useTranslateStore } from '@/stores/translateStore'

/**
 * Three vertical bars that follow the input level (04-ui-spec §4.3).
 *
 * RMS values are small (0.01–0.1), so a linear scale barely moves. A square-root curve makes
 * quiet speech visible while keeping loud peaks bounded.
 */
export function AudioMeter({ className = '' }: { className?: string }): JSX.Element {
  const levels = useTranslateStore((state) => state.levels)
  const peak = Math.max(levels.you, levels.remote)
  const normalized = Math.min(1, Math.sqrt(Math.max(0, peak)) * 2.4)

  return (
    <div
      className={`flex h-4 items-end gap-[3px] ${className}`}
      aria-hidden
      title="Input level"
    >
      {[0, 1, 2].map((index) => {
        const spread = 0.55 + index * 0.25
        const height = 3 + normalized * spread * 12
        return (
          <span
            key={index}
            className="w-[3px] rounded-full bg-[#0A84FF] transition-[height,opacity] duration-75 ease-out"
            style={{ height: `${height}px`, opacity: 0.55 + normalized * 0.45 }}
          />
        )
      })}
    </div>
  )
}
