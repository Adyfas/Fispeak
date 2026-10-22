import { app, ipcMain } from 'electron'
import type { CardRect, IslandState, PanelTab, Settings } from '@shared/api'
import { IPC } from '@shared/api'
import type { IslandWindow } from '../island/islandWindow'
import type { PanelWindow } from '../windows/panelWindow'
import type { NotesStore } from '../db/notesStore'
import type { SettingsStore } from '../db/settingsStore'
import type { PomodoroController } from '../pomodoro'
import { logger } from '../logger'

export interface IpcContext {
  island: IslandWindow
  panel: PanelWindow
  notes: NotesStore
  settings: SettingsStore
  pomodoro: PomodoroController
  onSettingsChanged(settings: Settings): void
  onToggleTranslate(): void
}

export function registerIpc(context: IpcContext): void {
  const { island, panel, notes, settings, pomodoro } = context

  ipcMain.on(IPC.islandSetState, (_event, state: IslandState) => {
    island.setState(state)
  })

  ipcMain.on(IPC.islandRequestMetrics, () => {
    island.requestMetrics()
  })

  ipcMain.on(IPC.islandReportCardRect, (_event, rect: CardRect) => {
    island.reportCardRect(rect)
  })

  ipcMain.on(IPC.islandHide, () => island.setVisible(false))
  ipcMain.on(IPC.islandShow, () => island.setVisible(true))
  ipcMain.on(IPC.islandToggleTranslate, () => context.onToggleTranslate())
  ipcMain.on(IPC.islandDragStart, () => island.dragStart())
  ipcMain.on(IPC.islandDragEnd, () => island.dragEnd())
  ipcMain.on(IPC.islandOpenPanel, (_event, tab: PanelTab | undefined) => {
    panel.open(tab ?? 'settings')
  })

  ipcMain.handle(IPC.notesList, () => notes.list())
  ipcMain.handle(IPC.notesCreate, (_event, body: string) => notes.create(body))
  ipcMain.handle(IPC.notesUpdate, (_event, id: string, body: string) => notes.update(id, body))
  ipcMain.handle(IPC.notesRemove, (_event, id: string) => notes.remove(id))

  ipcMain.handle(IPC.pomodoroGet, () => pomodoro.get())
  ipcMain.handle(IPC.pomodoroStart, () => pomodoro.start())
  ipcMain.handle(IPC.pomodoroPause, () => pomodoro.pause())
  ipcMain.handle(IPC.pomodoroReset, () => pomodoro.reset())

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_event, patch: Partial<Settings>) => {
    const next = settings.set(patch)
    logger.debug('ipc', 'settings updated', { keys: Object.keys(patch) })
    context.onSettingsChanged(next)
    return next
  })

  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.on(IPC.appQuit, () => app.quit())
}
