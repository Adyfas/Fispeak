import type { Settings } from '@shared/api'
import { DEFAULT_SETTINGS, resolveEngineSettings } from '@shared/api'
import { resolveAiSettings } from '@shared/providers'
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
      let legacy: Record<string, unknown> = {}
      if (raw) {
        try {
          legacy = JSON.parse(raw) as Record<string, unknown>
          stored = legacy as Partial<Settings>
        } catch {
          stored = {}
          legacy = {}
        }
      }
      // Migration: one provider now owns every task. Old databases keep their provider/models.
      const legacyEngines = resolveEngineSettings(
        legacy.engines as Parameters<typeof resolveEngineSettings>[0]
      )
      const ai = resolveAiSettings({
        ai: stored.ai,
        engines: legacyEngines,
        ttsModel: stored.ttsModel,
        promptAiProvider: stored.promptAiProvider,
        promptAiModel: stored.promptAiModel,
        promptAiBaseUrl: stored.promptAiBaseUrl
      })
      const { engines: _legacyEngines, ...rest } = legacy as Partial<Settings> & {
        engines?: unknown
      }
      void _legacyEngines
      this.cache = {
        ...DEFAULT_SETTINGS,
        ...(rest as Partial<Settings>),
        ai
      }
      // JSON nulls from older builds must not override the new enum defaults.
      if (!this.cache.sidecarKeepAlive) this.cache.sidecarKeepAlive = DEFAULT_SETTINGS.sidecarKeepAlive
      if (!this.cache.ttsOutput) this.cache.ttsOutput = DEFAULT_SETTINGS.ttsOutput
      if (this.cache.speakAutoPlay == null) this.cache.speakAutoPlay = DEFAULT_SETTINGS.speakAutoPlay
      if (this.cache.dictationAutoPaste == null) {
        this.cache.dictationAutoPaste = DEFAULT_SETTINGS.dictationAutoPaste
      }
      if (this.cache.promptAiEnabled == null) {
        this.cache.promptAiEnabled = DEFAULT_SETTINGS.promptAiEnabled
      }
      if (!this.cache.promptAiProvider) {
        this.cache.promptAiProvider = DEFAULT_SETTINGS.promptAiProvider
      }
      if (!this.cache.promptAiModel) {
        this.cache.promptAiModel = DEFAULT_SETTINGS.promptAiModel
      }
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
