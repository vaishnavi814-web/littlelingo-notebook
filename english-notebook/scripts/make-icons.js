// Generates the PNG app icons required by the web app manifest.
// Usage: node scripts/make-icons.js  (run from the repo root)
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const publicDir = path.resolve('client/public')
const sizes = [192, 512]

const BACKGROUND = [0xfc, 0xfa, 0xf7]
const INK = [0x86, 0x3b, 0xff]

// A rounded, slightly "notebook page" glyph drawn with signed distance fields.
function sample(x, y, size) {
  const u = x / size
  const v = y / size

  // Page body: rounded rectangle with a small margin.
  const m = 0.12
  const r = 0.08
  const dx = Math.abs(u - 0.5) - (0.5 - m - r)
  const dy = Math.abs(v - 0.5) - (0.5 - m - r)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r
  const inPage = outside < 0

  // Ruled lines across the page.
  const lineGap = 0.115
  const inRuledArea = u > 0.24 && u < 0.80 && v > 0.28 && v < 0.74
  const onLine = Math.abs(((v - 0.28) % lineGap) - lineGap / 2) < 0.018

  // Purple binding strip down the left edge.
  const onSpine = u > 0.15 && u < 0.235 && v > 0.2 && v < 0.8

  if (onSpine) return INK
  if (inPage && inRuledArea && onLine) return INK
  return BACKGROUND
}

function makePng(size) {
  const stride = size * 3 + 1
  const raw = Buffer.alloc(stride * size)

  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0 // filter type: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = sample(x + 0.5, y + 0.5, size)
      const offset = y * stride + 1 + x * 3
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
    }
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0)
    return Buffer.concat([length, typeAndData, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let table
function crc32(buffer) {
  if (!table) {
    table = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff]
  return crc ^ -1
}

sizes.forEach((size) => {
  const file = path.join(publicDir, `icon-${size}.png`)
  fs.writeFileSync(file, makePng(size))
  console.log(`wrote ${path.relative(process.cwd(), file)}`)
})

const maskable = makePng(512)
fs.writeFileSync(path.join(publicDir, 'icon-512-maskable.png'), maskable)
console.log('wrote client/public/icon-512-maskable.png')
