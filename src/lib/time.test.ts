import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatClockCompact,
  formatCountdown,
  formatRelative,
  progressFor,
  remainingFor
} from './time'

describe('time helpers', () => {
  it('formats a 24h clock in a fixed timezone', () => {
    const date = new Date('2026-10-22T10:42:00Z')
    expect(formatClock(date, { locale: 'en-GB', timeZone: 'UTC' })).toBe('10:42')
  })

  it('can force a 12h clock', () => {
    const date = new Date('2026-10-22T10:42:00Z')
    expect(formatClock(date, { locale: 'en-US', timeZone: 'UTC', hour12: true })).toBe('10:42 AM')
    expect(formatClock(date, { locale: 'en-US', timeZone: 'UTC', hour12: false })).toBe('10:42')
  })

  it('drops the meridiem in the compact clock', () => {
    const date = new Date('2026-10-22T10:42:00Z')
    expect(formatClockCompact(date, { locale: 'en-US', timeZone: 'UTC', hour12: true })).toBe(
      '10:42'
    )
    expect(formatClockCompact(date, { locale: 'en-GB', timeZone: 'UTC' })).toBe('10:42')
    expect(
      formatClockCompact(new Date('2026-10-22T13:05:00Z'), {
        locale: 'en-US',
        timeZone: 'UTC',
        hour12: true
      })
    ).toBe('1:05')
  })

  it('formats the countdown as mm:ss and never goes negative', () => {
    expect(formatCountdown(25 * 60_000)).toBe('25:00')
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(-500)).toBe('00:00')
  })

  it('derives remaining time from a deadline snapshot', () => {
    const now = 1_000_000
    expect(remainingFor({ endsAt: now + 240_000, remainingMs: 300_000 }, now)).toBe(240_000)
    expect(remainingFor({ endsAt: null, remainingMs: 300_000 }, now)).toBe(300_000)
    expect(remainingFor({ endsAt: now - 5_000, remainingMs: 300_000 }, now)).toBe(0)
  })

  it('derives progress from the phase deadline', () => {
    const now = 1_000_000
    expect(progressFor({ endsAt: now + 300_000, remainingMs: 300_000 }, 600_000, now)).toBe(0.5)
    expect(progressFor({ endsAt: null, remainingMs: 600_000 }, 600_000, now)).toBe(0)
    expect(progressFor({ endsAt: now, remainingMs: 0 }, 600_000, now)).toBe(1)
    expect(progressFor({ endsAt: now, remainingMs: 0 }, 0, now)).toBe(0)
  })

  it('formats compact relative timestamps for note rows', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    expect(formatRelative(now - 5_000, now)).toBe('now')
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5m')
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatRelative(Date.parse('2026-10-20T12:00:00Z'), now, 'en-GB')).toBe('20 Oct')
  })
})
