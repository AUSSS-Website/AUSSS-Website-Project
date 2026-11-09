// The stress test's phones: a few real (headless) browsers that sit the mock
// exam through the exam's own page, while scripts/exam-stress.mjs keeps the
// rest of the hall busy from Node. The script proves what the database does
// under load; these prove what a student sees while it does: that the page
// opens at the opening time by itself, starts, shows its pictures, saves as
// answers are tapped, and hands in, with no error on the way.
//
// It is started by exam-stress.mjs (BROWSERS=12, which needs SITE), never by
// hand: that script makes the accounts, puts them on the list, and writes the
// file this one reads:
//
//   { site, word, code, storageKey, opensAt, minutes, shots,
//     phones: [{ tag, session, sits: { scope, score }, share }] }
//
// Each phone is a browser context of its own, the size of a phone, on a
// connection slowed to an ordinary mobile one. Its session is put into the
// page's storage as a sign-in would have left it (nobody can sign a made-up
// student in to Google). It prints one line, `PHONES <json>`, with what each
// phone met.
//
// Chromium comes with the repo's `playwright` package (headless, as in
// scripts/page-walk.mjs). No browser window is opened.
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const file = process.argv[2]
if (!file) {
  console.error('exam-stress-phones is started by scripts/exam-stress.mjs (BROWSERS=n), with the file it writes.')
  process.exit(2)
}
const plan = JSON.parse(readFileSync(file, 'utf8'))
// For trying the script itself against a stand-in stack: the page's calls to
// the database are answered from another address. Never set in a real run.
const reroute = process.env.PHONES_API_OVERRIDE || ''
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))
// Two presses closer together than this are one slip of the thumb to the page
// (DOUBLE_TAP_MS in src/exam/examFlow.js); a press this soon after a page of
// questions changed is not counted either.
const AFTER_A_PAGE_MS = 700

async function sitOn(browser, phone, index) {
  const met = { tag: phone.tag, ok: false, stage: 'opening the page', answered: 0, pages: 0, errors: [], failed: 0, refused: 0, noConnection: false, startMs: null, handInMs: null }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  })
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [plan.storageKey, JSON.stringify(phone.session)])
  if (reroute) {
    await context.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const url = new URL(req.url())
      try {
        const res = await route.fetch({ url: reroute + url.pathname + url.search })
        return await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } })
      } catch {
        return route.abort('connectionfailed').catch(() => {})
      }
    })
  }
  const page = await context.newPage()
  // An ordinary mobile connection, not the machine's own: 150 ms each way, about 1.6 Mbit/s down.
  if (!reroute) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  }
  page.on('pageerror', (e) => met.errors.push(`page: ${e.message.split('\n')[0]}`))
  page.on('console', (m) => {
    // a failed request is counted below; what is left is the page's own complaint
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) met.errors.push(`console: ${m.text().slice(0, 160)}`)
  })
  page.on('requestfailed', (r) => {
    if (/supabase|\/exam\//.test(r.url())) met.failed += 1
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/rest\/v1\/rpc\/exam_|\/storage\/v1\//.test(r.url())) met.refused += 1
  })
  const seesNoConnection = async () => {
    if (await page.getByText('No connection', { exact: false }).first().isVisible().catch(() => false)) met.noConnection = true
  }

  try {
    // A little before the exam opens, each phone a moment after the last.
    await sleep(plan.opensAt - Date.now() - 20_000 + index * 400)
    await page.goto(`${plan.site}/exam/${plan.word}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    met.stage = 'waiting for the exam to open'
    await page.getByRole('heading', { name: 'You are on the list.' }).waitFor({ timeout: 60_000 })
    // The page asks the door as the opening time comes and shows the start code by itself.
    const code = page.locator('#exam-start-code')
    await code.waitFor({ timeout: Math.max(60_000, plan.opensAt - Date.now() + 90_000) })

    met.stage = 'starting'
    if (phone.sits.scope) await page.getByRole('checkbox', { name: /Professional exchange/ }).check()
    if (phone.sits.score) await page.getByRole('checkbox', { name: /Research exchange/ }).check()
    await code.fill(plan.code)
    const pressed = Date.now()
    await page.getByRole('button', { name: 'Start the exam' }).click()
    await page.locator('#question-1').waitFor({ timeout: 90_000 })
    met.startMs = Date.now() - pressed

    // Every page of the paper: an option of each question, the right one for
    // the share of them this student knows, then Next.
    met.stage = 'answering'
    const until = plan.opensAt + plan.minutes * 60_000 - 60_000
    for (;;) {
      await sleep(AFTER_A_PAGE_MS)
      const questions = page.locator('section[id^="question-"]')
      const count = await questions.count()
      for (let i = 0; i < count; i += 1) {
        const options = questions.nth(i).locator('label')
        const texts = await options.allTextContents()
        const right = texts.findIndex((text) => text.includes('(right)'))
        const pick = Math.random() < phone.share && right !== -1 ? right : Math.floor(Math.random() * texts.length)
        await options.nth(pick).click()
        met.answered += 1
        await sleep(250 + Math.random() * 900)
      }
      met.pages += 1
      await seesNoConnection()
      // Every picture on this page has loaded, or says it has not.
      const broken = await page.evaluate(() => [...document.querySelectorAll('main img, section img')].filter((img) => img.complete && img.naturalWidth === 0).length)
      if (broken) met.errors.push(`${broken} picture${broken === 1 ? '' : 's'} on page ${met.pages} did not load`)
      const next = page.getByRole('button', { name: 'Next', exact: true })
      if (Date.now() > until || !(await next.isVisible().catch(() => false))) break
      await next.click()
    }

    met.stage = 'handing in'
    await sleep(AFTER_A_PAGE_MS)
    const toReview = page.getByRole('button', { name: 'Review and hand in', exact: true })
    if (await toReview.isVisible().catch(() => false)) await toReview.click()
    else await page.getByRole('button', { name: 'Review', exact: true }).click()
    await page.getByRole('heading', { name: 'Review and hand in' }).waitFor({ timeout: 30_000 })
    // Everything tapped is saved before the hand-in is pressed, as a student would wait for the tick.
    await page.getByText('All answers saved', { exact: false }).first().waitFor({ timeout: 60_000 }).catch(() => met.errors.push('the page never said "All answers saved" on the review'))
    const handed = Date.now()
    await page.getByRole('button', { name: 'Hand in', exact: true }).click()
    await sleep(900)
    await page.getByRole('button', { name: 'Hand in for good', exact: true }).click()
    await page.getByRole('heading', { name: 'Your exam was received.' }).waitFor({ timeout: 90_000 })
    met.handInMs = Date.now() - handed
    met.stage = 'received'
    met.ok = true
  } catch (err) {
    met.errors.push(`while ${met.stage}: ${err.message.split('\n')[0]}`)
  }
  await page.screenshot({ path: path.join(plan.shots, `phone-${phone.tag}.png`) }).catch(() => {})
  await context.close()
  return met
}

mkdirSync(plan.shots, { recursive: true })
const browser = await chromium.launch()
const met = await Promise.all(plan.phones.map((phone, index) => sitOn(browser, phone, index)))
await browser.close()
console.log(`PHONES ${JSON.stringify(met)}`)
