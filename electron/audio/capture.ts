import type { AudioTag, CaptureDeviceStatus, TranslateMode } from '@shared/api'
import { HiddenAudioWindow, type MicStatusEvent } from '../windows/hiddenAudioWindow'
import { AudioResampler, FrameAssembler, rms, scale } from './resampler'
import { logger } from '../logger'

const LEVEL_INTERVAL_MS = 200
/** 05-audio-capture §8: keep captured audio from clipping. */
const INPUT_GAIN = 0.9

export interface SystemAudioSource {
  readonly available: boolean
  start(): Promise<void>
  stop(): void
}

export interface CaptureHooks {
  onFrame(tag: AudioTag, frame: Float32Array): void
  onLevel(tag: AudioTag, level: number): void
  onStatus(status: CaptureDeviceStatus): void
}

/**
 * Owns the two capture paths and normalises them to the wire format
 * (Float32, 16 kHz, mono, 200 ms frames) before they reach the WebSocket.
 */
export class AudioCapture {
  private readonly micWindow: HiddenAudioWindow
  private micResampler: AudioResampler | null = null
  private readonly micAssembler = new FrameAssembler()
  private system: SystemAudioSource | null = null
  private systemResampler: AudioResampler | null = null
  private readonly systemAssembler = new FrameAssembler()
  private lastLevelAt = { you: 0, remote: 0 }
  /** False after stop(): late frames from a dying helper must not reach the sidecar. */
  private active = false
  private micDesired: 'start' | 'stop' = 'stop'
  private mode: TranslateMode = 'listen'
  private status: CaptureDeviceStatus = {
    mic: 'idle',
    system: 'idle',
    message: null
  }

  constructor(
    private readonly hooks: CaptureHooks,
    systemSource?: SystemAudioSource
  ) {
    this.system = systemSource ?? null
    this.micWindow = new HiddenAudioWindow({
      onFrame: (samples, sampleRate) => this.handleMicFrame(samples, sampleRate),
      onStatus: (status) => this.handleMicStatus(status)
    })
  }

  getStatus(): CaptureDeviceStatus {
    return this.status
  }

  async start(options: { captureSystemAudio: boolean }): Promise<CaptureDeviceStatus> {
    this.active = true
    this.mode = options.captureSystemAudio ? 'listen' : 'speak'
    await this.applyMode(options.captureSystemAudio)
    return this.status
  }

  /**
   * The two capture paths are exclusive (05-audio-capture):
   * - `listen`: system audio (the meeting partner), microphone off
   * - `speak` : microphone only, system audio off
   */
  async setMode(
    mode: TranslateMode,
    options: { systemAudio: boolean } = { systemAudio: true }
  ): Promise<CaptureDeviceStatus> {
    this.active = true
    this.mode = mode
    await this.applyMode(options.systemAudio)
    return this.status
  }

  getMode(): TranslateMode {
    return this.mode
  }

  private async applyMode(systemAudio: boolean): Promise<void> {
    if (this.mode === 'listen') {
      this.micDesired = 'stop'
      this.micWindow.stopCapture()
      this.micResampler = null
      this.setStatus({ ...this.status, mic: 'idle' })

      if (!systemAudio) {
        this.setStatus({ ...this.status, system: 'idle' })
        return
      }
      if (!this.system?.available) {
        this.setStatus({
          ...this.status,
          system: 'unavailable',
          message: 'System audio capture is not available on this system'
        })
        return
      }
      this.setStatus({ ...this.status, system: 'starting' })
      try {
        await this.system.start()
        this.setStatus({ ...this.status, system: 'running', message: null })
      } catch (error) {
        this.setStatus({
          ...this.status,
          system: 'error',
          message: `System audio failed: ${error instanceof Error ? error.message : String(error)}`
        })
      }
      return
    }

    // speak: microphone only
    this.system?.stop()
    this.systemResampler = null
    this.setStatus({ ...this.status, system: 'idle' })

    this.micDesired = 'start'
    this.setStatus({ ...this.status, mic: 'starting', message: null })
    this.micWindow.create()
    this.micWindow.startCapture()
  }

  /** Stop both paths at once: no more mic frames, no more system audio, nothing on the wire. */
  stop(): void {
    this.active = false
    this.micDesired = 'stop'
    this.micWindow.stopCapture()
    this.system?.stop()
    this.micResampler = null
    this.systemResampler = null
    this.setStatus({ ...this.status, mic: 'idle', system: 'idle' })
  }

  destroy(): void {
    this.micWindow.destroy()
    this.system?.stop()
  }

  // -- internals ---------------------------------------------------------------------------
  private handleMicFrame(samples: Float32Array, sampleRate: number): void {
    if (!this.active) return
    if (!this.micResampler) this.micResampler = new AudioResampler(sampleRate)
    const resampled = this.micResampler.process(scale(samples, INPUT_GAIN))
    for (const frame of this.micAssembler.push(resampled)) {
      this.emitFrame('you', frame)
    }
  }

  private handleMicStatus(event: MicStatusEvent): void {
    if (event.state === 'ready') {
      // The page is loaded - now it can receive the start command.
      if (this.micDesired === 'start') this.micWindow.startCapture()
      return
    }
    if (event.state === 'running') {
      this.micResampler = new AudioResampler(event.sampleRate ?? 48_000)
      this.setStatus({ ...this.status, mic: 'running', message: null })
      logger.info('audio', 'microphone capture running', { sampleRate: event.sampleRate })
      return
    }
    if (event.state === 'denied') {
      this.setStatus({
        ...this.status,
        mic: 'denied',
        message: event.message ?? 'Microphone permission was denied'
      })
      return
    }
    if (event.state === 'error') {
      this.setStatus({
        ...this.status,
        mic: 'error',
        message: event.message ?? 'Microphone capture failed'
      })
      return
    }
    this.setStatus({ ...this.status, mic: 'idle' })
  }

  /** Feed system audio (ScreenCaptureKit helper, already mono) into the pipeline. */
  pushSystemAudio(samples: Float32Array, sampleRate: number): void {
    if (!this.active) return
    if (!this.systemResampler) this.systemResampler = new AudioResampler(sampleRate)
    const resampled = this.systemResampler.process(scale(samples, INPUT_GAIN))
    for (const frame of this.systemAssembler.push(resampled)) {
      this.emitFrame('remote', frame)
    }
  }

  private emitFrame(tag: AudioTag, frame: Float32Array): void {
    if (!this.active) return
    this.hooks.onFrame(tag, frame)
    const now = Date.now()
    if (now - this.lastLevelAt[tag] >= LEVEL_INTERVAL_MS) {
      this.lastLevelAt[tag] = now
      this.hooks.onLevel(tag, rms(frame))
    }
  }

  private setStatus(status: CaptureDeviceStatus): void {
    this.status = status
    this.hooks.onStatus(status)
  }
}
