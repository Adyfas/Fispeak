import { spawn, type ChildProcess } from 'node:child_process'
import { logger } from '../logger'

/**
 * Text to speech for the "speak to translate" play button.
 *
 * The MVP uses the built-in macOS `say` so the feature works without shipping a model.
 * The interface is the same one the sidecar will implement with Kokoro in Phase 4
 * (08-tts-engine), so the UI does not change when the engine is swapped.
 */
export interface TtsEngine {
  speak(text: string, options?: { lang?: string }): Promise<void>
  stop(): void
}

const VOICES: Record<string, string> = {
  en: 'Samantha',
  id: 'Damayanti',
  ms: 'Damayanti',
  de: 'Anna',
  fr: 'Thomas',
  es: 'Monica',
  ja: 'Kyoko',
  zh: 'Ting-Ting',
  ko: 'Yuna',
  pt: 'Luciana',
  ru: 'Milena',
  nl: 'Lotte',
  vi: 'Linh',
  th: 'Kanya',
  tr: 'Yelda',
  ar: 'Maged',
  hi: 'Lekha'
}

export class MacSayEngine implements TtsEngine {
  private child: ChildProcess | null = null

  get available(): boolean {
    return process.platform === 'darwin'
  }

  async speak(text: string, options: { lang?: string } = {}): Promise<void> {
    const clean = text.trim()
    if (!clean) return
    if (!this.available) {
      logger.warn('tts', 'no text to speech engine on this platform')
      return
    }

    this.stop()
    const voice = VOICES[(options.lang ?? 'en').toLowerCase()] ?? 'Samantha'
    logger.info('tts', 'speaking', { voice, chars: clean.length })

    await new Promise<void>((resolve) => {
      const child = spawn('say', ['-v', voice, '--', clean], { stdio: 'ignore' })
      this.child = child
      child.on('error', (error) => {
        logger.warn('tts', 'speech failed', { error: error.message })
        resolve()
      })
      child.on('close', () => {
        if (this.child === child) this.child = null
        resolve()
      })
    })
  }

  stop(): void {
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
  }
}
