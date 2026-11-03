import { spawn, type ChildProcess } from 'node:child_process'
import { logger } from '../logger'

/**
 * Plays a WAV rendered by the sidecar. `afplay` uses the current system output; routing to a
 * virtual mic (BlackHole) is a separate phase because it needs a device-level player.
 */
export class AudioFilePlayer {
  private child: ChildProcess | null = null

  async play(path: string, device?: string): Promise<void> {
    this.stop()
    if (!path) return
    // SoX can target a CoreAudio device (BlackHole). `afplay` always uses the default output.
    const useDevice = Boolean(device)
    const command = useDevice ? 'sox' : 'afplay'
    const args = useDevice ? [path, '-t', 'coreaudio', device as string] : [path]
    await new Promise<void>((resolve) => {
      const child = spawn(command, args, { stdio: 'ignore' })
      this.child = child
      child.on('error', (error) => {
        logger.warn('tts', 'audio playback failed', { error: error.message, command })
        if (this.child === child) this.child = null
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
