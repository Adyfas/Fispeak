import type { PomodoroMode } from './api'

export const FOCUS_MS = 25 * 60_000
export const SHORT_BREAK_MS = 5 * 60_000
export const LONG_BREAK_MS = 15 * 60_000
export const FOCUS_ROUNDS_BEFORE_LONG_BREAK = 4

export function durationFor(mode: PomodoroMode): number {
  switch (mode) {
    case 'work':
      return FOCUS_MS
    case 'short_break':
      return SHORT_BREAK_MS
    case 'long_break':
      return LONG_BREAK_MS
    default:
      return FOCUS_MS
  }
}
