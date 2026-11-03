import type {
  AudioTag,
  CaptureDeviceStatus,
  CaptureStatus,
  DictationResult,
  LanguageOption,
  SidecarEvent,
  Settings,
  TranslateMode
} from '@shared/api'
import { logger } from '../logger'
import { buildEnginePayload } from '../engine/engineClient'
import { providerBaseUrl, providerNeedsKey, taskRouting } from '@shared/providers'
import { getSecret, secretName } from '../security/credentials'
import type { AudioCapture } from '../audio/capture'
import type { SessionStore } from '../db/sessionStore'
import type { SettingsStore } from '../db/settingsStore'
import type { SidecarManager } from '../sidecar/sidecarManager'
import type { OllamaManager } from '../ollama/ollamaManager'
import { deliverText, frontmostApp } from '../dictation/paste'
import { enhancePrompt } from '../engine/engineClient'
import { WsBridge } from '../sidecar/wsBridge'

export interface TranslateControllerHooks {
  onEvent(event: SidecarEvent): void
  onStatus(status: CaptureStatus): void
  onMode(mode: TranslateMode): void
}

interface PendingTurn {
  chunkId: string
  tag: 'you' | 'remote'
  srcLang: string
  text: string
  confidence: number
  startedMs: number
  endedMs: number
}

/**
 * Local LISTEN trade-off (owner request: quality first). Longer VAD windows keep whole
 * sentences together instead of cutting them every 6 s, and a wider beam search stops
 * Whisper/NLLB from guessing. `fast` stays available for a laggy machine.
 */
const QUALITY_PRESETS = {
  fast: { beamSize: 1, maxWindowMs: 6_000, silenceMs: 900, minSpeechMs: 1_000 },
  balanced: { beamSize: 3, maxWindowMs: 10_000, silenceMs: 1_200, minSpeechMs: 1_000 },
  quality: { beamSize: 5, maxWindowMs: 14_000, silenceMs: 1_400, minSpeechMs: 1_000 }
} as const

/**
 * Wires the capture, the sidecar socket and the session storage together (09-sidecar-spec).
 *
 * The renderer never talks to the sidecar directly: main owns the single WebSocket and
 * broadcasts every event to the windows.
 */
export class TranslateController {
  private readonly bridge: WsBridge
  private sessionId: string | null = null
  private status: CaptureStatus = {
    mic: 'idle',
    system: 'idle',
    message: null,
    sessionId: null,
    sidecar: 'idle'
  }
  private readonly pending = new Map<string, PendingTurn>()
  private readonly pendingTranslations = new Map<
    string,
    { resolve: (result: { text: string; lang: string } | null) => void; timer: NodeJS.Timeout }
  >()
  private pendingSpeakLines: string[] = []
  private readonly pendingTts = new Map<
    string,
    { resolve: (result: { path: string; durationMs: number } | null) => void; timer: NodeJS.Timeout }
  >()
  private mtSeq = 0
  private ttsSeq = 0
  private mode: TranslateMode = 'listen'
  /** Prompt page: STT-only capture, no MT, no session rows. */
  private dictation = false
  private dictationToken = 0
  private dictationLines: string[] = []
  private dictationFinal = ''
  private dictationPreviousApp: string | null = null

  constructor(
    private readonly deps: {
      settings: SettingsStore
      sessions: SessionStore
      sidecar: SidecarManager
      ollama: OllamaManager
      capture: AudioCapture
    },
    private readonly hooks: TranslateControllerHooks
  ) {
    this.bridge = new WsBridge({
      onEvent: (event) => this.handleEvent(event),
      onStatus: (sidecar) => this.setStatus({ ...this.status, sidecar }),
      onUnhealthy: () => {
        logger.warn('translate', 'sidecar connection unhealthy, restarting it')
        void this.deps.sidecar.restart().then((port) => {
          if (port) this.bridge.connect(port)
        })
      }
    })
  }

  getStatus(): CaptureStatus {
    return this.status
  }

  isRunning(): boolean {
    return this.sessionId !== null
  }

  /** Push one 200 ms audio frame into the sidecar socket. */
  sendAudio(tag: AudioTag, frame: Float32Array): void {
    this.bridge.sendAudio(tag, frame)
  }

  /**
   * The language list comes from the sidecar (`GET /languages`) - the renderer must never
   * keep its own copy of the Whisper/FLORES mapping.
   */
  async getLanguages(): Promise<LanguageOption[]> {
    const port = this.deps.sidecar.getPort()
    if (!port) return []
    try {
      const response = await fetch(`http://127.0.0.1:${port}/languages`, {
        signal: AbortSignal.timeout(2000)
      })
      if (!response.ok) return []
      const body = (await response.json()) as { nllb?: LanguageOption[] }
      return body.nllb ?? []
    } catch {
      return []
    }
  }

  async start(): Promise<CaptureStatus> {
    if (this.sessionId) return this.status
    // The microphone is exclusive: Prompt dictation has to stop before a session starts.
    if (this.dictation) this.cancelDictation()

    const settings = this.deps.settings.get()
    if (settings.ai.provider === 'ollama') {
      await this.deps.ollama.start()
    }
    const port = await this.deps.sidecar.acquire()
    if (!port) {
      this.deps.sidecar.release()
      this.setStatus({
        ...this.status,
        sidecar: 'error',
        message: 'The sidecar is not available - models or python environment missing'
      })
      return this.status
    }

    this.bridge.connect(port)

    this.sessionId = this.deps.sessions.start({
      myLang: settings.myLang,
      remoteLang: settings.remoteLang,
      whisperModel: settings.whisperModel
    })
    this.setStatus({ ...this.status, sessionId: this.sessionId })
    this.sendConfig(settings)
    // Load Whisper + NLLB now, so the first transcript of the session is not delayed by a
    // ~10 s cold start (measured: first line 17 s vs ~7 s warm).
    this.bridge.sendJson({ t: 'warmup' })

    await this.deps.capture.setMode(this.mode, { systemAudio: settings.captureSystemAudio })
    logger.info('translate', 'live translate started', { sessionId: this.sessionId, mode: this.mode })
    return this.status
  }

  stop(): void {
    if (this.dictation) this.cancelDictation()
    if (!this.sessionId) {
      this.deps.capture.stop()
      this.pending.clear()
      this.cancelPendingTranslations()
      this.deps.sidecar.release()
      void this.deps.ollama.stop(this.deps.settings.get().ai.models.translate)
      this.bridge.disconnect()
      return
    }
    this.deps.capture.stop()
    this.bridge.sendJson({ t: 'state', mode: 'translate_off' })
    this.pending.clear()
    this.cancelPendingTranslations()
    this.deps.sessions.stop(this.sessionId)
    this.deps.sidecar.release()
    void this.deps.ollama.stop(this.deps.settings.get().ai.models.translate)
    this.bridge.disconnect()
    logger.info('translate', 'live translate stopped', { sessionId: this.sessionId })
    this.sessionId = null
    this.setStatus({ ...this.status, sessionId: null })
  }

  private cancelPendingTranslations(): void {
    for (const [requestId, pending] of this.pendingTranslations) {
      clearTimeout(pending.timer)
      pending.resolve(null)
      this.pendingTranslations.delete(requestId)
    }
  }

  /** Live reconfiguration: language swap without restarting the sidecar. */
  updateSettings(settings: Settings): void {
    if (!this.sessionId) return
    this.sendConfig(settings)
  }

  /**
   * SPEAK `Putar`: translate the (possibly edited) Indonesian text to the partner language.
   * The sidecar answers with `translated_text`; this promise resolves with the translation so
   * the caller (IPC) can run TTS. Returns null on timeout / missing sidecar.
   */
  translateForSpeak(text: string, tgtLang: string, record = true): Promise<{ text: string; lang: string } | null> {
    const trimmed = text.trim()
    if (!trimmed || !this.sessionId) return Promise.resolve(null)
    const settings = this.deps.settings.get()
    const requestId = `speak-${++this.mtSeq}`
    const sessionId = this.sessionId
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTranslations.delete(requestId)
        resolve(null)
      }, 20_000)
      this.pendingTranslations.set(requestId, {
        resolve: (result) => {
          if (result && sessionId && record) {
            // Persist the take (M3.7): merged source + translation + voice model.
            try {
              const existing = this.deps.sessions.takes(sessionId)
              const speakRoute = taskRouting(settings.ai, 'speak')
              this.deps.sessions.recordTake({
                sessionId,
                index: existing.length,
                mode: 'speak',
                mergedSource: trimmed,
                mergedTranslation: result.text,
                ttsModel: speakRoute.mode === 'cloud' ? speakRoute.model : settings.ttsModel,
                ttsVoice: speakRoute.mode === 'cloud' ? settings.ai.voiceId : settings.ttsVoice
              })
            } catch (error) {
              logger.warn('translate', 'take record failed', {
                error: error instanceof Error ? error.message : String(error)
              })
            }
          }
          resolve(result)
        },
        timer
      })
      this.bridge.sendJson({
        t: 'translate_text',
        request_id: requestId,
        text: trimmed,
        src: settings.myLang,
        tgt: tgtLang || settings.remoteLang
      })
    })
  }

  /**
   * Synthesize the translated text in the sidecar and return the WAV path.
   *
   * Speak follows the unified provider: when the selected provider offers TTS (Mistral, OpenAI,
   * Together, custom) the request carries that provider's model/key; otherwise the local Kokoro
   * or cloned voice is used. The sidecar writes a WAV either way, so playback is unchanged.
   */
  synthesize(
    text: string,
    lang: string,
    voice?: string,
    model?: string
  ): Promise<{ path: string; durationMs: number } | null> {
    const trimmed = text.trim()
    if (!trimmed || !this.sessionId) return Promise.resolve(null)
    const settings = this.deps.settings.get()
    const route = taskRouting(settings.ai, 'speak')
    const cloud = route.mode === 'cloud'
    const requestId = `tts-${++this.ttsSeq}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTts.delete(requestId)
        resolve(null)
      }, 120_000)
      this.pendingTts.set(requestId, { resolve, timer })
      this.bridge.sendJson({
        t: 'tts',
        request_id: requestId,
        text: trimmed,
        lang,
        model: cloud ? route.model : model || settings.ttsModel,
        voice: cloud ? settings.ai.voiceId : voice || settings.ttsVoice,
        speed: 1.0,
        // Remote TTS gets its own one-shot config; local TTS ignores these fields.
        provider: cloud ? route.provider : 'local',
        base_url: cloud ? providerBaseUrl(settings.ai, route.provider) : '',
        api_key: cloud && providerNeedsKey(route.provider)
          ? getSecret(secretName(route.provider))
          : '',
        voice_source:
          cloud && route.provider === 'mistral' && settings.ai.voiceSource === 'clone'
            ? 'clone'
            : 'preset'
      })
    })
  }

  /** The capture reports the device states; the sidecar state is tracked here. */
  updateDevices(status: CaptureDeviceStatus): void {
    this.setStatus({ ...this.status, ...status })
  }

  /**
   * Switch between "listen" (system audio of the meeting partner) and "speak"
   * (microphone only, the user talks to the partner).
   */
  async setMode(mode: TranslateMode): Promise<void> {
    if (this.mode === mode) return
    this.mode = mode
    logger.info('translate', `mode switched to ${mode}`)
    this.hooks.onMode(mode)
    if (this.sessionId) {
      await this.deps.capture.setMode(mode, {
        systemAudio: this.deps.settings.get().captureSystemAudio
      })
      // Stop any playing TTS from the previous mode (exclusivity).
      // (TTS engine is managed separately via IPC; capture.setMode already stops the capture paths.)
      // Tell the sidecar to drop the inactive stream.
      this.sendConfig(this.deps.settings.get())
    }
  }

  /**
   * Re-open the capture path for the current mode without changing the session. The feature
   * pages unmount/remount when the user navigates; this guarantees the mic/system tap is
   * running again even if `setMode` was called with the same mode (which is a no-op).
   */
  async ensureCapture(): Promise<void> {
    if (!this.sessionId) return
    await this.deps.capture.setMode(this.mode, {
      systemAudio: this.deps.settings.get().captureSystemAudio
    })
    this.sendConfig(this.deps.settings.get())
  }

  /**
   * SPEAK `[Selesai]`: stop capture (mic off) but keep the session alive so `[Putar]`
   * can still translate. Flushes the last partial as a final, merges all committed
   * lines into one text, and returns it. Returns null if no session is active.
   */
  async finishSpeak(): Promise<string | null> {
    if (!this.sessionId) return null
    // Tell sidecar to flush the last partial as a final FIRST (before stopping capture).
    this.bridge.sendJson({ t: 'state', mode: 'speak_finish' })
    // Small delay to let the sidecar process the flush.
    await new Promise((resolve) => setTimeout(resolve, 200))
    // Stop capture (mic off) — session stays alive for translateForSpeak.
    this.deps.capture.stop()
    const merged = this.pendingSpeakLines.join(' ').trim()
    if (merged) {
      this.pendingSpeakLines = []
    }
    return merged || null
  }

  /**
   * Prompt page: microphone -> transcript only. No session row and no MT, so the sidecar
   * never loads NLLB/Ollama and RAM stays at "Whisper only".
   */
  async startDictation(): Promise<boolean> {
    if (this.dictation) return true
    if (this.sessionId) this.stop()

    // Claim the microphone immediately: a `cancel` that arrives during the cold start must be
    // able to stop this start, otherwise the mic would stay open with no UI.
    const token = ++this.dictationToken
    this.dictation = true
    this.dictationLines = []
    this.dictationFinal = ''

    const settings = this.deps.settings.get()
    const port = await this.deps.sidecar.acquire()
    if (!port || token !== this.dictationToken) {
      this.deps.sidecar.release()
      this.dictation = false
      if (!port) {
        this.setStatus({
          ...this.status,
          sidecar: 'error',
          message: 'The sidecar is not available - models or python environment missing'
        })
      }
      return false
    }

    this.dictationPreviousApp = await frontmostApp()

    this.bridge.connect(port)
    this.sendConfig(settings, { sttOnly: true, captureMode: 'speak' })
    // Warm up STT only: loading the MT engine here would cost seconds and hundreds of MB.
    this.bridge.sendJson({ t: 'warmup', stt_only: true })
    await this.deps.capture.setMode('speak', { systemAudio: false })
    if (token !== this.dictationToken) {
      this.cancelDictation()
      return false
    }
    if (this.deps.capture.getStatus().mic === 'denied') {
      this.cancelDictation()
      this.setStatus({
        ...this.status,
        mic: 'denied',
        message: 'Microphone access is blocked - allow it in System Settings > Privacy.'
      })
      return false
    }
    logger.info('dictation', 'prompt dictation started')
    return true
  }

  /** Prompt page Stop: flush the take, then paste into the app that had focus. */
  async stopDictation(localText: string): Promise<DictationResult> {
    const settings = this.deps.settings.get()
    if (!this.dictation) {
      return deliverText(localText, {
        autoPaste: settings.dictationAutoPaste,
        previousApp: null
      })
    }

    // Flush the last streaming partial first, exactly like SPEAK `[Selesai]`.
    this.bridge.sendJson({ t: 'state', mode: 'speak_finish' })
    await new Promise((resolve) => setTimeout(resolve, 220))
    this.deps.capture.stop()

    const merged =
      (this.dictationFinal || this.dictationLines.join(' ')).trim() || localText.trim()
    const previousApp = this.dictationPreviousApp
    this.resetDictation()

    // Prompt AI: rewrite the transcript into a detailed prompt before it leaves the app.
    // The sidecar is already released, so the request does not keep Whisper in RAM.
    let finalText = merged
    let enhanced = false
    let aiFailed = false
    if (settings.promptAiEnabled && merged) {
      const improved = await enhancePrompt(merged, settings)
      if (improved) {
        finalText = improved
        enhanced = true
      } else {
        aiFailed = true
      }
    }

    const result = await deliverText(finalText, {
      autoPaste: settings.dictationAutoPaste,
      previousApp
    })
    logger.info('dictation', 'prompt dictation stopped', {
      chars: result.text.length,
      pasted: result.pasted,
      enhanced,
      aiFailed,
      reason: result.reason ?? null
    })
    return { ...result, enhanced, aiFailed }
  }

  /** Stop without pasting: page closed, Esc, or an error. */
  cancelDictation(): void {
    this.dictationToken += 1
    if (!this.dictation) return
    this.deps.capture.stop()
    this.resetDictation()
    logger.info('dictation', 'prompt dictation cancelled')
  }

  private resetDictation(): void {
    this.dictation = false
    this.dictationLines = []
    this.dictationFinal = ''
    this.dictationPreviousApp = null
    if (this.sessionId) return
    // No session: the sidecar is only alive for this dictation, so release it now.
    this.bridge.sendJson({ t: 'state', mode: 'translate_off' })
    this.deps.sidecar.release()
    this.bridge.disconnect()
  }

  private sendConfig(
    settings: Settings,
    options: { sttOnly?: boolean; captureMode?: TranslateMode } = {}
  ): void {
    const preset = QUALITY_PRESETS[settings.translateQuality] ?? QUALITY_PRESETS.quality
    this.bridge.sendJson({
      t: 'config',
      my_lang: settings.myLang,
      // The remote stream is auto-detected per window unless the owner pinned a language.
      // Sending the stored value while auto-detect is on would force Whisper into the wrong
      // language and ruin the transcript (the 2026-10-24 quality regression).
      remote_lang: settings.autoDetectRemoteLang ? 'auto' : settings.remoteLang,
      session_id: this.sessionId,
      tts_enabled: settings.ttsEnabled,
      tts_voice: 'af_heart',
      beam_size: preset.beamSize,
      vad_max_window_ms: preset.maxWindowMs,
      vad_silence_ms: preset.silenceMs,
      vad_min_speech_ms: preset.minSpeechMs,
      whisper_model: settings.whisperModel,
      engine: buildEnginePayload(settings),
      // "auto" lets the sidecar resolve: local STT = streaming, remote STT = batch
      // (owner decision 2026-10-25). It also falls back to batch when RTF > 1.
      stt_mode: 'auto',
      // Only the active capture source is processed (LISTEN = system audio, SPEAK = mic).
      capture_mode: options.captureMode ?? this.mode,
      // Prompt page: transcribe only. The router never asks MT for a target language.
      mode: options.sttOnly ? 'stt_only' : 'translate_on'
    })
  }

  private handleEvent(event: SidecarEvent): void {
    // After stop() the sidecar may still be finishing the last window; never let it reach the UI
    // or the database, otherwise a subtitle pops up on a closed card. Dictation owns the
    // microphone without a session, so its events must still flow.
    if (
      !this.sessionId &&
      !this.dictation &&
      (event.t === 'transcript' ||
        event.t === 'translation' ||
        event.t === 'audio_level' ||
        event.t === 'partial')
    ) {
      return
    }

    if (event.t === 'speak_final') {
      // The Prompt page uses the sidecar's merged take (it includes the flushed partial).
      if (this.dictation) this.dictationFinal = event.text
      this.hooks.onEvent(event)
      return
    }

    if (event.t === 'partial') {
      // Never stored: a partial is only a live preview of the line that `transcript` commits.
      this.hooks.onEvent(event)
      return
    }

    if (event.t === 'translated_text') {
      const pending = event.request_id ? this.pendingTranslations.get(event.request_id) : undefined
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingTranslations.delete(event.request_id as string)
        pending.resolve({ text: event.text_tgt, lang: event.tgt_lang })
      }
      this.hooks.onEvent(event)
      return
    }

    if (event.t === 'tts_ready' || event.t === 'tts_error') {
      const pending = event.request_id ? this.pendingTts.get(event.request_id) : undefined
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingTts.delete(event.request_id as string)
        pending.resolve(
          event.t === 'tts_ready' ? { path: event.path, durationMs: event.duration_ms } : null
        )
      }
      this.hooks.onEvent(event)
      return
    }

    if (event.t === 'transcript') {
      // In SPEAK mode, accumulate committed `you` lines for the current take.
      if (this.mode === 'speak' && event.tag === 'you') {
        this.pendingSpeakLines.push(event.text)
      }
      // Prompt page: keep the committed lines as the fallback text when the sidecar cannot
      // merge the take (for example remote/batch STT).
      if (this.dictation && event.tag === 'you') {
        this.dictationLines.push(event.text)
      }
      this.pending.set(event.chunk_id, {
        chunkId: event.chunk_id,
        tag: event.tag,
        srcLang: event.lang,
        text: event.text,
        confidence: event.conf,
        startedMs: event.started_ms,
        endedMs: event.end_ms
      })
      this.hooks.onEvent(event)
      return
    }

    if (event.t === 'translation') {
      const pending = this.pending.get(event.chunk_id)
      if (pending && this.sessionId) {
        this.deps.sessions.recordTurn({
          chunkId: pending.chunkId,
          sessionId: this.sessionId,
          tag: pending.tag,
          startedMs: pending.startedMs,
          endedMs: pending.endedMs,
          srcLang: pending.srcLang,
          tgtLang: event.tgt_lang,
          textSrc: pending.text,
          textTgt: event.text_tgt,
          confidence: pending.confidence,
          quality: event.quality
        })
        this.pending.delete(event.chunk_id)
      }
      this.hooks.onEvent(event)
      return
    }

    if (event.t === 'notice' && event.level === 'error') {
      this.setStatus({ ...this.status, message: event.message })
    }

    this.hooks.onEvent(event)
  }

  async resume(sessionId: string): Promise<CaptureStatus> {
    if (this.dictation) this.cancelDictation()
    if (this.sessionId) {
      this.stop()
    }
    const settings = this.deps.settings.get()
    if (settings.ai.provider === 'ollama') {
      await this.deps.ollama.start()
    }
    const port = await this.deps.sidecar.acquire()
    if (!port) {
      this.deps.sidecar.release()
      this.setStatus({
        ...this.status,
        sidecar: 'error',
        message: 'The sidecar is not available - models or python environment missing'
      })
      return this.status
    }
    this.bridge.connect(port)
    this.sessionId = sessionId
    this.deps.sessions.resume(sessionId)
    this.setStatus({ ...this.status, sessionId: this.sessionId })
    this.sendConfig(settings)
    this.bridge.sendJson({ t: 'warmup' })
    await this.deps.capture.setMode(this.mode, { systemAudio: settings.captureSystemAudio })
    logger.info('translate', 'live translate resumed', { sessionId: this.sessionId, mode: this.mode })
    return this.status
  }

  private setStatus(status: CaptureStatus): void {
    this.status = status
    this.hooks.onStatus(status)
  }
}
