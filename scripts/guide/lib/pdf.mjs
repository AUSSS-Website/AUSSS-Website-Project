// Reading a printed PDF back: how many pages it has, where its bookmarks
// point, and pictures of its pages for checking the book without opening it.
// pdf.js does the reading (the same library the site's document reader uses)
// and draws on the canvas it brings for Node.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

async function open(file) {
  const data = new Uint8Array(await fs.readFile(file))
  const task = getDocument({ data, verbosity: 0 })
  const pdf = await task.promise
  // The document is closed through the task that opened it.
  pdf.close = () => task.destroy()
  return pdf
}

// The bookmarks in reading order, each with the page it opens.
export async function inspect(file) {
  const pdf = await open(file)
  const outline = []
  const walk = async (items, level) => {
    for (const item of items || []) {
      const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
      const page = dest ? (await pdf.getPageIndex(dest[0])) + 1 : null
      outline.push({ title: item.title, level, page })
      await walk(item.items, level + 1)
    }
  }
  await walk(await pdf.getOutline(), 1)
  const pages = pdf.numPages
  await pdf.close()
  return { pages, outline }
}

async function draw(pdf, number, scale) {
  const page = await pdf.getPage(number)
  const viewport = page.getViewport({ scale })
  const { canvas, context } = pdf.canvasFactory.create(viewport.width, viewport.height)
  await page.render({ canvasContext: context, viewport, canvas }).promise
  return canvas
}

// page-007.png and so on, large enough to read.
export async function renderPages(file, numbers, dir, scale = 1.4) {
  const pdf = await open(file)
  const made = []
  for (const n of numbers.filter((x) => x <= pdf.numPages)) {
    const out = path.join(dir, `page-${String(n).padStart(3, '0')}.png`)
    await fs.writeFile(out, (await draw(pdf, n, scale)).toBuffer('image/png'))
    made.push(out)
  }
  await pdf.close()
  return made
}

// Every page of the book, twelve to a sheet with its number under it: enough
// to see a figure in the wrong place, a page left half empty or a chapter that
// starts where it should not.
export async function renderSheets(file, dir, { columns = 4, rows = 3, scale = 0.42 } = {}) {
  const pdf = await open(file)
  const per = columns * rows
  const gap = 14
  const label = 18
  const made = []
  for (let start = 1; start <= pdf.numPages; start += per) {
    const pages = []
    for (let n = start; n < start + per && n <= pdf.numPages; n++) pages.push({ n, canvas: await draw(pdf, n, scale) })
    const w = pages[0].canvas.width
    const h = pages[0].canvas.height
    const sheet = createCanvas(columns * (w + gap) + gap, rows * (h + label + gap) + gap)
    const ctx = sheet.getContext('2d')
    ctx.fillStyle = '#5b6661'
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    ctx.font = '13px sans-serif'
    pages.forEach(({ n, canvas }, i) => {
      const x = gap + (i % columns) * (w + gap)
      const y = gap + Math.floor(i / columns) * (h + label + gap)
      ctx.drawImage(canvas, x, y)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(String(n), x + 2, y + h + 14)
    })
    const out = path.join(dir, `sheet-${String(made.length + 1).padStart(2, '0')}.png`)
    await fs.writeFile(out, sheet.toBuffer('image/png'))
    made.push(out)
  }
  await pdf.close()
  return made
}
