/**
 * Static AI provider catalogue.
 *
 * The owner asked for one API key per provider that covers every task, instead of choosing a
 * speech provider, a translation provider and a speech-output provider separately. `/models`
 * only returns model ids; it does not say which model can transcribe, translate or speak, so
 * capabilities live here as data. The Settings UI, the Electron payload builder and the
 * sidecar all read the same catalogue.
 *
 * This file is dependency-free (imported by main, preload and renderer).
 */

export const AI_PROVIDER_IDS = [
  'local',
  'mistral',
  'openai',
  'gemini',
  'groq',
  'cloudflare',
  'deepgram',
  'openrouter',
  'together',
  'huggingface',
  'ollama',
  'custom'
] as const

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

/** The four jobs a provider can own. `summary` stays on the local/legacy path for now. */
export const AI_TASKS = ['listen', 'translate', 'speak', 'prompt'] as const

export type AiTask = (typeof AI_TASKS)[number]

export const AI_TASK_LABELS: Record<AiTask, string> = {
  listen: 'Listen',
  translate: 'Translate',
  speak: 'Speak',
  prompt: 'Prompt'
}

/** How the sidecar should call the provider for this task. */
export type AiTaskKind =
  | 'local'
  | 'openai-stt'
  | 'mistral-stt'
  | 'deepgram-stt'
  | 'openai-mt'
  | 'openai-tts'
  | 'mistral-tts'

export interface AiVoiceOption {
  id: string
  label: string
  language: string
}

export interface AiTaskCapability {
  kind: AiTaskKind
  models: string[]
  defaultModel: string
  /** No language hint needed: the provider detects the spoken language per request. */
  autoLanguage?: boolean
  /** Short line shown under the model picker. */
  note?: string
  voices?: AiVoiceOption[]
}

export type AiBadge = 'local' | 'free' | 'credit' | 'paid' | 'custom'

export interface AiProvider {
  id: AiProviderId
  label: string
  badge: AiBadge
  description: string
  auth: 'none' | 'bearer' | 'account'
  /** Base URL for OpenAI-compatible endpoints; the account placeholder is filled in at runtime. */
  baseUrl: string
  /** Cloudflare Workers AI needs an account id next to the token. */
  accountId?: boolean
  tasks: Partial<Record<AiTask, AiTaskCapability>>
}

const MISTRAL_TRANSCRIBE: AiTaskCapability = {
  kind: 'mistral-stt',
  models: ['voxtral-mini-transcribe-3-0', 'voxtral-small-transcribe-3-0'],
  defaultModel: 'voxtral-mini-transcribe-3-0',
  autoLanguage: true,
  note: 'Detects Indonesian/English per window (return_language).'
}

const MISTRAL_CHAT: AiTaskCapability = {
  kind: 'openai-mt',
  models: ['mistral-small-2603', 'mistral-large-4', 'ministral-8b-2512'],
  defaultModel: 'mistral-small-2603'
}

const MISTRAL_SPEAK: AiTaskCapability = {
  kind: 'mistral-tts',
  models: ['voxtral-mini-tts-3-0'],
  defaultModel: 'voxtral-mini-tts-3-0',
  note: 'No Indonesian preset voice - clone your voice for Indonesian.',
  voices: [
    { id: 'gb_jane_neutral', label: 'Jane (English UK)', language: 'en' },
    { id: 'voice_478', label: 'Sheila (English US)', language: 'en' },
    { id: 'voice_481', label: 'Heidi (German)', language: 'de' },
    { id: 'voice_592', label: 'Marie (French)', language: 'fr' },
    { id: 'voice_483', label: 'Elena (Spanish)', language: 'es' }
  ]
}

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = {
  local: {
    id: 'local',
    label: 'Local',
    badge: 'local',
    description: 'Bundled Whisper, NLLB and Kokoro. Nothing leaves this machine.',
    auth: 'none',
    baseUrl: '',
    tasks: {
      listen: {
        kind: 'local',
        models: ['small', 'base', 'medium'],
        defaultModel: 'small',
        autoLanguage: true,
        note: 'Whisper auto-detects the meeting language.'
      },
      translate: {
        kind: 'local',
        models: ['nllb-200-distilled-600M-ct2-int8'],
        defaultModel: 'nllb-200-distilled-600M-ct2-int8'
      },
      speak: {
        kind: 'local',
        models: ['kokoro-onnx', 'cloned', 'say'],
        defaultModel: 'kokoro-onnx',
        note: 'Kokoro speaks English. Indonesian uses the system voice or your clone.'
      }
    }
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    badge: 'free',
    description: 'One key for Listen, Translate, Speak and Prompt. Primary recommendation.',
    auth: 'bearer',
    baseUrl: 'https://api.mistral.ai/v1',
    tasks: {
      listen: MISTRAL_TRANSCRIBE,
      translate: MISTRAL_CHAT,
      speak: MISTRAL_SPEAK,
      prompt: { ...MISTRAL_CHAT, models: ['mistral-small-2603', 'mistral-large-4'] }
    }
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    badge: 'paid',
    description: 'Mature transcription, chat and preset TTS voices. Paid, best quality.',
    auth: 'bearer',
    baseUrl: 'https://api.openai.com/v1',
    tasks: {
      listen: {
        kind: 'openai-stt',
        models: ['gpt-transcribe', 'whisper-1'],
        defaultModel: 'gpt-transcribe',
        autoLanguage: true
      },
      translate: {
        kind: 'openai-mt',
        models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
        defaultModel: 'gpt-4o-mini'
      },
      speak: {
        kind: 'openai-tts',
        models: ['gpt-4o-mini-tts', 'tts-1'],
        defaultModel: 'gpt-4o-mini-tts',
        voices: [
          { id: 'alloy', label: 'Alloy', language: 'en' },
          { id: 'coral', label: 'Coral', language: 'en' },
          { id: 'nova', label: 'Nova', language: 'en' },
          { id: 'shimmer', label: 'Shimmer', language: 'en' },
          { id: 'onyx', label: 'Onyx', language: 'en' }
        ]
      },
      prompt: {
        kind: 'openai-mt',
        models: ['gpt-4o-mini', 'gpt-4o'],
        defaultModel: 'gpt-4o-mini'
      }
    }
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    badge: 'free',
    description: 'Free tier for translation and prompting. Speech stays local until its adapter lands.',
    auth: 'bearer',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    tasks: {
      translate: {
        kind: 'openai-mt',
        models: ['gemini-3.8-flash', 'gemini-2.5-flash'],
        defaultModel: 'gemini-3.8-flash'
      },
      prompt: {
        kind: 'openai-mt',
        models: ['gemini-3.8-flash', 'gemini-2.5-flash'],
        defaultModel: 'gemini-3.8-flash'
      }
    }
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    badge: 'free',
    description: 'Free speech and chat. Fast, auto language detection, no Indonesian TTS.',
    auth: 'bearer',
    baseUrl: 'https://api.groq.com/openai/v1',
    tasks: {
      listen: {
        kind: 'openai-stt',
        models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
        defaultModel: 'whisper-large-v3-turbo',
        autoLanguage: true,
        note: 'Free tier: about 8 hours of audio per day.'
      },
      translate: {
        kind: 'openai-mt',
        models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
        defaultModel: 'openai/gpt-oss-120b'
      },
      prompt: {
        kind: 'openai-mt',
        models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
        defaultModel: 'openai/gpt-oss-120b'
      }
    }
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare',
    badge: 'free',
    description: 'Workers AI free daily allowance. Needs a token and an account id.',
    auth: 'account',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1',
    accountId: true,
    tasks: {
      listen: {
        kind: 'openai-stt',
        models: ['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper'],
        defaultModel: '@cf/openai/whisper-large-v3-turbo',
        autoLanguage: true
      },
      translate: {
        kind: 'openai-mt',
        models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen2.5-7b-instruct'],
        defaultModel: '@cf/meta/llama-3.1-8b-instruct'
      },
      prompt: {
        kind: 'openai-mt',
        models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen2.5-7b-instruct'],
        defaultModel: '@cf/meta/llama-3.1-8b-instruct'
      }
    }
  },
  deepgram: {
    id: 'deepgram',
    label: 'Deepgram',
    badge: 'credit',
    description: 'Nova-3 speech with detected language + confidence. Speech only.',
    auth: 'bearer',
    baseUrl: 'https://api.deepgram.com',
    tasks: {
      listen: {
        kind: 'deepgram-stt',
        models: ['nova-3', 'nova-2'],
        defaultModel: 'nova-3',
        autoLanguage: true,
        note: 'Returns the detected language and confidence for every window.'
      }
    }
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    badge: 'paid',
    description: 'One key, hundreds of chat models (some free). Text only.',
    auth: 'bearer',
    baseUrl: 'https://openrouter.ai/api/v1',
    tasks: {
      translate: {
        kind: 'openai-mt',
        models: ['google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
        defaultModel: 'google/gemini-2.5-flash'
      },
      prompt: {
        kind: 'openai-mt',
        models: ['google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
        defaultModel: 'google/gemini-2.5-flash'
      }
    }
  },
  together: {
    id: 'together',
    label: 'Together',
    badge: 'paid',
    description: 'Hosted Whisper, open LLMs and several TTS models.',
    auth: 'bearer',
    baseUrl: 'https://api.together.xyz/v1',
    tasks: {
      listen: {
        kind: 'openai-stt',
        models: ['openai/whisper-large-v3', 'nvidia/parakeet-tdt-0.6b-v2'],
        defaultModel: 'openai/whisper-large-v3',
        autoLanguage: true
      },
      translate: {
        kind: 'openai-mt',
        models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
        defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
      },
      speak: {
        kind: 'openai-tts',
        models: ['cartesia/sonic-2', 'hexgrad/Kokoro-82M'],
        defaultModel: 'cartesia/sonic-2',
        voices: [
          { id: 'alloy', label: 'Alloy', language: 'en' },
          { id: 'af_heart', label: 'Heart', language: 'en' }
        ]
      },
      prompt: {
        kind: 'openai-mt',
        models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
        defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
      }
    }
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face',
    badge: 'credit',
    description: 'Inference router with monthly credits. Speech, chat and prompting.',
    auth: 'bearer',
    baseUrl: 'https://router.huggingface.co/v1',
    tasks: {
      listen: {
        kind: 'openai-stt',
        models: ['openai/whisper-large-v3-turbo'],
        defaultModel: 'openai/whisper-large-v3-turbo',
        autoLanguage: true
      },
      translate: {
        kind: 'openai-mt',
        models: ['meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'],
        defaultModel: 'meta-llama/Llama-3.1-8B-Instruct'
      },
      prompt: {
        kind: 'openai-mt',
        models: ['meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'],
        defaultModel: 'meta-llama/Llama-3.1-8B-Instruct'
      }
    }
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    badge: 'local',
    description: 'Free local chat models. Translate and Prompt only.',
    auth: 'none',
    baseUrl: 'http://localhost:11434',
    tasks: {
      translate: {
        kind: 'openai-mt',
        models: ['llama3.1:8b', 'qwen3:4b'],
        defaultModel: 'llama3.1:8b'
      },
      prompt: {
        kind: 'openai-mt',
        models: ['llama3.1:8b', 'qwen3:4b'],
        defaultModel: 'llama3.1:8b'
      }
    }
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    badge: 'custom',
    description: 'Any OpenAI-compatible server: vLLM, LM Studio, LiteLLM, whisper.cpp.',
    auth: 'bearer',
    baseUrl: '',
    tasks: {
      listen: {
        kind: 'openai-stt',
        models: ['whisper-1'],
        defaultModel: 'whisper-1',
        autoLanguage: true
      },
      translate: { kind: 'openai-mt', models: ['gpt-4o-mini'], defaultModel: 'gpt-4o-mini' },
      speak: {
        kind: 'openai-tts',
        models: ['tts-1'],
        defaultModel: 'tts-1',
        voices: [
          { id: 'alloy', label: 'Alloy', language: 'en' },
          { id: 'nova', label: 'Nova', language: 'en' }
        ]
      },
      prompt: { kind: 'openai-mt', models: ['gpt-4o-mini'], defaultModel: 'gpt-4o-mini' }
    }
  }
}

export interface AiSettings {
  provider: AiProviderId
  models: Record<AiTask, string>
  /** Preset slug or the owner's cloned voice. */
  voiceId: string
  voiceSource: 'preset' | 'clone'
  customBaseUrl: string
  cloudflareAccountId: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'local',
  models: {
    listen: 'small',
    translate: 'nllb-200-distilled-600M-ct2-int8',
    speak: 'kokoro-onnx',
    prompt: ''
  },
  voiceId: 'af_heart',
  voiceSource: 'preset',
  customBaseUrl: '',
  cloudflareAccountId: ''
}

export interface AiPreset {
  id: string
  label: string
  description: string
  settings: AiSettings
}

function modelsFor(provider: AiProviderId): Record<AiTask, string> {
  const entry = AI_PROVIDERS[provider]
  return {
    listen: entry.tasks.listen?.defaultModel ?? '',
    translate: entry.tasks.translate?.defaultModel ?? '',
    speak: entry.tasks.speak?.defaultModel ?? 'kokoro-onnx',
    prompt: entry.tasks.prompt?.defaultModel ?? ''
  }
}

function preset(id: string, label: string, description: string, provider: AiProviderId): AiPreset {
  return {
    id,
    label,
    description,
    settings: {
      ...DEFAULT_AI_SETTINGS,
      provider,
      models: modelsFor(provider),
      voiceId: AI_PROVIDERS[provider].tasks.speak?.voices?.[0]?.id ?? 'af_heart'
    }
  }
}

export const AI_PRESETS: AiPreset[] = [
  preset('local', 'Offline · Local', 'No key, nothing leaves this machine.', 'local'),
  preset('free-mistral', 'Free · Mistral', 'One key for all four tasks.', 'mistral'),
  preset('free-gemini', 'Free · Gemini', 'Translation + prompt; speech stays local.', 'gemini'),
  preset('free-groq', 'Free · Groq', 'Speech + translation; speech stays local.', 'groq'),
  preset('paid-openai', 'Paid · OpenAI', 'Best preset voices and transcription.', 'openai')
]

export function providerOf(id: AiProviderId): AiProvider {
  return AI_PROVIDERS[id] ?? AI_PROVIDERS.local
}

export function taskCapability(id: AiProviderId, task: AiTask): AiTaskCapability | null {
  return providerOf(id).tasks[task] ?? null
}

export type AiTaskMode = 'local' | 'cloud' | 'fallback' | 'off'

export interface AiTaskRouting {
  task: AiTask
  mode: AiTaskMode
  provider: AiProviderId
  providerLabel: string
  model: string
  /** `true` when audio or text leaves the machine for this task. */
  cloud: boolean
  note: string
}

/**
 * Per-task routing. A provider that does not offer a task never breaks that feature: speech and
 * translation fall back to the local engines, Prompt falls back to the legacy prompt provider
 * (or is simply off). The UI shows the fallback instead of hiding the feature.
 */
export function taskRouting(
  ai: AiSettings,
  task: AiTask,
  options: { promptAiEnabled?: boolean; promptAiProvider?: string } = {}
): AiTaskRouting {
  const entry = providerOf(ai.provider)
  if (task === 'prompt' && options.promptAiEnabled === false) {
    return {
      task,
      mode: 'off',
      provider: ai.provider,
      providerLabel: entry.label,
      model: '',
      cloud: false,
      note: 'Prompt AI is off.'
    }
  }
  const capability = entry.tasks[task]
  if (capability) {
    const cloud = ai.provider !== 'local'
    return {
      task,
      mode: cloud ? 'cloud' : 'local',
      provider: ai.provider,
      providerLabel: entry.label,
      model: ai.models[task] || capability.defaultModel,
      cloud,
      note: capability.note ?? ''
    }
  }

  if (task === 'prompt') {
    if (!options.promptAiEnabled) {
      return {
        task,
        mode: 'off',
        provider: ai.provider,
        providerLabel: entry.label,
        model: '',
        cloud: false,
        note: 'Prompt AI is off.'
      }
    }
    return {
      task,
      mode: 'cloud',
      provider: ai.provider,
      providerLabel: options.promptAiProvider || 'legacy',
      model: '',
      cloud: true,
      note: 'Uses the advanced Prompt AI provider.'
    }
  }

  return {
    task,
    mode: 'fallback',
    provider: 'local',
    providerLabel: 'Local',
    model: task === 'listen' ? 'small' : task === 'speak' ? 'kokoro-onnx' : 'nllb',
    cloud: false,
    note: `${entry.label} does not provide ${AI_TASK_LABELS[task].toLowerCase()} - Local is used.`
  }
}

export function taskRoutings(
  ai: AiSettings,
  options: { promptAiEnabled?: boolean; promptAiProvider?: string } = {}
): AiTaskRouting[] {
  return AI_TASKS.map((task) => taskRouting(ai, task, options))
}

export function hasCloudTask(ai: AiSettings): boolean {
  return ai.provider !== 'local'
}

/** Fills the account placeholder so `resolveBaseUrl` stays pure. */
export function providerBaseUrl(ai: AiSettings, provider: AiProviderId = ai.provider): string {
  const entry = providerOf(provider)
  if (provider === 'custom') return ai.customBaseUrl.trim().replace(/\/+$/, '')
  if (provider === 'cloudflare') {
    return entry.baseUrl.replace('{accountId}', ai.cloudflareAccountId.trim())
  }
  return entry.baseUrl
}

export function providerNeedsKey(provider: AiProviderId): boolean {
  return providerOf(provider).auth !== 'none'
}

export interface StoredLegacyAi {
  engines?: {
    provider?: string
    sttProvider?: string
    customBaseUrl?: string
    openrouterSttModel?: string
    openrouterMtModel?: string
    groqSttModel?: string
    groqMtModel?: string
    deepgramModel?: string
    ollamaMtModel?: string
    customSttModel?: string
    customMtModel?: string
    localStt?: boolean
  }
  ttsModel?: string
  promptAiProvider?: string
  promptAiModel?: string
  promptAiBaseUrl?: string
}

function isProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

function legacyProvider(stored: StoredLegacyAi): AiProviderId {
  const engines = stored.engines ?? {}
  const mt = isProviderId(engines.provider) ? engines.provider : 'local'
  if (mt !== 'local') return mt
  const stt = isProviderId(engines.sttProvider) ? engines.sttProvider : 'local'
  if (stt !== 'local') return stt
  return 'local'
}

function legacyModels(
  stored: StoredLegacyAi,
  provider: AiProviderId
): Partial<Record<AiTask, string>> {
  const engines = stored.engines ?? {}
  switch (provider) {
    case 'groq':
      return { listen: engines.groqSttModel, translate: engines.groqMtModel, prompt: engines.groqMtModel }
    case 'openrouter':
      return {
        listen: engines.openrouterSttModel,
        translate: engines.openrouterMtModel,
        prompt: engines.openrouterMtModel
      }
    case 'deepgram':
      return { listen: engines.deepgramModel }
    case 'ollama':
      return { translate: engines.ollamaMtModel, prompt: engines.ollamaMtModel }
    case 'custom':
      return {
        listen: engines.customSttModel,
        translate: engines.customMtModel,
        prompt: engines.customMtModel
      }
    default:
      return {}
  }
}

/**
 * Migration from the per-task `engines` + `promptAi*` settings. Existing installs keep their
 * provider and model choices; a fresh install stays fully local.
 */
export function resolveAiSettings(
  stored: { ai?: Partial<AiSettings> & { models?: Partial<Record<AiTask, string>> } } & StoredLegacyAi
): AiSettings {
  if (stored.ai) {
    const provider = isProviderId(stored.ai.provider) ? stored.ai.provider : 'local'
    const defaults = modelsFor(provider)
    const incoming: Partial<Record<AiTask, string>> = stored.ai.models ?? {}
    const models: Record<AiTask, string> = { ...defaults }
    for (const task of AI_TASKS) {
      const value = incoming[task]
      if (typeof value === 'string' && value.trim()) models[task] = value
    }
    const speak = AI_PROVIDERS[provider].tasks.speak
    // `voiceId: "voice"` is the legacy local-clone marker. A cloud TTS provider cannot use it,
    // so migrate to its first preset voice instead of sending an invalid id.
    const legacyClone = stored.ai.voiceSource === 'clone' && stored.ai.voiceId === 'voice'
    const cloudSpeak = speak && speak.kind !== 'local'
    return {
      ...DEFAULT_AI_SETTINGS,
      ...stored.ai,
      provider,
      models,
      voiceSource: legacyClone && cloudSpeak ? 'preset' : stored.ai.voiceSource === 'clone' ? 'clone' : 'preset',
      voiceId:
        legacyClone && cloudSpeak
          ? speak?.voices?.[0]?.id ?? DEFAULT_AI_SETTINGS.voiceId
          : stored.ai.voiceId || DEFAULT_AI_SETTINGS.voiceId
    }
  }

  const provider = legacyProvider(stored)
  const models = { ...modelsFor(provider), ...legacyModels(stored, provider) }
  // Empty legacy values must not erase a usable default.
  for (const task of AI_TASKS) {
    if (!models[task]) models[task] = modelsFor(provider)[task]
  }

  const legacyVoice = stored.ttsModel === 'cloned'
  // Keep the local voice choice visible when speech falls back to Local (or the provider is
  // Local). A real cloud TTS provider keeps its own catalogue default.
  if (stored.ttsModel && (provider === 'local' || !AI_PROVIDERS[provider].tasks.speak)) {
    models.speak = stored.ttsModel
  }
  const speak = AI_PROVIDERS[provider].tasks.speak
  const cloudSpeak = speak && speak.kind !== 'local'
  return {
    ...DEFAULT_AI_SETTINGS,
    provider,
    models,
    voiceSource: legacyVoice && !cloudSpeak ? 'clone' : 'preset',
    voiceId: legacyVoice && !cloudSpeak ? 'voice' : speak?.voices?.[0]?.id ?? DEFAULT_AI_SETTINGS.voiceId,
    customBaseUrl: stored.engines?.customBaseUrl ?? ''
  }
}
