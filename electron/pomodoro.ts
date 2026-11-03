import { Notification } from 'electron'
import type { PomodoroConfig, PomodoroMode, PomodoroSnapshot } from '@shared/api'
import { DEFAULT_POMODORO_CONFIG, durationFor, sanitizePomodoroConfig } from '@shared/pomodoro'
import { readJsonSetting, writeJsonSetting } from './db/settingsStore'
import { logger } from './logger'

export {
  DEFAULT_POMODORO_CONFIG,
  FOCUS_MS,
  SHORT_BREAK_MS,
  LONG_BREAK_MS,
  FOCUS_ROUNDS_BEFORE_LONG_BREAK,
  durationFor
} from '@shared/pomodoro'

const STORAGE_KEY = 'pomodoro'
/** A phase that ended while the app was closed for a long time is not worth a notification. */
const STALE_PHASE_MS = 60_000

interface StoredPomodoro {
  mode: PomodoroMode
  remainingMs: number
  totalMs?: number
  completedFocus: number
  endsAt: number | null
  config?: Partial<PomodoroConfig>
}

function notificationFor(mode: PomodoroMode): { title: string; body: string } {
  if (mode === 'work') return { title: 'Focus session done', body: 'Nice. Time for a break.' }
  return { title: 'Break over', body: 'Back to focus when you are ready.' }
}

/**
 * Countdown is deadline-based: the renderer interpolates from `endsAt`, so a 1 s tick can
 * never make the clock drift or run twice as fast (the Phase 1 bug).
 *
 * Durations are owner-editable (`configure`) and the phase can be switched by hand
 * (`setMode`), which is what the island's focus card drives.
 */
export class PomodoroController {
  private mode: PomodoroMode = 'idle'
  private config: PomodoroConfig = { ...DEFAULT_POMODORO_CONFIG }
  private remainingMs = DEFAULT_POMODORO_CONFIG.focusMs
  private totalMs = DEFAULT_POMODORO_CONFIG.focusMs
  private completedFocus = 0
  private deadline: number | null = null
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<(snapshot: PomodoroSnapshot) => void>()

  constructor() {
    const stored = readJsonSetting<StoredPomodoro>(STORAGE_KEY)
    if (!stored) return

    this.config = sanitizePomodoroConfig(stored.config)
    this.mode = stored.mode
    this.remainingMs = Math.max(0, Number(stored.remainingMs) || 0)
    this.totalMs = Math.max(
      this.remainingMs,
      Number(stored.totalMs) || durationFor(stored.mode, this.config)
    )
    this.completedFocus = Math.max(0, Number(stored.completedFocus) || 0)

    if (stored.endsAt && stored.endsAt > Date.now()) {
      this.deadline = stored.endsAt
      this.startTimer()
    } else if (stored.endsAt) {
      const expected = durationFor(stored.mode, this.config)
      const fresh = stored.endsAt > Date.now() - STALE_PHASE_MS
      this.remainingMs = fresh ? 0 : expected
      this.totalMs = expected
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
      totalMs: this.totalMs,
      completedFocus: this.completedFocus,
      config: { ...this.config }
    }
  }

  isRunning(): boolean {
    return this.deadline !== null
  }

  start(): PomodoroSnapshot {
    if (this.deadline) return this.get()

    const mode: PomodoroMode = this.mode === 'idle' ? 'work' : this.mode
    const restart = mode !== this.mode || this.remainingMs <= 0
    if (restart) {
      this.remainingMs = durationFor(mode, this.config)
      this.totalMs = this.remainingMs
    }

    this.mode = mode
    this.deadline = Date.now() + this.remainingMs
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
    this.remainingMs = durationFor('work', this.config)
    this.totalMs = this.remainingMs
    this.persist()
    this.emit()
    return this.get()
  }

  /** Manual phase switch from the card: focus / short break / long break. */
  setMode(mode: PomodoroMode): PomodoroSnapshot {
    this.deadline = null
    this.stopTimer()
    this.mode = mode
    this.remainingMs = durationFor(mode, this.config)
    this.totalMs = this.remainingMs
    this.persist()
    this.emit()
    return this.get()
  }

  /** Owner-edited phase lengths; applied to the next phase, or immediately while stopped. */
  configure(patch: Partial<PomodoroConfig>): PomodoroSnapshot {
    this.config = sanitizePomodoroConfig(patch, this.config)
    if (!this.deadline) {
      const mode = this.mode === 'idle' ? 'work' : this.mode
      this.remainingMs = durationFor(mode, this.config)
      this.totalMs = this.remainingMs
    }
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
        ? this.completedFocus % this.config.roundsBeforeLongBreak === 0
          ? 'long_break'
          : 'short_break'
        : 'work'

    this.mode = nextMode
    this.remainingMs = durationFor(nextMode, this.config)
    this.totalMs = this.remainingMs
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
      totalMs: this.totalMs,
      completedFocus: this.completedFocus,
      endsAt: this.deadline,
      config: this.config
    }
    writeJsonSetting(STORAGE_KEY, stored)
  }

  private emit(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) listener(snapshot)
  }
}
