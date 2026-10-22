import { contextBridge, ipcRenderer } from 'electron'
import type {
  CardRect,
  FispeakApi,
  IslandMetrics,
  IslandState,
  Note,
  PanelTab,
  PomodoroSnapshot,
  Settings
} from '@shared/api'
import { IPC } from '@shared/api'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: FispeakApi = {
  island: {
    setState: (state: IslandState) => ipcRenderer.send(IPC.islandSetState, state),
    requestMetrics: () => ipcRenderer.send(IPC.islandRequestMetrics),
    reportCardRect: (rect: CardRect) => ipcRenderer.send(IPC.islandReportCardRect, rect),
    onMetrics: (callback: (metrics: IslandMetrics) => void) =>
      subscribe<IslandMetrics>(IPC.islandMetrics, callback),
    onHover: (callback: (inside: boolean) => void) => subscribe<boolean>(IPC.islandHover, callback),
    onVisibility: (callback: (visible: boolean) => void) =>
      subscribe<boolean>(IPC.islandVisibility, callback),
    hide: () => ipcRenderer.send(IPC.islandHide),
    show: () => ipcRenderer.send(IPC.islandShow),
    toggleTranslate: () => ipcRenderer.send(IPC.islandToggleTranslate),
    dragStart: () => ipcRenderer.send(IPC.islandDragStart),
    dragEnd: () => ipcRenderer.send(IPC.islandDragEnd),
    openPanel: (tab?: PanelTab) => ipcRenderer.send(IPC.islandOpenPanel, tab)
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList) as Promise<Note[]>,
    create: (body: string) => ipcRenderer.invoke(IPC.notesCreate, body) as Promise<Note>,
    update: (id: string, body: string) =>
      ipcRenderer.invoke(IPC.notesUpdate, id, body) as Promise<Note[]>,
    remove: (id: string) => ipcRenderer.invoke(IPC.notesRemove, id) as Promise<Note[]>
  },
  pomodoro: {
    get: () => ipcRenderer.invoke(IPC.pomodoroGet) as Promise<PomodoroSnapshot>,
    start: () => ipcRenderer.invoke(IPC.pomodoroStart) as Promise<PomodoroSnapshot>,
    pause: () => ipcRenderer.invoke(IPC.pomodoroPause) as Promise<PomodoroSnapshot>,
    reset: () => ipcRenderer.invoke(IPC.pomodoroReset) as Promise<PomodoroSnapshot>,
    onTick: (callback: (snapshot: PomodoroSnapshot) => void) =>
      subscribe<PomodoroSnapshot>(IPC.pomodoroTick, callback)
  },
  panel: {
    onTab: (callback: (tab: PanelTab) => void) => subscribe<PanelTab>(IPC.panelTab, callback)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.settingsSet, patch) as Promise<Settings>
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo) as Promise<{ version: string; platform: NodeJS.Platform }>,
    quit: () => ipcRenderer.send(IPC.appQuit)
  }
}

contextBridge.exposeInMainWorld('fispeak', api)
