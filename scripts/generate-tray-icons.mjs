#!/usr/bin/env node
/**
 * Generates the monochrome template tray icons so no binary assets are committed from
 * third-party sources (04b §1: redraw icons ourselves).
 *
 * Output: resources/icons/trayTemplate.png, trayTemplate@2x.png and the active variants.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const outputDir = join(here, '..', 'resources', 'icons')

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(size, pixels) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Rounded pill matching the island silhouette, 4x supersampled. */
function drawPill(size, alpha) {
  const pixels = Buffer.alloc(size * size * 4)
  const supersample = 4
  const left = size * 0.06
  const right = size * 0.94
  const top = size * 0.34
  const bottom = size * 0.66
  const radius = (bottom - top) / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const px = x + (sx + 0.5) / supersample
          const py = y + (sy + 0.5) / supersample
          const nearestX = Math.max(left + radius, Math.min(px, right - radius))
          const nearestY = Math.max(top + radius, Math.min(py, bottom - radius))
          const dx = px - nearestX
          const dy = py - nearestY
          if (dx * dx + dy * dy <= radius * radius && px >= left && px <= right) hits += 1
        }
      }
      const coverage = hits / (supersample * supersample)
      const offset = (y * size + x) * 4
      pixels[offset] = 0
      pixels[offset + 1] = 0
      pixels[offset + 2] = 0
      pixels[offset + 3] = Math.round(coverage * alpha * 255)
    }
  }
  return encodePng(size, pixels)
}

mkdirSync(outputDir, { recursive: true })

const icons = [
  ['trayTemplate.png', 16, 0.6],
  ['trayTemplate@2x.png', 32, 0.6],
  ['trayActiveTemplate.png', 16, 1],
  ['trayActiveTemplate@2x.png', 32, 1]
]

for (const [name, size, alpha] of icons) {
  writeFileSync(join(outputDir, name), drawPill(size, alpha))
  console.log(`wrote resources/icons/${name}`)
}
