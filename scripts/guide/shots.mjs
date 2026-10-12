// The website guide's screenshots: opens the site at each entry of
// docs/guide/shots.manifest.mjs and saves one picture per entry to
// docs/guide/out/shots/, with what it took in docs/guide/out/shots.json
// (docs/guide/README.md).
//
//   npm run guide:shots                       every shot (needs npm run dev)
//   npm run guide:shots -- --only home,nav    the shots whose id starts with one of these
//   npm run guide:shots -- --list             the ids with their routes, and stop
//   npm run guide:shots -- --missing          only the shots not taken yet
//   npm run guide:shots -- --headed           watch it happen
//
// A shot is taken in one of two worlds. Public pages are opened as a visitor
// with the real data, behind the guard that holds back every write
// (scripts/walk-guard.mjs). Portal and exam pages are opened with the made-up
// session and sample rows of scripts/portal-sample.mjs, so that no real
// person is in a picture and nothing is signed in. A shot of a public page
// that needs made-up rows (events, an archived album) asks for `world: 'sample'`.
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { guardWrites } from '../walk-guard.mjs'
import { acts, installSample, presideOn } from '../portal-sample.mjs'

const MANIFEST = 'docs/guide/shots.manifest.mjs'
const OUT = 'docs/guide/out'
const SHOTS = path.join(OUT, 'shots')
const QUALITY = 84

// A laptop and a phone. The scale is what makes small text hold up in print.
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 },
  mobile: { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

function parseArgs(argv) {
  const opts = { base: 'http://localhost:5173', only: [], list: false, headed: false, missing: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }
    if (arg === '--only') opts.only = value().split(',').filter(Boolean)
    else if (arg === '--base') opts.base = value().replace(/\/$/, '')
    else if (arg === '--list') opts.list = true
    else if (arg === '--headed') opts.headed = true
    else if (arg === '--missing') opts.missing = true
    else throw new Error(`unknown option ${arg}`)
  }
  return opts
}

const worldOf = (shot) => shot.world || (/^\/(portal|exam)(\/|$|\?|#)/.test(shot.route) && shot.route !== '/portal/sign-in' ? 'sample' : 'live')

function check(shots) {
  const seen = new Set()
  for (const s of shots) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id || '')) throw new Error(`shot id "${s.id}" must be lower case words joined by hyphens`)
    if (seen.has(s.id)) throw new Error(`two shots are called ${s.id}`)
    seen.add(s.id)
    if (!s.route?.startsWith('/')) throw new Error(`${s.id}: route must start with /`)
    if (!s.caption) throw new Error(`${s.id}: no caption`)
    if (s.viewport && !VIEWPORTS[s.viewport]) throw new Error(`${s.id}: unknown viewport ${s.viewport}`)
  }
}

// A place on the page, as the manifest names it: 'section:Why choose us' is the
// innermost section or card that holds a heading with exactly those words,
// 'heading:Hand in' is the heading itself, anything else is a selector.
function locate(page, target) {
  if (target.startsWith('section:')) {
    const name = target.slice('section:'.length)
    return page.locator('section, article').filter({ has: page.getByRole('heading', { name, exact: true }) }).last()
  }
  if (target.startsWith('heading:')) return page.getByRole('heading', { name: target.slice('heading:'.length), exact: true }).first()
  return page.locator(target).first()
}

// Where a place sits on the whole page, in CSS pixels.
async function boxOf(page, target) {
  const found = locate(page, target)
  await found.waitFor({ state: 'visible', timeout: 8000 })
  return found.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }
  })
}

// Everything that loads late is on the page before the picture: fonts, the
// images further down (they load as they are scrolled to) and whatever the
// page fetched for them.
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    const step = Math.max(400, innerHeight)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 100))
    }
    scrollTo(0, 0)
  })
  // A page with an embed that keeps talking (the map in the footer) never goes
  // quiet, so this wait is short. And an image that is not drawn (the copy of a
  // card kept for the other screen size) never loads, so only drawn ones count.
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  await page
    .waitForFunction(() => [...document.images].every((img) => img.complete || img.getClientRects().length === 0), null, { timeout: 8000 })
    .catch(() => {})
}

// No blinking cursor, nothing mid-movement, no scrollbar in a picture.
const STILL = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
  ::-webkit-scrollbar { display: none !important; }
`

async function capture(page, shot, file) {
  const kind = shot.capture ?? 'content'
  const view = page.viewportSize()
  const shoot = (options) => page.screenshot({ path: file, type: 'jpeg', quality: QUALITY, ...options })

  if (kind === 'viewport') {
    await shoot({})
    return view
  }
  const page_ = await page.evaluate(() => {
    const footer = [...document.querySelectorAll('footer')].at(-1)
    return { height: document.documentElement.scrollHeight, footerTop: footer ? footer.getBoundingClientRect().top + scrollY : null }
  })
  // A bar fixed to the screen is drawn where the screen is. Typing in a field or
  // tapping a row scrolls the page, and the header would land in the middle of
  // the picture; from the top of the page it is where a reader expects it.
  await page.evaluate(() => scrollTo(0, 0))
  await page.waitForTimeout(150)
  const cap = shot.maxHeight ?? 1400
  let clip
  if (kind === 'content') {
    // The page from its top to where the footer begins, and never less than a screen.
    const height = Math.min(Math.max(page_.footerTop ?? page_.height, view.height), page_.height, cap)
    clip = { x: 0, y: 0, width: view.width, height }
  } else if (kind.el) {
    const pad = kind.pad ?? 16
    const box = await boxOf(page, kind.el)
    const x = Math.max(0, box.x - pad)
    const y = Math.max(0, box.y - pad)
    clip = { x, y, width: Math.min(view.width - x, box.width + pad * 2), height: Math.min(box.height + pad * 2, cap, page_.height - y) }
  } else if (kind.from !== undefined) {
    // A band across the page, from a place (or a number of pixels) down.
    const top = typeof kind.from === 'number' ? kind.from : (await boxOf(page, kind.from)).y - (kind.pad ?? 24)
    const y = Math.max(0, top)
    clip = { x: 0, y, width: view.width, height: Math.min(kind.height ?? view.height, page_.height - y) }
  } else {
    throw new Error(`unknown capture ${JSON.stringify(kind)}`)
  }
  clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) }
  if (clip.width < 40 || clip.height < 40) throw new Error(`nothing to capture (${clip.width} by ${clip.height})`)
  await shoot({ fullPage: true, clip })
  return { width: clip.width, height: clip.height }
}

async function take(context, opts, shot, world) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]))
  try {
    // What the browser remembers before the page opens: a cart, a quiz result.
    if (shot.storage) {
      await page.addInitScript((entries) => {
        for (const [key, value] of entries) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
      }, Object.entries(shot.storage))
    }
    // An answer of the database's that this shot writes itself, by function name.
    for (const [name, answer] of Object.entries(shot.rpc || {})) {
      await page.route(new RegExp(`/rest/v1/rpc/${name}$`), (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(answer) }),
      )
    }
    if (world === 'sample') presideOn(shot.route)
    // 'load' and then a short quiet spell: a page with an embed that keeps
    // talking would hold 'networkidle' for its whole timeout.
    await page.goto(opts.base + shot.route, { waitUntil: 'load', timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
    await settle(page)
    if (world === 'sample' && acts[shot.route]) await acts[shot.route](page)
    if (shot.do) await shot.do(page)
    await page.addStyleTag({ content: STILL })
    for (const selector of shot.hide || []) {
      await page.locator(selector).evaluateAll((els) => els.forEach((el) => (el.style.visibility = 'hidden')))
    }
    if (shot.scrollTo) {
      const box = await boxOf(page, shot.scrollTo)
      await page.evaluate((y) => scrollTo(0, y), Math.max(0, box.y - (shot.offset ?? 110)))
    }
    await page.waitForTimeout(shot.wait ?? 500)
    const ext = 'jpg'
    const size = await capture(page, shot, path.join(SHOTS, `${shot.id}.${ext}`))
    return { file: `shots/${shot.id}.${ext}`, ...size, errors }
  } finally {
    await page.close()
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { shots } = await import(pathToFileURL(path.resolve(MANIFEST)).href)
  check(shots)
  const wanted = shots.filter((s) => opts.only.length === 0 || opts.only.some((p) => s.id.startsWith(p)))
  if (opts.list) {
    for (const s of wanted) console.log(`${s.id.padEnd(34)} ${worldOf(s).padEnd(7)} ${(s.viewport || 'desktop').padEnd(8)} ${s.route}${s.skip ? `   (skipped: ${s.skip})` : ''}`)
    console.log(`${wanted.length} shots`)
    return
  }
  if (wanted.length === 0) throw new Error('no shot matches --only')
  try {
    await fetch(opts.base)
  } catch {
    throw new Error(`nothing answers at ${opts.base}: start the site with npm run dev first`)
  }

  await fs.mkdir(SHOTS, { recursive: true })
  const browser = await chromium.launch({ headless: !opts.headed })
  const contexts = new Map()
  const blocked = new Set()
  // One browser context for each world, screen and theme in use.
  const contextFor = async (world, viewport, theme) => {
    const key = `${world}|${viewport}|${theme}`
    if (contexts.has(key)) return contexts.get(key)
    const context = await browser.newContext({
      ...VIEWPORTS[viewport],
      colorScheme: theme,
      // The site's own reduced-motion rules show every block at once and stop
      // what loops, so a picture holds the page and two runs look the same.
      reducedMotion: 'reduce',
      locale: 'en-GB',
      timezoneId: 'Africa/Cairo',
    })
    if (world === 'sample') await installSample(context, theme)
    else {
      await guardWrites(context, blocked)
      await context.addInitScript((t) => localStorage.setItem('theme', t), theme)
    }
    contexts.set(key, context)
    return context
  }

  const index = JSON.parse(await fs.readFile(path.join(OUT, 'shots.json'), 'utf8').catch(() => '{}'))
  const failed = []
  let done = 0
  try {
    for (const shot of wanted) {
      if (opts.missing && index[shot.id]) continue
      if (shot.skip) {
        console.log(`  skipped ${shot.id}: ${shot.skip}`)
        continue
      }
      const world = worldOf(shot)
      const viewport = shot.viewport || 'desktop'
      const context = await contextFor(world, viewport, shot.theme || 'light')
      try {
        const got = await take(context, opts, shot, world)
        index[shot.id] = { file: got.file, width: got.width, height: got.height, viewport, world, route: shot.route, taken: new Date().toISOString() }
        // Written after every picture, so a run that is stopped keeps what it took.
        await fs.writeFile(path.join(OUT, 'shots.json'), JSON.stringify(index, null, 2))
        done++
        if (got.errors.length) console.log(`  ${shot.id}: the page reported ${got.errors.join(' | ')}`)
      } catch (err) {
        failed.push({ id: shot.id, why: err.message.split('\n')[0] })
        console.log(`  FAILED ${shot.id}: ${err.message.split('\n')[0]}`)
      }
    }
  } finally {
    await browser.close()
  }

  // Shots the manifest no longer has are dropped from the index.
  const known = new Set(shots.map((s) => s.id))
  for (const id of Object.keys(index)) if (!known.has(id)) delete index[id]
  await fs.writeFile(path.join(OUT, 'shots.json'), JSON.stringify(index, null, 2))

  if (blocked.size) {
    console.log(`\nguide shots: ${blocked.size} kinds of write to the database were held back:`)
    for (const w of [...blocked].sort()) console.log(`  ${w}`)
  }
  console.log(`\nguide shots: ${done} taken, ${failed.length} failed, in ${SHOTS}`)
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error('guide shots failed:', err.message)
  process.exit(1)
})
