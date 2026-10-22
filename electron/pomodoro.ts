import { Notification } from 'electron'
import type { PomodoroMode, PomodoroSnapshot } from '@shared/api'
import {
  FOCUS_MS,
  FOCUS_ROUNDS_BEFORE_LONG_BREAK,
  durationFor
} from '@shared/pomodoro'
import { readJsonSetting, writeJsonSetting } from './db/settingsStore'
import { logger } from './logger'

export { FOCUS_MS, SHORT_BREAK_MS, LONG_BREAK_MS, FOCUS_ROUNDS_BEFORE_LONG_BREAK, durationFor } from '@shared/pomodoro'

const STORAGE_KEY = 'pomodoro'
/** A phase that ended while the app was closed for a long time is not worth a notification. */
const STALE_PHASE_MS = 60_000

interface StoredPomodoro {
  mode: PomodoroMode
  remainingMs: number
  completedFocus: number
  endsAt: number | null
}

function notificationFor(mode: PomodoroMode): { title: string; body: string } {
  if (mode === 'work') return { title: 'Focus session done', body: 'Nice. Time for a break.' }
  return { title: 'Break over', body: 'Back to focus when you are ready.' }
}

/**
 * Countdown is deadline-based: the renderer interpolates from `endsAt`, so a 1 s tick can
 * never make the clock drift or run twice as fast (the Phase 1 bug).
 */
export class PomodoroController {
  private mode: PomodoroMode = 'idle'
  private remainingMs = FOCUS_MS
  private completedFocus = 0
  private deadline: number | null = null
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<(snapshot: PomodoroSnapshot) => void>()

  constructor() {
    const stored = readJsonSetting<StoredPomodoro>(STORAGE_KEY)
    if (stored) {
      this.mode = stored.mode
      this.remainingMs = stored.remainingMs
      this.completedFocus = stored.completedFocus
      if (stored.endsAt && stored.endsAt > Date.now()) {
        this.deadline = stored.endsAt
        this.startTimer()
      } else if (stored.endsAt) {
        const expected = durationFor(stored.mode)
        this.remainingMs = stored.endsAt > Date.now() - STALE_PHASE_MS ? 0 : expected
      }
    }
  }

  onChange(listener: (snapshot: PomodoroSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get(): PomodoroSnapshot {
    return {
      mode: this.mode,
      running: this.deadline !== null,
      endsAt: this.deadline,
      remainingMs: this.deadline ? this.remainingMs : Math.max(0, this.remainingMs),
      completedFocus: this.completedFocus
    }
  }

  isRunning(): boolean {
    return this.deadline !== null
  }

  start(): PomodoroSnapshot {
    if (this.deadline) return this.get()

    const mode: PomodoroMode = this.mode === 'idle' ? 'work' : this.mode
    const remainingMs =
      this.remainingMs > 0 && mode === this.mode ? this.remainingMs : durationFor(mode)

    this.mode = mode
    this.remainingMs = remainingMs
    this.deadline = Date.now() + remainingMs
    this.startTimer()
    this.persist()
    this.emit()
    return this.get()
  }

  pause(): PomodoroSnapshot {
    if (this.deadline) {
      this.remainingMs = Math.max(0, this.deadline - Date.now())
      this.deadline = null
      this.stopTimer()
      this.persist()
      this.emit()
    }
    return this.get()
  }

  reset(): PomodoroSnapshot {
    this.deadline = null
    this.stopTimer()
    this.mode = 'idle'
    this.remainingMs = FOCUS_MS
    this.persist()
    this.emit()
    return this.get()
  }

  dispose(): void {
    this.stopTimer()
    this.listeners.clear()
  }

  private startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    if (!this.deadline) return
    if (Date.now() >= this.deadline) {
      this.completeCurrentPhase()
      return
    }
    this.emit()
  }

  private completeCurrentPhase(): void {
    const finished = this.mode
    this.deadline = null
    this.stopTimer()

    if (finished === 'work') this.completedFocus += 1

    const nextMode: PomodoroMode =
      finished === 'work'
        ? this.completedFocus % FOCUS_ROUNDS_BEFORE_LONG_BREAK === 0
          ? 'long_break'
          : 'short_break'
        : 'work'

    this.mode = nextMode
    this.remainingMs = durationFor(nextMode)
    this.persist()
    this.notify(finished)
    this.emit()
  }

  private notify(finished: PomodoroMode): void {
    try {
      if (!Notification.isSupported()) return
      const { title, body } = notificationFor(finished)
      new Notification({ title: `fispeak - ${title}`, body }).show()
    } catch (error) {
      logger.warn('pomodoro', 'notification failed', { error: String(error) })
    }
  }

  private persist(): void {
    const stored: StoredPomodoro = {
      mode: this.mode,
      remainingMs: this.remainingMs,
      completedFocus: this.completedFocus,
      endsAt: this.deadline
    }
    writeJsonSetting(STORAGE_KEY, stored)
  }

  private emit(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) listener(snapshot)
  }
}
