import { contextBridge, ipcRenderer } from 'electron'

export type MicCommand = 'start' | 'stop'

export interface MicStatus {
  state: 'ready' | 'running' | 'stopped' | 'denied' | 'error'
  message?: string
  sampleRate?: number
}

/**
 * Preload of the hidden capture window.
 *
 * The channel names are inlined on purpose: a shared import with the island preload would
 * make Vite emit a shared chunk, and sandboxed preloads cannot `require` relative files.
 * Keep these in sync with `IPC.micCommand` / `IPC.micFrame` / `IPC.micStatus`.
 */
const MIC_COMMAND = 'mic:command'
const MIC_FRAME = 'mic:frame'
const MIC_STATUS = 'mic:status'

const api = {
  onCommand: (callback: (command: MicCommand) => void): void => {
    ipcRenderer.on(MIC_COMMAND, (_event, command: MicCommand) => callback(command))
  },
  sendFrame: (samples: Float32Array, sampleRate: number): void => {
    ipcRenderer.send(MIC_FRAME, samples, sampleRate)
  },
  sendStatus: (status: MicStatus): void => {
    ipcRenderer.send(MIC_STATUS, status)
  }
}

contextBridge.exposeInMainWorld('fispeakMic', api)
