import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_SETTINGS,
  resolveEngineSettings,
  type EngineSettings
} from './api'

describe('resolveEngineSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(resolveEngineSettings(undefined)).toEqual(DEFAULT_ENGINE_SETTINGS)
    expect(resolveEngineSettings(null)).toEqual(DEFAULT_ENGINE_SETTINGS)
  })

  it('keeps every explicit choice and fills the missing ones', () => {
    const stored: Partial<EngineSettings> = {
      provider: 'groq',
      sttProvider: 'deepgram',
      groqMtModel: 'custom-model'
    }

    const resolved = resolveEngineSettings(stored)

    expect(resolved.provider).toBe('groq')
    expect(resolved.sttProvider).toBe('deepgram')
    expect(resolved.groqMtModel).toBe('custom-model')
    expect(resolved.openrouterSttModel).toBe(DEFAULT_ENGINE_SETTINGS.openrouterSttModel)
  })

  it('promotes the removed localStt=false toggle to a cloud STT provider', () => {
    expect(
      resolveEngineSettings({ provider: 'openrouter', localStt: false }).sttProvider
    ).toBe('openrouter')
    expect(resolveEngineSettings({ provider: 'groq', localStt: false }).sttProvider).toBe(
      'groq'
    )
    expect(resolveEngineSettings({ provider: 'custom', localStt: false }).sttProvider).toBe(
      'custom'
    )
  })

  it('keeps local speech recognition when the old toggle was true or absent', () => {
    expect(resolveEngineSettings({ provider: 'custom', localStt: true }).sttProvider).toBe(
      'local'
    )
    expect(resolveEngineSettings({ provider: 'openrouter' }).sttProvider).toBe('local')
  })

  it('never invents a cloud STT for Ollama or local translation', () => {
    expect(resolveEngineSettings({ provider: 'ollama', localStt: false }).sttProvider).toBe(
      'local'
    )
    expect(resolveEngineSettings({ provider: 'local', localStt: false }).sttProvider).toBe(
      'local'
    )
  })

  it('does not overwrite an explicit sttProvider', () => {
    const resolved = resolveEngineSettings({
      provider: 'openrouter',
      sttProvider: 'local',
      localStt: false
    })

    expect(resolved.sttProvider).toBe('local')
  })
})
