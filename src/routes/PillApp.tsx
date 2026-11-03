import { useCallback, useEffect, useRef, useState } from 'react'
import { DragHandle } from '@/components/DragHandle'
import { StatusDot, type StatusKind } from '@/components/StatusDot'
import { GlobeIcon } from '@/components/icons'
import { Clock } from '@/features/clock/Clock'
import { ClockPage } from '@/features/island/ClockPage'
import { FeatureRail } from '@/features/island/FeatureRail'
import { PageShell } from '@/features/island/PageShell'
import { SettingsPage } from '@/features/island/SettingsPage'
import { VoicePage } from '@/features/island/VoicePage'
import { stepPage, type IslandPage } from '@/features/island/pages'
import { useIslandMetrics } from '@/features/island/useIslandMetrics'
import { NotesPanel } from '@/features/notes/NotesPanel'
import { PomodoroPanel } from '@/features/pomodoro/PomodoroPanel'
import { HistoryPanel } from '@/features/history/HistoryPanel'
import { PromptPage } from '@/features/prompt/PromptPage'
import { TranslateView } from '@/features/translate/TranslateView'
import { useTranslateSession } from '@/features/translate/useTranslateSession'
import { getApi } from '@/lib/ipc'
import { usePillStore } from '@/stores/pillStore'
import { usePromptStore } from '@/stores/promptStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTranslateStore } from '@/stores/translateStore'
import { NOTCH_HEADER_CLEARANCE, isNavState } from '@shared/island'
import { formatCountdown, remainingFor } from '@/lib/time'
import { usePomodoroStore } from '@/stores/pomodoroStore'
import logoFispeak from '@/assets/logo-fispeak.png'

const COLLAPSE_DELAY_MS = 220
const TRANSITION = 'width 340ms var(--island-ease), height 340ms var(--island-ease)'

function statusFor(state: string): StatusKind {
  if (state === 'ERROR_PILL') return 'error'
  if (state === 'TRANSLATE_ON') return 'active'
  return 'idle'
}

function isExpandedState(state: string): boolean {
  return (
    state === 'EXPANDED_TOOL' ||
    state === 'TRANSLATE_ON' ||
    state === 'PROMPT_ON' ||
    state === 'ERROR_PILL'
  )
}

export function PillApp(): JSX.Element {
  const metrics = useIslandMetrics()
  const state = usePillStore((store) => store.state)
  const errorMessage = usePillStore((store) => store.errorMessage)
  const dispatch = usePillStore((store) => store.dispatch)
  const loadPomodoro = usePomodoroStore((store) => store.load)
  const applyPomodoro = usePomodoroStore((store) => store.apply)
  const loadSettings = useSettingsStore((store) => store.load)
  const mode = useTranslateStore((store) => store.mode)
  const setMode = useTranslateStore((store) => store.setMode)
  const sessionActive = useTranslateStore((store) => store.status?.sessionId ?? null)
  useTranslateSession()

  const [now, setNow] = useState(() => Date.now())
  const snapshot = usePomodoroStore((state) => state.snapshot)
  const remaining = remainingFor(snapshot, now)

  const [page, setPage] = useState<IslandPage>('clock')
  const [hovered, setHovered] = useState(false)

  const cardRef = useRef<HTMLDivElement | null>(null)
  const collapseTimer = useRef<number | null>(null)

  const isNotch = metrics.placement === 'notch'
  const notchExpanded = isNotch && isExpandedState(state)
  const navActive = isNavState(state)
  const navVisible = hovered && navActive
  const isTranslate = state === 'TRANSLATE_ON'
  const effectivePage: IslandPage =
    state === 'PROMPT_ON'
      ? 'prompt'
      : isTranslate
        ? mode === 'speak'
          ? 'speak'
          : 'listen'
        : page === 'listen' || page === 'speak'
          ? 'clock'
          : page

  const goToPage = useCallback(
    (next: IslandPage): void => {
      const leavesSession = next !== 'listen' && next !== 'speak'
      if (leavesSession && sessionActive) {
        // The microphone/system audio is exclusive: leaving the session pages stops capture
        // instead of leaving an invisible recording (and the sidecar) running.
        dispatch('stop-translate')
        useTranslateStore.getState().reset()
        getApi().translate.stop()
      }
      setPage(next)
      if (next === 'prompt') {
        // Dictation has its own compact island state (waveform + text + Stop).
        getApi().island.setState('PROMPT_ON')
        return
      }
      if (next === 'listen' || next === 'speak') {
        if (mode !== next) {
          setMode(next)
          void getApi().translate.setMode(next)
        }
        getApi().island.setState('TRANSLATE_ON')
      } else {
        getApi().island.setState('EXPANDED_TOOL')
      }
    },
    [dispatch, mode, sessionActive, setMode]
  )

  // One local tick drives the smooth countdown; main only sends phase changes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])

  // Main is authoritative when hotkeys or the tray change the state.
  useEffect(() => {
    if (usePillStore.getState().state !== metrics.state) {
      usePillStore.setState({ state: metrics.state })
    }
  }, [metrics.state])

  // Growing/shrinking moves the card under the cursor. Ignore a hover-leave that arrives
  // during that window: it is the animation, not the owner leaving the island.
  const stateGuardUntil = useRef(0)
  const metricsRef = useRef(metrics)
  useEffect(() => {
    metricsRef.current = metrics
  }, [metrics])
  useEffect(() => {
    stateGuardUntil.current = Date.now() + 450
  }, [metrics.state])

  const clearCollapse = useCallback(() => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }, [])

  useEffect(() => {
    const api = getApi()
    const unsubscribeHover = api.island.onHover((inside) => {
      setHovered(inside)
      if (inside) {
        clearCollapse()
        dispatch('hover-enter')
        return
      }
      clearCollapse()
      const tryCollapse = (): void => {
        collapseTimer.current = null
        if (metricsRef.current.animating) {
          // Still resizing: the pointer may sit outside the moving card for a frame.
          collapseTimer.current = window.setTimeout(tryCollapse, 110)
          return
        }
        const remaining = stateGuardUntil.current - Date.now()
        if (remaining > 0) {
          collapseTimer.current = window.setTimeout(tryCollapse, remaining + 10)
          return
        }
        if (usePillStore.getState().state === 'EXPANDED_TOOL') dispatch('hover-leave')
      }
      collapseTimer.current = window.setTimeout(tryCollapse, COLLAPSE_DELAY_MS)
    })

    const unsubscribeTick = api.pomodoro.onTick((snapshot) => applyPomodoro(snapshot))
    void loadPomodoro()
    // The island shows the language direction, so it needs the saved settings too.
    void loadSettings()

    return () => {
      unsubscribeHover()
      unsubscribeTick()
      clearCollapse()
    }
  }, [applyPomodoro, clearCollapse, dispatch, loadPomodoro, loadSettings])

  // The feature rail is hover-only; the main process needs this flag to extend the hit-test.
  useEffect(() => {
    getApi().island.setNavVisible(navVisible)
  }, [navVisible])

  // Leaving the Prompt page must release the microphone and the sidecar: dictation never runs
  // in the background. The compact PROMPT_ON island stays open on hover-out by design.
  useEffect(() => {
    if (effectivePage !== 'prompt') usePromptStore.getState().cancel()
  }, [effectivePage])

  // Esc collapses the expanded panel, except while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (usePillStore.getState().state === 'EXPANDED_TOOL') dispatch('hover-leave')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch])

  // Arrow keys move between feature pages (keyboard accessibility). The rail is vertical,
  // so up/down are the primary keys; left/right stay as aliases for muscle memory.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const next =
        event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
            ? -1
            : 0
      if (!next) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (!navActive) return
      event.preventDefault()
      goToPage(stepPage(effectivePage, next))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const reportCardRect = useCallback(() => {
    const element = cardRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    getApi().island.reportCardRect({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(reportCardRect)
    return () => cancelAnimationFrame(frame)
  }, [reportCardRect, metrics.state, metrics.cardWidth, metrics.cardHeight])

  const closePrompt = useCallback((): void => {
    usePromptStore.getState().cancel()
    setPage('clock')
    getApi().island.setState('EXPANDED_TOOL')
  }, [])

  const renderPage = (): JSX.Element => {
    switch (effectivePage) {
      case 'clock':
        return <ClockPage />
      case 'voice':
        return <VoicePage />
      case 'notes':
        return (
          <div className="flex h-full min-h-0 flex-col p-4">
            <NotesPanel />
          </div>
        )
      case 'focus':
        return (
          <div className="flex h-full min-h-0 flex-col p-4">
            <PomodoroPanel />
          </div>
        )
      case 'sessions':
        return (
          <PageShell title="Sessions" subtitle="Pick a session">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <HistoryPanel />
            </div>
          </PageShell>
        )
      case 'settings':
        return <SettingsPage />
      default:
        return <ClockPage />
    }
  }

  return (
    <div className="fixed inset-0 select-none overflow-hidden">
      <div
        className="absolute inset-0 flex items-start"
        style={{
          // The card is always centered in the window: main sizes the window symmetrically
          // around it, so growing/shrinking never pulls the pill toward one side.
          justifyContent: 'center'
        }}
      >
        <div
          className={`relative shrink-0 ${metrics.animating ? 'pointer-events-none' : ''}`}
          aria-busy={metrics.animating}
        >
          <FeatureRail
            page={effectivePage}
            visible={navVisible}
            cardWidth={metrics.cardWidth}
            cardHeight={metrics.cardHeight}
            onSelect={goToPage}
          />

          <div
            ref={cardRef}
            data-testid="island-card"
            data-state={state}
            onTransitionEnd={reportCardRect}
            className="island-card relative flex flex-col overflow-hidden border border-white/[0.07] bg-black text-white shadow-island"
            style={{
              width: metrics.cardWidth,
              height: metrics.cardHeight,
              // Constant radius: the idle pill and the expanded card share the same corners, so
              // nothing "snaps" mid-animation. Notch placement keeps the top edge square.
              borderRadius: isNotch ? '0px 0px var(--island-radius) var(--island-radius)' : 'var(--island-radius)',
              transition: TRANSITION
            }}
          >
            <DragHandle enabled={!isNotch} />

            <div key={`${state}-${effectivePage}`} className="content-enter flex h-full min-h-0 flex-col">
              {state === 'IDLE' && isNotch && (
                <div className="flex h-full items-center justify-between px-2.5">
                  {snapshot.running ? (
                    <span className="font-mono text-[12px] tabular-nums tracking-tight text-blue-200/95">
                      {formatCountdown(remaining)}
                    </span>
                  ) : (
                    <Clock
                      compact
                      className="text-[13px] font-medium tabular-nums tracking-tight text-white"
                    />
                  )}
                  <img src={logoFispeak} alt="" className="h-3.5 w-auto" />
                </div>
              )}

              {state === 'IDLE' && !isNotch && (
                <div className="flex h-full items-center justify-between gap-2 px-3.5">
                  <GlobeIcon className="h-3.5 w-3.5 text-white/70" />
                  <Clock className="text-[12px] font-medium tabular-nums tracking-tight text-white/95" />
                  <StatusDot status={statusFor(state)} />
                </div>
              )}

              {state === 'EXPANDED_TOOL' && (
                <div
                  className="h-full"
                  style={{ paddingTop: notchExpanded ? NOTCH_HEADER_CLEARANCE : 0 }}
                >
                  {renderPage()}
                </div>
              )}

              {state === 'TRANSLATE_ON' && (
                <div
                  className="h-full"
                  style={{ paddingTop: notchExpanded ? NOTCH_HEADER_CLEARANCE : 0 }}
                >
                  <TranslateView variant="full" />
                </div>
              )}

              {state === 'PROMPT_ON' && (
                <div
                  className="h-full"
                  style={{ paddingTop: notchExpanded ? NOTCH_HEADER_CLEARANCE : 0 }}
                >
                  <PromptPage onClose={closePrompt} />
                </div>
              )}

              {state === 'TRANSLATE_MINI' && <TranslateView variant="mini" />}

              {state === 'ERROR_PILL' && (
                <div className="flex h-full items-center gap-2 px-3">
                  <StatusDot status="error" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-white/85">
                      {errorMessage ?? 'Something went wrong'}
                    </p>
                    <p className="text-[10px] text-white/35">Check the panel for details.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch('clear-error')}
                    className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/75 transition hover:bg-white/20"
                  >
                    Retry
                  </button>
                </div>
              )}

              {state === 'HIDDEN' && <div className="h-full w-full" aria-hidden />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
