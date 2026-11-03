/**
 * AudioWorklet that forwards the microphone stream to the main process.
 *
 * The worklet only captures: resampling to 16 kHz happens in the main process
 * (`electron/audio/resampler.ts`) so there is exactly one resampler implementation.
 */
class FispeakMicCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(4096)
    this._offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      const channel = input[0]
      let read = 0
      while (read < channel.length) {
        const room = this._buffer.length - this._offset
        const take = Math.min(room, channel.length - read)
        this._buffer.set(channel.subarray(read, read + take), this._offset)
        this._offset += take
        read += take
        if (this._offset === this._buffer.length) {
          const out = this._buffer.slice(0)
          this.port.postMessage(out, [out.buffer])
          this._offset = 0
        }
      }
    }
    // No output is written: the worklet must never feed the speakers (no echo).
    return true
  }
}

registerProcessor('fispeak-mic-capture', FispeakMicCapture)
