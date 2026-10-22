import { useEffect, useState } from 'react'
import type { PomodoroMode } from '@shared/api'
import { durationFor, FOCUS_ROUNDS_BEFORE_LONG_BREAK } from '@shared/pomodoro'
import { Block } from '@/components/Block'
import { PauseIcon, PlayIcon, ResetIcon } from '@/components/icons'
import { formatCountdown, progressFor, remainingFor } from '@/lib/time'
import { usePomodoroStore } from '@/stores/pomodoroStore'

const MODE_LABEL: Record<PomodoroMode, string> = {
  idle: 'Focus',
  work: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break'
}

const RING_RADIUS = 26
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export function PomodoroPanel(): JSX.Element {
  const snapshot = usePomodoroStore((state) => state.snapshot)
  const start = usePomodoroStore((state) => state.start)
  const pause = usePomodoroStore((state) => state.pause)
  const reset = usePomodoroStore((state) => state.reset)
  const [now, setNow] = useState(() => Date.now())

  // One local tick drives the smooth countdown; main only sends phase changes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])

  const duration = durationFor(snapshot.mode)
  const remaining = remainingFor(snapshot, now)
  const progress = progressFor(snapshot, duration, now)
  const isBreak = snapshot.mode === 'short_break' || snapshot.mode === 'long_break'
  const accent = isBreak ? '#4CD964' : '#0A84FF'
  const dots = (() => {
    const cycle = snapshot.completedFocus % FOCUS_ROUNDS_BEFORE_LONG_BREAK
    if (snapshot.completedFocus > 0 && cycle === 0) return FOCUS_ROUNDS_BEFORE_LONG_BREAK
    return cycle
  })()

  return (
    <Block
      label={MODE_LABEL[snapshot.mode]}
      className="flex-1"
      bodyClassName="items-center justify-between gap-1"
      slot={
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: FOCUS_ROUNDS_BEFORE_LONG_BREAK }).map((_, index) => (
            <span
              key={index}
              className={`h-1 w-1 rounded-full ${index < dots ? 'bg-white/70' : 'bg-white/15'}`}
            />
          ))}
        </span>
      }
    >
      <div className="relative flex h-[64px] w-[64px] items-center justify-center">
        <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90">
          <circle
            cx="32"
            cy="32"
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="3.5"
          />
          <circle
            cx="32"
            cy="32"
            r={RING_RADIUS}
            fill="none"
            stroke={accent}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 500ms linear, stroke 240ms ease' }}
          />
        </svg>
        <span className="font-mono text-[12px] tabular-nums tracking-tight text-white/95">
          {formatCountdown(remaining)}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void (snapshot.running ? pause() : start())}
          aria-label={snapshot.running ? 'Pause pomodoro' : 'Start pomodoro'}
          className="flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm transition hover:brightness-110 active:scale-95"
          style={{ backgroundColor: accent }}
        >
          {snapshot.running ? <PauseIcon className="h-2.5 w-2.5" /> : <PlayIcon className="h-2.5 w-2.5" />}
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          aria-label="Reset pomodoro"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.07] text-white/55 transition hover:bg-white/15 hover:text-white/90 active:scale-95"
        >
          <ResetIcon className="h-3 w-3" />
        </button>
      </div>
    </Block>
  )
}
