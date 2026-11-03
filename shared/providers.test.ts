import { describe, expect, it } from 'vitest'
import {
  AI_PRESETS,
  DEFAULT_AI_SETTINGS,
  providerBaseUrl,
  resolveAiSettings,
  taskRouting
} from './providers'

describe('resolveAiSettings', () => {
  it('starts fully local on a fresh install', () => {
    expect(resolveAiSettings({})).toEqual(DEFAULT_AI_SETTINGS)
  })

  it('migrates the legacy Groq speech + translation provider', () => {
    const ai = resolveAiSettings({
      engines: {
        provider: 'groq',
        sttProvider: 'groq',
        groqSttModel: 'whisper-large-v3',
        groqMtModel: 'llama-3.3-70b-versatile'
      }
    })

    expect(ai.provider).toBe('groq')
    expect(ai.models.listen).toBe('whisper-large-v3')
    expect(ai.models.translate).toBe('llama-3.3-70b-versatile')
    expect(ai.models.speak).toBe('kokoro-onnx')
  })

  it('keeps a cloud speech provider when translation stayed local', () => {
    const ai = resolveAiSettings({
      engines: { provider: 'local', sttProvider: 'deepgram', deepgramModel: 'nova-2' }
    })

    expect(ai.provider).toBe('deepgram')
    expect(ai.models.listen).toBe('nova-2')
    expect(taskRouting(ai, 'translate').mode).toBe('fallback')
  })

  it('migrates localStt=false into the cloud provider', () => {
    const ai = resolveAiSettings({
      engines: { provider: 'openrouter', localStt: false }
    })

    expect(ai.provider).toBe('openrouter')
    // OpenRouter has no transcription endpoint; Listen falls back to Local instead of pretending.
    expect(taskRouting(ai, 'listen').mode).toBe('fallback')
  })

  it('keeps the local voice visible when the provider has no speech output', () => {
    const ai = resolveAiSettings({
      engines: { provider: 'openrouter', sttProvider: 'groq' },
      ttsModel: 'cloned'
    })

    expect(ai.provider).toBe('openrouter')
    expect(ai.models.speak).toBe('cloned')
    expect(ai.voiceSource).toBe('clone')
    expect(taskRouting(ai, 'speak').mode).toBe('fallback')
  })

  it('converts the legacy local-clone marker to a cloud preset voice', () => {
    const ai = resolveAiSettings({
      ai: {
        provider: 'mistral',
        models: { listen: '', translate: '', speak: '', prompt: '' },
        voiceSource: 'clone',
        voiceId: 'voice'
      }
    })

    expect(ai.provider).toBe('mistral')
    expect(ai.voiceSource).toBe('preset')
    expect(ai.voiceId).toBe('gb_jane_neutral')
  })

  it('keeps an existing unified setting and fills new task defaults', () => {
    const ai = resolveAiSettings({
      ai: {
        provider: 'mistral',
        models: { listen: 'voxtral-small-transcribe-3-0', translate: '', speak: '', prompt: '' }
      }
    })

    expect(ai.provider).toBe('mistral')
    expect(ai.models.listen).toBe('voxtral-small-transcribe-3-0')
    expect(ai.models.translate).toBe('mistral-small-2603')
    expect(ai.models.speak).toBe('voxtral-mini-tts-3-0')
  })
})

describe('taskRouting', () => {
  it('sends every Mistral task to the cloud with one key', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, provider: 'mistral' as const }
    expect(taskRouting(ai, 'listen').mode).toBe('cloud')
    expect(taskRouting(ai, 'translate').mode).toBe('cloud')
    expect(taskRouting(ai, 'speak').mode).toBe('cloud')
    expect(taskRouting(ai, 'prompt').mode).toBe('cloud')
  })

  it('falls back to Local for a task the provider does not offer', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, provider: 'deepgram' as const }
    expect(taskRouting(ai, 'listen').mode).toBe('cloud')
    expect(taskRouting(ai, 'translate')).toMatchObject({ mode: 'fallback', provider: 'local' })
    expect(taskRouting(ai, 'speak').mode).toBe('fallback')
  })

  it('keeps Prompt off unless the owner enables it', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, provider: 'local' as const }
    expect(taskRouting(ai, 'prompt').mode).toBe('off')
    expect(taskRouting(ai, 'prompt', { promptAiEnabled: true }).mode).toBe('cloud')
  })
})

describe('providerBaseUrl', () => {
  it('fills the Cloudflare account id', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, provider: 'cloudflare' as const, cloudflareAccountId: 'abc' }
    expect(providerBaseUrl(ai)).toContain('/accounts/abc/ai/v1')
  })

  it('uses the owner custom URL', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, provider: 'custom' as const, customBaseUrl: 'http://x:9000/v1/' }
    expect(providerBaseUrl(ai)).toBe('http://x:9000/v1')
  })
})

describe('presets', () => {
  it('gives the Free · Mistral preset one provider for all tasks', () => {
    const preset = AI_PRESETS.find((item) => item.id === 'free-mistral')
    expect(preset?.settings.provider).toBe('mistral')
    expect(preset?.settings.models.listen).toContain('voxtral')
    expect(preset?.settings.models.speak).toContain('voxtral')
  })
})
