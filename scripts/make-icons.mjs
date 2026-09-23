// Builds the favicon set from the brand mark. Run once after the logo changes:
//   node scripts/make-icons.mjs
//
// Google shows a site's icon next to its search results only if the icon is
// a square whose side is a multiple of 48 px, reachable at a stable URL and
// declared with <link rel="icon">; most crawlers also try /favicon.ico. The
// old single 128 px PNG met none of that. Output: public/favicon.ico (16, 32,
// 48 px), public/icons/icon-{48,96,144,192,512}.png and the 180 px Apple touch
// icon, all the same white mark on the brand green, square (Google and the
// OS apply their own corner shape).
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const SRC = path.join(root, 'public/assets/brand/ausss-icon-white.png')
const OUT = path.join(root, 'public/icons')
const GREEN = { r: 6, g: 64, b: 43, alpha: 1 } // #06402b, the tile behind the mark

async function tile(size) {
  // The mark fills ~80% of the tile's height, centred, as on the old favicon.
  const markH = Math.round(size * 0.8)
  const mark = await sharp(SRC).resize({ height: markH, fit: 'inside' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: GREEN } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer()
}

// ICO container holding PNG-encoded images (supported by every browser and
// by Google's favicon fetcher).
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  const blobs = []
  let offset = 6 + 16 * pngs.length
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    blobs.push(buf)
    offset += buf.length
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

await fs.mkdir(OUT, { recursive: true })
for (const size of [48, 96, 144, 192, 512]) {
  await fs.writeFile(path.join(OUT, `icon-${size}.png`), await tile(size))
}
await fs.writeFile(path.join(root, 'public/apple-touch-icon.png'), await tile(180))
await fs.writeFile(path.join(root, 'public/favicon.png'), await tile(96))
const icoPngs = []
for (const size of [16, 32, 48]) icoPngs.push({ size, buf: await tile(size) })
await fs.writeFile(path.join(root, 'public/favicon.ico'), ico(icoPngs))
console.log('icons written to public/icons, public/favicon.ico, public/favicon.png, public/apple-touch-icon.png')
