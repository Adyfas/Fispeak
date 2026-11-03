import { useCallback, useEffect, useState } from 'react'
import type { TranscriptLine, TurnRecord } from '@shared/api'
import { taskRouting } from '@shared/providers'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTranslateStore } from '@/stores/translateStore'
import { usePillStore } from '@/stores/pillStore'
import { AudioMeter } from './AudioMeter'
import { LanguageBar } from './LanguageBar'
import { ModeSwitch, SpeakCard, type SpeakPhase } from './ModeSwitch'
import { TranscriptList } from './TranscriptList'
import { SessionPopup } from './SessionPopup'
import { MicIcon, SpeakerIcon, StopIcon } from '@/components/icons'
import { getApi } from '@/lib/ipc'

function statusLabel(sidecar: string, mic: string): { text: string; tone: string } {
  if (mic === 'denied') return { text: 'mic blocked', tone: 'text-amber-300/80' }
  if (sidecar === 'reconnecting') return { text: 'reconnecting', tone: 'text-amber-300/80' }
  if (sidecar === 'error') return { text: 'sidecar error', tone: 'text-red-400/80' }
  if (sidecar === 'connected') return { text: 'live', tone: 'text-[#4CD964]' }
  if (sidecar === 'idle') return { text: 'idle', tone: 'text-white/35' }
  return { text: 'connecting', tone: 'text-white/35' }
}

function toTranscriptLines(turns: TurnRecord[]): TranscriptLine[] {
  return turns.map((turn) => ({
    chunkId: turn.id,
    tag: turn.tag,
    srcLang: turn.srcLang,
    text: turn.textSrc,
    translated: turn.textTgt,
    tgtLang: turn.tgtLang,
    quality: turn.quality === 'warn' ? 'warn' : 'ok',
    startedMs: turn.startedMs,
    endedMs: turn.endedMs,
    confidence: turn.confidence
  }))
}

/** LISTEN / SPEAK feature page (04-ui-spec §4.3 + Phase 3.2 shell). */
export function TranslateView({ variant }: { variant: 'full' | 'mini' }): JSX.Element {
  const dispatch = usePillStore((state) => state.dispatch)
  const status = useTranslateStore((state) => state.status)
  const lines = useTranslateStore((state) => state.lines)
  const partials = useTranslateStore((state) => state.partials)
  const speakTranslation = useTranslateStore((state) => state.speakTranslation)
  const sttMode = useTranslateStore((state) => state.sttMode)
  const mode = useTranslateStore((state) => state.mode)
  const setMode = useTranslateStore((state) => state.setMode)
  const resetLines = useTranslateStore((state) => state.reset)
  const hydrate = useTranslateStore((state) => state.hydrate)
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((store) => store.update)
  const [speakPhase, setSpeakPhase] = useState<SpeakPhase>('live')
  // Owned here: switching to `ready` seeds it from the live text without an effect.
  const [speakDraft, setSpeakDraft] = useState('')
  const [speakTakeStart, setSpeakTakeStart] = useState(0) // index into youLines for current take
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [autoPlayCancelled, setAutoPlayCancelled] = useState(false)
  const [starting, setStarting] = useState(false)
  // Entering LISTEN/SPEAK resizes the card under the cursor; a second click could land on
  // Stop/Sessions. Keep the header inert for a moment after the page mounts.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 320)
    return () => window.clearTimeout(timer)
  }, [])

  const startEngine = useCallback(async (): Promise<void> => {
    setStarting(true)
    try {
      const sessions = await getApi().session.list()
      const latest = sessions[0]
      if (latest) {
        await getApi().session.resume(latest.id)
        const turns = await getApi().session.turns(latest.id)
        const hydrated = toTranscriptLines(turns)
        hydrate(hydrated)
        setSpeakTakeStart(hydrated.filter((line) => line.tag === 'you').length)
      } else {
        await getApi().translate.start()
      }
      setSpeakPhase('live')
      setSpeakDraft('')
    } finally {
      setStarting(false)
    }
  }, [hydrate])

  // The live source for SPEAK: all committed `you` lines in current take + current partial.
  const youLines = lines.filter((line) => line.tag === 'you').slice(speakTakeStart)

  const lastTranslation = [...lines].reverse().find((line) => line.translated)?.translated ?? ''

  const playDraft = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      const record = speakPhase === 'ready'
      setSpeakPhase('played')
      getApi().translate.speak(trimmed, settings.remoteLang, record)
    },
    [speakPhase, settings.remoteLang]
  )

  // Quick confirm: after Selesai, play automatically unless the user cancels.
  useEffect(() => {
    if (!settings.speakAutoPlay) return
    if (speakPhase !== 'ready' || autoPlayCancelled || !speakDraft.trim()) return
    const timer = window.setTimeout(() => playDraft(speakDraft), 1800)
    return () => window.clearTimeout(timer)
  }, [settings.speakAutoPlay, speakPhase, autoPlayCancelled, speakDraft, playDraft])

  if (variant === 'mini') {
    return (
      <div className="flex h-full items-center gap-2 px-3">
        <SpeakerIcon className="h-3 w-3 shrink-0 text-[#4CD964]" />
        <span className="truncate text-[11px] text-white/70">
          {lastTranslation || 'Listening…'}
        </span>
      </div>
    )
  }

  const label = statusLabel(status?.sidecar ?? 'idle', status?.mic ?? 'idle')
  const needsPermission = status?.mic === 'denied'
  const pair =
    mode === 'listen'
      ? `${(settings.autoDetectRemoteLang ? 'auto' : settings.remoteLang).toUpperCase()} → ${settings.myLang.toUpperCase()}`
      : `${settings.myLang.toUpperCase()} → ${settings.remoteLang.toUpperCase()}`
  const route = taskRouting(settings.ai, mode === 'listen' ? 'listen' : 'translate')
  const engineBadge =
    route.mode === 'cloud'
      ? `☁ ${route.providerLabel}`
      : route.mode === 'fallback'
        ? 'Local'
        : 'Local'

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        aria-hidden
        className="gradient-neon pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full opacity-[0.07] blur-2xl"
      />
      <header className="relative flex shrink-0 items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-rounded text-[15px] font-semibold tracking-tight text-white">
              {mode === 'listen' ? 'Listen' : 'Speak'}
            </h2>
            <span className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${label.tone}`}>
              {label.text}
            </span>
          </div>
          <p className="truncate text-[10px] tabular-nums text-white/40">
            {pair}
            <span className={route.mode === 'cloud' ? 'text-[#6CB6FF]' : 'text-white/30'}>
              {' '}
              · {engineBadge}
            </span>
            {sttMode === 'batch' && <span className="text-amber-300/60"> · batch</span>}
          </p>
        </div>

        <div
          className={`flex items-center gap-1.5 transition-opacity duration-150 ${
            armed ? '' : 'pointer-events-none opacity-80'
          }`}
        >
          <AudioMeter />
          <ModeSwitch
            mode={mode}
            onChange={(next) => {
              setMode(next)
              setSpeakPhase('live')
              setSpeakDraft('')
              getApi().translate.setMode(next)
            }}
          />
          <button
            type="button"
            onClick={() => setSessionsOpen(true)}
            className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] text-white/60 transition hover:bg-white/[0.12] hover:text-white/85"
          >
            Sessions
          </button>
          {status?.sessionId && (
            <button
              type="button"
              onClick={() => {
                dispatch('stop-translate')
                // Stop is a clean stop: mic + system audio off, no late lines, empty transcript.
                resetLines()
                getApi().translate.stop()
              }}
              className="flex items-center gap-1 rounded-full bg-[#FF3B30]/15 px-2 py-1 text-[9px] font-medium text-[#FF6B6B] transition hover:bg-[#FF3B30]/25"
            >
              <StopIcon className="h-2.5 w-2.5" /> stop
            </button>
          )}
        </div>
      </header>

      {/* The language bar stays in both modes so the layout never shifts under the cursor. */}
      <div className="shrink-0 px-4 pt-2">
        <LanguageBar
          mode={mode}
          onSwap={() => {
            const remote = settings.remoteLang === 'auto' ? settings.myLang : settings.remoteLang
            void update({ myLang: remote, remoteLang: settings.myLang })
          }}
        />
      </div>

      <div className="page-enter flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
          {!status?.sessionId && !needsPermission ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <button
                type="button"
                onClick={() => void startEngine()}
                disabled={starting}
                className="flex h-14 w-44 items-center justify-center rounded-full bg-[#0A84FF] font-rounded text-[15px] font-semibold text-white shadow-[0_10px_30px_rgba(10,132,255,0.35)] transition hover:bg-[#0A84FF]/85 active:scale-[0.98] disabled:opacity-50"
              >
                {starting ? 'Starting…' : 'Start'}
              </button>
              <p className="text-[10px] text-white/35">Starts Python + Ollama</p>
              {status?.message && (
                <p className="max-w-[320px] text-[10px] text-amber-300/75">{status.message}</p>
              )}
            </div>
          ) : needsPermission ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <MicIcon className="h-5 w-5 text-amber-300/70" />
              <p className="text-[12px] text-white/80">Microphone access is blocked</p>
              <p className="max-w-[320px] text-[10px] leading-relaxed text-white/40">
                Allow microphone access for fispeak in System Settings → Privacy &amp; Security →
                Microphone, then press retry.
              </p>
              <button
                type="button"
                onClick={() => getApi().translate.start()}
                className="rounded-full bg-[#0A84FF] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[#0A84FF]/85"
              >
                Retry
              </button>
            </div>
          ) : mode === 'speak' ? (
            <SpeakCard
              phase={speakPhase}
              liveText={
                [...youLines.map((l) => l.text), partials.you?.text ?? '']
                  .filter(Boolean)
                  .join(' ') || null
              }
              draft={speakDraft}
              onDraftChange={setSpeakDraft}
              translation={speakTranslation?.text ?? null}
              targetLang={settings.remoteLang}
              canTranslate={settings.remoteLang !== 'auto' && settings.remoteLang !== settings.myLang}
              autoPlay={settings.speakAutoPlay}
              autoPlayCancelled={autoPlayCancelled}
              onCancelAutoPlay={() => setAutoPlayCancelled(true)}
              onFinish={() => {
                // Merge all committed you lines + current partial into one text.
                const merged = [
                  ...youLines.map((l) => l.text),
                  partials.you?.text ?? ''
                ].filter(Boolean).join(' ')
                setSpeakDraft(merged)
                setSpeakPhase('ready')
                setAutoPlayCancelled(false)
                // Also ask sidecar to flush partial as final (background).
                void getApi().translate.finishSpeak()
              }}
              onPlay={playDraft}
              onCopy={(text) => {
                void navigator.clipboard?.writeText(text)
              }}
              onRetry={() => {
                setSpeakPhase('live')
                setSpeakDraft('')
                setSpeakTakeStart(0)
                resetLines()
                getApi().translate.start()
              }}
              onSpeakAgain={() => {
                setSpeakTakeStart(lines.filter((l) => l.tag === 'you').length)
                setSpeakDraft('')
                setSpeakPhase('live')
                useTranslateStore.getState().clearSpeakFinal()
              }}
            />
          ) : (
            <TranscriptList />
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-3 px-4 pb-3 text-[10px] text-white/30">
        <span className="flex items-center gap-1">
          <MicIcon className="h-3 w-3" /> {mode === 'speak' ? 'you (mic)' : 'system'}
        </span>
        <span className="flex items-center gap-1">
          <SpeakerIcon className="h-3 w-3" />
          {mode === 'speak'
            ? settings.remoteLang === 'auto'
              ? 'pick partner language'
              : settings.remoteLang
            : settings.myLang}
        </span>
        {status?.message && <span className="truncate text-amber-300/60">{status.message}</span>}
      </footer>

      <SessionPopup
        open={sessionsOpen}
        activeSessionId={status?.sessionId ?? null}
        onClose={() => setSessionsOpen(false)}
        onSelect={(sessionId) => {
          void (async () => {
            await getApi().session.resume(sessionId)
            const turns = await getApi().session.turns(sessionId)
            const hydrated = toTranscriptLines(turns)
            hydrate(hydrated)
            setSpeakPhase('live')
            setSpeakDraft('')
            setSpeakTakeStart(hydrated.filter((line) => line.tag === 'you').length)
          })()
        }}
      />
    </div>
  )
}
