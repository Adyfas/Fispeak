import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/api'
import { logger } from '../logger'

export interface MicStatusEvent {
  state: 'ready' | 'running' | 'stopped' | 'denied' | 'error'
  message?: string
  sampleRate?: number
}

export interface HiddenAudioWindowHooks {
  onFrame(samples: Float32Array, sampleRate: number): void
  onStatus(status: MicStatusEvent): void
}

/**
 * Hidden window that owns the microphone stream (05-audio-capture §2.1).
 *
 * `getUserMedia` only works in a renderer, so the capture lives in its own invisible window
 * with a dedicated preload. The island window must never hold a media stream.
 */
export class HiddenAudioWindow {
  private window: BrowserWindow | null = null
  private frameHandler: ((event: Electron.IpcMainEvent, samples: Float32Array, sampleRate: number) => void) | null = null
  private statusHandler: ((event: Electron.IpcMainEvent, status: MicStatusEvent) => void) | null = null

  constructor(private readonly hooks: HiddenAudioWindowHooks) {}

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    const win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/mic.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })

    this.window = win
    win.on('closed', () => {
      this.window = null
    })

    this.frameHandler = (event, samples, sampleRate) => {
      if (event.sender !== win.webContents) return
      this.hooks.onFrame(samples, sampleRate)
    }
    this.statusHandler = (event, status) => {
      if (event.sender !== win.webContents) return
      this.hooks.onStatus(status)
    }
    ipcMain.on(IPC.micFrame, this.frameHandler)
    ipcMain.on(IPC.micStatus, this.statusHandler)

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/mic.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/mic.html'))
    }

    logger.info('audio', 'hidden audio window created')
    return win
  }

  /** The IPC layer uses this to accept frames only from the capture window. */
  getWebContents(): Electron.WebContents | null {
    const win = this.window
    if (!win || win.isDestroyed()) return null
    return win.webContents
  }

  startCapture(): void {
    const win = this.create()
    win.webContents.send(IPC.micCommand, 'start')
  }

  stopCapture(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC.micCommand, 'stop')
  }

  destroy(): void {
    if (this.frameHandler) ipcMain.removeListener(IPC.micFrame, this.frameHandler)
    if (this.statusHandler) ipcMain.removeListener(IPC.micStatus, this.statusHandler)
    this.frameHandler = null
    this.statusHandler = null
    const win = this.window
    this.window = null
    if (win && !win.isDestroyed()) win.destroy()
  }
}
