import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const debugEnabled = process.env.FISPEAK_DEBUG === '1' || !app.isPackaged
let logDir: string | null = null

/** Icons keep a long terminal scroll readable while the pipeline is running. */
const ICONS: Record<string, string> = {
  main: '🟣',
  ipc: '🔌',
  settings: '⚙️',
  island: '🏝️',
  window: '🪟',
  translate: '🎧',
  audio: '🎙️',
  capture: '🎙️',
  sck: '🔊',
  sidecar: '☁️',
  ws: '🔗',
  engine: '🌍',
  models: '📦',
  db: '🗄️',
  tts: '🗣️',
  pomodoro: '⏱️',
  tray: '🧭',
  shortcuts: '⌨️'
}

function timestamp(): string {
  return new Date().toISOString()
}

function plainTime(): string {
  return new Date().toTimeString().slice(0, 8) + '.' + String(new Date().getMilliseconds()).padStart(3, '0')
}

async function writeLine(line: string): Promise<void> {
  try {
    if (!logDir) {
      logDir = join(app.getPath('userData'), 'logs')
      await mkdir(logDir, { recursive: true })
    }
    const day = timestamp().slice(0, 10).replaceAll('-', '')
    await appendFile(join(logDir, `main-${day}.log`), line + '\n', 'utf8')
  } catch {
    // Logging must never take the app down.
  }
}

function log(level: Level, scope: string, message: string, extra?: unknown): void {
  if (level === 'debug' && !debugEnabled) return
  // The log file stays machine-readable JSON; the terminal gets a readable line.
  const payload = extra === undefined ? '' : ` ${safeJson(extra)}`
  const line = `{"ts":"${timestamp()}","lvl":"${level.toUpperCase()}","mod":"${scope}","msg":${JSON.stringify(message)}}${payload}`
  const icon = ICONS[scope] ?? '•'
  const human = `[${plainTime()}] ${icon} ${scope}: ${message}${extra === undefined ? '' : ` ${safeJson(extra)}`}`
  if (level === 'error') console.error(human)
  else if (level === 'warn') console.warn(human)
  else console.log(human)
  void writeLine(line)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '"<unserializable>"'
  }
}

export const logger = {
  debug: (scope: string, message: string, extra?: unknown) => log('debug', scope, message, extra),
  info: (scope: string, message: string, extra?: unknown) => log('info', scope, message, extra),
  warn: (scope: string, message: string, extra?: unknown) => log('warn', scope, message, extra),
  error: (scope: string, message: string, extra?: unknown) => log('error', scope, message, extra)
}
