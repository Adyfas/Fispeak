import WebSocket from 'ws'
import type { AudioTag, SidecarConnectionStatus, SidecarEvent } from '@shared/api'
import { AUDIO_TAG_BYTE } from '@shared/api'
import { logger } from '../logger'

const PING_INTERVAL_MS = 10_000
const PONG_TIMEOUT_MS = 10_000
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10_000]
/** Backpressure threshold for the Electron -> sidecar send buffer (09-sidecar-spec §3.3). */
const MAX_BUFFERED_BYTES = 5 * 1024 * 1024

export interface WsBridgeHooks {
  onEvent(event: SidecarEvent): void
  onStatus(status: SidecarConnectionStatus): void
  /** The sidecar stopped answering pings - the host should restart it. */
  onUnhealthy?(): void
}

/**
 * The single WebSocket connection of the Electron runtime (09-sidecar-spec §3).
 *
 * One socket for the whole app: every window is fed by broadcasting the events to the
 * renderers, the audio router pushes tagged frames into it.
 */
export class WsBridge {
  private socket: WebSocket | null = null
  private port: number | null = null
  private status: SidecarConnectionStatus = 'idle'
  private pingTimer: NodeJS.Timeout | null = null
  private pongTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private droppedRemoteFrames = 0
  private pendingFrames: string[] = []
  private closed = false

  constructor(private readonly hooks: WsBridgeHooks) {}

  getStatus(): SidecarConnectionStatus {
    return this.status
  }

  getDroppedRemoteFrames(): number {
    return this.droppedRemoteFrames
  }

  connect(port: number): void {
    this.closed = false
    this.port = port
    this.open()
  }

  disconnect(): void {
    this.closed = true
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.removeAllListeners()
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
    this.setStatus('idle')
  }

  /** Send one 200 ms audio frame (Float32, 16 kHz, mono) with its stream tag. */
  sendAudio(tag: AudioTag, frame: Float32Array): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return

    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      if (tag === 'remote') {
        this.droppedRemoteFrames += 1
        if (this.droppedRemoteFrames % 50 === 1) {
          logger.warn('ws', 'backpressure: dropped remote audio frames', {
            dropped: this.droppedRemoteFrames,
            buffered: socket.bufferedAmount
          })
        }
        return
      }
      logger.warn('ws', 'backpressure: send buffer full, keeping user audio', {
        buffered: socket.bufferedAmount
      })
    }

    const payload = Buffer.allocUnsafe(1 + frame.length * 4)
    payload[0] = AUDIO_TAG_BYTE[tag]
    Buffer.from(frame.buffer, frame.byteOffset, frame.length * 4).copy(payload, 1)
    socket.send(payload)
  }

  /**
   * Send a JSON control frame. Frames sent before the socket is open are queued (a bounded
   * number) and flushed on connect, so a `warmup` request is never silently dropped.
   */
  sendJson(payload: Record<string, unknown>): void {
    const text = JSON.stringify(payload)
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (this.pendingFrames.length < 32) this.pendingFrames.push(text)
      return
    }
    socket.send(text)
  }

  // -- internals ---------------------------------------------------------------------------
  private open(): void {
    if (this.closed || this.port === null) return
    const socket = new WebSocket(`ws://127.0.0.1:${this.port}/ws`, { perMessageDeflate: false })
    this.socket = socket
    this.setStatus(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting')

    socket.on('open', () => {
      this.reconnectAttempt = 0
      this.setStatus('connected')
      socket.send(JSON.stringify({ t: 'hello', proto: 1, client: 'electron' }))
      const queued = this.pendingFrames.splice(0, this.pendingFrames.length)
      for (const frame of queued) socket.send(frame)
      this.startPing()
      logger.info('ws', 'sidecar socket connected', { port: this.port })
    })

    socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        // Binary frames from the sidecar are TTS audio (tag 0x03) - Phase 4.
        return
      }
      this.handleText(data.toString())
    })

    socket.on('error', (error: Error) => {
      logger.warn('ws', 'socket error', { error: error.message })
    })

    socket.on('close', () => {
      this.clearTimers()
      if (this.socket === socket) this.socket = null
      if (this.closed) return
      this.setStatus('reconnecting')
      this.scheduleReconnect()
    })
  }

  private handleText(text: string): void {
    let event: SidecarEvent
    try {
      event = JSON.parse(text) as SidecarEvent
    } catch {
      return
    }
    if (event.t === 'pong') {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer)
        this.pongTimer = null
      }
    }
    this.hooks.onEvent(event)
  }

  private startPing(): void {
    this.clearTimers()
    this.pingTimer = setInterval(() => {
      this.sendJson({ t: 'ping' })
      if (this.pongTimer) return
      this.pongTimer = setTimeout(() => {
        logger.warn('ws', 'no pong within 10 s, connection considered dead')
        this.hooks.onUnhealthy?.()
        this.socket?.close()
      }, PONG_TIMEOUT_MS)
    }, PING_INTERVAL_MS)
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.pingTimer = null
    this.pongTimer = null
    this.reconnectTimer = null
  }

  private scheduleReconnect(): void {
    if (this.closed) return
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private setStatus(status: SidecarConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.hooks.onStatus(status)
  }
}
