import type { FispeakApi } from '@shared/api'

/**
 * Preload bridge. Throws early (instead of silently doing nothing) if the renderer is ever
 * loaded without the preload script, which would otherwise look like a broken UI.
 */
export function getApi(): FispeakApi {
  if (!window.fispeak) {
    throw new Error('fispeak preload API is unavailable')
  }
  return window.fispeak
}
