import { useCallback, useEffect, useState } from 'react'
import type { AiProviderId, EngineTestResult, Settings } from '@shared/api'
import {
  AI_PROVIDERS,
  AI_PRESETS,
  AI_TASKS,
  AI_TASK_LABELS,
  type AiTask,
  providerNeedsKey,
  providerOf,
  taskCapability,
  taskRoutings
} from '@shared/providers'
import { getApi } from '@/lib/ipc'
import { AiModeBadge, SettingsGroup, SettingsRow } from './SettingsGroup'

/**
 * One provider owns Listen, Translate, Speak and Prompt.
 *
 * The old UI made the owner choose a speech provider, a translation provider and a prompt
 * provider separately, then type a key for each. Now there is one key, a provider-level
 * capability check, and every row says whether it is Local, Cloud or a Local fallback.
 */

const inputClass =
  'w-56 rounded-md border border-white/10 bg-[#171719] px-2.5 py-1.5 text-[11px] text-white/85 outline-none focus:border-white/30'
const pillClass =
  'rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/75 transition hover:bg-white/20 disabled:opacity-40'

const BADGE_TEXT: Record<string, string> = {
  local: 'Local',
  free: 'Free',
  credit: 'Credit',
  paid: 'Paid',
  custom: 'Custom'
}

function ProviderIcon({ id }: { id: AiProviderId }): JSX.Element {
  const letter = providerOf(id).label.slice(0, 1).toUpperCase()
  const local = id === 'local' || id === 'ollama'
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
        local ? 'bg-[#4CD964]/15 text-[#4CD964]' : 'bg-[#0A84FF]/15 text-[#6CB6FF]'
      }`}
    >
      {letter}
    </span>
  )
}

export function EngineSection({
  settings,
  patch
}: {
  settings: Settings
  patch: (value: Partial<Settings>) => void
}): JSX.Element {
  const ai = settings.ai
  const provider = ai.provider
  const entry = providerOf(provider)
  const [hasKey, setHasKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<EngineTestResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const patchAi = useCallback(
    (value: Partial<Settings['ai']>): void => {
      patch({ ai: { ...ai, ...value } })
    },
    [ai, patch]
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.fispeak) return
    if (!providerNeedsKey(provider)) {
      let idle = true
      void Promise.resolve().then(() => {
        if (idle) setHasKey(false)
      })
      return () => {
        idle = false
      }
    }
    let active = true
    void getApi()
      .engine.hasKey(provider)
      .then((flag) => {
        if (active) setHasKey(flag)
      })
    return () => {
      active = false
    }
  }, [provider])

  const routes = taskRoutings(ai, {
    promptAiEnabled: settings.promptAiEnabled,
    promptAiProvider: settings.promptAiProvider
  })

  const applyAi = useCallback(
    (nextAi: Settings['ai']): void => {
      const value: Partial<Settings> = { ai: nextAi }
      if (nextAi.provider === 'local') {
        value.whisperModel = nextAi.models.listen as Settings['whisperModel']
        value.ttsModel = nextAi.models.speak
      }
      patch(value)
    },
    [patch]
  )

  const setModel = (task: AiTask, value: string): void => {
    const nextAi = { ...ai, models: { ...ai.models, [task]: value } }
    if (provider === 'local' && task === 'listen') {
      patch({ ai: nextAi, whisperModel: value as Settings['whisperModel'] })
      return
    }
    if (provider === 'local' && task === 'speak') {
      patch({ ai: nextAi, ttsModel: value })
      return
    }
    patch({ ai: nextAi })
  }

  const chooseProvider = (value: AiProviderId): void => {
    setResult(null)
    setNotice(null)
    const next = providerOf(value)
    const nextAi: Settings['ai'] = {
      ...ai,
      provider: value,
      models: {
        listen: next.tasks.listen?.defaultModel ?? '',
        translate: next.tasks.translate?.defaultModel ?? '',
        speak: next.tasks.speak?.defaultModel ?? 'kokoro-onnx',
        prompt: next.tasks.prompt?.defaultModel ?? ''
      },
      voiceId: next.tasks.speak?.voices?.[0]?.id ?? ai.voiceId,
      voiceSource: 'preset'
    }
    applyAi(nextAi)
  }

  const saveKey = async (): Promise<void> => {
    setNotice(null)
    const ok = await getApi().engine.setKey(provider, keyDraft)
    if (ok) {
      setKeyDraft('')
      setHasKey(true)
      setNotice('API key saved in the OS credential store.')
    } else {
      setNotice('Could not reach the credential store - is the Keychain unlocked?')
    }
  }

  const clearKey = async (): Promise<void> => {
    await getApi().engine.clearKey(provider)
    setHasKey(false)
    setNotice('API key removed.')
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setNotice(null)
    setResult(null)
    try {
      setResult(await getApi().engine.test(ai))
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: 0
      })
    } finally {
      setTesting(false)
    }
  }

  const cloudRoutes = routes.filter((route) => route.mode === 'cloud')
  const speakCapability = taskCapability(provider, 'speak')
  const supportsClone = provider === 'mistral' || provider === 'local'

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsGroup
        icon={<span className="text-[12px]">✦</span>}
        title="Quick setup"
        subtitle="One click fills the provider, models and voice. Offline stays the default."
      >
        <div className="flex flex-wrap gap-1.5 py-2">
          {AI_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => {
                setResult(null)
                setNotice(null)
                applyAi(preset.settings)
              }}
              className={`rounded-full px-2.5 py-1 text-[10px] transition ${
                ai.provider === preset.settings.provider
                  ? 'bg-[#0A84FF] text-white'
                  : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.12]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        icon={<ProviderIcon id={provider} />}
        title="AI Provider"
        subtitle={entry.description}
        action={
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] text-white/45">
            {BADGE_TEXT[entry.badge]}
          </span>
        }
      >
        <div className="flex flex-wrap gap-1.5 py-2.5">
          {(Object.keys(AI_PROVIDERS) as AiProviderId[]).map((id) => {
            const item = AI_PROVIDERS[id]
            const selected = id === provider
            return (
              <button
                key={id}
                type="button"
                onClick={() => chooseProvider(id)}
                title={item.description}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] transition ${
                  selected
                    ? 'bg-[#0A84FF] text-white'
                    : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.12]'
                }`}
              >
                {item.label}
                {item.badge === 'free' && (
                  <span className={selected ? 'text-white/70' : 'text-[#4CD964]/80'}>free</span>
                )}
              </button>
            )
          })}
        </div>

        {providerNeedsKey(provider) ? (
          <>
            <SettingsRow
              label="API key"
              hint={
                hasKey
                  ? `Saved for ${entry.label}. One key covers every task this provider offers.`
                  : `Stored in the OS credential store - never in settings.json.`
              }
            >
              <input
                type="password"
                aria-label={`${entry.label} API key`}
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                placeholder={hasKey ? '••••••••' : 'sk-…'}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => void saveKey()}
                disabled={!keyDraft.trim()}
                className={pillClass}
              >
                Save
              </button>
              {hasKey && (
                <button type="button" onClick={() => void clearKey()} className={pillClass}>
                  Clear
                </button>
              )}
            </SettingsRow>
            {hasKey && (
              <p className="pb-1 text-[10px] text-[#4CD964]">✓ API key stored for {entry.label}</p>
            )}
          </>
        ) : (
          <p className="py-2 text-[10px] text-white/35">
            No key needed. {provider === 'ollama' ? 'Ollama runs on this machine.' : 'Everything stays local.'}
          </p>
        )}

        {provider === 'custom' && (
          <SettingsRow label="Server URL" hint="OpenAI-compatible base URL (/v1 is added when missing)">
            <input
              aria-label="Custom server URL"
              value={ai.customBaseUrl}
              onChange={(event) => patchAi({ customBaseUrl: event.target.value })}
              placeholder="http://localhost:8000/v1"
              className={inputClass}
            />
          </SettingsRow>
        )}

        {provider === 'cloudflare' && (
          <SettingsRow label="Account ID" hint="Workers AI dashboard - not a secret">
            <input
              aria-label="Cloudflare account id"
              value={ai.cloudflareAccountId}
              onChange={(event) => patchAi({ cloudflareAccountId: event.target.value })}
              placeholder="023e105f4ecef8ad9ca31a8372d0c353"
              className={inputClass}
            />
          </SettingsRow>
        )}

        <div className="flex items-center gap-2 py-2">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing}
            className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80 transition hover:bg-white/20 disabled:opacity-40"
          >
            {testing ? 'Testing…' : 'Test all tasks'}
          </button>
          {result && (
            <span className={`text-[10px] ${result.ok ? 'text-[#4CD964]' : 'text-[#FF453A]'}`}>
              {result.ok ? '✓' : '✕'} {result.message}
              {result.latencyMs > 0 ? ` (${result.latencyMs} ms)` : ''}
            </span>
          )}
        </div>
        {provider === 'mistral' && (
          <p className="pb-1.5 text-[9px] leading-relaxed text-white/30">
            Free mode is rate limited. The test spaces its calls and retries a 429; if it still
            fails, wait a few seconds and run it again.
          </p>
        )}
        {notice && <p className="pb-1.5 text-[10px] text-white/45">{notice}</p>}
      </SettingsGroup>

      <SettingsGroup
        icon={<span className="text-[12px]">◈</span>}
        title="Models"
        subtitle="Only models that can do the job are listed. A missing task falls back to Local."
      >
        {AI_TASKS.map((task) => {
          const capability = taskCapability(provider, task)
          const route = routes.find((item) => item.task === task)
          if (!route) return null
          return (
            <SettingsRow
              key={task}
              label={AI_TASK_LABELS[task]}
              hint={capability?.note ?? route.note}
            >
              {capability ? (
                provider === 'custom' ? (
                  <input
                    aria-label={`${AI_TASK_LABELS[task]} model`}
                    value={ai.models[task] || capability.defaultModel}
                    onChange={(event) => setModel(task, event.target.value)}
                    className="w-44 rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
                  />
                ) : (
                  <select
                    aria-label={`${AI_TASK_LABELS[task]} model`}
                    value={ai.models[task] || capability.defaultModel}
                    onChange={(event) => setModel(task, event.target.value)}
                    className="max-w-56 rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
                  >
                    {capability.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <span className="text-[10px] text-white/30">
                  {task === 'speak' ? 'not offered' : 'not offered'}
                </span>
              )}
              <AiModeBadge
                mode={route.mode}
                provider={route.mode === 'cloud' ? route.providerLabel : undefined}
              />
            </SettingsRow>
          )
        })}
      </SettingsGroup>

      {speakCapability && (
        <SettingsGroup
          icon={<span className="text-[12px]">◉</span>}
          title="Voice"
          subtitle="Preset keeps it simple; clone uses the sample recorded on the Voice page."
        >
          <SettingsRow
            label="Source"
            hint={supportsClone ? undefined : 'This provider has no clone endpoint in fispeak yet.'}
          >
            <div className="flex gap-1">
              {(supportsClone
                ? (['preset', 'clone'] as const)
                : (['preset'] as const)
              ).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => patchAi({ voiceSource: source })}
                  className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                    ai.voiceSource === source
                      ? 'bg-[#0A84FF] text-white'
                      : 'bg-white/[0.06] text-white/55 hover:bg-white/[0.12]'
                  }`}
                >
                  {source === 'preset' ? 'Preset' : 'Clone'}
                </button>
              ))}
            </div>
          </SettingsRow>
          <SettingsRow
            label="Voice"
            hint={
              ai.voiceSource === 'clone'
                ? provider === 'mistral'
                  ? 'Sends your saved sample as ref_audio. Indonesian needs a clone.'
                  : 'Uses the sample recorded on the Voice page.'
                : undefined
            }
          >
            {ai.voiceSource === 'clone' ? (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/55">
                My voice
              </span>
            ) : speakCapability.voices && speakCapability.voices.length > 0 ? (
              <select
                aria-label="Voice"
                value={ai.voiceId}
                onChange={(event) => patchAi({ voiceId: event.target.value })}
                className="max-w-48 rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
              >
                {speakCapability.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Voice id"
                value={ai.voiceId}
                onChange={(event) => patchAi({ voiceId: event.target.value })}
                placeholder="voice id"
                className="w-36 rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
              />
            )}
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup
        icon={<span className="text-[12px]">⌁</span>}
        title="Privacy"
        subtitle="Exactly what leaves this machine with the current provider."
      >
        <div className="space-y-1.5 py-2.5 text-[10px] leading-relaxed text-white/45">
          {cloudRoutes.length === 0 ? (
            <p className="text-[#4CD964]/80">Nothing leaves this machine. All tasks are Local.</p>
          ) : (
            cloudRoutes.map((route) => (
              <p key={route.task}>
                <span className="text-white/75">{AI_TASK_LABELS[route.task]}</span> →{' '}
                {route.providerLabel} ({route.model || 'default model'})
                {route.task === 'listen' && ' · meeting audio is uploaded'}
                {route.task === 'translate' && ' · transcript text is uploaded'}
                {route.task === 'speak' && ' · translated text is uploaded'}
                {route.task === 'prompt' && ' · dictated text is uploaded'}
              </p>
            ))
          )}
          {routes
            .filter((route) => route.mode === 'fallback')
            .map((route) => (
              <p key={`fallback-${route.task}`} className="text-[#FFB340]/80">
                {AI_TASK_LABELS[route.task]} falls back to Local — {route.note}
              </p>
            ))}
        </div>
      </SettingsGroup>
    </div>
  )
}
