import { useEffect, useState } from 'react'
import type { LanguageOption, PlacementSetting, PrivacyStatus, Settings } from '@shared/api'
import { taskCapability } from '@shared/providers'
import { useSettingsStore } from '@/stores/settingsStore'
import { getApi } from '@/lib/ipc'
import { EngineSection } from './EngineSection'
import { SettingsGroup, SettingsRow } from './SettingsGroup'

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
      className="rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[12px] text-white/85 outline-none focus:border-white/30"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

const PLACEMENT_OPTIONS: ReadonlyArray<{ value: PlacementSetting; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'notch', label: 'Notch' },
  { value: 'floating', label: 'Floating' }
]

const textInput =
  'w-56 rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[11px] text-white/85 outline-none focus:border-white/30'

export function SettingsPanel(): JSX.Element {
  const settings = useSettingsStore((store) => store.settings)
  const update = useSettingsStore((store) => store.update)
  const [languages, setLanguages] = useState<LanguageOption[]>([])
  const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null)
  const patch = (value: Partial<Settings>): void => {
    void update(value)
  }

  // The language list comes from the sidecar - never from a second copy in the renderer.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.fispeak) return
    void getApi().translate.languages().then(setLanguages)
    void getApi().privacy.status().then(setPrivacy)
  }, [])

  const languageOptions =
    languages.length > 0
      ? languages.map((language) => ({ value: language.ui, label: language.label }))
      : [
          { value: settings.myLang, label: settings.myLang.toUpperCase() },
          { value: settings.remoteLang, label: settings.remoteLang.toUpperCase() }
        ]

  const promptOwnedByProvider = Boolean(taskCapability(settings.ai.provider, 'prompt'))

  return (
    <div className="flex flex-col gap-2.5">
      <EngineSection settings={settings} patch={patch} />

      <SettingsGroup
        icon={<span className="text-[12px]">◐</span>}
        title="Island"
        subtitle="Where the floating card lives."
      >
        <SettingsRow label="Placement" hint="Notch pins the island to the top edge on notched MacBooks">
          <Select
            label="Island placement"
            value={settings.placement}
            options={PLACEMENT_OPTIONS}
            onChange={(value) => patch({ placement: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        icon={<span className="text-[12px]">文</span>}
        title="Languages"
        subtitle="Your language and the meeting partner's language."
      >
        <SettingsRow label="My language">
          <Select
            label="My language"
            value={settings.myLang}
            options={languageOptions}
            onChange={(value) => patch({ myLang: value })}
          />
        </SettingsRow>
        <SettingsRow label="Remote language" hint="Pinned only when auto-detect is off">
          <span className={settings.autoDetectRemoteLang ? 'pointer-events-none opacity-45' : ''}>
            <Select
              label="Remote language"
              value={settings.autoDetectRemoteLang ? 'auto' : settings.remoteLang}
              options={[{ value: 'auto', label: 'Auto-detect' }, ...languageOptions]}
              onChange={(value) =>
                patch(
                  value === 'auto'
                    ? { remoteLang: 'auto', autoDetectRemoteLang: true }
                    : { remoteLang: value, autoDetectRemoteLang: false }
                )
              }
            />
          </span>
        </SettingsRow>
        <SettingsRow label="Auto-detect remote language" hint="Follow the meeting language per window">
          <Toggle
            label="Auto-detect remote language"
            checked={settings.autoDetectRemoteLang}
            onChange={(value) =>
              patch({
                autoDetectRemoteLang: value,
                ...(value || settings.remoteLang !== 'auto' ? {} : { remoteLang: 'en' })
              })
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        icon={<span className="text-[12px]">◍</span>}
        title="Audio & voice"
        subtitle="Capture, playback and the local fallback voice."
      >
        <SettingsRow label="Capture system audio" hint="Meeting audio from speakers or headphones">
          <Toggle
            label="Capture system audio"
            checked={settings.captureSystemAudio}
            onChange={(value) => patch({ captureSystemAudio: value })}
          />
        </SettingsRow>
        {privacy && (
          <SettingsRow
            label="Screen Recording permission"
            hint={
              privacy.screenRecording === 'granted'
                ? 'System audio capture is allowed'
                : privacy.systemAudio === 'available'
                  ? 'Required for meeting audio on macOS 13+'
                  : 'System audio is not available on this system'
            }
          >
            {privacy.screenRecording === 'granted' ? (
              <span className="rounded-full bg-[#4CD964]/15 px-2 py-0.5 text-[10px] text-[#4CD964]">
                granted
              </span>
            ) : privacy.systemAudio === 'available' ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => getApi().privacy.openScreenRecording()}
                  className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/75 transition hover:bg-white/20"
                >
                  Open settings
                </button>
                <button
                  type="button"
                  onClick={() => void getApi().privacy.status().then(setPrivacy)}
                  className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/75 transition hover:bg-white/20"
                >
                  Check again
                </button>
              </span>
            ) : (
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/45">
                {privacy.blackhole ? 'use BlackHole' : 'unavailable'}
              </span>
            )}
          </SettingsRow>
        )}
        <SettingsRow label="Read replies aloud (TTS)">
          <Toggle
            label="TTS enabled"
            checked={settings.ttsEnabled}
            onChange={(value) => patch({ ttsEnabled: value })}
          />
        </SettingsRow>
        <SettingsRow label="Auto-play after Selesai" hint="2 seconds to cancel">
          <Toggle
            label="Auto-play after Selesai"
            checked={settings.speakAutoPlay}
            onChange={(value) => patch({ speakAutoPlay: value })}
          />
        </SettingsRow>
        <SettingsRow
          label="TTS output"
          hint={privacy?.blackhole ? 'BlackHole 2ch detected' : 'BlackHole not installed'}
        >
          <Select
            label="TTS output"
            value={settings.ttsOutput}
            options={[
              { value: 'speaker', label: 'Speaker' },
              ...(privacy?.blackhole
                ? [{ value: 'blackhole' as const, label: 'BlackHole' }]
                : [])
            ]}
            onChange={(value) => patch({ ttsOutput: value })}
          />
        </SettingsRow>
        <SettingsRow label="Engine idle" hint="Stop Python + Ollama after">
          <Select
            label="Engine idle"
            value={settings.sidecarKeepAlive}
            options={[
              { value: 'off', label: 'Immediately' },
              { value: '2m', label: '2 min' },
              { value: '10m', label: '10 min' },
              { value: 'always', label: 'Always' }
            ]}
            onChange={(value) => patch({ sidecarKeepAlive: value })}
          />
        </SettingsRow>
        <SettingsRow label="TTS volume">
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              aria-label="TTS volume"
              value={settings.ttsVolume}
              onChange={(event) => patch({ ttsVolume: Number(event.target.value) })}
              className="w-28 accent-[#0A84FF]"
            />
            <span className="w-8 text-right text-[10px] tabular-nums text-white/45">
              {Math.round(settings.ttsVolume * 100)}%
            </span>
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        icon={<span className="text-[12px]">✎</span>}
        title="Prompt page"
        subtitle="Dictate an idea and optionally rewrite it into a detailed prompt."
      >
        <SettingsRow label="AI prompt upgrade" hint="Rewrite before pasting">
          <Toggle
            label="AI prompt upgrade"
            checked={settings.promptAiEnabled}
            onChange={(value) => patch({ promptAiEnabled: value })}
          />
        </SettingsRow>
        <SettingsRow label="Prompt auto-paste" hint="Paste into the focused field with ⌘V">
          <Toggle
            label="Prompt auto-paste"
            checked={settings.dictationAutoPaste}
            onChange={(value) => patch({ dictationAutoPaste: value })}
          />
        </SettingsRow>
        <SettingsRow
          label="AI provider"
          hint={
            promptOwnedByProvider
              ? `${settings.ai.provider} handles Prompt with the same key.`
              : 'This provider has no chat model, so the advanced provider below is used.'
          }
        >
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/55">
            {promptOwnedByProvider ? settings.ai.provider : settings.promptAiProvider}
          </span>
        </SettingsRow>
        {!promptOwnedByProvider && (
          <>
            <SettingsRow label="Advanced provider" hint="Free OVHcloud works without a key">
              <Select
                label="Prompt AI provider"
                value={settings.promptAiProvider}
                options={[
                  { value: 'ovh', label: 'OVHcloud' },
                  { value: 'groq', label: 'Groq' },
                  { value: 'openrouter', label: 'OpenRouter' },
                  { value: 'ollama', label: 'Ollama' },
                  { value: 'custom', label: 'Custom' }
                ]}
                onChange={(value) => patch({ promptAiProvider: value })}
              />
            </SettingsRow>
            <SettingsRow label="Advanced model">
              <input
                type="text"
                aria-label="Prompt AI model"
                value={settings.promptAiModel}
                onChange={(event) => patch({ promptAiModel: event.target.value })}
                spellCheck={false}
                className={textInput}
              />
            </SettingsRow>
            {(settings.promptAiProvider === 'custom' ||
              settings.promptAiProvider === 'ollama') && (
              <SettingsRow label="Advanced base URL">
                <input
                  type="text"
                  aria-label="Prompt AI base URL"
                  value={settings.promptAiBaseUrl}
                  onChange={(event) => patch({ promptAiBaseUrl: event.target.value })}
                  placeholder="http://localhost:11434"
                  spellCheck={false}
                  className={textInput}
                />
              </SettingsRow>
            )}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        icon={<span className="text-[12px]">◔</span>}
        title="Live translate"
        subtitle="Local LISTEN trade-off: quality keeps whole sentences."
      >
        <SettingsRow
          label="Quality"
          hint="Quality is slower but the sentences read much better"
        >
          <Select
            label="Live translate quality"
            value={settings.translateQuality}
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'quality', label: 'Quality (slowest)' }
            ]}
            onChange={(value) => patch({ translateQuality: value })}
          />
        </SettingsRow>
        <SettingsRow label="Summary provider" hint="Phase 4 - summaries not implemented yet">
          <Select
            label="Summary provider"
            value={settings.summaryProvider}
            options={[
              { value: 'auto', label: 'Auto (Ollama)' },
              { value: 'ollama', label: 'Ollama' },
              { value: 'openrouter', label: 'OpenRouter' }
            ]}
            onChange={(value) => patch({ summaryProvider: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        icon={<span className="text-[12px]">⌘</span>}
        title="Shortcuts"
        subtitle="Global keys work while fispeak is running."
      >
        <div className="flex items-center justify-between py-2 text-[12px] text-white/70">
          <span>Toggle live translate</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
            ⌘/Ctrl ⇧ F
          </kbd>
        </div>
        <div className="flex items-center justify-between py-2 text-[12px] text-white/70">
          <span>Hide / show island</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
            ⌘/Ctrl ⇧ H
          </kbd>
        </div>
      </SettingsGroup>
    </div>
  )
}
