import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { logger } from '../logger'

const HOST = '127.0.0.1'
const PORT = 11434
const START_TIMEOUT_MS = 15_000
const PROBE_TIMEOUT_MS = 700

/**
 * Owns the local Ollama process for MT. The app starts it on the explicit Start action and
 * stops it on Stop, so no 5 GB model sits in RAM while the user is not translating.
 */
export class OllamaManager {
  private child: ChildProcess | null = null
  private spawned = false

  private baseUrl(): string {
    return `http://${HOST}:${PORT}`
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl()}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      })
      return response.ok
    } catch {
      return false
    }
  }

  /** Start `ollama serve` when it is not already answering. */
  async start(): Promise<boolean> {
    if (await this.isRunning()) return true
    const binary = this.binary()
    if (!binary) {
      logger.warn('ollama', 'ollama binary not found')
      return false
    }
    try {
      this.child = spawn(binary, ['serve'], { stdio: 'ignore' })
      this.spawned = true
      this.child.on('error', (error) => {
        logger.warn('ollama', 'ollama process error', { error: error.message })
        this.child = null
        this.spawned = false
      })
      this.child.on('exit', () => {
        this.child = null
        this.spawned = false
      })
    } catch (error) {
      logger.warn('ollama', 'failed to spawn ollama', { error: String(error) })
      this.child = null
      this.spawned = false
      return false
    }

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await this.isRunning()) {
        logger.info('ollama', 'ollama ready')
        return true
      }
      await delay(300)
    }
    logger.warn('ollama', 'ollama did not become ready in time')
    return false
  }

  /**
   * Stop the process we spawned; if Ollama was already running (brew service), unload the
   * model instead of killing a service the owner may use elsewhere.
   */
  async stop(model = 'llama3.1:8b'): Promise<void> {
    if (this.child && this.spawned) {
      try {
        this.child.kill('SIGTERM')
      } catch {
        // ignore
      }
      this.child = null
      this.spawned = false
      return
    }
    // The owner may run Ollama as a brew service. Stop it so the 8B model actually leaves RAM.
    if (process.platform === 'darwin') {
      try {
        await promisify(execFile)('brew', ['services', 'stop', 'ollama'], { timeout: 8_000 })
        logger.info('ollama', 'brew service stopped')
        return
      } catch {
        // No brew service or brew missing: fall back to unloading the model.
      }
    }
    try {
      await fetch(`${this.baseUrl()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(2_000)
      })
      logger.info('ollama', 'model unloaded', { model })
    } catch {
      // Ollama may already be down.
    }
  }

  /** Hard stop on quit. */
  kill(): void {
    if (!this.child) return
    try {
      this.child.kill('SIGKILL')
    } catch {
      // ignore
    }
    this.child = null
    this.spawned = false
  }

  hasProcess(): boolean {
    return this.child !== null
  }

  private binary(): string | null {
    const override = process.env.FISPEAK_OLLAMA_BIN
    if (override) return override
    const candidates = ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']
    return candidates.find((path) => existsSync(path)) ?? 'ollama'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
