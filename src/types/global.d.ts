import type { FispeakApi } from '@shared/api'

declare global {
  interface Window {
    fispeak: FispeakApi
    fispeakMic?: {
      onCommand(callback: (command: 'start' | 'stop') => void): void
      sendFrame(samples: Float32Array, sampleRate: number): void
      sendStatus(status: {
        state: 'ready' | 'running' | 'stopped' | 'denied' | 'error'
        message?: string
        sampleRate?: number
      }): void
    }
  }
}

export {}
