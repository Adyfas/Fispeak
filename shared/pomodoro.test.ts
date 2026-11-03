import { describe, expect, it } from 'vitest'
import type { PomodoroConfig } from './api'
import {
  DEFAULT_POMODORO_CONFIG,
  durationFor,
  formatDurationLabel,
  MINUTE,
  sanitizePomodoroConfig
} from './pomodoro'

describe('pomodoro config', () => {
  it('falls back to the defaults for an empty or broken patch', () => {
    expect(sanitizePomodoroConfig(null)).toEqual(DEFAULT_POMODORO_CONFIG)
    expect(sanitizePomodoroConfig({ focusMs: Number.NaN })).toEqual(DEFAULT_POMODORO_CONFIG)
  })

  it('clamps custom durations into a usable range', () => {
    const config = sanitizePomodoroConfig({
      focusMs: 0,
      shortBreakMs: 99 * MINUTE,
      longBreakMs: 2 * MINUTE,
      roundsBeforeLongBreak: 1
    })
    expect(config.focusMs).toBe(MINUTE)
    expect(config.shortBreakMs).toBe(60 * MINUTE)
    expect(config.longBreakMs).toBe(2 * MINUTE)
    expect(config.roundsBeforeLongBreak).toBe(2)
  })

  it('keeps a valid custom configuration untouched', () => {
    const custom: PomodoroConfig = {
      focusMs: 50 * MINUTE,
      shortBreakMs: 10 * MINUTE,
      longBreakMs: 25 * MINUTE,
      roundsBeforeLongBreak: 3
    }
    expect(sanitizePomodoroConfig(custom)).toEqual(custom)
    expect(durationFor('work', custom)).toBe(custom.focusMs)
    expect(durationFor('short_break', custom)).toBe(custom.shortBreakMs)
    expect(durationFor('long_break', custom)).toBe(custom.longBreakMs)
    expect(durationFor('idle', custom)).toBe(custom.focusMs)
  })

  it('formats minute and hour labels', () => {
    expect(formatDurationLabel(25 * MINUTE)).toBe('25m')
    expect(formatDurationLabel(90 * MINUTE)).toBe('1h 30m')
    expect(formatDurationLabel(120 * MINUTE)).toBe('2h')
  })
})
