import { app, BrowserWindow, screen } from 'electron'
import type { PanelTab, PomodoroSnapshot } from '@shared/api'
import { IPC } from '@shared/api'
import { IslandWindow } from './island/islandWindow'
import { PanelWindow } from './windows/panelWindow'
import { AppTray } from './tray'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { SettingsStore } from './db/settingsStore'
import { NotesStore } from './db/notesStore'
import { closeDb } from './db/db'
import { PomodoroController } from './pomodoro'
import { registerIpc } from './ipc'
import { logger } from './logger'
import { SidecarManager } from './sidecar/sidecarManager'

const isMac = process.platform === 'darwin'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let island: IslandWindow | null = null
let panel: PanelWindow | null = null
let tray: AppTray | null = null
let pomodoro: PomodoroController | null = null
let sidecar: SidecarManager | null = null
let translateOn = false

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function refreshTray(): void {
  tray?.refresh(pomodoro?.get() ?? null)
}

function startTranslate(): void {
  translateOn = true
  island?.setState('TRANSLATE_ON')
  refreshTray()
}

function stopTranslate(): void {
  translateOn = false
  island?.setState('EXPANDED_TOOL')
  refreshTray()
}

function toggleTranslate(): void {
  if (island?.getState() === 'TRANSLATE_ON') stopTranslate()
  else startTranslate()
}

function openPanel(tab: PanelTab = 'settings'): void {
  panel?.open(tab)
}

app.on('second-instance', () => openPanel())

app.whenReady().then(() => {
  if (isMac) {
    // Accessory app: no Dock icon, no Cmd+Tab entry (04b §4.1).
    app.setActivationPolicy('accessory')
    app.dock?.hide()
  }
  app.setAppUserModelId('app.fispeak')

  const settingsStore = new SettingsStore()
  const notesStore = new NotesStore()
  const pomodoroController = new PomodoroController()
  const panelWindow = new PanelWindow()

  const islandWindow = new IslandWindow(
    {
      onHoverChange: (inside) => {
        islandWindow.getBrowserWindow()?.webContents.send(IPC.islandHover, inside)
      },
      onVisibilityChange: (visible) => {
        islandWindow.getBrowserWindow()?.webContents.send(IPC.islandVisibility, visible)
        refreshTray()
      },
      onPositionChange: (position) => {
        settingsStore.set({ floatingPosition: position })
      }
    },
    settingsStore.get()
  )

  islandWindow.create()

  const appTray = new AppTray({
    openPanel: () => openPanel('settings'),
    togglePill: () => islandWindow.toggleVisible(),
    toggleTranslate: () => toggleTranslate(),
    quit: () => app.quit(),
    isPillVisible: () => islandWindow.isVisible(),
    isTranslateOn: () => translateOn
  })
  appTray.create()
  appTray.refresh(pomodoroController.get())

  registerIpc({
    island: islandWindow,
    panel: panelWindow,
    notes: notesStore,
    settings: settingsStore,
    pomodoro: pomodoroController,
    onSettingsChanged: (next) => {
      islandWindow.applySettings(next)
      refreshTray()
    },
    onToggleTranslate: () => toggleTranslate()
  })

  registerShortcuts({
    toggleTranslate: () => toggleTranslate(),
    togglePill: () => islandWindow.toggleVisible()
  })

  pomodoroController.onChange((snapshot: PomodoroSnapshot) => {
    broadcast(IPC.pomodoroTick, snapshot)
    refreshTray()
  })

  screen.on('display-metrics-changed', () => islandWindow.reposition())
  screen.on('display-added', () => islandWindow.reposition())
  screen.on('display-removed', () => islandWindow.reposition())

  island = islandWindow
  panel = panelWindow
  tray = appTray
  pomodoro = pomodoroController

  // Phase 2: the Python sidecar owns the AI audio engines. It is spawned (or reused) in the
  // background; the UI only needs it from Phase 3 on, so a failure must never block startup.
  const sidecarManager = new SidecarManager((status, detail) => {
    logger.info('sidecar', `status: ${status}`, detail)
  })
  sidecar = sidecarManager
  void sidecarManager.start().then((port) => {
    if (port) logger.info('main', 'sidecar available', { port })
  })

  // First run: open the panel so the welcome stub is visible (Phase 1 only; models come later).
  if (!settingsStore.get().firstRunDone) openPanel('settings')

  logger.info('main', 'fispeak ready', { version: app.getVersion(), platform: process.platform })
})

// Tray app: closing every window must not quit.
app.on('window-all-closed', () => {})

// Graceful sidecar shutdown: `/shutdown` first, hard kill as the safety net
// (09-sidecar-spec §1.2, 14-risks-notes §2 - no zombie sidecars).
let sidecarStopped = false
let cleanedUp = false

function cleanup(): void {
  if (cleanedUp) return
  cleanedUp = true
  unregisterShortcuts()
  pomodoro?.dispose()
  tray?.destroy()
  island?.destroy()
  panel?.destroy()
  sidecar?.kill()
  closeDb()
  logger.info('main', 'fispeak quitting')
}

app.on('before-quit', (event) => {
  if (sidecar && !sidecarStopped && sidecar.getStatus() === 'running') {
    event.preventDefault()
    logger.info('main', 'sidecar shutdown started')
    void sidecar
      .stop()
      .catch((error) => logger.warn('main', 'sidecar shutdown failed', { error: String(error) }))
      .finally(() => {
        sidecarStopped = true
        cleanup()
        app.exit(0)
      })
  }
})

app.on('will-quit', () => {
  cleanup()
})
