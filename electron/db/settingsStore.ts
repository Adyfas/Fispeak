import type { Settings } from '@shared/api'
import { DEFAULT_SETTINGS } from '@shared/api'
import { getDb } from './db'

const SETTINGS_KEY = 'app'

function readRow(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeRow(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

export class SettingsStore {
  private cache: Settings | null = null

  get(): Settings {
    if (!this.cache) {
      const raw = readRow(SETTINGS_KEY)
      let stored: Partial<Settings> = {}
      if (raw) {
        try {
          stored = JSON.parse(raw) as Partial<Settings>
        } catch {
          stored = {}
        }
      }
      // Defaults win over unknown/missing keys; new settings added later stay backwards compatible.
      this.cache = { ...DEFAULT_SETTINGS, ...stored }
    }
    return { ...this.cache }
  }

  set(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.get(), ...patch }
    writeRow(SETTINGS_KEY, JSON.stringify(next))
    this.cache = next
    return { ...next }
  }
}

export function readJsonSetting<T>(key: string): T | null {
  const raw = readRow(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJsonSetting(key: string, value: unknown): void {
  writeRow(key, JSON.stringify(value))
}
