import { useEffect, useState } from 'react'
import type { IslandMetrics } from '@shared/api'
import { ISLAND_CARD_SIZES, ISLAND_GUTTER } from '@shared/island'
import { getApi } from '@/lib/ipc'

const FALLBACK: IslandMetrics = {
  state: 'IDLE',
  placement: 'floating',
  cardWidth: ISLAND_CARD_SIZES.IDLE.width,
  cardHeight: ISLAND_CARD_SIZES.IDLE.height,
  gutterX: ISLAND_GUTTER,
  gutterTop: 0,
  animating: false
}

/** Window geometry and placement pushed by the main process after every transition. */
export function useIslandMetrics(): IslandMetrics {
  const [metrics, setMetrics] = useState<IslandMetrics>(FALLBACK)

  useEffect(() => {
    const api = getApi()
    const unsubscribe = api.island.onMetrics((next) => setMetrics(next))
    // Ask main for the current metrics: the window may already be in a non-IDLE state.
    api.island.requestMetrics()
    return unsubscribe
  }, [])

  return metrics
}
