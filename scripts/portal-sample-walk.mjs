// The portal walked with a made-up session and sample rows: every portal page
// at a list of widths in both themes, measured for sideways scrolling and
// text contrast and saved as a screenshot. It needs no sign-in and shows no
// real person, and nothing it does reaches production: every Supabase call is
// answered here, except anonymous reads of the public committees and settings
// tables. Use it to check a design change on the portal; the signed-in walk
// (scripts/page-walk.mjs with --login) is still the one that sees real data.
//
//   npm run walk:portal-sample                      everything (needs npm run dev)
//   npm run walk:portal-sample -- light 320,375     themes, then widths
//   npm run walk:portal-sample -- dark 1440 /portal/tasks
//
// The session, the sample rows and the list of screens are in
// scripts/portal-sample.mjs, which the website guide's screenshots use too.
// When a page gains a query, give it a row there or the page shows its empty
// state.
//
// The exchange exam is walked from both sides: the portal's Exam pages
// (/portal/exam), and the pages students sit it on (/exam/<word>), which are no
// part of the portal. There the word in the address chooses what the student
// meets, from the sign-in card to "Your exam was received." (see `doors`).
//
//   npm run walk:portal-sample -- light,dark 320,375 /exam
//
// A few screens only show after a tap: `acts` in that file holds what the
// walk does on those routes before it measures.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { measureCutOff } from './walk-checks.mjs'
import { ROUTES as SCREENS, acts, installSample, presideOn } from './portal-sample.mjs'

const themes = (process.argv[2] || 'dark,light').split(',')
const widths = (process.argv[3] || '320,375,768,1024,1440,1920').split(',').map(Number)
const only = process.argv[4] || ''
const base = 'http://localhost:5173'
const ROUTES = SCREENS.filter((r) => !only || r.startsWith(only))

function measureOverflow() {
  const doc = document.documentElement
  const vw = doc.clientWidth
  const by = Math.max(doc.scrollWidth, document.body.scrollWidth) - vw
  if (by <= 1) return null
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX === 'visible') continue
      if (p.getBoundingClientRect().right <= vw + 1) return true
    }
    return false
  }
  const hits = []
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue
    if (getComputedStyle(el).position === 'fixed' || clipped(el)) continue
    hits.push(el)
  }
  const inner = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)))
  return { by: Math.round(by), who: inner.slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).slice(0, 70)} "${(el.textContent || '').trim().slice(0, 30)}"`) }
}

const require = createRequire(import.meta.url)
const axe = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const browser = await chromium.launch()
const findings = { overflow: [], cutoff: [], contrast: new Map(), errors: new Map() }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

for (const theme of themes) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 900 }, colorScheme: theme, reducedMotion: 'reduce' })
    await installSample(context, theme)

    const dir = path.join('.page-walk', `portal-sample-${stamp}`, `${theme}-${width}`)
    await fs.mkdir(dir, { recursive: true })
    for (const r of ROUTES) {
      // One page is open at a time, so this holds for every read the page makes.
      presideOn(r)
      const page = await context.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]))
      try {
        await page.goto(base + r, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(500)
        const landed = new URL(page.url()).pathname
        if (!landed.startsWith(r.split(/[?#]/)[0])) errs.push(`landed on ${landed}`)
        if (acts[r]) {
          await acts[r](page)
          await page.waitForTimeout(700)
        }
        const over = await page.evaluate(measureOverflow)
        if (over) findings.overflow.push({ theme, width, route: r, ...over })
        const cut = await page.evaluate(measureCutOff)
        if (cut) findings.cutoff.push({ theme, width, route: r, cut })
        await page.evaluate(`${axe}; null`)
        const low = await page.evaluate(async () => {
          const res = await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] })
          // What the text says, to find it by. A field has no text between its
          // tags, so it is named by the start of its own tag.
          const named = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || html.replace(/\s+/g, ' ').slice(0, 110)
          return res.violations.flatMap((v) => v.nodes.map((n) => ({ ...(n.any[0]?.data || {}), text: named(n.html) })))
        })
        for (const c of low) {
          const key = `${theme} ${c.fgColor} on ${c.bgColor} = ${c.contrastRatio}`
          const hit = findings.contrast.get(key) || { routes: new Set(), text: c.text }
          hit.routes.add(r)
          findings.contrast.set(key, hit)
        }
        await page.screenshot({ path: path.join(dir, `${r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`), fullPage: true })
      } catch (e) {
        errs.push(`walk: ${e.message.split('\n')[0]}`)
      }
      for (const e of errs) {
        const hit = findings.errors.get(e) || new Set()
        hit.add(r)
        findings.errors.set(e, hit)
      }
      await page.close()
    }
    await context.close()
    console.log(`portal sample walk: ${theme} ${width}px done`)
  }
}
await browser.close()

console.log(`\nsideways scrolling: ${findings.overflow.length}`)
for (const o of findings.overflow) console.log(`  ${o.theme} ${o.width}px ${o.route}: ${o.by}px, ${o.who.join(' | ')}`)
console.log(`\ncut off at the screen's edge (fixed bars): ${findings.cutoff.length}`)
for (const o of findings.cutoff) console.log(`  ${o.theme} ${o.width}px ${o.route}: ${o.cut.map((c) => `${c.el.slice(0, 60)} "${c.text}" (${c.left} to ${c.right})`).join(' | ').slice(0, 240)}`)
console.log(`\nlow-contrast pairs: ${findings.contrast.size}`)
for (const [k, v] of findings.contrast) console.log(`  ${k}  (${[...v.routes].slice(0, 3).join(', ')})  "${v.text}"`)
console.log(`\npage errors: ${findings.errors.size}`)
for (const [k, v] of findings.errors) console.log(`  ${k}  (${[...v].slice(0, 4).join(', ')})`)
console.log(`\nscreenshots in .page-walk/portal-sample-${stamp}`)
