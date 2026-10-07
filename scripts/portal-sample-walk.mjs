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
// The sample rows below follow the columns the portal selects. When a page
// gains a query, give it a row here or the page shows its empty state.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const themes = (process.argv[2] || 'dark,light').split(',')
const widths = (process.argv[3] || '320,375,768,1024,1440,1920').split(',').map(Number)
const only = process.argv[4] || ''
const base = 'http://localhost:5173'
const REF = 'wjijkqrdaakiwbtdssio'
const uid = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const now = Math.floor(Date.now() / 1000)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', email: 'webmaster@example.com', exp: now + 86400, iat: now, aud: 'authenticated' })}.sig`
const user = {
  id: uid,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'webmaster@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: { full_name: 'Sample Webmaster' },
  created_at: '2026-09-01T00:00:00Z',
}
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user }

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString()
const day = (ahead) => new Date(Date.now() + ahead * 864e5).toISOString().slice(0, 10)
const scope = { id: 'c-scope', slug: 'scope', abbr: 'SCOPE', name: 'Professional Exchange', color: '#0181c1' }
// Events around today: two coming up, a multi-day all-day one, two over.
const at = (daysAhead, hour) => {
  const d = new Date(Date.now() + daysAhead * 864e5)
  d.setUTCHours(hour - 2, 0, 0, 0)
  return d.toISOString()
}
const scoph = { slug: 'scoph', abbr: 'SCOPH', name: 'Public Health', color: '#1b9e4b' }
const scora = { slug: 'scora', abbr: 'SCORA', name: 'Sexual & Reproductive Health and Rights incl. HIV & AIDS', color: '#d1477a' }
const sampleEvents = [
  { id: 'ev-1', slug: 'world-health-day-stand-2026', committee_id: 'c-scoph', committee: scoph, title: 'World Health Day stand', description: 'Blood pressure checks, a **quiz** and free leaflets.\n\n- Bring your student card\n- Volunteers meet at 10:30\n\nQuestions? Ask on [our page](/committees/scoph).', starts_at: at(5, 11), ends_at: at(5, 15), all_day: false, place: 'Faculty garden, Ain Shams Faculty of Medicine', image: '/assets/exchange/incomings/campus.jpg', signup_url: 'https://forms.gle/example', published: true, created_at: iso(3), updated_at: iso(1) },
  { id: 'ev-2', slug: 'first-general-assembly-2026', committee_id: null, committee: null, title: 'First general assembly', description: '', starts_at: at(12, 17), ends_at: null, all_day: false, place: '', image: '', signup_url: '', published: true, created_at: iso(3), updated_at: iso(1) },
  { id: 'ev-3', slug: 'summer-camp-on-sexual-and-reproductive-health-and-rights-2026', committee_id: 'c-scora', committee: scora, title: 'Summer camp on sexual and reproductive health and rights, with a title long enough to wrap', description: 'Three days of workshops.', starts_at: at(30, 0), ends_at: at(32, 0), all_day: true, place: 'Ain Sokhna', image: '/assets/exchange/sama-02.jpg', signup_url: '', published: false, created_at: iso(2), updated_at: iso(0.5) },
  { id: 'ev-4', slug: 'incomings-welcome-night-2026', committee_id: 'c-scope', committee: { slug: 'scope', abbr: 'SCOPE', name: 'Professional Exchange', color: '#0181c1' }, title: 'Incomings welcome night', description: 'Dinner on the Nile with the August incomings.', starts_at: at(-40, 19), ends_at: at(-40, 23), all_day: false, place: 'Zamalek', image: '/assets/exchange/incomings/together.jpg', signup_url: '', published: true, created_at: iso(60), updated_at: iso(40) },
  { id: 'ev-5', slug: 'national-general-assembly-aswan-2025', committee_id: null, committee: null, title: 'National General Assembly, Aswan', description: '', starts_at: at(-400, 0), ends_at: at(-397, 0), all_day: true, place: 'Aswan', image: '', signup_url: '', published: true, created_at: iso(420), updated_at: iso(400) },
]
const termOf = (iso) => {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  return d.getUTCMonth() >= 8 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`
}
const overOf = (e) => {
  const last = Date.parse(e.ends_at || e.starts_at)
  return new Date(e.all_day ? last + 864e5 : last).toISOString()
}
const tables = {
  profiles: [
    { id: uid, full_name: 'Sample Webmaster', email: 'webmaster@example.com', membership_status: 'active', avatar_url: null, photo_path: null, email_digest: true, directory_opt_in: true, phone: '', created_at: iso(30), updated_at: iso(1) },
  ],
  assignments: [
    { id: 'a1', status: 'active', position: { id: 'p1', key: 'society.webmaster', title: 'Webmaster', short_title: 'Webmaster', level: 'webmaster', can_assign_tasks: true, committee: null }, term: { id: 't1', label: '2026-27', is_current: true } },
  ],
  tasks: [
    { id: 't-1', title: 'Collect the incomings welcome booklet photos from every contact person', body: 'One folder per student. Names on the files, please.', status: 'todo', priority: 'high', due_on: day(2), completed_at: null, committee_id: 'c-scope', created_by: uid, created_at: iso(3), updated_at: iso(1), committee: scope, assignees: [{ profile_id: uid }, { profile_id: other }] },
    { id: 't-2', title: 'Book the hall for the first general assembly', body: '', status: 'doing', priority: 'normal', due_on: day(-1), completed_at: null, committee_id: null, created_by: other, created_at: iso(6), updated_at: iso(2), committee: null, assignees: [{ profile_id: uid }] },
    { id: 't-3', title: 'Send the orientation recap', body: '', status: 'done', priority: 'normal', due_on: day(-6), completed_at: iso(5), committee_id: 'c-scope', created_by: uid, created_at: iso(12), updated_at: iso(5), committee: scope, assignees: [{ profile_id: other }] },
  ],
  posts: [
    { id: 'po-1', committee_id: 'c-scope', kind: 'update', title: 'Exchange season opens on the first of November', body: 'Applications go through the portal this year. Read the conditions before you apply: https://ausss-ainshams.org/exchange', levels: ['member', 'assistant', 'officer'], pinned: true, publish_at: iso(2), expires_at: null, author_id: uid, created_at: iso(2), committee: scope, reads: [] },
  ],
  notifications: [
    { id: 'n-1', kind: 'task_assigned', payload: { task_id: 't-1', title: 'Collect the incomings welcome booklet photos', actor_id: other }, read_at: null, created_at: iso(0.1) },
    { id: 'n-2', kind: 'task_comment', payload: { task_id: 't-2', title: 'Book the hall for the first general assembly', actor_id: other }, read_at: iso(1), created_at: iso(2) },
  ],
  roster_entries: [
    { id: 'r-1', full_name: 'Sample Member With A Rather Long Four Part Name', email: 'member1@example.com', status: 'Full Member', joined_year: 2023, years_spent: 3, lgas: 4, ngas: 1, current_position: 'Exchange Incomings Assistant', origin: 'sheet', portal_edited_at: null, profile_id: null, import_batch: 'b1', updated_at: iso(1), committee_id: 'c-scope', is_contact_person: true, position_id: null },
    { id: 'r-2', full_name: 'Second Sample', email: 'member2@example.com', status: 'Candidate Member', joined_year: 2025, years_spent: 1, lgas: 1, ngas: 0, current_position: '', origin: 'sheet', portal_edited_at: null, profile_id: null, import_batch: 'b1', updated_at: iso(1), committee_id: null, is_contact_person: false, position_id: null },
    { id: 'r-3', full_name: 'Third Sample', email: 'member3@example.com', status: 'Associate Member', joined_year: 2024, years_spent: 2, lgas: 2, ngas: 0, current_position: 'Local Member', origin: 'portal', portal_edited_at: iso(2), profile_id: null, import_batch: null, updated_at: iso(2), committee_id: 'c-scope', is_contact_person: false, position_id: null },
  ],
  albums: [
    { id: 'al-1', slug: 'national-general-assembly-aswan-2026', title: 'National General Assembly, Aswan 2026', blurb: 'Three days in Aswan.', cover_photo_id: null, sort_order: 0, published: true, created_at: iso(20), updated_at: iso(2) },
    { id: 'al-2', slug: 'orientation-day', title: 'Orientation day', blurb: '', cover_photo_id: null, sort_order: 1, published: true, created_at: iso(15), updated_at: iso(3) },
    { id: 'al-3', slug: 'world-diabetes-day-campaign', title: 'World Diabetes Day campaign', blurb: '', cover_photo_id: null, sort_order: 2, published: false, created_at: iso(5), updated_at: iso(1) },
  ],
  content_blocks: [
    { key: 'join.faq', editors: [], has_draft: iso(0.2), draft: { items: [{ q: 'Who can join AUSSS?', a: 'Any student at the **Faculty of Medicine**, Ain Shams University. See the [committees](/#committees) to find where you fit.' }, { q: 'A question long enough to wrap onto a second line on a small phone, to see how the row copes?', a: 'It copes.\n\n- one\n- two' }] }, published: null, draft_saved_at: iso(0.2), draft_saved_by: other, published_at: null, published_by: null, updated_at: iso(0.2) },
    // nothing saved yet: the editor opens on the copy that ships in the code
    { key: 'exchange.incomings', editors: ['scope', 'score'], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
    { key: 'site.contact', editors: [], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
    { key: 'home.page', editors: [], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
    { key: 'ifmsa.page', editors: [], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
  ],
  orders: [
    { id: 'o-1', ref: 'AUSSS-7F3K2Q', status: 'new', name: 'Sample Buyer', email: 'buyer1@example.com', phone: '01000000001', is_member: true, lc: '', year: '3rd year', payment_method: 'instapay', items: [{ product_id: 'tshirt-55', name: 'AUSSS T-Shirt, 55th Limited Edition', size: 'L', design: '', qty: 2, unit_price: 300, line_total: 600 }, { product_id: 'notebook', name: 'AUSSS Notebook', size: '', design: 'Support Divisions', qty: 1, unit_price: 40, line_total: 40 }], subtotal: 640, client_subtotal: 640, price_flag: '', notes: '', officer_notes: '', receipt_path: 'o-1.jpg', created_at: iso(0.2), updated_at: iso(0.2) },
    { id: 'o-2', ref: 'AUSSS-9QX81B', status: 'contacted', name: 'Another Buyer With A Long Name', email: 'a-rather-long-address-for-a-phone@example.com', phone: '+44 7700 900123', is_member: false, lc: 'Cairo', year: 'Other / External', payment_method: 'telda', items: [{ product_id: 'jacket', name: '"The" AUSSS Jacket', size: '2XL', design: '', qty: 1, unit_price: 650, line_total: 650 }], subtotal: 650, client_subtotal: 600, price_flag: 'price mismatch (client said 600, server 650)', notes: '', officer_notes: '', receipt_path: null, created_at: iso(2), updated_at: iso(1) },
    { id: 'o-3', ref: 'AUSSS-2M4N6P', status: 'delivered', name: 'Third Buyer', email: 'buyer3@example.com', phone: '01000000003', is_member: true, lc: '', year: '5th year', payment_method: 'vodafone', items: [{ product_id: 'bucket-hat', name: 'Dash Bucket Hat', size: 'One size', design: '', qty: 1, unit_price: 150, line_total: 150 }], subtotal: 150, client_subtotal: 150, price_flag: '', notes: '', officer_notes: '', receipt_path: 'o-3.jpg', created_at: iso(9), updated_at: iso(3) },
  ],
  merch_products: [
    { id: 'tshirt-55', name: 'AUSSS T-Shirt, 55th Limited Edition', tagline: 'Think Global. Act Local.', description: 'Forest-green ringer tee with white trim.', image: '/assets/merch/page-04.jpg', price: 300, sizes: ['S', 'M', 'L', 'XL', 'XXL'], size_chart: '/assets/merch/size-chart-tshirt.jpg', designs: [], wide_designs: [], available: true, sort_order: 0, updated_at: iso(3) },
    { id: 'notebook', name: 'AUSSS Notebook', tagline: 'Like it? Note it down.', description: 'Spiral-bound notebook with a committee-themed cover.', image: '/assets/merch/page-13.jpg', price: 40, sizes: [], size_chart: '', designs: ['SCOPH', 'SCORA', 'Exchange', 'Support Divisions'], wide_designs: ['Exchange', 'Support Divisions'], available: true, sort_order: 1, updated_at: iso(3) },
    { id: 'a-new-product-with-a-long-id-for-phones', name: 'A new product with a rather long name that wraps', tagline: '', description: '', image: '', price: 120, sizes: [], size_chart: '', designs: [], wide_designs: [], available: false, sort_order: 2, updated_at: iso(0.1) },
  ],
  events: sampleEvents,
  audit_log: [
    { id: 3, at: iso(0.1), actor: uid, table_name: 'content_blocks', row_id: 'join.faq', action: 'UPDATE', before: { key: 'join.faq', draft: null, updated_at: iso(1) }, after: { key: 'join.faq', draft: { items: [{ q: 'Who can join AUSSS?', a: 'Any student at the Faculty of Medicine.' }] }, updated_at: iso(0.1) } },
    { id: 2, at: iso(1), actor: other, table_name: 'tasks', row_id: '7a1f0c1e-5b1d-4c58-9a57-3f2f3a6f0c11', action: 'INSERT', before: null, after: { id: '7a1f0c1e-5b1d-4c58-9a57-3f2f3a6f0c11', title: 'Collect the incomings welcome booklet photos from every contact person', status: 'todo', priority: 'high' } },
    { id: 1, at: iso(2), actor: null, table_name: 'roster_entries', row_id: 'a-row-id-long-enough-to-need-breaking-on-a-phone-0123456789', action: 'DELETE', before: { full_name: 'Sample Member With A Rather Long Four Part Name', email: 'member1@example.com', status: 'Full Member' }, after: null },
  ],
}
const rpcs = {
  events_public: {
    events: sampleEvents
      .filter((e) => e.published)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map(({ committee, committee_id, published, created_at, ...e }) => ({
        ...e,
        committee: committee?.slug ?? null,
        over_at: overOf(e),
        term: termOf(e.starts_at),
        aliases: e.id === 'ev-1' ? ['world-health-day-2026'] : [],
      })),
    generated_at: new Date().toISOString(),
  },
  directory: [
    { id: uid, full_name: 'Sample Webmaster', avatar_url: null, membership_status: 'active', positions: [{ title: 'Webmaster', committee: null, level: 'webmaster' }] },
    { id: other, full_name: 'Sample Officer With A Long Name', avatar_url: null, membership_status: 'active', positions: [{ title: 'Local Exchange Officer for Incomings', committee: 'SCOPE', level: 'officer' }] },
    { id: 'x3', full_name: 'Third Person', avatar_url: null, membership_status: 'candidate', positions: [] },
  ],
  profile_names: [
    { id: uid, full_name: 'Sample Webmaster', avatar_url: null },
    { id: other, full_name: 'Sample Officer', avatar_url: null },
  ],
}

const ROUTES = [
  '/portal', '/portal/profile', '/portal/verify', '/portal/tasks', '/portal/tasks/t-1', '/portal/updates',
  '/portal/notifications', '/portal/directory', '/portal/committees', '/portal/committees/scope',
  '/portal/gallery', '/portal/magazine', '/portal/submissions?tab=orders', '/portal/submissions?tab=stories',
  '/portal/submissions?tab=signups', '/portal/admin/settings', '/portal/admin/roster', '/portal/admin/verification',
  '/portal/merch', '/portal/merch/notebook', '/portal/merch/a-new-product-with-a-long-id-for-phones',
  '/portal/events', '/portal/events/ev-1', '/portal/events/ev-3',
  // the public pages that show events, from the same sample
  '/events', '/events/archive', '/events/world-health-day-stand-2026', '/events/national-general-assembly-aswan-2025', '/', '/committees/scoph',
  '/portal/content', '/portal/content/join.faq', '/portal/content/exchange.incomings', '/portal/content/site.contact', '/portal/content/home.page', '/portal/content/ifmsa.page', '/portal/admin/audit',
].filter((r) => !only || r.startsWith(only))

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
const findings = { overflow: [], contrast: new Map(), errors: new Map() }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

for (const theme of themes) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 900 }, colorScheme: theme, reducedMotion: 'reduce' })
    await context.addInitScript(
      ([t, key, s]) => {
        localStorage.setItem('theme', t)
        localStorage.setItem(key, s)
      },
      [theme, `sb-${REF}-auth-token`, JSON.stringify(session)],
    )
    await context.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const json = (body, headers = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) })
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
      if (url.pathname.startsWith('/auth/v1/')) return json(url.pathname.endsWith('/user') ? user : session)
      if (url.pathname.startsWith('/storage/v1/')) return json([])
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1]
      if (rpc) return json(rpcs[rpc] ?? [])
      const table = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/)?.[1]
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return json(null)
      // Public tables are read for real, as an anonymous visitor.
      if (table === 'committees' || table === 'site_settings') {
        const headers = { ...req.headers(), authorization: `Bearer ${req.headers().apikey}` }
        return route.continue({ headers })
      }
      let rows = tables[table] || []
      const idEq = url.searchParams.get('id')?.match(/^eq\.(.+)$/)?.[1]
      if (idEq) rows = rows.filter((r) => r.id === idEq)
      const keyEq = url.searchParams.get('key')?.match(/^eq\.(.+)$/)?.[1]
      if (keyEq) rows = rows.filter((r) => r.key === keyEq)
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `*/${table === 'notifications' ? 1 : rows.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } })
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(rows[0] ?? {})
      return json(rows, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` })
    })

    const dir = path.join('.page-walk', `portal-sample-${stamp}`, `${theme}-${width}`)
    await fs.mkdir(dir, { recursive: true })
    for (const r of ROUTES) {
      const page = await context.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]))
      try {
        await page.goto(base + r, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(500)
        const landed = new URL(page.url()).pathname
        if (!landed.startsWith(r.split('?')[0])) errs.push(`landed on ${landed}`)
        const over = await page.evaluate(measureOverflow)
        if (over) findings.overflow.push({ theme, width, route: r, ...over })
        await page.evaluate(`${axe}; null`)
        const low = await page.evaluate(async () => {
          const res = await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] })
          return res.violations.flatMap((v) => v.nodes.map((n) => ({ ...(n.any[0]?.data || {}), text: n.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) })))
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
console.log(`\nlow-contrast pairs: ${findings.contrast.size}`)
for (const [k, v] of findings.contrast) console.log(`  ${k}  (${[...v.routes].slice(0, 3).join(', ')})  "${v.text}"`)
console.log(`\npage errors: ${findings.errors.size}`)
for (const [k, v] of findings.errors) console.log(`  ${k}  (${[...v].slice(0, 4).join(', ')})`)
console.log(`\nscreenshots in .page-walk/portal-sample-${stamp}`)
