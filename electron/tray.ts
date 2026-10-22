import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import type { PomodoroSnapshot } from '@shared/api'
import { logger } from './logger'

export interface TrayHooks {
  openPanel(): void
  togglePill(): void
  toggleTranslate(): void
  quit(): void
  isPillVisible(): boolean
  isTranslateOn(): boolean
}

function iconPath(name: string): string {
  return join(app.getAppPath(), 'resources', 'icons', name)
}

export class AppTray {
  private tray: Tray | null = null

  constructor(private readonly hooks: TrayHooks) {}

  create(): void {
    const image = nativeImage.createFromPath(iconPath('trayTemplate.png'))
    if (image.isEmpty()) logger.warn('tray', 'tray icon missing', { path: iconPath('trayTemplate.png') })
    const tray = new Tray(image)
    tray.setToolTip('fispeak')
    tray.on('click', () => this.hooks.togglePill())
    this.tray = tray
    this.refresh(null)
  }

  refresh(pomodoro: PomodoroSnapshot | null): void {
    const tray = this.tray
    if (!tray) return
    const running = pomodoro?.running === true
    const image = nativeImage.createFromPath(iconPath(running ? 'trayActiveTemplate.png' : 'trayTemplate.png'))
    if (!image.isEmpty()) tray.setImage(image)

    const translateLabel = this.hooks.isTranslateOn() ? 'Stop translate' : 'Start translate'
    const modal = Menu.buildFromTemplate([
      { label: 'Open panel', click: () => this.hooks.openPanel() },
      { type: 'separator' },
      {
        label: translateLabel,
        click: () => this.hooks.toggleTranslate()
      },
      { label: this.hooks.isPillVisible() ? 'Hide island' : 'Show island', click: () => this.hooks.togglePill() },
      { type: 'separator' },
      { label: 'Quit fispeak', click: () => this.hooks.quit() }
    ])
    tray.setContextMenu(modal)
    tray.setToolTip(pomodoro?.running ? 'fispeak - focus running' : 'fispeak')
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
