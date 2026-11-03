import { app, BrowserWindow, screen } from 'electron'
import type { PanelTab, PomodoroSnapshot, Settings } from '@shared/api'
import { IPC } from '@shared/api'
import { IslandWindow } from './island/islandWindow'
import { PanelWindow } from './windows/panelWindow'
import { AppTray } from './tray'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { SettingsStore } from './db/settingsStore'
import { NotesStore } from './db/notesStore'
import { SessionStore } from './db/sessionStore'
import { closeDb } from './db/db'
import { PomodoroController } from './pomodoro'
import { registerIpc } from './ipc'
import { logger } from './logger'
import { SidecarManager } from './sidecar/sidecarManager'
import { OllamaManager } from './ollama/ollamaManager'
import { AudioCapture } from './audio/capture'
import { SckCapture } from './audio/sckCapture'
import { TranslateController } from './translate/translateController'
import { ModelManager } from './models/modelManager'
import { MacSayEngine } from './tts/sayEngine'
import { AudioFilePlayer } from './tts/filePlayer'

const isMac = process.platform === 'darwin'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let island: IslandWindow | null = null
let panel: PanelWindow | null = null
let tray: AppTray | null = null
let pomodoro: PomodoroController | null = null
let sidecar: SidecarManager | null = null
let ollama: OllamaManager | null = null
let capture: AudioCapture | null = null
let translate: TranslateController | null = null
let translateOn = false
// Forward references: the capture and the controller are wired to each other.
let audioCaptureRef: AudioCapture | null = null
let translateControllerRef: TranslateController | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function keepAliveMs(value: Settings['sidecarKeepAlive'] | null | undefined): number {
  if (value === '2m') return 120_000
  if (value === '10m') return 600_000
  if (value === 'always') return -1
  // 'off' and legacy/missing values stop immediately (owner diagram: Stop = processes die).
  return 0
}

function refreshTray(): void {
  tray?.refresh(pomodoro?.get() ?? null)
}

function startTranslate(): void {
  translateOn = true
  island?.setState('TRANSLATE_ON')
  void translate?.start()
  refreshTray()
}

function stopTranslate(): void {
  translateOn = false
  translate?.stop()
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
  const sessionStore = new SessionStore()
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

  // Phase 2: the Python sidecar owns the AI audio engines. Phase 3.4 (RAM): the process is
  // started only when the owner presses Start, never at app launch.
  const sidecarManager = new SidecarManager((status, detail) => {
    logger.info('sidecar', `status: ${status}`, detail)
  })
  sidecarManager.setKeepAlive(keepAliveMs(settingsStore.get().sidecarKeepAlive))
  logger.info('main', 'sidecar lifecycle', {
    keepAlive: settingsStore.get().sidecarKeepAlive,
    ms: keepAliveMs(settingsStore.get().sidecarKeepAlive)
  })
  sidecar = sidecarManager
  const ollamaManager = new OllamaManager()
  ollama = ollamaManager

  // Phase 3: capture -> resample -> WebSocket -> sidecar, and the events back to the island.
  const sckCapture = new SckCapture({
    onAudio: (samples, sampleRate) => audioCaptureRef?.pushSystemAudio(samples, sampleRate),
    onError: (message) => logger.warn('audio', 'system audio error', { message })
  })
  const audioCapture = new AudioCapture(
    {
      onFrame: (tag, frame) => translateControllerRef?.sendAudio(tag, frame),
      onLevel: () => undefined,
      onStatus: (status) => translateControllerRef?.updateDevices(status)
    },
    sckCapture
  )
  capture = audioCapture
  audioCaptureRef = audioCapture

  const translateController = new TranslateController(
    { settings: settingsStore, sessions: sessionStore, sidecar: sidecarManager, ollama: ollamaManager, capture: audioCapture },
    {
      onEvent: (event) => broadcast(IPC.sidecarEvent, event),
      onStatus: (status) => broadcast(IPC.captureStatus, status),
      onMode: (mode) => broadcast(IPC.translateMode, mode)
    }
  )
  translate = translateController
  translateControllerRef = translateController

  const ttsEngine = new MacSayEngine()
  const audioPlayer = new AudioFilePlayer()

  const modelManager = new ModelManager((status) => {
    broadcast(IPC.modelsProgress, status)
  })

  registerIpc({
    island: islandWindow,
    panel: panelWindow,
    notes: notesStore,
    settings: settingsStore,
    pomodoro: pomodoroController,
    sessions: sessionStore,
    translate: translateController,
    models: modelManager,
    sck: sckCapture,
    tts: ttsEngine,
    player: audioPlayer,
    onSettingsChanged: (next) => {
      islandWindow.applySettings(next)
      translateController.updateSettings(next)
      sidecarManager.setKeepAlive(keepAliveMs(next.sidecarKeepAlive))
      refreshTray()
    },
    onToggleTranslate: () => toggleTranslate()
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
  capture?.destroy()
  sidecar?.kill()
  ollama?.kill()
  closeDb()
  logger.info('main', 'fispeak quitting')
}

app.on('before-quit', (event) => {
  const sidecarBusy = sidecar && !sidecarStopped && sidecar.getStatus() === 'running'
  if (sidecarBusy || ollama?.hasProcess()) {
    event.preventDefault()
    logger.info('main', 'sidecar/ollama shutdown started')
    void Promise.resolve(sidecar ? sidecar.stop() : undefined)
      .catch((error) => logger.warn('main', 'sidecar shutdown failed', { error: String(error) }))
      .finally(() => {
        sidecarStopped = true
        ollama?.kill()
        cleanup()
        app.exit(0)
      })
  }
})

app.on('will-quit', () => {
  cleanup()
})
