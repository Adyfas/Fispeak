import type { FispeakApi } from '@shared/api'

declare global {
  interface Window {
    fispeak: FispeakApi
  }
}

export {}
