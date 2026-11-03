import { useEffect } from 'react'
import { usePromptStore } from '@/stores/promptStore'
import { useTranslateStore } from '@/stores/translateStore'

/**
 * Subscribes the renderer to the sidecar events that main broadcasts.
 * The renderer never opens a socket of its own (09-sidecar-spec §3.3).
 */
export function useTranslateSession(): void {
  const applyEvent = useTranslateStore((state) => state.applyEvent)
  const setStatus = useTranslateStore((state) => state.setStatus)
  const setMode = useTranslateStore((state) => state.setMode)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.fispeak) return
    const offEvent = window.fispeak.translate.onEvent((event) => {
      // Prompt dictation shares the socket but not the transcript: its partials belong to the
      // Prompt page only, otherwise they would show up in the LISTEN history.
      const phase = usePromptStore.getState().phase
      if (phase === 'starting' || phase === 'live' || phase === 'finishing') return
      applyEvent(event)
    })
    const offStatus = window.fispeak.translate.onStatus(setStatus)
    const offMode = window.fispeak.translate.onMode(setMode)
    return () => {
      offEvent()
      offStatus()
      offMode()
    }
  }, [applyEvent, setStatus, setMode])
}
