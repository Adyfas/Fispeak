import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/api'
import { DEFAULT_AI_SETTINGS } from '@shared/providers'
import { EngineSection } from './EngineSection'

function installApi(): void {
  ;(window as unknown as { fispeak: unknown }).fispeak = {
    engine: {
      hasKey: () => Promise.resolve(false),
      setKey: () => Promise.resolve(true),
      clearKey: () => Promise.resolve(true),
      test: () => Promise.resolve({ ok: true, message: 'ok', latencyMs: 1 }),
      models: () => Promise.resolve([])
    }
  }
}

function mistralSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      provider: 'mistral',
      models: {
        listen: 'voxtral-mini-transcribe-3-0',
        translate: 'mistral-small-2603',
        speak: 'voxtral-mini-tts-3-0',
        prompt: 'mistral-small-2603'
      }
    }
  }
}

describe('EngineSection', () => {
  beforeEach(installApi)

  it('selects one provider and fills all four task models', () => {
    const patch = vi.fn()
    render(<EngineSection settings={DEFAULT_SETTINGS} patch={patch} />)

    fireEvent.click(screen.getByRole('button', { name: /^Mistral/ }))

    const value = patch.mock.calls.at(-1)?.[0] as Partial<Settings>
    expect(value.ai?.provider).toBe('mistral')
    expect(value.ai?.models.listen).toContain('voxtral')
    expect(value.ai?.models.translate).toBe('mistral-small-2603')
    expect(value.ai?.models.speak).toContain('voxtral')
  })

  it('shows Cloud badges and one key for an all-in-one provider', async () => {
    const patch = vi.fn()
    render(<EngineSection settings={mistralSettings()} patch={patch} />)

    await waitFor(() => expect(screen.getAllByText('Cloud · Mistral').length).toBeGreaterThan(0))
    expect(screen.getByText(/Voxtral TTS covers|No Indonesian preset voice/i)).toBeTruthy()
    expect(screen.getByLabelText('Mistral API key')).toBeTruthy()
    // One key covers the tasks; the UI must not ask for a second speech key.
    expect(screen.getAllByLabelText(/API key$/)).toHaveLength(1)
  })

  it('marks a missing task as a Local fallback instead of hiding it', () => {
    const patch = vi.fn()
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ai: {
        ...DEFAULT_AI_SETTINGS,
        provider: 'deepgram',
        models: { ...DEFAULT_AI_SETTINGS.models, listen: 'nova-3' }
      }
    }
    render(<EngineSection settings={settings} patch={patch} />)

    expect(screen.getAllByText('Fallback · Local').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/falls back to Local/i).length).toBeGreaterThan(0)
  })
})
