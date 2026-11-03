import { create } from 'zustand'
import type { IslandState } from '@shared/api'

export type PillEvent =
  | 'hover-enter'
  | 'hover-leave'
  | 'start-translate'
  | 'stop-translate'
  | 'toggle-translate'
  | 'error'
  | 'clear-error'
  | 'hide'
  | 'show'

/**
 * Pure island state machine (04-ui-spec §3). Feature pages, list/speak and prompt dictation
 * each have an explicit state; every visual change must be expressible through these.
 */
export function nextPillState(current: IslandState, event: PillEvent): IslandState {
  switch (event) {
    case 'hover-enter':
      return current === 'IDLE' || current === 'TRANSLATE_MINI' ? 'EXPANDED_TOOL' : current
    case 'hover-leave':
      return current === 'EXPANDED_TOOL' ? 'IDLE' : current
    case 'start-translate':
      return current === 'HIDDEN' ? current : 'TRANSLATE_ON'
    case 'stop-translate':
      return current === 'TRANSLATE_ON' ? 'EXPANDED_TOOL' : current
    case 'toggle-translate':
      if (current === 'HIDDEN') return current
      return current === 'TRANSLATE_ON' ? 'EXPANDED_TOOL' : 'TRANSLATE_ON'
    case 'error':
      return 'ERROR_PILL'
    case 'clear-error':
      return current === 'ERROR_PILL' ? 'EXPANDED_TOOL' : current
    case 'hide':
      return 'HIDDEN'
    case 'show':
      return current === 'HIDDEN' ? 'IDLE' : current
    default:
      return current
  }
}

interface PillStore {
  state: IslandState
  errorMessage: string | null
  dispatch: (event: PillEvent) => void
  raiseError: (message: string) => void
}

function publish(state: IslandState): void {
  if (typeof window !== 'undefined' && window.fispeak) window.fispeak.island.setState(state)
}

export const usePillStore = create<PillStore>((set, get) => ({
  state: 'IDLE',
  errorMessage: null,
  dispatch: (event) => {
    const { state } = get()
    const next = nextPillState(state, event)
    if (next === state) return
    set({ state: next, errorMessage: event === 'clear-error' ? null : get().errorMessage })
    publish(next)
  },
  raiseError: (message) => {
    set({ state: 'ERROR_PILL', errorMessage: message })
    publish('ERROR_PILL')
  }
}))
