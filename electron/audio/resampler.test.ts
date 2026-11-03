import { describe, expect, it } from 'vitest'
import { AudioResampler, FrameAssembler, downmixToMono, rms, scale } from './resampler'

describe('AudioResampler', () => {
  it('halves the sample count for an integer ratio', () => {
    const resampler = new AudioResampler(32_000, 16_000)
    const input = new Float32Array(64).fill(0.5)
    const output = resampler.process(input)
    expect(output.length).toBe(32)
    expect(output[0]).toBeCloseTo(0.5, 5)
  })

  it('keeps the leftover samples for the next chunk', () => {
    const resampler = new AudioResampler(48_000, 16_000)
    const first = resampler.process(new Float32Array(10).fill(1))
    expect(first.length).toBe(3) // 9 samples consumed, 1 kept
    const second = resampler.process(new Float32Array(8).fill(1))
    expect(second.length).toBe(3) // 1 kept + 8 new = 9 samples -> 3 outputs
  })

  it('averages the source samples of each output sample (box filter)', () => {
    const resampler = new AudioResampler(48_000, 16_000)
    const input = Float32Array.from([0, 3, 0, 0, 0, 0])
    const output = resampler.process(input)
    expect(output.length).toBe(2)
    expect(output[0]).toBeCloseTo(1, 5)
    expect(output[1]).toBeCloseTo(0, 5)
  })

  it('supports a non integer ratio with linear interpolation', () => {
    const resampler = new AudioResampler(44_100, 16_000)
    const output = resampler.process(new Float32Array(441).fill(1))
    expect(output.length).toBeGreaterThan(150)
    expect(output[0]).toBeCloseTo(1, 5)
  })
})

describe('FrameAssembler', () => {
  it('cuts the stream into 200 ms frames', () => {
    const assembler = new FrameAssembler(3200)
    const frames = assembler.push(new Float32Array(3200 * 2 + 100))
    expect(frames.length).toBe(2)
    expect(frames[0].length).toBe(3200)
    expect(frames[1].length).toBe(3200)
  })

  it('keeps the remainder for the next call', () => {
    const assembler = new FrameAssembler(3200)
    expect(assembler.push(new Float32Array(1000)).length).toBe(0)
    const frames = assembler.push(new Float32Array(2400))
    expect(frames.length).toBe(1)
  })

  it('flushes a padded last frame', () => {
    const assembler = new FrameAssembler(3200)
    assembler.push(new Float32Array(100))
    const flushed = assembler.flush()
    expect(flushed?.length).toBe(3200)
    expect(assembler.flush()).toBeNull()
  })
})

describe('helpers', () => {
  it('downmixes stereo to mono', () => {
    const left = Float32Array.from([1, 1, 1])
    const right = Float32Array.from([0, 0, 0])
    const mono = downmixToMono([left, right])
    expect(mono.length).toBe(3)
    expect(mono[0]).toBeCloseTo(0.5, 5)
  })

  it('computes rms and scales samples', () => {
    expect(rms(Float32Array.from([1, -1]))).toBeCloseTo(1, 5)
    expect(rms(new Float32Array(0))).toBe(0)
    expect(scale(Float32Array.from([1, 2]), 0.9)[1]).toBeCloseTo(1.8, 5)
  })
})
