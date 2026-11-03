import { useEffect, useState } from 'react'
import type { AppInfo, PanelTab } from '@shared/api'
import logoFispeak from '@/assets/logo-fispeak.png'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { ModelsPanel } from '@/features/models/ModelsPanel'
import { HistoryPanel } from '@/features/history/HistoryPanel'
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

/** Models the first run needs before LISTEN/SPEAK can work (10-summary-export §4). */
const ESSENTIAL_MODELS = ['faster-whisper-small', 'nllb-200-distilled-600M-ct2-int8'] as const

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
  const [setup, setSetup] = useState<{ busy: boolean; line: string; error: string | null }>({
    busy: false,
    line: '',
    error: null
  })

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

  // First-run progress: the Download tab has its own subscription, this one feeds the wizard.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.fispeak) return
    return getApi().models.onProgress((status) => {
      setSetup((current) =>
        current.busy
          ? { ...current, line: `${status.label}: ${Math.round(status.progress * 100)}%` }
          : current
      )
    })
  }, [])

  async function downloadEssentialPack(): Promise<void> {
    setSetup({ busy: true, line: 'Preparing…', error: null })
    try {
      for (const id of ESSENTIAL_MODELS) {
        setSetup((current) => ({ ...current, line: `Downloading ${id}…` }))
        await getApi().models.download(id)
      }
      setWelcomeDismissed(true)
      await update({ firstRunDone: true })
      setTab('download')
    } catch (error) {
      setSetup({
        busy: false,
        line: '',
        error: error instanceof Error ? error.message : 'Download failed'
      })
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[#0b0b0d] text-white">
      <header
        className="app-drag flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] pr-4"
        style={{ paddingLeft: isMac ? 84 : 16 }}
      >
        <div className="flex items-center gap-2">
          <img src={logoFispeak} alt="" className="h-4 w-auto" />
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

        {tab === 'download' && <ModelsPanel />}

        {tab === 'history' && <HistoryPanel />}

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
          <div className="w-[340px] rounded-2xl border border-white/10 bg-[#121214] p-5 shadow-2xl">
            <h2 className="text-[15px] font-semibold">Welcome to fispeak</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-white/55">
              Your floating translator. Let the meeting audio in (LISTEN) or speak your own
              language and play the translation to your partner (SPEAK).
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              Everything runs on this Mac. The first run needs the speech and translation models
              (about 1.1 GB, downloaded once).
            </p>
            {setup.line && (
              <p className="mt-2 text-[11px] tabular-nums text-[#0A84FF]">{setup.line}</p>
            )}
            {setup.error && <p className="mt-2 text-[11px] text-red-400">{setup.error}</p>}
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={setup.busy}
                onClick={() => void downloadEssentialPack()}
                className="w-full rounded-lg bg-[#0A84FF] py-2 text-[12px] font-medium text-white transition hover:bg-[#0A84FF]/85 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
              >
                {setup.busy ? 'Downloading…' : 'Download essential models'}
              </button>
              <button
                type="button"
                disabled={setup.busy}
                onClick={() => {
                  setWelcomeDismissed(true)
                  void update({ firstRunDone: true })
                }}
                className="w-full rounded-lg bg-white/[0.06] py-1.5 text-[11px] text-white/60 transition hover:bg-white/10 disabled:opacity-40"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
