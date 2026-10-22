import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { PanelTab } from '@shared/api'
import { IPC } from '@shared/api'
import { logger } from '../logger'

const PANEL_WIDTH = 640
const PANEL_HEIGHT = 480

export class PanelWindow {
  private window: BrowserWindow | null = null

  open(tab: PanelTab = 'settings'): void {
    const existing = this.window
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      existing.webContents.send(IPC.panelTab, tab)
      return
    }

    const win = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      minWidth: 560,
      minHeight: 420,
      show: false,
      title: 'fispeak',
      backgroundColor: '#0b0b0d',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 14 } } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.window = win
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.window = null
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/panel.html?tab=${tab}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/panel.html'), { query: { tab } })
    }
    logger.info('panel', 'panel window created', { tab })
  }

  hasWindow(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}
