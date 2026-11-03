import { useEffect, useState } from 'react'
import type { LanguageOption } from '@shared/api'
import { useSettingsStore } from '@/stores/settingsStore'

interface LanguageBarProps {
  mode?: 'listen' | 'speak'
  onSwap?: () => void
}

/**
 * Language direction of the live session. The list comes from the sidecar (`/languages`),
 * the renderer must not keep its own copy of the mapping.
 *
 * In `speak` mode only the partner language matters: the user talks in their own language
 * and the message is translated into the partner's language, so "auto" is not offered there.
 */
export function LanguageBar({ mode = 'listen', onSwap }: LanguageBarProps): JSX.Element {
  const settings = useSettingsStore((store) => store.settings)
  const update = useSettingsStore((store) => store.update)
  const [languages, setLanguages] = useState<LanguageOption[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.fispeak) return
    let active = true
    void window.fispeak.translate.languages().then((list) => {
      if (active) setLanguages(list)
    })
    return () => {
      active = false
    }
  }, [])

  const label = (code: string): string => {
    if (code === 'auto') return 'AUTO'
    return languages.find((language) => language.ui === code)?.label.toUpperCase() ?? code.toUpperCase()
  }

  const partnerOptions = languages.filter((language) => language.ui !== 'auto')
  /** Auto-detect wins over the stored code; the controller sends `auto` in that case. */
  const remoteValue = settings.autoDetectRemoteLang ? 'auto' : settings.remoteLang
  const remoteOptions = [
    { ui: 'auto', whisper: 'auto', flores: 'auto', label: 'Auto-detect' },
    ...languages
  ]

  if (mode === 'speak') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.08em] text-white/35">
          {label(settings.myLang)} →
        </span>
        <select
          aria-label="Partner language"
          value={settings.remoteLang === 'auto' ? '' : settings.remoteLang}
          onChange={(event) => void update({ remoteLang: event.target.value })}
          className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/75 outline-none focus:border-white/30"
        >
          <option value="" className="bg-[#171719] text-white">
            Pick partner language
          </option>
          {partnerOptions.map((option) => (
            <option key={option.ui} value={option.ui} className="bg-[#171719] text-white">
              {option.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[9px] uppercase tracking-[0.08em] text-white/25">
          speak to translate
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Remote language"
        value={remoteValue}
        onChange={(event) => {
          const value = event.target.value
          void update(
            value === 'auto'
              ? { remoteLang: 'auto', autoDetectRemoteLang: true }
              : { remoteLang: value, autoDetectRemoteLang: false }
          )
        }}
        className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/75 outline-none focus:border-white/30"
      >
        {remoteOptions.map((option) => (
          <option key={option.ui} value={option.ui} className="bg-[#171719] text-white">
            {option.ui === 'auto' ? 'Auto' : option.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-label="Swap languages"
        onClick={onSwap}
        className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/60 transition hover:bg-white/[0.12] hover:text-white"
      >
        ⇄
      </button>

      <select
        aria-label="My language"
        value={settings.myLang}
        onChange={(event) => void update({ myLang: event.target.value })}
        className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/75 outline-none focus:border-white/30"
      >
        {languages.map((option) => (
          <option key={option.ui} value={option.ui} className="bg-[#171719] text-white">
            {option.label}
          </option>
        ))}
      </select>

      <span className="ml-auto text-[9px] uppercase tracking-[0.08em] text-white/25">
        {label(remoteValue)} → {label(settings.myLang)}
      </span>
    </div>
  )
}
