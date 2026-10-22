import { useCallback, useEffect, useRef } from 'react'
import { DragHandle } from '@/components/DragHandle'
import { StatusDot, type StatusKind } from '@/components/StatusDot'
import { GlobeIcon } from '@/components/icons'
import { Clock } from '@/features/clock/Clock'
import { ClockBlock } from '@/features/clock/ClockBlock'
import { PanelBlock, TranslateBlock } from '@/features/actions/ActionBlocks'
import { useIslandMetrics } from '@/features/island/useIslandMetrics'
import { NotesPanel } from '@/features/notes/NotesPanel'
import { PomodoroPanel } from '@/features/pomodoro/PomodoroPanel'
import { TranslateStub } from '@/features/translate/TranslateStub'
import { getApi } from '@/lib/ipc'
import { usePillStore } from '@/stores/pillStore'
import { usePomodoroStore } from '@/stores/pomodoroStore'
import { NOTCH_HEADER_CLEARANCE } from '@shared/island'

const COLLAPSE_DELAY_MS = 220
const TRANSITION = 'width 340ms var(--island-ease), height 340ms var(--island-ease)'

function statusFor(state: string): StatusKind {
  if (state === 'ERROR_PILL') return 'error'
  if (state === 'TRANSLATE_ON') return 'active'
  return 'idle'
}

function isExpandedState(state: string): boolean {
  return state === 'EXPANDED_TOOL' || state === 'TRANSLATE_ON' || state === 'ERROR_PILL'
}

export function PillApp(): JSX.Element {
  const metrics = useIslandMetrics()
  const state = usePillStore((store) => store.state)
  const errorMessage = usePillStore((store) => store.errorMessage)
  const dispatch = usePillStore((store) => store.dispatch)
  const loadPomodoro = usePomodoroStore((store) => store.load)
  const applyPomodoro = usePomodoroStore((store) => store.apply)

  const cardRef = useRef<HTMLDivElement | null>(null)
  const collapseTimer = useRef<number | null>(null)

  const isNotch = metrics.placement === 'notch'
  const notchExpanded = isNotch && isExpandedState(state)

  // Main is authoritative when hotkeys or the tray change the state.
  useEffect(() => {
    if (usePillStore.getState().state !== metrics.state) {
      usePillStore.setState({ state: metrics.state })
    }
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
      if (inside) {
        clearCollapse()
        dispatch('hover-enter')
        return
      }
      clearCollapse()
      collapseTimer.current = window.setTimeout(() => {
        collapseTimer.current = null
        if (usePillStore.getState().state === 'EXPANDED_TOOL') dispatch('hover-leave')
      }, COLLAPSE_DELAY_MS)
    })

    const unsubscribeTick = api.pomodoro.onTick((snapshot) => applyPomodoro(snapshot))
    void loadPomodoro()

    return () => {
      unsubscribeHover()
      unsubscribeTick()
      clearCollapse()
    }
  }, [applyPomodoro, clearCollapse, dispatch, loadPomodoro])

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

  return (
    <div className="fixed inset-0 select-none overflow-hidden">
      <div
        className="absolute inset-0 flex items-start"
        style={{
          // Notch: the window is always centered on the screen, so centering the card inside
          // it keeps the card visually still while the window resizes.
          justifyContent: isNotch ? 'center' : 'flex-start',
          paddingLeft: isNotch ? 0 : metrics.gutterX
        }}
      >
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
            borderRadius: isNotch ? '0px 0px 20px 20px' : '20px',
            transition: TRANSITION
          }}
        >
        <DragHandle enabled={!isNotch} />

        <div key={state} className="content-enter flex h-full min-h-0 flex-col">
          {state === 'IDLE' && isNotch && (
            <div className="flex h-full items-center justify-between px-2.5">
              <StatusDot status={statusFor(state)} />
              <Clock
                compact
                className="text-[13px] font-medium tabular-nums tracking-tight text-white"
              />
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
              className="flex h-full min-h-0 gap-2.5 px-3.5 pb-3"
              style={{ paddingTop: notchExpanded ? NOTCH_HEADER_CLEARANCE : 12 }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <ClockBlock status={statusFor(state)} />
                <NotesPanel />
              </div>
              <div className="flex w-[172px] shrink-0 flex-col gap-2.5">
                <PomodoroPanel />
                <TranslateBlock />
                <PanelBlock />
              </div>
            </div>
          )}

          {state === 'TRANSLATE_ON' && (
            <div className="h-full" style={{ paddingTop: notchExpanded ? NOTCH_HEADER_CLEARANCE : 0 }}>
              <TranslateStub variant="full" />
            </div>
          )}

          {state === 'TRANSLATE_MINI' && <TranslateStub variant="mini" />}

          {state === 'ERROR_PILL' && (
            <div className="flex h-full items-center gap-2 px-3">
              <StatusDot status="error" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-white/85">
                  {errorMessage ?? 'Something went wrong'}
                </p>
                <p className="text-[10px] text-white/35">Audio capture arrives in Phase 3.</p>
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
  )
}
