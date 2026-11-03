import { useEffect, useMemo, useState } from 'react'
import type { PomodoroConfig, PomodoroMode } from '@shared/api'
import { formatDurationLabel, MINUTE } from '@shared/pomodoro'
import { Block } from '@/components/Block'
import {
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ResetIcon,
  SettingsIcon
} from '@/components/icons'
import { formatCountdown, remainingFor } from '@/lib/time'
import { usePomodoroStore } from '@/stores/pomodoroStore'

const MODE_LABEL: Record<PomodoroMode, string> = {
  idle: 'Focus',
  work: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break'
}

const PHASE_TABS: ReadonlyArray<{ mode: PomodoroMode; label: string }> = [
  { mode: 'work', label: 'Focus' },
  { mode: 'short_break', label: 'Short' },
  { mode: 'long_break', label: 'Long' }
]

const ACCENT: Record<PomodoroMode, { solid: string; from: string; to: string }> = {
  idle: { solid: '#0A84FF', from: '#0A84FF', to: '#6C8CFF' },
  work: { solid: '#0A84FF', from: '#0A84FF', to: '#6C8CFF' },
  short_break: { solid: '#30D158', from: '#30D158', to: '#8BE9B4' },
  long_break: { solid: '#2AC7A9', from: '#2AC7A9', to: '#7DE8D3' }
}

const RING_RADIUS = 26
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface DurationRow {
  key: keyof PomodoroConfig
  label: string
  stepMinutes: number
  minMs: number
  maxMs: number
}

const DURATION_ROWS: ReadonlyArray<DurationRow> = [
  { key: 'focusMs', label: 'Focus', stepMinutes: 5, minMs: MINUTE, maxMs: 180 * MINUTE },
  { key: 'shortBreakMs', label: 'Break', stepMinutes: 1, minMs: MINUTE, maxMs: 60 * MINUTE },
  { key: 'longBreakMs', label: 'Long', stepMinutes: 5, minMs: MINUTE, maxMs: 120 * MINUTE }
]

function Stepper({
  label,
  valueMs,
  stepMinutes,
  minMs,
  maxMs,
  onChange
}: {
  label: string
  valueMs: number
  stepMinutes: number
  minMs: number
  maxMs: number
  onChange: (next: number) => void
}): JSX.Element {
  const step = stepMinutes * MINUTE
  const clamp = (value: number): number => Math.min(maxMs, Math.max(minMs, value))
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-[10px] text-white/55">{label}</span>
      <span className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()} duration`}
          onClick={() => onChange(clamp(valueMs - step))}
          disabled={valueMs <= minMs}
          className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.07] text-white/60 transition hover:bg-white/15 hover:text-white disabled:opacity-25"
        >
          <MinusIcon className="h-2.5 w-2.5" />
        </button>
        <span className="w-11 text-center text-[10px] font-medium tabular-nums text-white/85">
          {formatDurationLabel(valueMs)}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()} duration`}
          onClick={() => onChange(clamp(valueMs + step))}
          disabled={valueMs >= maxMs}
          className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.07] text-white/60 transition hover:bg-white/15 hover:text-white disabled:opacity-25"
        >
          <PlusIcon className="h-2.5 w-2.5" />
        </button>
      </span>
    </div>
  )
}

export function PomodoroPanel(): JSX.Element {
  const snapshot = usePomodoroStore((state) => state.snapshot)
  const start = usePomodoroStore((state) => state.start)
  const pause = usePomodoroStore((state) => state.pause)
  const reset = usePomodoroStore((state) => state.reset)
  const setMode = usePomodoroStore((state) => state.setMode)
  const configure = usePomodoroStore((state) => state.configure)

  const [editing, setEditing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // One local tick drives the smooth countdown; main only sends phase changes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  const config = snapshot.config
  const phase = snapshot.mode === 'idle' ? 'work' : snapshot.mode
  const accent = ACCENT[snapshot.mode]
  const total = Math.max(1, snapshot.totalMs)
  const remaining = remainingFor(snapshot, now)
  const progress = Math.min(1, Math.max(0, 1 - remaining / total))

  const dots = useMemo(() => {
    const cycle = snapshot.completedFocus % config.roundsBeforeLongBreak
    if (snapshot.completedFocus > 0 && cycle === 0) return config.roundsBeforeLongBreak
    return cycle
  }, [snapshot.completedFocus, config.roundsBeforeLongBreak])

  const head = useMemo(() => {
    const angle = progress * 2 * Math.PI
    return { x: 32 + RING_RADIUS * Math.sin(angle), y: 32 - RING_RADIUS * Math.cos(angle) }
  }, [progress])

  const activeTab = PHASE_TABS.find((tab) => tab.mode === phase)?.mode ?? 'work'

  return (
    <Block
      label={MODE_LABEL[snapshot.mode]}
      className="flex-1"
      bodyClassName="items-stretch justify-between gap-2"
      slot={
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: config.roundsBeforeLongBreak }).map((_, index) => (
            <span
              key={index}
              className={`h-1 w-1 rounded-full transition-colors ${
                index < dots ? 'bg-white/70' : 'bg-white/15'
              }`}
            />
          ))}
        </span>
      }
    >
      {editing ? (
        <div className="flex flex-1 flex-col justify-center gap-1.5">
          {DURATION_ROWS.map((row) => (
            <Stepper
              key={row.key}
              label={row.label}
              valueMs={config[row.key] as number}
              stepMinutes={row.stepMinutes}
              minMs={row.minMs}
              maxMs={row.maxMs}
              onChange={(next) => void configure({ [row.key]: next } as Partial<PomodoroConfig>)}
            />
          ))}
          <div className="mt-0.5 flex items-center justify-between gap-1 border-t border-white/[0.06] pt-1.5">
            <span className="text-[9px] text-white/35">Long break every</span>
            <span className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Fewer rounds before a long break"
                onClick={() =>
                  void configure({ roundsBeforeLongBreak: Math.max(2, config.roundsBeforeLongBreak - 1) })
                }
                disabled={config.roundsBeforeLongBreak <= 2}
                className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.07] text-white/60 transition hover:bg-white/15 hover:text-white disabled:opacity-25"
              >
                <MinusIcon className="h-2.5 w-2.5" />
              </button>
              <span className="w-6 text-center text-[10px] tabular-nums text-white/85">
                {config.roundsBeforeLongBreak}
              </span>
              <button
                type="button"
                aria-label="More rounds before a long break"
                onClick={() =>
                  void configure({ roundsBeforeLongBreak: Math.min(8, config.roundsBeforeLongBreak + 1) })
                }
                disabled={config.roundsBeforeLongBreak >= 8}
                className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.07] text-white/60 transition hover:bg-white/15 hover:text-white disabled:opacity-25"
              >
                <PlusIcon className="h-2.5 w-2.5" />
              </button>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="mt-0.5 rounded-lg bg-white/[0.09] py-1 text-[10px] font-medium text-white/75 transition hover:bg-white/[0.16] hover:text-white"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="relative mx-auto flex h-[112px] w-[112px] items-center justify-center">
            <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="pomodoro-ring" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={accent.from} />
                  <stop offset="100%" stopColor={accent.to} />
                </linearGradient>
              </defs>
              <circle
                cx="32"
                cy="32"
                r={RING_RADIUS}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth="4"
              />
              <circle
                cx="32"
                cy="32"
                r={RING_RADIUS}
                fill="none"
                stroke="url(#pomodoro-ring)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
                transform="rotate(-90 32 32)"
                style={{ transition: 'stroke-dashoffset 260ms linear' }}
              />
              <circle cx={head.x} cy={head.y} r="2.1" fill="white" opacity="0.9" />
            </svg>
            <div className="flex flex-col items-center">
              <span className="font-mono text-[21px] font-semibold leading-none tabular-nums tracking-tight text-white">
                {formatCountdown(remaining)}
              </span>
              <span className="mt-1 text-[8px] uppercase tracking-[0.14em] text-white/30">
                of {formatDurationLabel(total)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-0.5 rounded-full bg-white/[0.055] p-0.5">
            {PHASE_TABS.map((tab) => {
              const active = tab.mode === activeTab
              return (
                <button
                  key={tab.mode}
                  type="button"
                  onClick={() => void setMode(tab.mode)}
                  aria-pressed={active}
                  className={`flex-1 rounded-full py-1 text-[9px] font-medium transition ${
                    active ? 'text-[#0b0b0d]' : 'text-white/45 hover:text-white/80'
                  }`}
                  style={active ? { backgroundColor: ACCENT[tab.mode].solid } : undefined}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => void (snapshot.running ? pause() : start())}
              aria-label={snapshot.running ? 'Pause pomodoro' : 'Start pomodoro'}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm transition hover:brightness-110 active:scale-95"
              style={{ backgroundColor: accent.solid }}
            >
              {snapshot.running ? <PauseIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => void reset()}
              aria-label="Reset pomodoro"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-white/55 transition hover:bg-white/15 hover:text-white/90 active:scale-95"
            >
              <ResetIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit focus and break durations"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-white/55 transition hover:bg-white/15 hover:text-white/90 active:scale-95"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </Block>
  )
}
