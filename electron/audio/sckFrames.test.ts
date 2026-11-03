import { describe, expect, it } from 'vitest'
import { parseFrames, pcmToMono, type PcmInfo } from './sckFrames'

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write('FSPK', 0, 'ascii')
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

describe('parseFrames', () => {
  it('reads the info frame and the pcm frames', () => {
    const info = Buffer.from(JSON.stringify({ type: 'info', sampleRate: 48000, channels: 2, format: 'f32le', interleaved: true }))
    const pcm = Buffer.from([1, 2, 3, 4])
    const result = parseFrames(Buffer.concat([frame(info), frame(pcm)]))
    expect(result.frames.length).toBe(2)
    expect(result.frames[0].info?.sampleRate).toBe(48_000)
    expect(result.frames[1].pcm?.length).toBe(4)
    expect(result.rest.length).toBe(0)
  })

  it('keeps incomplete frames for the next chunk', () => {
    const complete = frame(Buffer.from([1, 2, 3, 4]))
    const partial = frame(Buffer.from([9, 9])).subarray(0, 6)
    const result = parseFrames(Buffer.concat([complete, partial]))
    expect(result.frames.length).toBe(1)
    expect(result.rest.length).toBe(6)
  })

  it('resynchronises after garbage', () => {
    const garbage = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    const result = parseFrames(Buffer.concat([garbage, frame(Buffer.from([1]))]))
    expect(result.frames.length).toBe(1)
  })
})

describe('pcmToMono', () => {
  const info: PcmInfo = { type: 'info', sampleRate: 48_000, channels: 2, format: 'f32le', interleaved: true }

  it('averages interleaved stereo float samples', () => {
    const pcm = Buffer.alloc(16)
    pcm.writeFloatLE(1, 0)
    pcm.writeFloatLE(0, 4)
    pcm.writeFloatLE(0.5, 8)
    pcm.writeFloatLE(0.5, 12)
    const mono = pcmToMono(pcm, info)
    expect(mono.length).toBe(2)
    expect(mono[0]).toBeCloseTo(0.5, 5)
    expect(mono[1]).toBeCloseTo(0.5, 5)
  })

  it('handles split (non interleaved) channels', () => {
    const pcm = Buffer.alloc(16)
    pcm.writeFloatLE(1, 0)
    pcm.writeFloatLE(3, 4)
    pcm.writeFloatLE(0, 8)
    pcm.writeFloatLE(0, 12)
    const mono = pcmToMono(pcm, { ...info, interleaved: false })
    expect(mono.length).toBe(2)
    expect(mono[0]).toBeCloseTo(0.5, 5)
    expect(mono[1]).toBeCloseTo(1.5, 5)
  })

  it('converts 16 bit samples', () => {
    const pcm = Buffer.alloc(8)
    pcm.writeInt16LE(32767, 0)
    pcm.writeInt16LE(-32768, 2)
    pcm.writeInt16LE(0, 4)
    pcm.writeInt16LE(0, 6)
    const mono = pcmToMono(pcm, { ...info, format: 's16le' })
    expect(mono.length).toBe(2)
    expect(mono[0]).toBeCloseTo(0, 2)
    expect(mono[1]).toBeCloseTo(0, 5)
  })
})
