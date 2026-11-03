import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 8765
const PORT_SCAN_STOP = 8770
const HEALTH_TIMEOUT_MS = 10_000
const HEALTH_PROBE_TIMEOUT_MS = 750
const SHUTDOWN_GRACE_MS = 5_000

export type SidecarStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface SidecarStatusDetail {
  port?: number
  message?: string
  reused?: boolean
}

/**
 * Owns the Python sidecar process (09-sidecar-spec §1).
 *
 * - reuses a healthy sidecar instead of spawning a second one
 * - reads the real port from `userData/sidecar.port`
 * - `/shutdown` first, `SIGKILL` after 5 s
 * - kills leftovers on `will-quit`
 */
export class SidecarManager {
  private child: ChildProcess | null = null
  private status: SidecarStatus = 'stopped'
  private port: number | null = null
  private refs = 0
  private idleTimer: NodeJS.Timeout | null = null
  /** 0 = stop immediately, >0 = keep warm for N ms, <0 = always on. */
  private keepAliveMs = 0

  constructor(private readonly onStatus?: (status: SidecarStatus, detail?: SidecarStatusDetail) => void) {}

  getStatus(): SidecarStatus {
    return this.status
  }

  getPort(): number | null {
    return this.port
  }

  isRunning(): boolean {
    return this.status === 'running'
  }

  setKeepAlive(ms: number): void {
    this.keepAliveMs = ms
  }

  /** A translate session needs the sidecar: start it now and keep it warm while active. */
  async acquire(): Promise<number | null> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.refs += 1
    return this.start()
  }

  /** The last consumer left: stop now or after the keep-alive window. */
  release(): void {
    this.refs = Math.max(0, this.refs - 1)
    if (this.refs > 0) return
    if (this.keepAliveMs < 0) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.keepAliveMs === 0) {
      void this.stop()
      return
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.refs === 0) void this.stop()
    }, this.keepAliveMs)
  }

  /** Start (or reuse) the sidecar. Resolves with the port it listens on. */
  async start(): Promise<number | null> {
    if (this.status === 'running' || this.status === 'starting') return this.port

    this.setStatus('starting')

    const existing = await this.findHealthySidecar()
    if (existing) {
      this.port = existing
      this.setStatus('running', { port: existing, reused: true })
      logger.info('sidecar', 'reusing running sidecar', { port: existing })
      return existing
    }

    const command = this.resolveCommand()
    if (!command) {
      this.setStatus('error', { message: 'sidecar runtime not found' })
      logger.error('sidecar', 'sidecar runtime not found', {
        hint: 'create the venv with: /opt/homebrew/bin/python3.11 -m venv .venv && .venv/bin/pip install -r sidecar/requirements.txt'
      })
      return null
    }

    try {
      this.child = spawn(command.command, command.args, {
        cwd: app.getAppPath(),
        env: { ...process.env, FISPEAK_DEBUG: process.env.FISPEAK_DEBUG ?? '' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      this.child = null
      this.setStatus('error', { message: String(error) })
      logger.error('sidecar', 'failed to spawn sidecar', { error: String(error) })
      return null
    }

    this.child.on('error', (error) => {
      logger.error('sidecar', 'sidecar process error', { error: error.message })
      this.setStatus('error', { message: error.message })
    })

    this.child.on('exit', (code, signal) => {
      logger.info('sidecar', 'sidecar exited', { code, signal })
      this.child = null
      if (this.status !== 'stopped') this.setStatus('stopped')
    })

    this.pipeLogs(this.child)

    const port = await this.waitForHealth()
    if (!port) {
      this.setStatus('error', { message: 'sidecar did not become healthy in time' })
      logger.error('sidecar', 'health check timed out', { timeoutMs: HEALTH_TIMEOUT_MS })
      this.kill()
      return null
    }

    this.port = port
    this.setStatus('running', { port })
    logger.info('sidecar', 'sidecar ready', { port })
    return port
  }

  /** Stop and start again - used when the socket stops answering pings. */
  async restart(): Promise<number | null> {
    await this.stop()
    this.port = null
    return this.start()
  }

  /** Graceful stop: `/shutdown`, then SIGKILL after the grace period. */
  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.refs = 0
    const child = this.child
    const port = this.port

    if (port !== null) {
      try {
        await this.post(`/shutdown`, HOST, port)
        logger.info('sidecar', 'shutdown requested', { port })
      } catch (error) {
        logger.warn('sidecar', 'shutdown request failed', { error: String(error) })
      }
    }

    if (!child) {
      // A reused sidecar has no child handle; `/shutdown` above is the only signal.
      this.port = null
      this.setStatus('stopped')
      return
    }

    const exited = await this.waitForExit(SHUTDOWN_GRACE_MS)
    if (!exited) {
      logger.warn('sidecar', 'sidecar did not exit in time, killing', { graceMs: SHUTDOWN_GRACE_MS })
      this.kill()
    }
    this.child = null
    this.port = null
    this.setStatus('stopped')
  }

  /** Hard kill for `will-quit` (zombie sidecars, 14-risks-notes §2). */
  kill(): void {
    const child = this.child
    if (!child || child.exitCode !== null) {
      this.child = null
      return
    }
    try {
      child.kill('SIGKILL')
      logger.warn('sidecar', 'sidecar killed')
    } catch (error) {
      logger.warn('sidecar', 'kill failed', { error: String(error) })
    }
    this.child = null
  }

  // -- internals ---------------------------------------------------------------------------
  private setStatus(status: SidecarStatus, detail?: SidecarStatusDetail): void {
    this.status = status
    this.onStatus?.(status, detail)
  }

  private resolveCommand(): { command: string; args: string[] } | null {
    const override = process.env.FISPEAK_PYTHON
    if (override) return { command: override, args: [] }

    if (app.isPackaged) {
      const binary = process.platform === 'win32' ? 'sidecar.exe' : 'sidecar'
      const packaged = join(process.resourcesPath, 'bin', binary)
      return existsSync(packaged) ? { command: packaged, args: [] } : null
    }

    const root = app.getAppPath()
    const python =
      process.platform === 'win32'
        ? join(root, '.venv', 'Scripts', 'python.exe')
        : join(root, '.venv', 'bin', 'python')
    if (!existsSync(python)) return null
    return { command: python, args: [join(root, 'sidecar', 'main.py'), '--mode', 'normal'] }
  }

  private async findHealthySidecar(): Promise<number | null> {
    const candidates = new Set<number>()
    const fromFile = this.readPortFile()
    if (fromFile) candidates.add(fromFile)
    for (let port = DEFAULT_PORT; port <= PORT_SCAN_STOP; port += 1) candidates.add(port)

    for (const port of candidates) {
      if (await this.isHealthy(port)) return port
    }
    return null
  }

  private readPortFile(): number | null {
    try {
      const path = join(app.getPath('userData'), 'sidecar.port')
      if (!existsSync(path)) return null
      const parsed = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    } catch {
      return null
    }
  }

  private async isHealthy(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://${HOST}:${port}/health`, {
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)
      })
      if (!response.ok) return false
      const body = (await response.json()) as { ok?: boolean }
      return body.ok === true
    } catch {
      return false
    }
  }

  private async waitForHealth(): Promise<number | null> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      const port = this.readPortFile()
      if (port && (await this.isHealthy(port))) return port
      for (let candidate = DEFAULT_PORT; candidate <= PORT_SCAN_STOP; candidate += 1) {
        if (candidate !== port && (await this.isHealthy(candidate))) return candidate
      }
      await delay(250)
    }
    return null
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!this.child || this.child.exitCode !== null) return true
      await delay(100)
    }
    return !this.child || this.child.exitCode !== null
  }

  private async post(path: string, host: string, port: number): Promise<void> {
    const response = await fetch(`http://${host}:${port}${path}`, {
      method: 'POST',
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  }

  private pipeLogs(child: ChildProcess): void {
    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    const logDir = join(app.getPath('userData'), 'logs')
    const logFile = join(logDir, `sidecar-${day}.log`)
    try {
      mkdirSync(logDir, { recursive: true })
    } catch {
      // ignore
    }

    const forward = (stream: NodeJS.ReadableStream | null): void => {
      stream?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        try {
          appendFileSync(logFile, text, 'utf8')
        } catch {
          // ignore
        }
        // Always visible: the sidecar prints one readable line per pipeline step, which is what
        // the owner watches while listening to a meeting.
        process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
      })
    }

    forward(child.stdout)
    forward(child.stderr)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
