import type { PomodoroConfig, PomodoroMode } from './api'

export const MINUTE = 60_000

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  focusMs: 25 * MINUTE,
  shortBreakMs: 5 * MINUTE,
  longBreakMs: 15 * MINUTE,
  roundsBeforeLongBreak: 4
}

/** Older names kept for the docs/tests that imported the fixed lengths. */
export const FOCUS_MS = DEFAULT_POMODORO_CONFIG.focusMs
export const SHORT_BREAK_MS = DEFAULT_POMODORO_CONFIG.shortBreakMs
export const LONG_BREAK_MS = DEFAULT_POMODORO_CONFIG.longBreakMs
export const FOCUS_ROUNDS_BEFORE_LONG_BREAK = DEFAULT_POMODORO_CONFIG.roundsBeforeLongBreak

const MIN_PHASE_MS = MINUTE
const MAX_FOCUS_MS = 180 * MINUTE
const MAX_BREAK_MS = 60 * MINUTE
const MAX_ROUNDS = 8

export function durationFor(mode: PomodoroMode, config: PomodoroConfig = DEFAULT_POMODORO_CONFIG): number {
  switch (mode) {
    case 'work':
      return config.focusMs
    case 'short_break':
      return config.shortBreakMs
    case 'long_break':
      return config.longBreakMs
    default:
      return config.focusMs
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/** Accepts anything that came from disk or the IPC boundary; never throws. */
export function sanitizePomodoroConfig(
  patch: Partial<PomodoroConfig> | null | undefined,
  base: PomodoroConfig = DEFAULT_POMODORO_CONFIG
): PomodoroConfig {
  const source = patch ?? {}
  return {
    focusMs: clamp(source.focusMs, MIN_PHASE_MS, MAX_FOCUS_MS, base.focusMs),
    shortBreakMs: clamp(source.shortBreakMs, MIN_PHASE_MS, MAX_BREAK_MS, base.shortBreakMs),
    longBreakMs: clamp(source.longBreakMs, MIN_PHASE_MS, MAX_BREAK_MS, base.longBreakMs),
    roundsBeforeLongBreak: clamp(source.roundsBeforeLongBreak, 2, MAX_ROUNDS, base.roundsBeforeLongBreak)
  }
}

export const POMODORO_LIMITS = {
  minPhaseMs: MIN_PHASE_MS,
  maxFocusMs: MAX_FOCUS_MS,
  maxBreakMs: MAX_BREAK_MS,
  maxRounds: MAX_ROUNDS
} as const

/** "25m" / "1h 30m" for the compact steppers. */
export function formatDurationLabel(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
