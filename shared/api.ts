/**
 * Shared contract between Electron main, preload and renderer.
 * Keep this file dependency-free: it is imported by all three processes.
 */

export const ISLAND_STATES = [
  'IDLE',
  'EXPANDED_TOOL',
  'TRANSLATE_ON',
  'TRANSLATE_MINI',
  'ERROR_PILL',
  'HIDDEN'
] as const

export type IslandState = (typeof ISLAND_STATES)[number]

export type PlacementMode = 'notch' | 'floating'

export type PlacementSetting = 'auto' | PlacementMode

export interface CardRect {
  x: number
  y: number
  width: number
  height: number
}

export interface IslandMetrics {
  state: IslandState
  placement: PlacementMode
  cardWidth: number
  cardHeight: number
  gutterX: number
  gutterTop: number
  /** True while the window is resizing; renderer must not treat clicks as reliable. */
  animating: boolean
}

export interface Note {
  id: string
  body: string
  createdAt: number
  pinned: boolean
}

export type PomodoroMode = 'idle' | 'work' | 'short_break' | 'long_break'

export interface PomodoroSnapshot {
  mode: PomodoroMode
  running: boolean
  /** Epoch ms when the current phase ends. Null while paused or idle. */
  endsAt: number | null
  /** Remaining time when not running (paused or idle); ignored while `endsAt` is set. */
  remainingMs: number
  completedFocus: number
}

export type PanelTab = 'settings' | 'download' | 'history' | 'summary'

export interface Settings {
  placement: PlacementSetting
  myLang: string
  remoteLang: string
  autoDetectRemoteLang: boolean
  ttsEnabled: boolean
  ttsVolume: number
  captureSystemAudio: boolean
  whisperModel: 'small' | 'base' | 'medium'
  summaryProvider: 'auto' | 'ollama' | 'openrouter'
  summaryLanguage: string
  openrouterKey: string
  firstRunDone: boolean
  /** Saved window top-left for floating placement (DIP screen coordinates). */
  floatingPosition: { x: number; y: number } | null
}

export const DEFAULT_SETTINGS: Settings = {
  placement: 'auto',
  myLang: 'id',
  remoteLang: 'auto',
  autoDetectRemoteLang: true,
  ttsEnabled: true,
  ttsVolume: 0.8,
  captureSystemAudio: true,
  whisperModel: 'small',
  summaryProvider: 'auto',
  summaryLanguage: 'Indonesian',
  openrouterKey: '',
  firstRunDone: false,
  floatingPosition: null
}

/** Languages required by the MVP (01-vision §6). NLLB covers many more; selector stays short. */
export const SUPPORTED_LANGUAGES = [
  { code: 'id', label: 'Indonesian' },
  { code: 'en', label: 'English' },
  { code: 'ms', label: 'Malay' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' }
] as const

export const IPC = {
  islandSetState: 'island:set-state',
  islandRequestMetrics: 'island:request-metrics',
  islandReportCardRect: 'island:report-card-rect',
  islandMetrics: 'island:metrics',
  islandHover: 'island:hover',
  islandVisibility: 'island:visibility',
  islandHide: 'island:hide',
  islandShow: 'island:show',
  islandDragStart: 'island:drag-start',
  islandDragEnd: 'island:drag-end',
  islandOpenPanel: 'island:open-panel',
  islandToggleTranslate: 'island:toggle-translate',
  panelTab: 'panel:tab',
  notesList: 'notes:list',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove',
  pomodoroGet: 'pomodoro:get',
  pomodoroStart: 'pomodoro:start',
  pomodoroPause: 'pomodoro:pause',
  pomodoroReset: 'pomodoro:reset',
  pomodoroTick: 'pomodoro:tick',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appInfo: 'app:info',
  appQuit: 'app:quit'
} as const

export interface AppInfo {
  version: string
  platform: string
}

export interface FispeakApi {
  island: {
    setState(state: IslandState): void
    requestMetrics(): void
    reportCardRect(rect: CardRect): void
    onMetrics(callback: (metrics: IslandMetrics) => void): () => void
    onHover(callback: (inside: boolean) => void): () => void
    onVisibility(callback: (visible: boolean) => void): () => void
    hide(): void
    show(): void
    toggleTranslate(): void
    dragStart(): void
    dragEnd(): void
    openPanel(tab?: PanelTab): void
  }
  notes: {
    list(): Promise<Note[]>
    create(body: string): Promise<Note>
    update(id: string, body: string): Promise<Note[]>
    remove(id: string): Promise<Note[]>
  }
  pomodoro: {
    get(): Promise<PomodoroSnapshot>
    start(): Promise<PomodoroSnapshot>
    pause(): Promise<PomodoroSnapshot>
    reset(): Promise<PomodoroSnapshot>
    onTick(callback: (snapshot: PomodoroSnapshot) => void): () => void
  }
  panel: {
    onTab(callback: (tab: PanelTab) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  app: {
    info(): Promise<AppInfo>
    quit(): void
  }
}
