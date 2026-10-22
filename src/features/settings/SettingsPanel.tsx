import type { ReactNode } from 'react'
import type { PlacementSetting, Settings } from '@shared/api'
import { SUPPORTED_LANGUAGES } from '@shared/api'
import { useSettingsStore } from '@/stores/settingsStore'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span className="flex flex-col">
        <span className="text-[12px] text-white/80">{label}</span>
        {hint && <span className="text-[10px] text-white/30">{hint}</span>}
      </span>
      <span className="shrink-0">{children}</span>
    </label>
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

const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map((language) => ({
  value: language.code,
  label: language.label
}))

const PLACEMENT_OPTIONS: ReadonlyArray<{ value: PlacementSetting; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'notch', label: 'Notch' },
  { value: 'floating', label: 'Floating' }
]

export function SettingsPanel(): JSX.Element {
  const settings = useSettingsStore((store) => store.settings)
  const update = useSettingsStore((store) => store.update)
  const patch = (value: Partial<Settings>): void => {
    void update(value)
  }

  return (
    <div className="divide-y divide-white/[0.06]">
      <section className="pb-2">
        <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Island</h3>
        <Row label="Placement" hint="Notch pins the island to the top edge on notched MacBooks">
          <Select
            label="Island placement"
            value={settings.placement}
            options={PLACEMENT_OPTIONS}
            onChange={(value) => patch({ placement: value })}
          />
        </Row>
      </section>

      <section className="py-2">
        <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Languages</h3>
        <Row label="My language">
          <Select
            label="My language"
            value={settings.myLang}
            options={LANGUAGE_OPTIONS}
            onChange={(value) => patch({ myLang: value })}
          />
        </Row>
        <Row label="Remote language">
          <Select
            label="Remote language"
            value={settings.remoteLang}
            options={[{ value: 'auto', label: 'Auto-detect' }, ...LANGUAGE_OPTIONS]}
            onChange={(value) => patch({ remoteLang: value })}
          />
        </Row>
        <Row label="Auto-detect remote language">
          <Toggle
            label="Auto-detect remote language"
            checked={settings.autoDetectRemoteLang}
            onChange={(value) => patch({ autoDetectRemoteLang: value })}
          />
        </Row>
      </section>

      <section className="py-2">
        <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Audio &amp; voice</h3>
        <Row label="Capture system audio" hint="Meeting audio from speakers or headphones">
          <Toggle
            label="Capture system audio"
            checked={settings.captureSystemAudio}
            onChange={(value) => patch({ captureSystemAudio: value })}
          />
        </Row>
        <Row label="Read my replies aloud (TTS)">
          <Toggle
            label="TTS enabled"
            checked={settings.ttsEnabled}
            onChange={(value) => patch({ ttsEnabled: value })}
          />
        </Row>
        <Row label="TTS volume">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            aria-label="TTS volume"
            defaultValue={settings.ttsVolume}
            onPointerUp={(event) => patch({ ttsVolume: Number(event.currentTarget.value) })}
            onKeyUp={(event) => patch({ ttsVolume: Number(event.currentTarget.value) })}
            className="w-28 accent-[#0A84FF]"
          />
        </Row>
      </section>

      <section className="py-2">
        <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Models &amp; summary</h3>
        <Row label="Whisper model" hint="Applied in Phase 3">
          <Select
            label="Whisper model"
            value={settings.whisperModel}
            options={[
              { value: 'base', label: 'Base (fast)' },
              { value: 'small', label: 'Small (default)' },
              { value: 'medium', label: 'Medium (accurate)' }
            ]}
            onChange={(value) => patch({ whisperModel: value })}
          />
        </Row>
        <Row label="Summary provider">
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
        </Row>
        <Row label="OpenRouter API key" hint="Only used when the fallback provider runs">
          <input
            type="password"
            aria-label="OpenRouter API key"
            defaultValue={settings.openrouterKey}
            onBlur={(event) => patch({ openrouterKey: event.currentTarget.value })}
            placeholder="sk-or-…"
            className="w-40 rounded-md border border-white/10 bg-[#171719] px-2 py-1 text-[12px] text-white/85 outline-none focus:border-white/30"
          />
        </Row>
      </section>

      <section className="pt-2">
        <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Shortcuts</h3>
        <div className="flex items-center justify-between py-1 text-[12px] text-white/70">
          <span>Toggle live translate</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">⌘/Ctrl ⇧ F</kbd>
        </div>
        <div className="flex items-center justify-between py-1 text-[12px] text-white/70">
          <span>Hide / show island</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">⌘/Ctrl ⇧ H</kbd>
        </div>
      </section>
    </div>
  )
}
