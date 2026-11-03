#!/usr/bin/env node
/**
 * Generates the monochrome template menu bar icons from the owner's cloud logo
 * (`public/icon/FISPEAK.png`), so no third-party binary assets are committed and the
 * tray always matches the app icon.
 *
 * The mask is the cloud body only: the purple pixels. The eyes are white pupils ringed
 * by black, so they fall out of the purple test and become transparent holes - which is
 * what makes the shape readable as "the fispeak cloud" at 22 px.
 *
 * Output: resources/icons/trayTemplate.png, trayTemplate@2x.png and the active variants
 * (active = fully opaque, idle = slightly dimmed, same convention as before).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outputDir = join(root, 'resources', 'icons')
const sourcePath = join(root, 'public', 'icon', 'FISPEAK.png')

/** Menu bar artwork box in points; @2x gets twice that. */
const CANVAS = 22

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

/** Minimal PNG reader: 8-bit RGBA, no interlacing (what the design export uses). */
function readRgbaPng(path) {
  const buffer = readFileSync(path)
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, type ${colorType}, interlace ${interlace})`)
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  let position = 0

  for (let y = 0; y < height; y += 1) {
    const filter = raw[position]
    position += 1
    const row = raw.subarray(position, position + stride)
    position += stride
    const previous = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride)
    const current = pixels.subarray(y * stride, (y + 1) * stride)

    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? current[index - 4] : 0
      const above = previous ? previous[index] : 0
      const corner = index >= 4 && previous ? previous[index - 4] : 0
      let value = row[index]
      if (filter === 1) value += left
      else if (filter === 2) value += above
      else if (filter === 3) value += (left + above) >> 1
      else if (filter === 4) {
        const estimate = left + above - corner
        const pa = Math.abs(estimate - left)
        const pb = Math.abs(estimate - above)
        const pc = Math.abs(estimate - corner)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? above : corner
      }
      current[index] = value & 0xff
    }
  }

  return { width, height, pixels }
}

/** Cloud coverage (0..1) plus the tight bounding box of the shape. */
function readCloudMask(path) {
  const { width, height, pixels } = readRgbaPng(path)
  const coverage = new Float32Array(width * height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      const a = pixels[index + 3]
      // Cloud body is flat #8817EF; the white eyes and black pupils fail this test and
      // therefore punch straight through the silhouette.
      if (a > 0 && b > 110 && g < 120 && r > 50 && b > g + 60) {
        coverage[y * width + x] = a / 255
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  return { width, height, coverage, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } }
}

/** Area-average the cloud mask down to the requested width, keeping its aspect ratio. */
function resizeMask(mask, targetWidth) {
  const { coverage, width, box } = mask
  const scale = box.width / targetWidth
  const targetHeight = Math.max(1, Math.round(box.height / scale))
  const out = new Float32Array(targetWidth * targetHeight)

  for (let y = 0; y < targetHeight; y += 1) {
    const startY = box.y + Math.floor(y * scale)
    const endY = Math.min(box.y + box.height, box.y + Math.ceil((y + 1) * scale))
    for (let x = 0; x < targetWidth; x += 1) {
      const startX = box.x + Math.floor(x * scale)
      const endX = Math.min(box.x + box.width, box.x + Math.ceil((x + 1) * scale))
      let sum = 0
      let count = 0
      for (let sy = startY; sy < endY; sy += 1) {
        for (let sx = startX; sx < endX; sx += 1) {
          sum += coverage[sy * width + sx]
          count += 1
        }
      }
      out[y * targetWidth + x] = count === 0 ? 0 : sum / count
    }
  }

  return { pixels: out, width: targetWidth, height: targetHeight }
}

/** Draw the cloud centred in a square template canvas, then dim it for the idle state. */
function renderIcon(mask, canvas, alpha) {
  const scaled = resizeMask(mask, canvas)
  const pixels = Buffer.alloc(canvas * canvas * 4)
  const left = Math.floor((canvas - scaled.width) / 2)
  const top = Math.floor((canvas - scaled.height) / 2)

  for (let y = 0; y < scaled.height; y += 1) {
    for (let x = 0; x < scaled.width; x += 1) {
      const value = scaled.pixels[y * scaled.width + x]
      const offset = ((top + y) * canvas + left + x) * 4
      pixels[offset] = 0
      pixels[offset + 1] = 0
      pixels[offset + 2] = 0
      pixels[offset + 3] = Math.round(value * alpha * 255)
    }
  }

  return encodePng(canvas, pixels)
}

const mask = readCloudMask(sourcePath)
mkdirSync(outputDir, { recursive: true })

const icons = [
  ['trayTemplate.png', CANVAS, 0.7],
  ['trayTemplate@2x.png', CANVAS * 2, 0.7],
  ['trayActiveTemplate.png', CANVAS, 1],
  ['trayActiveTemplate@2x.png', CANVAS * 2, 1]
]

for (const [name, size, alpha] of icons) {
  writeFileSync(join(outputDir, name), renderIcon(mask, size, alpha))
  console.log(`wrote resources/icons/${name}`)
}
