/**
 * Shared contract between Electron main, preload and renderer.
 * Keep this file dependency-free: it is imported by all three processes.
 */

import { DEFAULT_AI_SETTINGS, type AiProviderId, type AiSettings } from './providers'

export type { AiProviderId, AiSettings }

export const ISLAND_STATES = [
  'IDLE',
  'EXPANDED_TOOL',
  'TRANSLATE_ON',
  'PROMPT_ON',
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

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Note {
  id: string
  body: string
  /** Non-empty for a checklist note; the body then acts as the title. */
  items: ChecklistItem[]
  createdAt: number
  pinned: boolean
}

export type PomodoroMode = 'idle' | 'work' | 'short_break' | 'long_break'

/** Owner-editable phase lengths. Stored by the main process, mirrored in every snapshot. */
export interface PomodoroConfig {
  focusMs: number
  shortBreakMs: number
  longBreakMs: number
  roundsBeforeLongBreak: number
}

export interface PomodoroSnapshot {
  mode: PomodoroMode
  running: boolean
  /** Epoch ms when the current phase ends. Null while paused or idle. */
  endsAt: number | null
  /** Remaining time when not running (paused or idle); ignored while `endsAt` is set. */
  remainingMs: number
  /** Length of the phase that is running, so the ring stays correct for custom durations. */
  totalMs: number
  completedFocus: number
  config: PomodoroConfig
}

export type PanelTab = 'settings' | 'download' | 'history' | 'summary'

/**
 * Where the AI work runs. `local` keeps everything on the machine (bundled faster-whisper +
 * NLLB); the other providers talk to an OpenAI-compatible HTTP API, so no model download is
 * needed. API keys never live in Settings - they go to the OS credential store.
 */
export type EngineProvider = 'local' | 'openrouter' | 'groq' | 'ollama' | 'custom'

/**
 * Speech recognition is chosen independently from translation: a free Groq or Deepgram key
 * can replace the bundled Whisper while translation still runs locally, and vice versa.
 * `deepgram` is speech-only; it never appears as a translation provider.
 */
export type SttProvider = 'local' | 'openrouter' | 'groq' | 'deepgram' | 'custom'

/**
 * Prompt page (dictation) only: which OpenAI-compatible endpoint rewrites the transcript into
 * a detailed prompt. OVHcloud AI Endpoints works anonymously (2 requests/minute), so the
 * default needs no key at all.
 */
export type PromptAiProvider = 'ovh' | 'groq' | 'openrouter' | 'ollama' | 'custom'

export interface EngineSettings {
  /** Translation engine. Also the default source of STT until `sttProvider` is set. */
  provider: EngineProvider
  /** Speech recognition engine. Independent so a free STT API can pair with local translation. */
  sttProvider: SttProvider
  /** OpenRouter: hardcoded base URL, model ids only. Ollama/custom: editable base URL. */
  ollamaBaseUrl: string
  customBaseUrl: string
  openrouterSttModel: string
  openrouterMtModel: string
  groqSttModel: string
  groqMtModel: string
  deepgramModel: string
  ollamaMtModel: string
  customSttModel: string
  customMtModel: string
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  provider: 'local',
  sttProvider: 'local',
  ollamaBaseUrl: 'http://localhost:11434',
  customBaseUrl: '',
  openrouterSttModel: 'openai/whisper-1',
  openrouterMtModel: 'google/gemini-2.5-flash',
  groqSttModel: 'whisper-large-v3-turbo',
  groqMtModel: 'openai/gpt-oss-120b',
  deepgramModel: 'nova-3',
  ollamaMtModel: 'llama3.1:8b',
  customSttModel: 'whisper-1',
  customMtModel: 'gpt-4o-mini'
}

/**
 * Merge stored engine settings with the defaults and migrate the removed `localStt` toggle.
 * Before speech recognition became its own setting, `localStt=false` meant "use the same cloud
 * provider for STT and translation"; preserve that so existing installs keep working.
 */
export function resolveEngineSettings(
  stored: (Partial<EngineSettings> & { localStt?: boolean }) | null | undefined
): EngineSettings {
  const { localStt, ...rest } = stored ?? {}
  const engines: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS, ...rest }
  if (stored?.sttProvider == null) {
    const provider = engines.provider
    engines.sttProvider =
      localStt === false &&
      (provider === 'openrouter' || provider === 'groq' || provider === 'custom')
        ? provider
        : 'local'
  }
  return engines
}

export interface EngineTestResult {
  ok: boolean
  message: string
  latencyMs: number
}

export interface EngineModelOption {
  id: string
  label: string
}

export interface Settings {
  placement: PlacementSetting
  myLang: string
  remoteLang: string
  autoDetectRemoteLang: boolean
  ttsEnabled: boolean
  ttsVolume: number
  captureSystemAudio: boolean
  /**
   * Local LISTEN trade-off. `quality` uses more beam search and longer VAD windows (better
   * sentences, a few seconds more latency); `fast` reacts quickest but cuts phrases.
   */
  translateQuality: TranslateQuality
  whisperModel: 'small' | 'base' | 'medium'
  ttsModel: string
  ttsVoice: string
  speakAutoPlay: boolean
  ttsOutput: 'speaker' | 'blackhole'
  sidecarKeepAlive: 'off' | '2m' | '10m' | 'always'
  /** Prompt page: paste into the focused input with ⌘V instead of only copying. */
  dictationAutoPaste: boolean
  /** Prompt page: rewrite the transcript into a detailed prompt with an LLM before pasting. */
  promptAiEnabled: boolean
  promptAiProvider: PromptAiProvider
  promptAiModel: string
  /** Only for the custom (and self-hosted Ollama) provider. */
  promptAiBaseUrl: string
  summaryProvider: 'auto' | 'ollama' | 'openrouter'
  summaryLanguage: string
  openrouterKey: string
  /**
   * One provider (and one key) owns Listen, Translate, Speak and Prompt. `engines` is gone from
   * the live settings object; `resolveEngineSettings` only survives to migrate old databases.
   */
  ai: AiSettings
  firstRunDone: boolean
  /** Saved window top-left for floating placement (DIP screen coordinates). */
  floatingPosition: { x: number; y: number } | null
}

export type TranslateQuality = 'fast' | 'balanced' | 'quality'

export const DEFAULT_SETTINGS: Settings = {
  placement: 'auto',
  myLang: 'id',
  remoteLang: 'auto',
  autoDetectRemoteLang: true,
  ttsEnabled: true,
  ttsVolume: 0.8,
  captureSystemAudio: true,
  translateQuality: 'quality',
  whisperModel: 'small',
  ttsModel: 'kokoro-onnx',
  ttsVoice: 'af_heart',
  speakAutoPlay: false,
  ttsOutput: 'speaker',
  sidecarKeepAlive: 'off',
  dictationAutoPaste: true,
  promptAiEnabled: false,
  promptAiProvider: 'ovh',
  promptAiModel: 'Mistral-Small-3.2-24B-Instruct-2506',
  promptAiBaseUrl: '',
  summaryProvider: 'auto',
  summaryLanguage: 'Indonesian',
  openrouterKey: '',
  ai: DEFAULT_AI_SETTINGS,
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
  islandNavVisible: 'island:nav-visible',
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
  pomodoroSetMode: 'pomodoro:set-mode',
  pomodoroConfigure: 'pomodoro:configure',
  pomodoroTick: 'pomodoro:tick',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  sidecarEvent: 'sidecar:event',
  sidecarStatus: 'sidecar:status',
  captureStart: 'capture:start',
  captureStop: 'capture:stop',
  captureStatus: 'capture:status',
  dictationStart: 'dictation:start',
  dictationStop: 'dictation:stop',
  dictationCancel: 'dictation:cancel',
  sessionStart: 'session:start',
  sessionStop: 'session:stop',
  sessionList: 'session:list',
  sessionTurns: 'session:turns',
  sessionTakes: 'session:takes',
  sessionResume: 'session:resume',
  sessionRename: 'session:rename',
  sessionCreate: 'session:create',
  languagesGet: 'languages:get',
  translateMode: 'translate:mode',
  translateSpeak: 'translate:speak',
  translateFinishSpeak: 'translate:finish-speak',
  translateEnsureCapture: 'translate:ensure-capture',
  voiceSave: 'voice:save',
  engineTest: 'engine:test',
  engineModels: 'engine:models',
  engineKeySet: 'engine:key-set',
  engineKeyHas: 'engine:key-has',
  engineKeyClear: 'engine:key-clear',
  modelsList: 'models:list',
  modelsDownload: 'models:download',
  modelsCancel: 'models:cancel',
  modelsProgress: 'models:progress',
  privacyStatus: 'privacy:status',
  privacyOpen: 'privacy:open',
  micCommand: 'mic:command',
  micFrame: 'mic:frame',
  micStatus: 'mic:status',
  appInfo: 'app:info',
  appQuit: 'app:quit'
} as const

/** Audio stream tags; the first byte of every WS frame (09-sidecar-spec §3.1). */
export type AudioTag = 'you' | 'remote'

/**
 * Two exclusive capture modes (05-audio-capture):
 * - `listen`  : system audio only (the meeting partner), the microphone stays off
 * - `speak`   : microphone only, the user talks and the message is translated for the partner
 */
export type TranslateMode = 'listen' | 'speak'

export const AUDIO_TAG_BYTE: Record<AudioTag, number> = { you: 0x01, remote: 0x02 }

/** Wire format of the audio we send: Float32, 16 kHz, mono, 200 ms per frame. */
export const AUDIO_SAMPLE_RATE = 16_000
export const AUDIO_FRAME_SAMPLES = 3200

export interface TranscriptLine {
  chunkId: string
  tag: AudioTag
  srcLang: string
  text: string
  translated: string | null
  tgtLang: string | null
  quality: 'ok' | 'warn'
  startedMs: number
  endedMs: number
  confidence: number
}

/** A live (uncommitted) line: dimmed in the UI until `transcript` commits it. */
export interface PartialLine {
  windowId: string
  tag: AudioTag
  text: string
  startedMs: number
}

export type SidecarEvent =
  | { t: 'hello_ack'; port: number; version: string }
  | { t: 'engine_ready'; engine: string; ok: boolean; reason?: string | null; provider?: string }
  | {
      t: 'transcript'
      tag: AudioTag
      lang: string
      text: string
      conf: number
      started_ms: number
      end_ms: number
      session_id: string | null
      chunk_id: string
    }
  | {
      t: 'translation'
      tag: AudioTag
      chunk_id: string
      src_lang: string
      tgt_lang: string
      text_src: string
      text_tgt: string
      quality: 'ok' | 'warn'
    }
  | {
      t: 'partial'
      tag: AudioTag
      window_id: string
      text: string
      started_ms: number
      end_ms: number
      conf: number
      session_id: string | null
    }
  | {
      t: 'translated_text'
      request_id: string | null
      text_src: string
      text_tgt: string
      src_lang: string
      tgt_lang: string
      quality: 'ok' | 'warn'
    }
  | { t: 'speak_final'; text: string; session_id: string | null }
  | {
      t: 'tts_ready'
      request_id: string | null
      path: string
      sample_rate: number
      duration_ms: number
    }
  | {
      t: 'tts_error'
      request_id: string | null
      code: string
      message: string
    }
  | { t: 'stt_mode'; mode: 'stream' | 'batch' }
  | { t: 'audio_level'; tag: AudioTag; rms: number }
  | { t: 'notice'; level: 'info' | 'warn' | 'error'; code: string; message: string }
  | { t: 'pong' }

export type SidecarConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type CaptureState = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable' | 'error'

/** Status of the two capture devices (the sidecar connection is tracked separately). */
export interface CaptureDeviceStatus {
  mic: CaptureState
  system: CaptureState
  message: string | null
}

export interface CaptureStatus extends CaptureDeviceStatus {
  sessionId: string | null
  sidecar: SidecarConnectionStatus
}

/** Result of the Prompt page's Stop action. */
export interface DictationResult {
  /** Final transcribed text (sidecar flush, then the renderer buffer as fallback). */
  text: string
  /** True when the text was typed into the focused app with ⌘V. */
  pasted: boolean
  /** True when the text was placed on the clipboard. */
  copied: boolean
  /** True when the pasted text is the AI-improved prompt instead of the raw transcript. */
  enhanced?: boolean
  /** True when prompt AI was requested but the provider failed (raw text was used). */
  aiFailed?: boolean
  /** `accessibility` when auto-paste was requested but macOS has not granted the permission. */
  reason?: 'accessibility' | 'empty' | 'failed' | 'ai_failed'
}

export interface TurnRecord {
  id: string
  sessionId: string
  tag: AudioTag
  startedMs: number
  endedMs: number
  srcLang: string
  tgtLang: string | null
  textSrc: string
  textTgt: string | null
  confidence: number
  quality: string
  createdAt: number
}

/** One entry of `GET /languages` - the sidecar is the only source of the mapping. */
export interface LanguageOption {
  ui: string
  whisper: string
  flores: string
  label: string
}

export interface SessionRecord {
  id: string
  name: string
  startedAt: number
  endedAt: number | null
  status: 'active' | 'paused' | 'closed'
  myLang: string
  remoteLang: string
  whisperModel: string
  ttsModel: string | null
  ttsVoice: string | null
  turnCount: number
}

export interface TakeRecord {
  id: string
  sessionId: string
  index: number
  mode: 'listen' | 'speak'
  mergedSource: string | null
  mergedTranslation: string | null
  ttsModel: string | null
  ttsVoice: string | null
  createdAt: number
}

export interface AppInfo {
  version: string
  platform: string
}

/** One entry of the model list (10-summary-export §4). */
export interface ModelStatus {
  id: string
  kind: 'stt' | 'mt' | 'tts'
  label: string
  hint: string
  state: 'missing' | 'partial' | 'installed' | 'downloading' | 'error'
  totalBytes: number
  downloadedBytes: number
  progress: number
  missing: string[]
  message: string | null
  params: string
  languages: string
  license: string
  runtime: string
  size: string
  speed: string
  ram: string
  quality: string
  status: 'stable' | 'experimental' | 'unsupported'
  experimentalNote?: string
}

export interface PrivacyStatus {
  screenRecording: 'granted' | 'denied' | 'unsupported' | 'unknown'
  systemAudio: 'available' | 'unavailable'
  blackhole: boolean
  platform: string
}

export interface FispeakApi {
  island: {
    setState(state: IslandState): void
    requestMetrics(): void
    reportCardRect(rect: CardRect): void
    setNavVisible(visible: boolean): void
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
  translate: {
    start(): void
    stop(): void
    setMode(mode: TranslateMode): void
    speak(text: string, lang: string, record?: boolean): void
    finishSpeak(): Promise<string | null>
    ensureCapture(): void
    onEvent(callback: (event: SidecarEvent) => void): () => void
    onStatus(callback: (status: CaptureStatus) => void): () => void
    onMode(callback: (mode: TranslateMode) => void): () => void
    languages(): Promise<LanguageOption[]>
  }
  dictation: {
    start(): Promise<boolean>
    /** Stops capture, flushes the last phrase and pastes/copies the final text. */
    stop(localText: string): Promise<DictationResult>
    /** Stops without pasting (page closed, Esc, error). */
    cancel(): void
  }
  session: {
    list(): Promise<SessionRecord[]>
    turns(sessionId: string): Promise<TurnRecord[]>
    takes(sessionId: string): Promise<TakeRecord[]>
    resume(sessionId: string): Promise<string>
    rename(sessionId: string, name: string): Promise<void>
    create(name?: string): Promise<string>
  }
  voice: {
    saveSample(
      bytes: ArrayBuffer,
      refText: string
    ): Promise<{ ok: boolean; path?: string; error?: string }>
  }
  models: {
    list(): Promise<ModelStatus[]>
    download(id: string): Promise<ModelStatus[]>
    cancel(id: string): void
    onProgress(callback: (status: ModelStatus) => void): () => void
  }
  privacy: {
    status(): Promise<PrivacyStatus>
    openScreenRecording(): void
    openMicrophone(): void
    openAccessibility(): void
  }
  notes: {
    list(): Promise<Note[]>
    create(body: string, items?: ChecklistItem[]): Promise<Note>
    update(id: string, body: string, items?: ChecklistItem[]): Promise<Note[]>
    remove(id: string): Promise<Note[]>
  }
  pomodoro: {
    get(): Promise<PomodoroSnapshot>
    start(): Promise<PomodoroSnapshot>
    pause(): Promise<PomodoroSnapshot>
    reset(): Promise<PomodoroSnapshot>
    setMode(mode: PomodoroMode): Promise<PomodoroSnapshot>
    configure(patch: Partial<PomodoroConfig>): Promise<PomodoroSnapshot>
    onTick(callback: (snapshot: PomodoroSnapshot) => void): () => void
  }
  panel: {
    onTab(callback: (tab: PanelTab) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  engine: {
    /** Probe every task configured on the selected provider with the stored key. */
    test(ai: AiSettings): Promise<EngineTestResult>
    /** List model ids from `/models` (OpenAI-compatible) or `/api/tags` (Ollama). */
    models(provider: AiProviderId, baseUrl: string, accountId?: string): Promise<EngineModelOption[]>
    /** Store the API key in the OS credential store (never in settings.json). */
    setKey(provider: AiProviderId, key: string): Promise<boolean>
    hasKey(provider: AiProviderId): Promise<boolean>
    clearKey(provider: AiProviderId): Promise<boolean>
  }
  app: {
    info(): Promise<AppInfo>
    quit(): void
  }
}
