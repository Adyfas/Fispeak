import { contextBridge, ipcRenderer } from 'electron'
import type {
  CaptureStatus,
  CardRect,
  ChecklistItem,
  DictationResult,
  EngineModelOption,
  EngineTestResult,
  FispeakApi,
  IslandMetrics,
  IslandState,
  LanguageOption,
  ModelStatus,
  Note,
  PanelTab,
  PomodoroConfig,
  PomodoroMode,
  PomodoroSnapshot,
  PrivacyStatus,
  SessionRecord,
  Settings,
  SidecarEvent,
  TakeRecord,
  TranslateMode,
  TurnRecord
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
    setNavVisible: (visible: boolean) => ipcRenderer.send(IPC.islandNavVisible, visible),
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
    create: (body: string, items?: ChecklistItem[]) =>
      ipcRenderer.invoke(IPC.notesCreate, body, items) as Promise<Note>,
    update: (id: string, body: string, items?: ChecklistItem[]) =>
      ipcRenderer.invoke(IPC.notesUpdate, id, body, items) as Promise<Note[]>,
    remove: (id: string) => ipcRenderer.invoke(IPC.notesRemove, id) as Promise<Note[]>
  },
  pomodoro: {
    get: () => ipcRenderer.invoke(IPC.pomodoroGet) as Promise<PomodoroSnapshot>,
    start: () => ipcRenderer.invoke(IPC.pomodoroStart) as Promise<PomodoroSnapshot>,
    pause: () => ipcRenderer.invoke(IPC.pomodoroPause) as Promise<PomodoroSnapshot>,
    reset: () => ipcRenderer.invoke(IPC.pomodoroReset) as Promise<PomodoroSnapshot>,
    setMode: (mode: PomodoroMode) =>
      ipcRenderer.invoke(IPC.pomodoroSetMode, mode) as Promise<PomodoroSnapshot>,
    configure: (patch: Partial<PomodoroConfig>) =>
      ipcRenderer.invoke(IPC.pomodoroConfigure, patch) as Promise<PomodoroSnapshot>,
    onTick: (callback: (snapshot: PomodoroSnapshot) => void) =>
      subscribe<PomodoroSnapshot>(IPC.pomodoroTick, callback)
  },
  panel: {
    onTab: (callback: (tab: PanelTab) => void) => subscribe<PanelTab>(IPC.panelTab, callback)
  },
  translate: {
    start: () => ipcRenderer.send(IPC.captureStart),
    stop: () => ipcRenderer.send(IPC.captureStop),
    setMode: (mode: TranslateMode) => ipcRenderer.send(IPC.translateMode, mode),
    speak: (text: string, lang: string, record = true) => ipcRenderer.send(IPC.translateSpeak, text, lang, record),
    finishSpeak: () => ipcRenderer.invoke(IPC.translateFinishSpeak) as Promise<string | null>,
    ensureCapture: () => ipcRenderer.send(IPC.translateEnsureCapture),
    onEvent: (callback: (event: SidecarEvent) => void) =>
      subscribe<SidecarEvent>(IPC.sidecarEvent, callback),
    onStatus: (callback: (status: CaptureStatus) => void) =>
      subscribe<CaptureStatus>(IPC.captureStatus, callback),
    onMode: (callback: (mode: TranslateMode) => void) =>
      subscribe<TranslateMode>(IPC.translateMode, callback),
    languages: () => ipcRenderer.invoke(IPC.languagesGet) as Promise<LanguageOption[]>
  },
  session: {
    list: () => ipcRenderer.invoke(IPC.sessionList) as Promise<SessionRecord[]>,
    turns: (sessionId: string) =>
      ipcRenderer.invoke(IPC.sessionTurns, sessionId) as Promise<TurnRecord[]>,
    takes: (sessionId: string) =>
      ipcRenderer.invoke(IPC.sessionTakes, sessionId) as Promise<TakeRecord[]>,
    resume: (sessionId: string) => ipcRenderer.invoke(IPC.sessionResume, sessionId) as Promise<string>,
    rename: (sessionId: string, name: string) => ipcRenderer.invoke(IPC.sessionRename, sessionId, name) as Promise<void>,
    create: (name?: string) => ipcRenderer.invoke(IPC.sessionCreate, name) as Promise<string>
  },
  voice: {
    saveSample: (bytes: ArrayBuffer, refText: string) =>
      ipcRenderer.invoke(IPC.voiceSave, bytes, refText) as Promise<{
        ok: boolean
        path?: string
        error?: string
      }>
  },
  dictation: {
    start: () => ipcRenderer.invoke(IPC.dictationStart) as Promise<boolean>,
    stop: (localText: string) =>
      ipcRenderer.invoke(IPC.dictationStop, localText) as Promise<DictationResult>,
    cancel: () => ipcRenderer.send(IPC.dictationCancel)
  },
  models: {
    list: () => ipcRenderer.invoke(IPC.modelsList) as Promise<ModelStatus[]>,
    download: (id: string) => ipcRenderer.invoke(IPC.modelsDownload, id) as Promise<ModelStatus[]>,
    cancel: (id: string) => ipcRenderer.send(IPC.modelsCancel, id),
    onProgress: (callback: (status: ModelStatus) => void) =>
      subscribe<ModelStatus>(IPC.modelsProgress, callback)
  },
  privacy: {
    status: () => ipcRenderer.invoke(IPC.privacyStatus) as Promise<PrivacyStatus>,
    openScreenRecording: () => ipcRenderer.send(IPC.privacyOpen, 'screen'),
    openMicrophone: () => ipcRenderer.send(IPC.privacyOpen, 'microphone'),
    openAccessibility: () => ipcRenderer.send(IPC.privacyOpen, 'accessibility')
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.settingsSet, patch) as Promise<Settings>
  },
  engine: {
    test: (ai) => ipcRenderer.invoke(IPC.engineTest, ai) as Promise<EngineTestResult>,
    models: (provider, baseUrl, accountId) =>
      ipcRenderer.invoke(IPC.engineModels, provider, baseUrl, accountId) as Promise<
        EngineModelOption[]
      >,
    setKey: (provider, key) => ipcRenderer.invoke(IPC.engineKeySet, provider, key) as Promise<boolean>,
    hasKey: (provider) => ipcRenderer.invoke(IPC.engineKeyHas, provider) as Promise<boolean>,
    clearKey: (provider) => ipcRenderer.invoke(IPC.engineKeyClear, provider) as Promise<boolean>
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo) as Promise<{ version: string; platform: NodeJS.Platform }>,
    quit: () => ipcRenderer.send(IPC.appQuit)
  }
}

contextBridge.exposeInMainWorld('fispeak', api)
