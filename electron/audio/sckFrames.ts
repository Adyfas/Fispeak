/**
 * Parser for the ScreenCaptureKit helper stream (native/sck-capture).
 *
 * Wire format: "FSPK" | uint32 little endian length | payload.
 * The first payload is a JSON info frame, every following one is raw PCM.
 */

const MAGIC = Buffer.from('FSPK', 'ascii')
const HEADER_SIZE = MAGIC.length + 4

export interface PcmInfo {
  type: 'info'
  sampleRate: number
  channels: number
  format: 'f32le' | 's16le'
  interleaved: boolean
}

export interface SckFrame {
  info?: PcmInfo
  pcm?: Buffer
  ready?: Record<string, unknown>
  error?: { code: string; message: string }
  /** Any other JSON control frame (diagnostics). Never audio. */
  stats?: Record<string, unknown>
}

export interface ParseResult {
  frames: SckFrame[]
  rest: Buffer
}

/** Split the helper output into frames. Incomplete trailing data stays in `rest`. */
export function parseFrames(buffer: Buffer): ParseResult {
  const frames: SckFrame[] = []
  let offset = 0

  while (buffer.length - offset >= HEADER_SIZE) {
    if (!buffer.subarray(offset, offset + MAGIC.length).equals(MAGIC)) {
      // Resynchronise: skip to the next magic marker.
      const next = buffer.indexOf(MAGIC, offset + 1)
      if (next === -1) {
        offset = buffer.length - (MAGIC.length - 1)
        break
      }
      offset = next
      continue
    }

    const length = buffer.readUInt32LE(offset + MAGIC.length)
    const start = offset + HEADER_SIZE
    const end = start + length
    if (buffer.length < end) break

    const payload = buffer.subarray(start, end)
    const frame = decodePayload(payload)
    if (frame) frames.push(frame)
    offset = end
  }

  return { frames, rest: buffer.subarray(offset) }
}

function decodePayload(payload: Buffer): SckFrame | null {
  if (payload.length === 0) return null
  // Control frames are JSON objects; audio frames are raw PCM. A PCM frame whose first Float32
  // sample happens to be 0x7b cannot be valid JSON, so the parse below rejects it.
  const first = payload[0]
  if (first === 0x7b || first === 0x5b) {
    try {
      const parsed = JSON.parse(payload.toString('utf8')) as PcmInfo & {
        type?: string
        code?: string
        message?: string
      }
      if (parsed.type === 'info') return { info: parsed }
      if (parsed.type === 'ready') return { ready: { ...parsed } as unknown as Record<string, unknown> }
      if (parsed.type === 'error') {
        return { error: { code: parsed.code ?? 'unknown', message: parsed.message ?? '' } }
      }
      // Unknown control frame: never let it reach the PCM path (that would inject noise).
      return { stats: { ...parsed } as unknown as Record<string, unknown> }
    } catch {
      return { pcm: Buffer.from(payload) }
    }
  }
  return { pcm: Buffer.from(payload) }
}

/**
 * Convert raw PCM to mono Float32. Handles interleaved and split (non-interleaved) layouts
 * for 32 bit float and 16 bit integer samples.
 */
export function pcmToMono(pcm: Buffer, info: PcmInfo): Float32Array {
  const channels = Math.max(1, info.channels)
  const bytesPerSample = info.format === 'f32le' ? 4 : 2
  const totalSamples = Math.floor(pcm.length / bytesPerSample)
  if (totalSamples === 0) return new Float32Array(0)

  const read = (index: number): number => {
    if (info.format === 'f32le') return pcm.readFloatLE(index * 4)
    return pcm.readInt16LE(index * 2) / 32768
  }

  if (info.interleaved) {
    const frames = Math.floor(totalSamples / channels)
    const out = new Float32Array(frames)
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0
      for (let channel = 0; channel < channels; channel += 1) sum += read(frame * channels + channel)
      out[frame] = sum / channels
    }
    return out
  }

  // Non-interleaved: the channels are stored one after the other.
  const frames = Math.floor(totalSamples / channels)
  const out = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0
    for (let channel = 0; channel < channels; channel += 1) sum += read(channel * frames + frame)
    out[frame] = sum / channels
  }
  return out
}
