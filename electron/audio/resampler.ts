/**
 * Audio format helpers for the Electron side (05-audio-capture §1).
 *
 * Everything that leaves Electron towards the sidecar is Float32, 16 kHz, mono, in 200 ms
 * frames (3200 samples). Captured audio arrives at 48 kHz (mic, ScreenCaptureKit) and is
 * resampled here, in the main process, so exactly one resampler implementation exists.
 */

export const TARGET_SAMPLE_RATE = 16_000
export const FRAME_SAMPLES = 3200

/** Average the channels of an interleaved-free multi-channel capture into mono. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]
  const length = Math.min(...channels.map((channel) => channel.length))
  const out = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    let sum = 0
    for (const channel of channels) sum += channel[index]
    out[index] = sum / channels.length
  }
  return out
}

/**
 * Resample to 16 kHz.
 *
 * Integer ratios (48k -> 16k is the common case) use a box filter, which averages the source
 * samples of each output sample and therefore low-passes instead of aliasing. Other ratios
 * fall back to linear interpolation with a fractional read position.
 */
export class AudioResampler {
  private readonly ratio: number
  private readonly integerMode: boolean
  private tail: Float32Array = new Float32Array(0)
  private nextPosition = 0

  constructor(inputRate: number, outputRate: number = TARGET_SAMPLE_RATE) {
    this.ratio = inputRate / outputRate
    this.integerMode = Number.isInteger(this.ratio) && this.ratio >= 1
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0)
    const merged = concat(this.tail, input)
    if (this.integerMode) return this.processInteger(merged)
    return this.processLinear(merged)
  }

  private processInteger(merged: Float32Array): Float32Array {
    const step = Math.round(this.ratio)
    const count = Math.floor(merged.length / step)
    const out = new Float32Array(count)
    for (let index = 0; index < count; index += 1) {
      let sum = 0
      for (let offset = 0; offset < step; offset += 1) sum += merged[index * step + offset]
      out[index] = sum / step
    }
    this.tail = merged.slice(count * step)
    return out
  }

  private processLinear(merged: Float32Array): Float32Array {
    const values: number[] = []
    while (this.nextPosition + 1 < merged.length) {
      const index = Math.floor(this.nextPosition)
      const fraction = this.nextPosition - index
      values.push(merged[index] * (1 - fraction) + merged[index + 1] * fraction)
      this.nextPosition += this.ratio
    }
    const consumed = Math.floor(this.nextPosition)
    this.tail = merged.slice(consumed)
    this.nextPosition -= consumed
    return Float32Array.from(values)
  }
}

/** Cut a stream of samples into fixed 200 ms frames, keeping the remainder for the next call. */
export class FrameAssembler {
  private remainder: Float32Array = new Float32Array(0)

  constructor(private readonly frameSamples: number = FRAME_SAMPLES) {}

  push(samples: Float32Array): Float32Array[] {
    const merged = concat(this.remainder, samples)
    const count = Math.floor(merged.length / this.frameSamples)
    const frames: Float32Array[] = []
    for (let index = 0; index < count; index += 1) {
      frames.push(merged.slice(index * this.frameSamples, (index + 1) * this.frameSamples))
    }
    this.remainder = merged.slice(count * this.frameSamples)
    return frames
  }

  flush(): Float32Array | null {
    if (this.remainder.length === 0) return null
    const padded = new Float32Array(this.frameSamples)
    padded.set(this.remainder)
    this.remainder = new Float32Array(0)
    return padded
  }
}

/** Root mean square of a frame - used for the audio level meter. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

/** Scale a frame, used to keep captured audio from clipping (05-audio-capture §8). */
export function scale(samples: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) out[index] = samples[index] * factor
  return out
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const out = new Float32Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
