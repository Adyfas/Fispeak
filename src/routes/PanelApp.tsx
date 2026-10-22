import { useEffect, useState } from 'react'
import type { AppInfo, PanelTab } from '@shared/api'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { getApi } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settingsStore'

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'settings', label: 'Settings' },
  { id: 'download', label: 'Download' },
  { id: 'history', label: 'History' },
  { id: 'summary', label: 'Summary' }
]

/** Traffic lights (hiddenInset) sit in the first ~70 px on macOS. */
const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

function initialTab(): PanelTab {
  const requested = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((tab) => tab.id === requested) ? (requested as PanelTab) : 'settings'
}

function EmptyState({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
      <p className="text-[13px] text-white/70">{title}</p>
      <p className="text-[11px] text-white/30">{body}</p>
    </div>
  )
}

export function PanelApp(): JSX.Element {
  const [tab, setTab] = useState<PanelTab>(initialTab)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)

  const settings = useSettingsStore((store) => store.settings)
  const loaded = useSettingsStore((store) => store.loaded)
  const load = useSettingsStore((store) => store.load)
  const update = useSettingsStore((store) => store.update)

  const showWelcome = loaded && !settings.firstRunDone && !welcomeDismissed

  useEffect(() => {
    void load()
    void getApi().app.info().then(setInfo)
  }, [load])

  useEffect(() => getApi().panel.onTab((next) => setTab(next)), [])

  return (
    <div className="flex h-screen flex-col bg-[#0b0b0d] text-white">
      <header
        className="app-drag flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] pr-4"
        style={{ paddingLeft: isMac ? 84 : 16 }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#4CD964]" />
          <span className="text-[13px] font-semibold tracking-tight">fispeak</span>
        </div>
        <nav className="app-no-drag flex gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                tab === entry.id
                  ? 'bg-white/12 text-white'
                  : 'text-white/45 hover:bg-white/[0.06] hover:text-white/75'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-3">
        {tab === 'settings' && <SettingsPanel />}

        {tab === 'download' && (
          <EmptyState
            title="Model downloads arrive in Phase 3"
            body="Whisper small, NLLB int8 and Kokoro ONNX will download on demand into the app data folder."
          />
        )}

        {tab === 'history' && (
          <EmptyState
            title="No sessions yet"
            body="Meeting sessions appear here once audio capture lands in Phase 3."
          />
        )}

        {tab === 'summary' && (
          <EmptyState
            title="No summaries yet"
            body="Summaries run locally through Ollama, with OpenRouter as a fallback (Phase 4)."
          />
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[10px] text-white/30">
        <span>
          fispeak {info ? `v${info.version}` : ''} · {info?.platform ?? ''}
        </span>
        <span>Local-first. No cloud required.</span>
      </footer>

      {showWelcome && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-white/10 bg-[#121214] p-5 shadow-2xl">
            <h2 className="text-[15px] font-semibold">Welcome to fispeak</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-white/55">
              Your floating translator. Hover the island for notes and the pomodoro, and start live
              translation straight from there.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/30">
              Phase 1 is the interface only. Audio capture, models, TTS and summaries arrive in the
              next phases.
            </p>
            <button
              type="button"
              onClick={() => {
                setWelcomeDismissed(true)
                void update({ firstRunDone: true })
              }}
              className="mt-4 w-full rounded-lg bg-[#0A84FF] py-2 text-[12px] font-medium text-white transition hover:bg-[#0A84FF]/85"
            >
              Get started
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
