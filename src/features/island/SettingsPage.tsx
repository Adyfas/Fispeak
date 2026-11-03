import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { AiProviderId } from '@shared/api'
import { AI_PROVIDERS, AI_TASKS, AI_TASK_LABELS, taskRoutings } from '@shared/providers'
import { useSettingsStore } from '@/stores/settingsStore'
import { getApi } from '@/lib/ipc'
import { AiModeBadge } from '@/features/settings/SettingsGroup'
import { PageShell } from './PageShell'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[12px] text-white/80">{label}</p>
        {hint && <p className="text-[9px] text-white/35">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-[#0A84FF]' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}): JSX.Element {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** Compact Settings feature page; the full panel still owns models, keys and history. */
export function SettingsPage(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const [blackhole, setBlackhole] = useState(false)
  const routes = taskRoutings(settings.ai, {
    promptAiEnabled: settings.promptAiEnabled,
    promptAiProvider: settings.promptAiProvider
  })

  useEffect(() => {
    void getApi()
      .privacy.status()
      .then((status) => setBlackhole(status.blackhole))
  }, [])

  return (
    <PageShell
      title="Settings"
      subtitle="Quick settings"
      action={
        <button
          type="button"
          onClick={() => getApi().island.openPanel('settings')}
          className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/20"
        >
          Open panel
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-1">
          <div className="flex items-center justify-between py-1.5">
            <div>
              <p className="text-[12px] text-white/80">AI engine</p>
              <p className="text-[9px] text-white/35">One provider, one key</p>
            </div>
            <select
              aria-label="AI provider"
              value={settings.ai.provider}
              onChange={(event) => {
                const provider = event.target.value as AiProviderId
                const entry = AI_PROVIDERS[provider]
                const models = {
                  listen: entry.tasks.listen?.defaultModel ?? '',
                  translate: entry.tasks.translate?.defaultModel ?? '',
                  speak: entry.tasks.speak?.defaultModel ?? 'kokoro-onnx',
                  prompt: entry.tasks.prompt?.defaultModel ?? ''
                }
                void update({
                  ai: {
                    ...settings.ai,
                    provider,
                    models,
                    voiceSource: 'preset',
                    voiceId: entry.tasks.speak?.voices?.[0]?.id ?? settings.ai.voiceId
                  },
                  ...(provider === 'local'
                    ? {
                        whisperModel: models.listen as 'base' | 'small' | 'medium',
                        ttsModel: models.speak
                      }
                    : {})
                })
              }}
              className="rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
            >
              {(Object.keys(AI_PROVIDERS) as AiProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {AI_PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </div>
          {AI_TASKS.map((task) => {
            const route = routes.find((item) => item.task === task)
            if (!route) return null
            return (
              <div key={task} className="flex items-center justify-between py-1">
                <span className="text-[11px] text-white/55">{AI_TASK_LABELS[task]}</span>
                <span className="flex items-center gap-1.5">
                  <span className="max-w-40 truncate text-[9px] text-white/30">{route.model}</span>
                  <AiModeBadge
                    mode={route.mode}
                    provider={route.mode === 'cloud' ? route.providerLabel : undefined}
                  />
                </span>
              </div>
            )
          })}
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-1">
          <Row label="Capture system audio" hint="Meeting audio">
            <Toggle
              label="Capture system audio"
              checked={settings.captureSystemAudio}
              onChange={(value) => void update({ captureSystemAudio: value })}
            />
          </Row>
          <Row label="Read replies aloud" hint="TTS">
            <Toggle
              label="TTS enabled"
              checked={settings.ttsEnabled}
              onChange={(value) => void update({ ttsEnabled: value })}
            />
          </Row>
          <Row label="Auto-detect partner language">
            <Toggle
              label="Auto-detect remote language"
              checked={settings.autoDetectRemoteLang}
              onChange={(value) => void update({ autoDetectRemoteLang: value })}
            />
          </Row>
          <Row label="Auto-play after Selesai" hint="2s to cancel">
            <Toggle
              label="Auto-play after Selesai"
              checked={settings.speakAutoPlay}
              onChange={(value) => void update({ speakAutoPlay: value })}
            />
          </Row>
          <Row label="Prompt auto-paste" hint="⌘V into the focused field">
            <Toggle
              label="Prompt auto-paste"
              checked={settings.dictationAutoPaste}
              onChange={(value) => void update({ dictationAutoPaste: value })}
            />
          </Row>
          <Row label="AI prompt upgrade" hint="Rewrite with OVH before pasting">
            <Toggle
              label="AI prompt upgrade"
              checked={settings.promptAiEnabled}
              onChange={(value) => void update({ promptAiEnabled: value })}
            />
          </Row>
          <Row label="TTS output" hint={blackhole ? 'BlackHole 2ch detected' : 'BlackHole not installed'}>
            <select
              aria-label="TTS output"
              value={settings.ttsOutput}
              onChange={(event) =>
                void update({ ttsOutput: event.target.value as 'speaker' | 'blackhole' })
              }
              className="rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
            >
              <option value="speaker">Speaker</option>
              <option value="blackhole" disabled={!blackhole}>
                BlackHole
              </option>
            </select>
          </Row>
          <Row label="Engine idle" hint="Stop Python + Ollama after">
            <select
              aria-label="Engine idle"
              value={settings.sidecarKeepAlive}
              onChange={(event) =>
                void update({
                  sidecarKeepAlive: event.target.value as
                    | 'off'
                    | '2m'
                    | '10m'
                    | 'always'
                })
              }
              className="rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30"
            >
              <option value="off">Immediately</option>
              <option value="2m">2 min</option>
              <option value="10m">10 min</option>
              <option value="always">Always</option>
            </select>
          </Row>
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-1">
          <Row label="Translate quality">
            <Select
              label="Translate quality"
              value={settings.translateQuality}
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'quality', label: 'Quality' }
              ]}
              onChange={(value) => void update({ translateQuality: value })}
            />
          </Row>
        </section>

        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={() => getApi().island.openPanel('download')}
            className="flex-1 rounded-xl bg-white/[0.06] py-2 text-[11px] text-white/70 transition hover:bg-white/[0.12]"
          >
            Download models
          </button>
          <button
            type="button"
            onClick={() => getApi().island.openPanel('history')}
            className="flex-1 rounded-xl bg-white/[0.06] py-2 text-[11px] text-white/70 transition hover:bg-white/[0.12]"
          >
            History
          </button>
        </div>
      </div>
    </PageShell>
  )
}
