import workletUrl from './audio/mic-worklet.js?url'

/**
 * Microphone capture page (05-audio-capture §2.1).
 *
 * Runs in a hidden window: it owns the getUserMedia stream and the AudioWorklet, and ships
 * raw Float32 blocks to the main process, which resamples them to 16 kHz and frames them.
 */

let context: AudioContext | null = null
let stream: MediaStream | null = null
let node: AudioWorkletNode | null = null

async function start(): Promise<void> {
  if (stream) return
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 48_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    })

    context = new AudioContext({ sampleRate: 48_000 })
    await context.audioWorklet.addModule(workletUrl)
    const source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'fispeak-mic-capture')
    const sink = context.createGain()
    sink.gain.value = 0

    source.connect(node)
    node.connect(sink)
    sink.connect(context.destination)

    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      window.fispeakMic?.sendFrame(event.data, context?.sampleRate ?? 48_000)
    }

    await context.resume()
    window.fispeakMic?.sendStatus({ state: 'running', sampleRate: context.sampleRate })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const denied = /denied|not allowed|permission/i.test(message)
    window.fispeakMic?.sendStatus({ state: denied ? 'denied' : 'error', message })
    stop()
  }
}

function stop(): void {
  if (node) {
    node.port.onmessage = null
    node.disconnect()
  }
  node = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  void context?.close()
  context = null
  window.fispeakMic?.sendStatus({ state: 'stopped' })
}

window.fispeakMic?.onCommand((command) => {
  if (command === 'start') void start()
  else stop()
})

// The main process may send "start" before this page finished loading, so the page reports
// itself as ready and waits for the command from there on.
window.fispeakMic?.sendStatus({ state: 'ready' })
