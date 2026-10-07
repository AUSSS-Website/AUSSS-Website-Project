// The page walk: opens every public page and every portal page at a list of
// widths and in both themes, saves a full-page screenshot of each, and records
// what the browser console prints. One tool, used for the console sweep, the
// design pass, a smoke test after a deploy and the website guide's screenshots
// (docs/RUNBOOK.md section 21).
//
//   npm run walk                                  everything, against the dev server
//   npm run walk -- --base https://ausss-ainshams.org --public-only
//   npm run walk -- --widths 320,1280 --themes dark --only /gallery
//   npm run walk -- --no-shots --strict           console check only; exit 1 on our own errors
//   npm run walk -- --login                       sign in once so the portal pages can be walked
//   npm run walk -- --contrast --no-shots         measure text contrast (WCAG AA) on every page
//
// One-time setup: `npx playwright install chromium`.
//
// Portal pages need a signed-in session. `--login` opens a browser window on
// the sign-in page; sign in there (if Google refuses the automated browser,
// use the email link and paste it into that window). The session is saved to
// .page-walk/auth.json, which is gitignored: it is a live sign-in, treat it
// like a password and delete it when you are done. Without it the walk covers
// the public pages and says so.
//
// Every visit also measures the page for sideways scrolling and names the
// elements that stick out of the viewport, and names anything cut off at the
// screen's edge inside a fixed bar such as the header (scripts/walk-checks.mjs). With `--contrast` it runs axe-core's
// colour-contrast rule as well, which is how the design pass checks both themes
// against WCAG AA.
//
// Output: .page-walk/<run>/<theme>-<width>/<page>.png and report.json there.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { measureCutOff } from './walk-checks.mjs'

const PRODUCTION = 'https://ausss-ainshams.org'
const OUT_ROOT = '.page-walk'
const AUTH_FILE = path.join(OUT_ROOT, 'auth.json')

// Public routes that are deliberately not in the sitemap but still render a page.
const EXTRA_PUBLIC = ['/merch/checkout', '/sorting', '/portal/sign-in']

// Portal routes with a fixed address. The ones with an id or slug in them are
// found by following the first matching link on their list page.
const PORTAL_FIXED = [
  '/portal',
  '/portal/profile',
  '/portal/verify',
  '/portal/tasks',
  '/portal/updates',
  '/portal/notifications',
  '/portal/directory',
  '/portal/committees',
  '/portal/gallery',
  '/portal/magazine',
  '/portal/submissions?tab=orders',
  '/portal/submissions?tab=stories',
  '/portal/submissions?tab=signups',
  '/portal/admin/settings',
  '/portal/admin/roster',
  '/portal/admin/verification',
  '/portal/content',
  '/portal/content/join.faq',
  '/portal/content/exchange.incomings',
  '/portal/admin/audit',
]
const PORTAL_DETAIL = [
  { list: '/portal/tasks', prefix: '/portal/tasks/' },
  { list: '/portal/committees', prefix: '/portal/committees/' },
  { list: '/portal/gallery', prefix: '/portal/gallery/' },
  { list: '/portal/magazine', prefix: '/portal/magazine/' },
]

function parseArgs(argv) {
  const opts = {
    base: 'http://localhost:5173',
    widths: [320, 375, 768, 1024, 1440, 1920],
    themes: ['dark', 'light'],
    only: '',
    login: false,
    publicOnly: false,
    shots: true,
    strict: false,
    contrast: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }
    if (arg === '--base') opts.base = value().replace(/\/$/, '')
    else if (arg === '--widths') opts.widths = value().split(',').map(Number).filter((n) => n >= 240)
    else if (arg === '--themes') opts.themes = value().split(',').filter((t) => t === 'dark' || t === 'light')
    else if (arg === '--only') opts.only = value()
    else if (arg === '--login') opts.login = true
    else if (arg === '--public-only') opts.publicOnly = true
    else if (arg === '--no-shots') opts.shots = false
    else if (arg === '--strict') opts.strict = true
    else if (arg === '--contrast') opts.contrast = true
    else throw new Error(`unknown option ${arg}`)
  }
  if (opts.widths.length === 0 || opts.themes.length === 0) throw new Error('no widths or themes left to walk')
  return opts
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

// The public page list is the sitemap: the one the base serves, else the one
// the last local build wrote, else production's.
async function publicPaths(base) {
  const fromXml = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
  const sources = [
    async () => {
      const res = await fetch(`${base}/sitemap.xml`)
      return res.ok ? res.text() : ''
    },
    async () => fs.readFile(path.join('dist', 'sitemap.xml'), 'utf8'),
    async () => (await fetch(`${PRODUCTION}/sitemap.xml`)).text(),
  ]
  for (const source of sources) {
    try {
      const paths = fromXml(await source())
      if (paths.length > 0) return [...new Set([...paths, ...EXTRA_PUBLIC])]
    } catch {
      /* try the next source */
    }
  }
  throw new Error('no sitemap found: run `npm run build` once, or check the network')
}

async function login(opts) {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${opts.base}/portal/sign-in`)
  console.log('page walk: sign in in the window that opened; it closes by itself once the portal loads')
  console.log('page walk: use "Email me a sign-in link" and paste the link from the email into that window')
  // Google turns automated browsers away ("this browser or app may not be
  // secure"). Bring the window back to the sign-in page so the email link
  // can be used instead.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() || !/accounts\.google\.com\/.*signin\/rejected/.test(frame.url())) return
    console.log('page walk: Google refused this browser; back on the sign-in page, use the email link')
    page.goto(`${opts.base}/portal/sign-in`).catch(() => {})
  })
  try {
    await page.waitForURL(
      (url) => url.pathname.startsWith('/portal') && !/\/portal\/(sign-in|callback)/.test(url.pathname),
      { timeout: 10 * 60 * 1000 },
    )
  } catch (err) {
    await browser.close().catch(() => {})
    const closed = /closed/i.test(err.message)
    throw new Error(closed ? 'the window was closed before the portal loaded; no session saved' : 'no sign-in within 10 minutes; no session saved')
  }
  await page.waitForLoadState('networkidle')
  await fs.mkdir(OUT_ROOT, { recursive: true })
  await context.storageState({ path: AUTH_FILE })
  await browser.close()
  console.log(`page walk: session saved to ${AUTH_FILE} (gitignored; delete it when you are done)`)
}

// Whose message is it? Ours are the ones the console sweep has to fix.
function classify(entry) {
  const where = `${entry.url || ''} ${entry.text}`
  if (/Content Security Policy|Refused to (load|connect|frame|execute|apply)/i.test(entry.text)) return 'ours'
  if (entry.kind === 'pageerror' || /^ContentSecurityPolicyIssue/.test(entry.text)) return 'ours'
  if (/google\.com|gstatic\.com|googleusercontent|canva\.com|doubleclick|youtube/i.test(where)) return 'embed'
  // LazyLoadImageIssue is Chrome noting that lazy images exist, not a fault.
  if (/third-party cookie|SameSite|Permissions-Policy|Tracking Prevention|LazyLoadImageIssue/i.test(entry.text)) {
    return 'browser'
  }
  return 'ours'
}

// The dev server and every preview talk to the PRODUCTION database, so the
// walk must not write to it. Reads pass; so does sign-in traffic. Any other
// call to Supabase (a magazine view being counted, a notification marked
// read) is answered here with an empty success and never leaves the machine.
const READ_RPCS = new Set([
  'check_membership',
  'committee_roster',
  'content_public',
  'gallery_public',
  'people_public',
  'magazine_insights',
  'magazine_public',
  'match_roster_lines',
  'post_audience',
  'profile_names',
  'roster_sheet_info',
  'roster_stats',
  'roster_sync_token_info',
  'roster_upgrade_candidates',
  'search_roster',
  'stories_public',
  'task_assignable_people',
])

async function guardWrites(context, blocked) {
  await context.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1]
    const reading =
      method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ||
      url.pathname.startsWith('/auth/v1/') ||
      (rpc && READ_RPCS.has(rpc)) ||
      // Signed URLs for private files are made with a POST but change nothing.
      url.pathname.startsWith('/storage/v1/object/sign/')
    if (reading) return route.continue()
    blocked.add(`${method} ${url.pathname}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
}

// Does the page scroll sideways, and which elements cause it? Runs in the page.
// An element counts only if nothing above it clips it, and of a nested set
// only the innermost is named, since that is the one to fix.
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
  const innermost = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)))
  return {
    by: Math.round(by),
    culprits: innermost.slice(0, 6).map((el) => ({
      el: `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).slice(0, 90)}`,
      text: (el.textContent || '').trim().slice(0, 50),
      right: Math.round(el.getBoundingClientRect().right),
    })),
  }
}

// axe-core's colour-contrast rule: every piece of text it can measure against
// a flat background, with the ratio found and the one WCAG AA asks for. Text
// over a photo or a gradient cannot be measured and is not listed.
let axeSource = ''
async function measureContrast(page) {
  if (!axeSource) {
    const require = createRequire(import.meta.url)
    axeSource = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
  }
  // evaluate() is not subject to the page's Content-Security-Policy.
  await page.evaluate(`${axeSource}; null`)
  return page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] })
    return result.violations.flatMap((v) =>
      v.nodes.map((n) => {
        const d = n.any[0]?.data || {}
        const text = n.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        return {
          target: n.target.join(' ').slice(0, 160),
          text: (text || n.html).slice(0, 70),
          fg: d.fgColor,
          bg: d.bgColor,
          ratio: d.contrastRatio,
          needs: d.expectedContrastRatio,
          size: d.fontSize,
        }
      }),
    )
  })
}

const slugOf = (route) => route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '') || 'home'

async function visit(context, opts, route, shotDir, report) {
  const page = await context.newPage()
  const messages = []
  const record = (kind, text, url) => {
    const entry = { kind, text: String(text).slice(0, 600), url: url || '' }
    messages.push({ ...entry, owner: classify(entry) })
  }
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') record(msg.type(), msg.text(), msg.location().url)
  })
  page.on('pageerror', (err) => record('pageerror', err.message))
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText || ''
    // A navigation away cancels in-flight requests; that is not a failure.
    if (!/ERR_ABORTED/.test(failure)) record('requestfailed', `${failure} ${req.url()}`, req.url())
  })
  page.on('response', (res) => {
    if (res.status() >= 400) record('http', `${res.status()} ${res.url()}`, res.url())
  })
  // What DevTools lists under "Issues" (blocked or third-party cookies, policy
  // violations, mixed content) never reaches the console events above.
  try {
    const cdp = await context.newCDPSession(page)
    cdp.on('Audits.issueAdded', ({ issue }) => {
      const d = issue.details || {}
      const cookie = d.cookieIssueDetails
      const csp = d.contentSecurityPolicyIssueDetails
      const url = cookie?.cookieUrl || cookie?.request?.url || csp?.blockedURL || ''
      const detail = cookie
        ? `${cookie.cookie?.name || cookie.rawCookieLine || 'cookie'} (${[...(cookie.cookieWarningReasons || []), ...(cookie.cookieExclusionReasons || [])].join(', ')})`
        : csp
          ? `${csp.violatedDirective} blocked ${csp.blockedURL || 'inline'}`
          : ''
      record('issue', `${issue.code} ${detail} ${url}`.trim(), url)
    })
    await cdp.send('Audits.enable')
  } catch {
    /* not Chromium: no Issues panel to read */
  }

  let finalPath = route
  let overflow = null
  let cutoff = null
  let contrast = []
  try {
    await page.goto(`${opts.base}${route}`, { waitUntil: 'networkidle', timeout: 45000 })
    // Scroll to the end and back so everything lazy (images, the map and
    // Canva embeds, with whatever they print) loads before the screenshot.
    await page.evaluate(async () => {
      const step = Math.max(400, window.innerHeight)
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(400)
    finalPath = new URL(page.url()).pathname
    overflow = await page.evaluate(measureOverflow)
    cutoff = await page.evaluate(measureCutOff)
    if (opts.contrast) contrast = await measureContrast(page)
    if (opts.shots) {
      await fs.mkdir(shotDir, { recursive: true })
      await page.screenshot({ path: path.join(shotDir, `${slugOf(route)}.png`), fullPage: true })
    }
  } catch (err) {
    record('pageerror', `walk: ${err.message.split('\n')[0]}`)
  }
  report.push({ route, finalPath, messages, overflow, cutoff, contrast })
  return page
}

async function walk(opts) {
  const publicRoutes = await publicPaths(opts.base)
  const signedIn = !opts.publicOnly && (await exists(AUTH_FILE))
  if (!opts.publicOnly && !signedIn) {
    console.log('page walk: no saved session, walking the public pages only (run with --login first for the portal)')
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = path.join(OUT_ROOT, stamp)
  const report = { base: opts.base, started: new Date().toISOString(), runs: [] }
  const blocked = new Set()
  const browser = await chromium.launch()

  try {
    for (const theme of opts.themes) {
      for (const width of opts.widths) {
        const context = await browser.newContext({
          viewport: { width, height: width < 700 ? 800 : 900 },
          colorScheme: theme,
          // The site's own reduced-motion rules show every scroll-revealed
          // block at once and stop the looping animations, so a full-page
          // screenshot holds the whole page and two runs look the same.
          reducedMotion: 'reduce',
          storageState: signedIn ? AUTH_FILE : undefined,
        })
        await guardWrites(context, blocked)
        // The theme toggle's stored choice wins over the OS preference.
        await context.addInitScript((t) => {
          try {
            localStorage.setItem('theme', t)
          } catch {
            /* storage blocked */
          }
        }, theme)

        const shotDir = path.join(outDir, `${theme}-${width}`)
        const pages = []
        const wanted = (route) => !opts.only || route.startsWith(opts.only)

        for (const route of publicRoutes.filter(wanted)) {
          await (await visit(context, opts, route, shotDir, pages)).close()
        }
        if (signedIn) {
          const detail = new Set()
          for (const route of PORTAL_FIXED) {
            const want = wanted(route)
            const lists = PORTAL_DETAIL.filter((d) => d.list === route)
            if (!want && lists.every((d) => !wanted(d.prefix))) continue
            const page = await visit(context, opts, route, shotDir, want ? pages : [])
            for (const { prefix } of lists) {
              const href = await page
                .locator(`a[href^="${prefix}"]`)
                .first()
                .getAttribute('href', { timeout: 2000 })
                .catch(() => null)
              if (href) detail.add(href)
            }
            await page.close()
          }
          for (const route of [...detail].filter(wanted)) {
            await (await visit(context, opts, route, shotDir, pages)).close()
          }
        }

        report.runs.push({ theme, width, pages })
        const noisy = pages.filter((p) => p.messages.length > 0).length
        const wide = pages.filter((p) => p.overflow).length
        const cut = pages.filter((p) => p.cutoff).length
        const faint = pages.reduce((n, p) => n + p.contrast.length, 0)
        console.log(
          `page walk: ${theme} ${width}px: ${pages.length} pages, ${noisy} with console output, ` +
            `${wide} scrolling sideways, ${cut} with a bar cut off${opts.contrast ? `, ${faint} low-contrast texts` : ''}`,
        )
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }

  // One line per distinct message, with how many pages printed it.
  const seen = new Map()
  for (const run of report.runs) {
    for (const page of run.pages) {
      for (const m of page.messages) {
        const key = `${m.owner}|${m.kind}|${m.text}`
        const hit = seen.get(key) || { ...m, routes: new Set() }
        hit.routes.add(page.route)
        seen.set(key, hit)
      }
    }
  }
  report.summary = [...seen.values()]
    .map((m) => ({ owner: m.owner, kind: m.kind, text: m.text, routes: [...m.routes] }))
    .sort((a, b) => a.owner.localeCompare(b.owner) || b.routes.length - a.routes.length)

  report.blockedWrites = [...blocked].sort()

  // Page views that scroll sideways, and the low-contrast colour pairs with
  // how many pages show each.
  report.overflow = report.runs.flatMap((run) =>
    run.pages
      .filter((p) => p.overflow)
      .map((p) => ({ theme: run.theme, width: run.width, route: p.route, ...p.overflow })),
  )
  report.cutoff = report.runs.flatMap((run) =>
    run.pages
      .filter((p) => p.cutoff)
      .map((p) => ({ theme: run.theme, width: run.width, route: p.route, culprits: p.cutoff })),
  )
  const pairs = new Map()
  for (const run of report.runs) {
    for (const page of run.pages) {
      for (const c of page.contrast) {
        const key = `${run.theme}|${c.fg}|${c.bg}`
        const hit = pairs.get(key) || { ...c, theme: run.theme, routes: new Set(), samples: new Set() }
        hit.routes.add(page.route)
        if (hit.samples.size < 4) hit.samples.add(c.text)
        pairs.set(key, hit)
      }
    }
  }
  report.contrast = [...pairs.values()]
    .map(({ theme, fg, bg, ratio, needs, routes, samples }) => ({
      theme,
      fg,
      bg,
      ratio,
      needs,
      routes: [...routes],
      samples: [...samples],
    }))
    .sort((a, b) => a.theme.localeCompare(b.theme) || b.routes.length - a.routes.length)

  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  if (blocked.size > 0) {
    console.log(`\npage walk: ${blocked.size} kinds of write to the database were held back:`)
    report.blockedWrites.forEach((w) => console.log(`  ${w}`))
  }

  console.log(`\npage walk: ${report.summary.length} distinct console messages`)
  for (const m of report.summary) {
    const sample = m.routes.slice(0, 3).join(', ') + (m.routes.length > 3 ? `, +${m.routes.length - 3}` : '')
    console.log(`  [${m.owner}] ${m.kind}: ${m.text.slice(0, 160)}  (${sample})`)
  }
  if (report.overflow.length > 0) {
    console.log(`\npage walk: ${report.overflow.length} page views scroll sideways`)
    const listed = new Set()
    for (const o of report.overflow) {
      const key = `${o.width}|${o.route}`
      if (listed.has(key)) continue
      listed.add(key)
      const who = o.culprits.map((c) => c.el).join(' | ').slice(0, 200)
      console.log(`  ${o.width}px ${o.route}: ${o.by}px over, ${who}`)
    }
  }
  if (report.cutoff.length > 0) {
    console.log(`\npage walk: ${report.cutoff.length} page views with something cut off at the screen's edge`)
    const listed = new Set()
    for (const o of report.cutoff) {
      const key = `${o.width}|${o.culprits.map((c) => c.el).join()}`
      if (listed.has(key)) continue
      listed.add(key)
      const who = o.culprits.map((c) => `${c.el.slice(0, 60)} "${c.text}" (${c.left} to ${c.right})`).join(' | ')
      console.log(`  ${o.width}px ${o.route}: ${who.slice(0, 240)}`)
    }
  }
  if (opts.contrast) {
    console.log(`\npage walk: ${report.contrast.length} low-contrast colour pairs`)
    for (const c of report.contrast) {
      console.log(
        `  [${c.theme}] ${c.fg} on ${c.bg} = ${c.ratio} (needs ${c.needs}), ${c.routes.length} pages, ` +
          `e.g. ${c.routes[0]}: "${c.samples[0]}"`,
      )
    }
  }
  console.log(`page walk: report and screenshots in ${outDir}`)

  const ours = report.summary.filter((m) => m.owner === 'ours').length
  if (opts.strict && ours > 0) {
    console.error(`page walk: ${ours} of our own console messages, failing (--strict)`)
    process.exit(1)
  }
}

const opts = parseArgs(process.argv.slice(2))
;(opts.login ? login(opts) : walk(opts)).catch((err) => {
  console.error('page walk failed:', err.message)
  process.exit(1)
})
