import type {
  AiProviderId,
  AiSettings,
  EngineModelOption,
  EngineTestResult,
  PromptAiProvider,
  Settings
} from '@shared/api'
import {
  AI_TASKS,
  type AiTask,
  providerBaseUrl,
  providerNeedsKey,
  providerOf,
  taskCapability,
  taskRouting
} from '@shared/providers'
import { getSecret, secretName } from '../security/credentials'
import { logger } from '../logger'

/**
 * Client for the OpenAI-compatible endpoints and the mapping from `Settings.ai` to the payload
 * the sidecar expects in its `config` frame.
 *
 * The owner configures ONE provider. That provider owns Listen, Translate, Speak and Prompt
 * wherever it offers them; a task it does not offer falls back to the local engine (the UI shows
 * the fallback). Everything here runs in the Electron main process: the renderer never sees a key.
 */

const DEFAULT_OLLAMA_BASE = 'http://localhost:11434'
/** OVHcloud AI Endpoints: OpenAI-compatible and usable anonymously (2 requests/minute). */
export const OVH_AI_BASE = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1'
const REQUEST_TIMEOUT_MS = 20_000
const ENHANCE_TIMEOUT_MS = 28_000

export interface EngineWireConfig {
  provider: string
  baseUrl?: string
  model?: string
  apiKey?: string
}

export interface EnginePayload {
  stt: EngineWireConfig
  mt: EngineWireConfig
}

/** `https://host/v1` for servers that need the OpenAI layer, unchanged when already present. */
function openAiRoot(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/\/v\d+$/.test(trimmed) || trimmed.endsWith('/ai/v1')) return trimmed
  return `${trimmed}/v1`
}

export function resolveBaseUrl(
  provider: AiProviderId,
  baseUrl: string,
  accountId = ''
): string {
  if (provider === 'custom') return openAiRoot(baseUrl)
  if (provider === 'ollama') return baseUrl.trim().replace(/\/+$/, '') || DEFAULT_OLLAMA_BASE
  if (provider === 'cloudflare') {
    return providerOf(provider).baseUrl.replace('{accountId}', accountId.trim())
  }
  return providerBaseUrl({ ...emptyAi(), provider, cloudflareAccountId: accountId })
}

function emptyAi(): AiSettings {
  return {
    provider: 'local',
    models: { listen: '', translate: '', speak: '', prompt: '' },
    voiceId: '',
    voiceSource: 'preset',
    customBaseUrl: '',
    cloudflareAccountId: ''
  }
}

function wireFor(ai: AiSettings, task: AiTask): EngineWireConfig | null {
  const route = taskRouting(ai, task)
  if (route.mode !== 'cloud') return null
  const capability = taskCapability(route.provider, task)
  if (!capability) return null
  const provider = route.provider
  return {
    provider,
    baseUrl: provider === 'custom' ? openAiRoot(ai.customBaseUrl) : providerBaseUrl(ai, provider),
    model: route.model || capability.defaultModel,
    apiKey: providerNeedsKey(provider) ? getSecret(secretName(provider)) : ''
  }
}

/**
 * Settings -> sidecar. Only the tasks the selected provider actually offers are sent as remote;
 * the rest stay `local`, so switching a provider can never silently disable Listen or Translate.
 */
export function buildEnginePayload(settings: Settings): EnginePayload {
  const ai = settings.ai
  return {
    stt: wireFor(ai, 'listen') ?? { provider: 'local' },
    mt: wireFor(ai, 'translate') ?? { provider: 'local' }
  }
}

function headers(provider: AiProviderId, apiKey: string): Record<string, string> {
  const result: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) result.Authorization = `Bearer ${apiKey}`
  if (provider === 'openrouter') {
    result['HTTP-Referer'] = 'https://fispeak.app'
    result['X-Title'] = 'fispeak'
  }
  return result
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 200).replace(/\s+/g, ' ')
    return text ? `HTTP ${response.status}: ${text}` : `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `/models` for OpenAI-compatible servers, `/api/tags` for Ollama.
 * Deepgram exposes no model catalogue, so its picker stays a curated list.
 */
export async function listModels(
  provider: AiProviderId,
  baseUrl: string,
  accountId = ''
): Promise<EngineModelOption[]> {
  if (provider === 'local') return []
  if (provider === 'deepgram') return []
  const base = resolveBaseUrl(provider, baseUrl, accountId)
  if (!base) throw new Error(`${provider}: base URL is empty`)

  if (provider === 'ollama') {
    const root = base.replace(/\/+$/, '').replace(/\/v1$/, '')
    const response = await request(`${root}/api/tags`, { headers: headers(provider, '') })
    if (!response.ok) throw new Error(`ollama: ${await readError(response)}`)
    const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
    return (body.models ?? [])
      .map((item) => item.name ?? item.model ?? '')
      .filter(Boolean)
      .map((id) => ({ id, label: id }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  const apiKey = getSecret(secretName(provider))
  const response = await request(`${base}/models`, { headers: headers(provider, apiKey) })
  if (!response.ok) throw new Error(`${provider}: ${await readError(response)}`)
  const body = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>
    result?: Array<{ id?: string; name?: string }>
  }
  const rows = body.data ?? body.result ?? []
  return rows
    .map((item) => ({ id: item.id ?? '', label: item.name ?? item.id ?? '' }))
    .filter((item) => item.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function chatProbe(
  provider: AiProviderId,
  baseUrl: string,
  model: string,
  apiKey: string
): Promise<string | null> {
  const base =
    provider === 'ollama' ? `${baseUrl.trim().replace(/\/+$/, '') || DEFAULT_OLLAMA_BASE}/v1` : baseUrl
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request(`${base}/chat/completions`, {
      method: 'POST',
      headers: { ...headers(provider, apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        max_tokens: 5,
        temperature: 0,
        stream: false
      })
    })
    if (response.status === 429) {
      lastError = await readError(response)
      if (attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after') || 0)
        const delay = retryAfter > 0 && retryAfter <= 10 ? retryAfter * 1000 : 1500 * (attempt + 1)
        await sleep(delay)
        continue
      }
      return `${lastError} (free tier is rate limited - wait a few seconds and test again)`
    }
    if (!response.ok) return `model "${model}" failed: ${await readError(response)}`
    return null
  }
  return lastError || `model "${model}" failed: rate limited`
}

/**
 * One click in Settings -> "does this configuration work?".
 *
 * Every task the provider offers is probed with the SAME key, which is the point of the unified
 * provider: the owner types one key, not one per task. TTS is verified by its model id rather
 * than by generating audio (a test click should not spend speech credits).
 */
export async function testConnection(ai: AiSettings): Promise<EngineTestResult> {
  const started = Date.now()
  const notes: string[] = []
  const failures: string[] = []
  const provider = ai.provider

  if (provider === 'local') {
    return { ok: true, message: 'Local engines selected - nothing to test', latencyMs: 0 }
  }

  const entry = providerOf(provider)
  const apiKey = providerNeedsKey(provider) ? getSecret(secretName(provider)) : ''
  const keyRequired = providerNeedsKey(provider) && provider !== 'custom'
  if (keyRequired && !apiKey) {
    return {
      ok: false,
      message: `no ${entry.label} API key saved yet`,
      latencyMs: Date.now() - started
    }
  }
  if (provider === 'custom' && !ai.customBaseUrl.trim()) {
    return { ok: false, message: 'custom server URL is empty', latencyMs: Date.now() - started }
  }
  if (provider === 'cloudflare' && !ai.cloudflareAccountId.trim()) {
    return {
      ok: false,
      message: 'Cloudflare account id is required',
      latencyMs: Date.now() - started
    }
  }

  const base = providerBaseUrl(ai, provider)
  let catalogue: EngineModelOption[] = []
  let catalogueError: string | null = null

  if (provider === 'deepgram') {
    try {
      const response = await request('https://api.deepgram.com/v1/auth/token', {
        headers: { Accept: 'application/json', Authorization: `Token ${apiKey}` }
      })
      if (!response.ok) failures.push(`Deepgram: ${await readError(response)}`)
      else notes.push('Deepgram key accepted')
    } catch (error) {
      failures.push(`Deepgram: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    try {
      catalogue = await listModels(provider, ai.customBaseUrl, ai.cloudflareAccountId)
    } catch (error) {
      catalogueError = error instanceof Error ? error.message : String(error)
    }
  }

  const hasChatTask = Boolean(entry.tasks.translate || entry.tasks.prompt)
  if (catalogueError) {
    // Some providers do not expose `/models` (or expose it behind a different API). A chat probe
    // still proves the key and model; only a provider with no chat task needs the catalogue.
    if (hasChatTask) notes.push(`model list skipped: ${catalogueError}`)
    else failures.push(catalogueError)
  }

  // Free modes need breathing room between calls; two chat probes back-to-back are what caused
  // the 429 the owner saw. Same model => one probe.
  if (provider === 'mistral') await sleep(1200)
  const probed = new Map<string, string | null>()

  for (const task of AI_TASKS) {
    const capability = entry.tasks[task]
    if (!capability) continue
    const model = ai.models[task] || capability.defaultModel
    if (!model) {
      failures.push(`${task}: no model selected`)
      continue
    }
    if (task === 'listen' && provider === 'deepgram') {
      notes.push(`Listen: ${model}`)
      continue
    }
    // The catalogue is informational: `/models` does not say which model transcribes or speaks,
    // so the curated list stays authoritative and a chat probe verifies the key.
    if (catalogue.length > 0 && !catalogue.some((item) => item.id === model)) {
      notes.push(`${task}: ${model} (not listed by /models)`)
    }
    if (task === 'translate' || task === 'prompt') {
      const probeKey = `${provider}|${base}|${model}`
      try {
        let failure: string | null
        if (probed.has(probeKey)) {
          failure = probed.get(probeKey) ?? null
          if (!failure) {
            notes.push(`${task}: ${model} (same model, already verified)`)
            continue
          }
        } else {
          if (probed.size > 0) await sleep(1200)
          failure = await chatProbe(provider, base, model, apiKey)
          probed.set(probeKey, failure)
        }
        if (failure) failures.push(`${task}: ${failure}`)
        else notes.push(`${task}: ${model} answered`)
      } catch (error) {
        failures.push(
          `${task}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    } else if (task === 'speak') {
      notes.push(`Speak: ${model} + ${ai.voiceSource === 'clone' ? 'cloned voice' : ai.voiceId}`)
    } else {
      notes.push(`Listen: ${model}`)
    }
  }

  if (failures.length === 0 && notes.length === 0) {
    notes.push(`${entry.label}: key accepted, no task enabled`)
  }
  return {
    ok: failures.length === 0,
    message: [...notes, ...failures].join('; '),
    latencyMs: Date.now() - started
  }
}

/**
 * Prompt page: turn a short spoken idea into a detailed, prompt-engineered instruction.
 *
 * The selected provider owns Prompt when it offers chat models. When it does not (for example
 * Deepgram speech-only), the advanced Prompt AI provider is used instead; the UI shows that
 * fallback rather than silently dropping the feature.
 */
const ENHANCE_SYSTEM_PROMPT = [
  'You are an expert prompt engineer.',
  'The user dictated a short, spoken idea. Rewrite it as ONE detailed, self-contained prompt',
  'that another AI assistant (coding or writing) can execute without follow-up questions.',
  '',
  'Include, when relevant:',
  '- the concrete goal and the deliverable format',
  '- audience / context and the problem being solved',
  '- must-have features and explicit non-goals',
  '- constraints: stack, styling direction, accessibility, performance, responsiveness',
  '- structure of the output or the files expected',
  '- a short quality bar / definition of done',
  '',
  'Rules:',
  '- Write the final prompt in the SAME language as the user input.',
  '- Keep it 120-220 words, specific and actionable; never generic filler.',
  '- Do not invent unrelated requirements; infer only what the idea implies.',
  '- Reply with the final prompt only: no preface, no quotes, no markdown fences, no commentary.'
].join('\n')

function legacyPromptBase(provider: PromptAiProvider, baseUrl: string): string {
  if (provider === 'ovh') return OVH_AI_BASE
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (provider === 'groq') return 'https://api.groq.com/openai/v1'
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (provider === 'ollama') return trimmed || DEFAULT_OLLAMA_BASE
  return openAiRoot(trimmed)
}

export interface EnhanceTarget {
  provider: AiProviderId | PromptAiProvider
  model: string
  baseUrl: string
  apiKey: string
}

function enhanceTarget(settings: Settings): EnhanceTarget | null {
  const ai = settings.ai
  const route = taskRouting(ai, 'prompt', {
    promptAiEnabled: settings.promptAiEnabled,
    promptAiProvider: settings.promptAiProvider
  })
  if (route.mode === 'off') return null

  if (ai.provider !== 'local' && taskCapability(ai.provider, 'prompt')) {
    return {
      provider: ai.provider,
      model: ai.models.prompt || taskCapability(ai.provider, 'prompt')?.defaultModel || '',
      baseUrl: providerBaseUrl(ai),
      apiKey: providerNeedsKey(ai.provider) ? getSecret(secretName(ai.provider)) : ''
    }
  }

  const provider = settings.promptAiProvider
  return {
    provider,
    model: settings.promptAiModel,
    baseUrl: legacyPromptBase(provider, settings.promptAiBaseUrl),
    apiKey: getSecret(secretName(provider))
  }
}

/** Returns the improved prompt, or null when the provider failed (caller keeps the raw text). */
export async function enhancePrompt(text: string, settings: Settings): Promise<string | null> {
  const value = text.trim()
  if (!value) return null
  const target = enhanceTarget(settings)
  if (!target) return null
  const model = target.model.trim()
  if (!model || !target.baseUrl) return null

  // Ollama serves the OpenAI layer under /v1; the catalogue base is the bare host.
  const provider = target.provider as AiProviderId
  const root =
    provider === 'ollama' ? `${target.baseUrl.replace(/\/+$/, '')}/v1` : target.baseUrl
  const endpoint = `${root}/chat/completions`
  const headerProvider: AiProviderId = provider

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ENHANCE_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers(headerProvider, target.apiKey)
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ENHANCE_SYSTEM_PROMPT },
          { role: 'user', content: value }
        ],
        temperature: 0.4,
        max_tokens: 700,
        stream: false
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      logger.warn('prompt-ai', 'enhance failed', { status: response.status })
      return null
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = body.choices?.[0]?.message?.content ?? ''
    // Models sometimes wrap the answer in quotes or a fence; strip both.
    const cleaned = raw
      .trim()
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/```$/, '')
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim()
    return cleaned.length >= 20 ? cleaned : null
  } catch (error) {
    logger.warn('prompt-ai', 'enhance request failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}
