export interface ClockFormatOptions {
  locale?: string
  timeZone?: string
  hour12?: boolean
}

export function formatClock(date: Date, options: ClockFormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(options.hour12 === undefined ? {} : { hour12: options.hour12 }),
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  }).format(date)
}

/**
 * Same clock without the AM/PM marker. The notch wings of the idle pill are only ~50 px
 * wide, so the meridiem has to go; the expanded Clock block shows the full string.
 */
export function formatClockCompact(date: Date, options: ClockFormatOptions = {}): string {
  const parts = new Intl.DateTimeFormat(options.locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(options.hour12 === undefined ? {} : { hour12: options.hour12 }),
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  }).formatToParts(date)
  return parts
    .filter((part) => part.type === 'hour' || part.type === 'minute' || part.type === 'literal')
    .map((part) => part.value)
    .join('')
    .trim()
}

export function formatDate(date: Date, options: ClockFormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  }).format(date)
}

export function formatFullDate(date: Date, options: ClockFormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  }).format(date)
}

/** mm:ss for the pomodoro display; never negative. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * The snapshot is deadline-based, so the renderer can interpolate locally every second
 * without the value being decremented twice (main ticks + renderer ticks).
 */
export function remainingFor(
  snapshot: { endsAt: number | null; remainingMs: number },
  now = Date.now()
): number {
  if (snapshot.endsAt != null) return Math.max(0, snapshot.endsAt - now)
  return Math.max(0, snapshot.remainingMs)
}

/** 0..1 fraction of the current phase already elapsed. */
export function progressFor(
  snapshot: { endsAt: number | null; remainingMs: number },
  durationMs: number,
  now = Date.now()
): number {
  if (durationMs <= 0) return 0
  const remaining = remainingFor(snapshot, now)
  return Math.min(1, Math.max(0, 1 - remaining / durationMs))
}

/** Compact timestamp for note rows: "now", "5m", "3h", "22 Oct". */
export function formatRelative(timestamp: number, now = Date.now(), locale?: string): string {
  const diff = Math.max(0, now - timestamp)
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
    new Date(timestamp)
  )
}
