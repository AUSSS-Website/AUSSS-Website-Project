// The website guide as a book: reads docs/guide/guide.json, the chapters in
// docs/guide/chapters/ and the pictures scripts/guide/shots.mjs took, and
// prints docs/guide/out/AUSSS-website-guide.pdf (docs/guide/README.md).
//
//   npm run guide:build                     the PDF, and what the checks found
//   npm run guide:build -- --sheets         also out/preview/sheet-NN.png: every page, small
//   npm run guide:build -- --pages 1,2,9    also out/preview/page-NNN.png of those pages
//   npm run guide:build -- --html           stop at out/guide.html, to read in a browser
//
// A chapter is a Markdown file with a few lines of front matter:
//
//   ---
//   title: The home page
//   part: 2
//   roles: visitor
//   routes: /
//   ---
//
// In its text, `##` opens a section and `###` a smaller one, a line that is
// only `![](shot:home-hero)` places that picture with the caption the manifest
// gives it (words between the brackets replace the caption), a line that
// starts `TODO:` is a section still to be written, and a quotation that starts
// `Note:` or `Careful:` becomes a box.
//
// The contents page needs each chapter's page number, which only the printed
// PDF knows. So the book is printed twice: once to read the numbers out of the
// PDF's own bookmarks, and again with them filled in.
import fs from 'node:fs/promises'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { Marked } from 'marked'
import { inspect, renderPages, renderSheets } from './lib/pdf.mjs'

const GUIDE = 'docs/guide'
const OUT = path.join(GUIDE, 'out')
const FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600&display=swap'

function parseArgs(argv) {
  const opts = { sheets: false, pages: [], html: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--sheets') opts.sheets = true
    else if (arg === '--html') opts.html = true
    else if (arg === '--pages') opts.pages = String(argv[++i] || '').split(',').map(Number).filter((n) => n > 0)
    else throw new Error(`unknown option ${arg}`)
  }
  return opts
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
// The site writes its apostrophes and quotation marks curled. Applied to the
// words of a page only: not inside a tag, and not inside code.
function curl(html) {
  let inCode = 0
  return html
    .split(/(<[^>]+>)/)
    .map((piece) => {
      if (piece.startsWith('<')) {
        if (/^<(code|pre)\b/i.test(piece)) inCode++
        else if (/^<\/(code|pre)>/i.test(piece)) inCode = Math.max(0, inCode - 1)
        return piece
      }
      if (inCode) return piece
      return piece
        .replace(/(&quot;|")(?=[\w(\[{])/g, '“')
        .replace(/&quot;|"/g, '”')
        .replace(/(^|[\s(\[{“])(&#39;|')(?=\w)/g, '$1‘')
        .replace(/&#39;|'/g, '’')
    })
    .join('')
}
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const squash = (s) => s.replace(/\s+/g, '')
const list = (value) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [])

async function readChapters() {
  const dir = path.join(GUIDE, 'chapters')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  const chapters = []
  for (const file of files) {
    const text = await fs.readFile(path.join(dir, file), 'utf8')
    const found = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!found) throw new Error(`${file}: no front matter`)
    const meta = {}
    for (const line of found[1].split(/\r?\n/)) {
      const at = line.indexOf(':')
      if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
    if (!meta.title || !meta.part) throw new Error(`${file}: the front matter needs a title and a part`)
    chapters.push({ file, slug: file.replace(/\.md$/, ''), title: meta.title, part: meta.part, roles: list(meta.roles), routes: list(meta.routes), body: found[2] })
  }
  return chapters
}

// What is wrong with the chapters before anything is printed. `errors` stop
// the build; `warnings` are printed and it goes on.
function lint(chapters, guide, shots, taken) {
  const errors = []
  const warnings = []
  const used = new Map()
  const known = new Map(shots.map((s) => [s.id, s]))
  const parts = new Set(guide.parts.map((p) => p.id))
  for (const ch of chapters) {
    if (!parts.has(ch.part)) errors.push(`${ch.file}: part ${ch.part} is not in guide.json`)
    for (const role of ch.roles) if (!guide.roles[role]) errors.push(`${ch.file}: role "${role}" is not in guide.json`)
    ch.body.split(/\r?\n/).forEach((line, i) => {
      const at = `${ch.file}:${i + 1}`
      if (line.includes('—')) errors.push(`${at}: an em-dash; the site's copy has none`)
      if (/^#\s/.test(line)) errors.push(`${at}: a chapter's title is in its front matter; sections start at ##`)
      const shot = line.match(/^!\[.*\]\(shot:([^)]+)\)\s*$/)?.[1]
      if (shot) {
        if (!known.has(shot)) errors.push(`${at}: no shot called ${shot} in the manifest`)
        else if (known.get(shot).skip) warnings.push(`${at}: ${shot} is skipped in the manifest (${known.get(shot).skip})`)
        else if (!taken[shot]) warnings.push(`${at}: ${shot} has not been taken yet (npm run guide:shots -- --only ${shot})`)
        if (used.has(shot)) warnings.push(`${at}: ${shot} is also in ${used.get(shot)}`)
        used.set(shot, ch.file)
      } else if (/\(shot:/.test(line)) errors.push(`${at}: a picture goes on a line of its own`)
      if (/\b\w+(ize|izes|ized|izing|ization)\b/i.test(line) && !/\b(size|sizes|sized|sizing|prize|seize|capsize)\b/i.test(line)) {
        warnings.push(`${at}: an -ize spelling; the site writes -ise`)
      }
    })
  }
  for (const s of shots) if (!used.has(s.id) && !s.skip) warnings.push(`manifest: no chapter shows ${s.id}`)
  return { errors, warnings }
}

function renderChapter(ch, ctx) {
  let figures = 0
  let todos = 0
  const figure = (id, words) => {
    const shot = ctx.shots.get(id)
    const got = ctx.taken[id]
    const caption = words || shot?.caption || ''
    const kind = [shot?.viewport === 'mobile' ? 'mobile' : '', got && got.width < 700 && shot?.viewport !== 'mobile' ? 'narrow' : ''].filter(Boolean).join(' ')
    const picture = got
      ? `<img src="${escapeHtml(got.file)}" alt="${escapeHtml(caption)}" width="${got.width}" height="${got.height}">`
      : `<div class="missing">The picture <code>${escapeHtml(id)}</code> has not been taken.</div>`
    if (!got) ctx.missing.push(id)
    figures++
    return `<figure class="${kind}">${picture}<figcaption><b>Figure ${ch.n}.${figures}</b>${ctx.inline(caption)}</figcaption></figure>`
  }
  // Pictures and unwritten sections become HTML of their own before Markdown
  // sees them, so neither ends up inside a paragraph.
  const source = ch.body
    .split(/\r?\n/)
    .map((line) => {
      const shot = line.match(/^!\[(.*)\]\(shot:([^)]+)\)\s*$/)
      if (shot) return `\n${figure(shot[2], shot[1])}\n`
      const todo = line.match(/^TODO:\s*(.+)$/)
      if (todo) {
        todos++
        return `\n<p class="todo">${ctx.inline(todo[1])}</p>\n`
      }
      return line
    })
    .join('\n')

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        const level = Math.min(depth + 1, 4)
        ctx.headings.push({ id: null, level, text: plain(curl(html)) })
        return `<h${level} id="${ch.slug}--${slugify(plain(html))}">${html}</h${level}>\n`
      },
    },
  })
  const body = marked
    .parse(source)
    .replace(/<blockquote>\s*<p>Note:/g, '<blockquote class="note"><p><strong>Note.</strong>')
    .replace(/<blockquote>\s*<p>Careful:/g, '<blockquote class="careful"><p><strong>Careful.</strong>')
  return { body: curl(body), figures, todos }
}

function assemble(guide, chapters, ctx, css) {
  const text = (s) => curl(escapeHtml(s))
  const inlineMarked = new Marked()
  ctx.inline = (text) => inlineMarked.parseInline(text)
  const out = []
  const toc = []
  let number = 0
  let letter = 0
  let todos = 0
  let figures = 0

  for (const part of guide.parts) {
    const own = chapters.filter((c) => c.part === part.id)
    if (own.length === 0) continue
    const lettered = !/^\d+$/.test(part.id)
    for (const ch of own) ch.n = lettered ? String.fromCharCode(65 + letter++) : String(++number)
    const kicker = lettered ? part.title : `Part ${part.id}`
    const name = lettered ? part.title : `Part ${part.id}: ${part.title}`
    toc.push(`<div class="toc-part">${text(name)}</div>`)
    // The part's page is a heading too, so it is in the PDF's bookmarks.
    ctx.headings.push({ id: `part-${part.id}`, level: 1, text: plain(text(part.title)) })
    out.push(
      `<section class="part"><div class="kicker">${escapeHtml(kicker)}</div>` +
        `<h1 id="part-${part.id}">${text(part.title)}</h1>` +
        `<p class="blurb">${text(part.blurb)}</p>` +
        `<ol>${own.map((c) => `<li><span class="n">${c.n}</span><span>${text(c.title)}</span></li>`).join('')}</ol></section>`,
    )
    for (const ch of own) {
      const id = `ch-${ch.slug}`
      ctx.headings.push({ id, level: 2, text: plain(text(`${ch.n} ${ch.title}`)) })
      const made = renderChapter(ch, ctx)
      todos += made.todos
      figures += made.figures
      const chips = ch.roles.map((r) => `<span class="chip">${escapeHtml(guide.roles[r])}</span>`).join('')
      const where = ch.routes.length ? `<span class="where">${ch.routes.map(escapeHtml).join(' &nbsp; ')}</span>` : ''
      out.push(
        `<section class="chapter"><h2 id="${id}"><span class="n">${ch.n}</span>${text(ch.title)}</h2>` +
          `<div class="meta">${chips}${where}</div>${made.body}</section>`,
      )
      toc.push(
        `<div class="toc-row"><span class="n">${ch.n}</span><a href="#${id}">${text(ch.title)}</a><span class="dots"></span><span class="pg" data-for="${id}"></span></div>`,
      )
    }
  }

  let version = ''
  try {
    version = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    // Not a checkout: the cover carries the date alone.
  }
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const edition =
    (todos ? `<b>Draft.</b> ${todos} sections are still to be written. ` : '') +
    `${escapeHtml(date)}${version ? `, from version ${version} of the site` : ''}.`

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${escapeHtml(guide.title)}</title>
<link rel="stylesheet" href="${FONTS}">
<style>${css}</style>
</head>
<body>
<section class="cover">
  <img src="../../../public/assets/brand/ausss-vertical-white.png" alt="">
  <div class="rule"></div>
  <div class="title">${text(guide.title)}</div>
  <div class="subtitle">${text(guide.subtitle)}</div>
  <div class="edition">${edition}</div>
</section>
<section class="contents"><h1 id="contents">Contents</h1>
${toc.join('\n')}
</section>
${out.join('\n')}
</body>
</html>
`
  // "Contents" is the first heading on the page.
  ctx.headings.unshift({ id: 'contents', level: 1, text: 'Contents' })
  return { html, todos, figures, chapters: number + letter }
}

async function print(file, pdfFile, numbers) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(path.resolve(file)).href, { waitUntil: 'networkidle' })
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))))
      return { serif: document.fonts.check('600 12pt "Cormorant Garamond"'), sans: document.fonts.check('400 12pt Inter') }
    })
    if (numbers) {
      await page.evaluate((map) => {
        for (const slot of document.querySelectorAll('.pg[data-for]')) slot.textContent = map[slot.dataset.for] ?? ''
      }, numbers)
    }
    await page.pdf({ path: pdfFile, printBackground: true, preferCSSPageSize: true, outline: true, tagged: true })
    return fonts
  } finally {
    await browser.close()
  }
}

// Each heading's page, from the PDF's bookmarks. The bookmarks and the
// headings this script wrote are the same list in the same order; if they ever
// are not, the chapters are found by their words alone.
function pagesOf(headings, outline) {
  const numbers = {}
  const same = outline.length === headings.length && outline.every((o, i) => squash(o.title) === squash(headings[i].text))
  if (same) {
    headings.forEach((h, i) => {
      if (h.id) numbers[h.id] = outline[i].page
    })
    return { numbers, same }
  }
  for (const h of headings.filter((x) => x.id)) {
    const hit = outline.find((o) => squash(o.title) === squash(h.text))
    if (hit) numbers[h.id] = hit.page
  }
  return { numbers, same }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const guide = JSON.parse(await fs.readFile(path.join(GUIDE, 'guide.json'), 'utf8'))
  const { shots } = await import(pathToFileURL(path.resolve(GUIDE, 'shots.manifest.mjs')).href)
  const taken = JSON.parse(await fs.readFile(path.join(OUT, 'shots.json'), 'utf8').catch(() => '{}'))
  const css = await fs.readFile(path.join(GUIDE, 'theme', 'print.css'), 'utf8')
  const chapters = await readChapters()

  const { errors, warnings } = lint(chapters, guide, shots, taken)
  for (const w of warnings) console.log(`  note: ${w}`)
  if (errors.length) {
    for (const e of errors) console.error(`  ${e}`)
    throw new Error(`${errors.length} things to put right in the chapters`)
  }

  const ctx = { shots: new Map(shots.map((s) => [s.id, s])), taken, headings: [], missing: [] }
  const book = assemble(guide, chapters, ctx, css)
  await fs.mkdir(OUT, { recursive: true })
  const htmlFile = path.join(OUT, 'guide.html')
  await fs.writeFile(htmlFile, book.html)
  console.log(`guide: ${book.chapters} chapters, ${book.figures} figures (${ctx.missing.length} not taken yet), ${book.todos} sections to be written`)
  if (opts.html) return console.log(`guide: ${htmlFile}`)

  const pdfFile = path.join(OUT, guide.file)
  const fonts = await print(htmlFile, pdfFile)
  if (!fonts.serif || !fonts.sans) console.log('  note: the fonts did not load from Google Fonts (no network?), so the book is set in the fallbacks')
  const first = await inspect(pdfFile)
  const { numbers, same } = pagesOf(ctx.headings, first.outline)
  if (!same) console.log(`  note: the PDF has ${first.outline.length} bookmarks for ${ctx.headings.length} headings; page numbers were matched by title`)
  const unplaced = chapters.filter((c) => !numbers[`ch-${c.slug}`]).map((c) => c.file)
  if (unplaced.length) throw new Error(`no page found for ${unplaced.join(', ')}`)

  await print(htmlFile, pdfFile, numbers)
  const second = await inspect(pdfFile)
  if (second.pages !== first.pages) throw new Error(`the page count changed between the two printings (${first.pages}, then ${second.pages})`)
  const moved = pagesOf(ctx.headings, second.outline).numbers
  const drift = Object.keys(numbers).filter((id) => moved[id] !== numbers[id])
  if (drift.length) throw new Error(`these moved between the two printings: ${drift.join(', ')}`)

  const size = (await fs.stat(pdfFile)).size
  console.log(`guide: ${second.pages} pages, ${(size / 1048576).toFixed(1)} MB, ${pdfFile}`)

  if (opts.sheets || opts.pages.length) {
    const dir = path.join(OUT, 'preview')
    await fs.rm(dir, { recursive: true, force: true })
    await fs.mkdir(dir, { recursive: true })
    if (opts.pages.length) console.log(`guide: ${(await renderPages(pdfFile, opts.pages, dir)).length} pages drawn in ${dir}`)
    if (opts.sheets) console.log(`guide: ${(await renderSheets(pdfFile, dir)).length} sheets drawn in ${dir}`)
  }
}

main().catch((err) => {
  console.error('guide build failed:', err.message)
  process.exit(1)
})
