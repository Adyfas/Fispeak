import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SystemAudioSource } from './capture'
import { parseFrames, pcmToMono, type PcmInfo } from './sckFrames'
import { logger } from '../logger'

const HELPER_NAME = 'fispeak-audio-helper'

export interface SckCaptureHooks {
  onAudio(samples: Float32Array, sampleRate: number): void
  onError(message: string): void
}

/**
 * macOS 13+ system audio through the ScreenCaptureKit helper (05-audio-capture §2.2).
 *
 * The helper is a separate Swift binary that writes framed PCM to stdout; Electron parses
 * the frames, mixes them down to mono and hands them to the audio router.
 */
export class SckCapture implements SystemAudioSource {
  private child: ChildProcess | null = null
  private rest: Buffer = Buffer.alloc(0)
  private info: PcmInfo | null = null
  private stopped = true
  private killTimer: NodeJS.Timeout | null = null

  constructor(private readonly hooks: SckCaptureHooks) {}

  get available(): boolean {
    if (process.platform !== 'darwin') return false
    return existsSync(this.helperPath())
  }

  helperPath(): string {
    const override = process.env['FISPEAK_AUDIO_HELPER']
    if (override && existsSync(override)) return override

    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const candidates = [
      // Inside the app bundle: the helper then shares the app's code identity, so a single
      // Screen Recording grant covers both (see scripts/dev-app-bundle.sh).
      join(process.resourcesPath, HELPER_NAME),
      join(process.resourcesPath, 'bin', HELPER_NAME),
      join(process.resourcesPath, 'bin', `darwin-${arch}`, HELPER_NAME),
      // Plain dev flow: the helper sits in the repository.
      join(app.getAppPath(), 'resources', 'bin', `darwin-${arch}`, HELPER_NAME)
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return candidates[candidates.length - 1]
  }

  /** Ask macOS whether the Screen Recording permission is already granted. */
  async checkPermission(): Promise<boolean> {
    if (!this.available) return false
    return new Promise((resolve) => {
      const child = spawn(this.helperPath(), ['--check'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
      })
      child.on('error', () => resolve(false))
      child.on('close', () => {
        try {
          const parsed = JSON.parse(output) as { granted?: boolean }
          resolve(parsed.granted === true)
        } catch {
          resolve(false)
        }
      })
    })
  }

  async start(): Promise<void> {
    if (!this.available) throw new Error('the ScreenCaptureKit helper is not built')
    if (this.child) return

    const path = this.helperPath()
    logger.info('audio', 'starting the screen capture helper', { path })
    const child = spawn(path, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    this.rest = Buffer.alloc(0)
    this.info = null
    this.stopped = false

    child.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) return
      this.consume(chunk)
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      logger.warn('audio', 'screen capture helper stderr', { text: chunk.toString('utf8').trim() })
    })

    child.on('error', (error) => {
      logger.error('audio', 'screen capture helper failed to start', { error: error.message })
      this.hooks.onError(error.message)
    })

    child.on('exit', (code) => {
      if (this.killTimer) {
        clearTimeout(this.killTimer)
        this.killTimer = null
      }
      logger.info('audio', 'screen capture helper exited', { code })
      if (code !== 0 && code !== null) {
        this.hooks.onError(stderr.trim() || `the audio helper exited with code ${code}`)
      }
      this.child = null
    })
  }

  /**
   * Stop capture immediately: drop audio that is still in flight, ask the helper to exit and make
   * sure it really is gone. The helper owns a Core Audio process tap, so a lingering process would
   * keep listening to the Mac's audio after the user pressed stop.
   */
  stop(): void {
    this.stopped = true
    this.rest = Buffer.alloc(0)
    this.info = null

    const child = this.child
    this.child = null
    if (!child) return

    child.stdout?.removeAllListeners('data')
    child.stderr?.removeAllListeners('data')
    try {
      child.kill('SIGTERM')
    } catch {
      // already gone
    }

    this.killTimer = setTimeout(() => {
      this.killTimer = null
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('audio', 'audio helper ignored SIGTERM, killing it')
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }
    }, 1500)
    this.killTimer.unref()
    logger.info('audio', 'screen capture helper stopping', { pid: child.pid })
  }

  private consume(chunk: Buffer): void {
    const buffer = Buffer.concat([this.rest, chunk])
    const { frames, rest } = parseFrames(buffer)
    this.rest = rest

    for (const frame of frames) {
      if (frame.error) {
        logger.warn('audio', 'screen capture helper error', frame.error)
        this.hooks.onError(`${frame.error.code}: ${frame.error.message}`)
        continue
      }
      if (frame.info) {
        this.info = frame.info
        logger.info('audio', 'screen capture stream info', frame.info)
        continue
      }
      if (frame.ready) {
        logger.info('audio', 'screen capture helper ready', frame.ready)
        continue
      }
      if (frame.stats) {
        logger.debug('audio', 'screen capture helper stats', frame.stats)
        continue
      }
      if (!frame.pcm || !this.info) continue
      const mono = pcmToMono(frame.pcm, this.info)
      if (mono.length > 0) this.hooks.onAudio(mono, this.info.sampleRate)
    }
  }
}
