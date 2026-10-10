// The scripted rehearsal of the exchange exam: a mock exam sat by a few
// hundred made-up students at the same time, to prove before the day that the
// database lets the right people in, keeps every answer and marks the papers
// correctly while 400 phones are saving at once, and to see how long a start
// and a save take when they do.
//
// It only ever talks to a LOCAL Supabase stack (the one `supabase start` runs
// in Docker; .github/workflows/exam-rehearsal.yml starts one on a runner). It
// never touches the hosted project: before it reads a key or sends a byte it
// looks at the API address and stops unless the host is 127.0.0.1 or
// localhost, it follows no redirect, and the hosted project's address and
// keys appear nowhere in it. What it makes (the mock exam, a second small one,
// their accounts and one officer's position) it deletes again before it ends.
//
// What it does, over HTTP as the phones and the portal do:
//   1. As the service role: makes sure there is a current term, then makes a
//      mock exam (ready, open now, closing in two hours, 60 minutes long,
//      with a start code), its questions and their key, and the list of
//      student IDs: one for each taker and a few that nobody uses. Each
//      option's text says which of the officers' options it is and whether
//      it is the right one, so a taker here can find it on a shuffled paper.
//   2. Makes the takers' accounts through the Auth admin API, and one exam
//      officer: a SCOPE officer position of its own, with the account's
//      address as its work email, because an officer's position can only be
//      held by its work email.
//   3. Signs each account's token itself with the stack's JWT secret, as the
//      stack signs its own keys, so no sign-in limit is ever met.
//   4. Plays every taker, some at a time: the door, the details and the ID
//      (a few give an ID that is not on the list first, one tries an ID that
//      is already held), the start code (a few give a wrong one first), the
//      paper, the answers a page of ten at a time with some changed and some
//      flagged, then the review and the hand-in. A few are left sitting, and
//      a few are moved past their deadline and must find their next save
//      refused. The script decides what each taker answers, so it knows
//      every grade before the database marks anything. Then the closing time
//      is moved into the past while a few papers are still being sat: closing
//      only stops new starts, so a running paper must keep its own deadline
//      and go on being saved, and an account that has not started must be
//      told the exam has closed.
//   5. As a taker and as a visitor who is not signed in: tries to read the
//      key, the questions, the list, the attempts and the answers, and to
//      call the officers' functions. Nothing may come back.
//   6. As the officer: reads the ranking, the question figures and a few
//      papers, and compares every score, rank, state and count with its own.
//      Then makes the requests the portal's Exam page makes on its own
//      account, which the set-up above (the service role's) never met: the
//      exam with its counts, the questions with their key, a question moved
//      and moved back, and a second exam made from a title alone, filled
//      through the officers' functions, and deleted again.
//   7. Prints how long the calls took and what happened.
//   8. Deletes the exam and the accounts, and checks the exam's rows are gone.
//
// It ends with 0 when everything matched, with 1 when anything did not (each
// line says which taker and what was expected), and with 2 when it refused to
// run. Timings are printed and are never a reason to fail.
//
// To run it (it needs Docker and Node 22 or newer, so normally: Actions >
// exam-rehearsal > Run workflow):
//   supabase start
//   supabase status -o env > stack.env
//   node --env-file=stack.env scripts/exam-rehearsal.mjs
//
// It reads, as `supabase status -o env` prints them: API_URL, JWT_SECRET,
// SERVICE_ROLE_KEY (or SECRET_KEY) and ANON_KEY (or PUBLISHABLE_KEY). And,
// all optional: TAKERS (400), QUESTIONS (100), CONCURRENCY (50, how many
// takers play at a time) and SEED (to play a run's parts again).
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { appendFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Ten questions a page, as on the phones (PAGE_SIZE in src/exam/sitting.js).
const PAGE = 10
const MINUTES = 60
const OPTION_LETTERS = ['A', 'B', 'C', 'D']
const SPARE_IDS = 5
const TIMEOUT_MS = 30_000
// How long the first call waits for a stack that has only just been started.
const WARM_UP_MS = 30_000
// A phone sends a failed save again; so does a taker here, after these waits.
const RETRY_WAITS = [500, 1000, 2000]
// As FACULTY_YEARS in src/portal/constants.js.
const FACULTY_YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6', 'Intern', 'Graduate', 'Other']
// .test is reserved for testing and can never be a real mailbox.
const EMAIL_DOMAIN = 'exam-rehearsal.test'
const HOW =
  'Give it the values of a local stack: supabase status -o env > stack.env, then node --env-file=stack.env scripts/exam-rehearsal.mjs'

// ---------------------------------------------------------------------------
// Small pure parts (exported so they can be tested without a stack)
// ---------------------------------------------------------------------------

// The one rule that keeps this script away from the hosted project: the API
// address must be http(s) on 127.0.0.1 or localhost. Returns the origin to
// call, or null for anything else.
export function localApi(address) {
  let url
  try {
    url = new URL(String(address ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null
  return `${url.protocol}//${url.host}`
}

const b64url = (text) => Buffer.from(text).toString('base64url')

// The signature of an HS256 token: HMAC-SHA256 of "<header>.<payload>".
export function hs256(signingInput, secret) {
  return createHmac('sha256', secret).update(signingInput).digest('base64url')
}

// A token signed with the stack's JWT secret, in the shape the local stack
// gives its own anon and service role keys (HS256, no key id), which is what
// its gateway, PostgREST and Auth accept.
export function signToken(claims, secret) {
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  return `${input}.${hs256(input, secret)}`
}

// A token's parts without trusting it; null when it is not a JWT at all.
export function readToken(token) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) return null
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()),
      claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString()),
      signedBy(secret) {
        const want = Buffer.from(hs256(`${parts[0]}.${parts[1]}`, secret))
        const got = Buffer.from(parts[2])
        return want.length === got.length && timingSafeEqual(want, got)
      },
    }
  } catch {
    return null
  }
}

// Arabic-Indic (U+0660 to U+0669) and Persian (U+06F0 to U+06F9) digits read
// as Western ones. Written with code points so that no character in this
// file is one an editor cannot show.
const westernDigits = (text) =>
  [...String(text ?? '')]
    .map((ch) => {
      const code = ch.codePointAt(0)
      if (code >= 0x660 && code <= 0x669) return String(code - 0x660)
      if (code >= 0x6f0 && code <= 0x6f9) return String(code - 0x6f0)
      return ch
    })
    .join('')
const arabicDigits = (text) => text.replace(/\d/g, (d) => String.fromCodePoint(0x660 + Number(d)))
const digitsOf = (text) => westernDigits(text).replace(/\D/g, '')

// What app.tidy_student_id drops from an ID beside plain whitespace and the
// separators - . _ / \, as code points, a pair for a run of them: the other
// spaces, what cannot be seen (soft hyphen, zero-width characters, direction
// marks with their embeddings and isolates, word joiner, byte order mark), the
// dashes and the minus sign.
const DROPPED_FROM_AN_ID = [
  0xa0, 0x1680, [0x2000, 0x200a], 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xad, 0x61c, [0x200b, 0x200f], [0x202a, 0x202e], 0x2060, [0x2066, 0x2069], 0xfeff,
  [0x2010, 0x2015], 0x2212,
]

// A student ID as the database compares it (app.tidy_student_id): Arabic-Indic,
// Persian and full-width (U+FF10 to U+FF19) digits as Western ones;
// whitespace, the characters above and the separators - . _ / \ dropped;
// letters in upper case.
export function tidyId(id) {
  const dropped = (code) =>
    DROPPED_FROM_AN_ID.some((one) => (Array.isArray(one) ? code >= one[0] && code <= one[1] : code === one))
  return [...westernDigits(id)]
    .map((ch) => {
      const code = ch.codePointAt(0)
      return code >= 0xff10 && code <= 0xff19 ? String(code - 0xff10) : ch
    })
    .filter((ch) => !/[\s\-._/\\]/.test(ch) && !dropped(ch.codePointAt(0)))
    .join('')
    .toUpperCase()
}

// A small seeded dice, so a run's parts can be played again from its seed.
export function dice(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const below = (n) => Math.floor(next() * n)
  return {
    next,
    below,
    chance: (share) => next() < share,
    pick: (list) => list[below(list.length)],
    shuffle(list) {
      const out = [...list]
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = below(i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}

// The median, the 95th percentile and the slowest of a list of durations.
export function spread(list) {
  const sorted = [...list].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return { count: 0, median: 0, p95: 0, slowest: 0 }
  return {
    count: n,
    median: (sorted[(n - 1) >> 1] + sorted[n >> 1]) / 2,
    p95: sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)],
    slowest: sorted[n - 1],
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

class Refusal extends Error {}

function wholeNumber(env, name, fallback, min, max) {
  const raw = String(env[name] ?? '').trim()
  if (raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Refusal(`${name} must be a whole number from ${min} to ${max}, not "${raw}".`)
  }
  return n
}

export function readSettings(env) {
  // Where, before anything else: no key is read and nothing is sent until
  // the address has passed.
  const given = String(env.API_URL ?? '').trim()
  if (given === '') throw new Refusal(`API_URL is not set. ${HOW}`)
  const api = localApi(given)
  if (!api) {
    throw new Refusal(
      `API_URL is ${given.slice(0, 200)}, which is not a local stack. This script runs only against 127.0.0.1 or localhost and never against the hosted project.`,
    )
  }

  const value = (name) => String(env[name] ?? '').trim()
  const jwtSecret = value('JWT_SECRET')
  const serviceKey = value('SERVICE_ROLE_KEY') || value('SECRET_KEY')
  const anonKey = value('ANON_KEY') || value('PUBLISHABLE_KEY')
  const missing = [
    !jwtSecret && 'JWT_SECRET',
    !serviceKey && 'SERVICE_ROLE_KEY (or SECRET_KEY)',
    !anonKey && 'ANON_KEY (or PUBLISHABLE_KEY)',
  ].filter(Boolean)
  if (missing.length) {
    // CLI 2.117 prints all of them; a later one may stop printing the secret
    const hint = jwtSecret
      ? ''
      : ' (if your CLI no longer prints JWT_SECRET, set it by hand to the JWT secret of the stack: auth.jwt_secret in supabase/config.toml, or the default of the CLI)'
    throw new Refusal(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ${HOW}${hint}`)
  }

  // A service role key that is a signed token must be one this secret
  // signed: then the tokens signed here are accepted wherever it is.
  const service = readToken(serviceKey)
  if (service) {
    if (service.header.alg !== 'HS256') {
      throw new Refusal(
        `SERVICE_ROLE_KEY is signed with ${service.header.alg}, not HS256: this stack signs with keys of its own (auth.signing_keys_path in supabase/config.toml) and would not accept the tokens this script signs with JWT_SECRET.`,
      )
    }
    if (!service.signedBy(jwtSecret)) {
      throw new Refusal(
        'JWT_SECRET did not sign SERVICE_ROLE_KEY, so the two are not from the same stack. Take both from one run of supabase status -o env.',
      )
    }
    if (service.claims.role !== 'service_role') {
      throw new Refusal(`SERVICE_ROLE_KEY is a token for the role ${service.claims.role}, not service_role.`)
    }
  }

  return {
    api,
    jwtSecret,
    serviceKey,
    anonKey,
    takers: wholeNumber(env, 'TAKERS', 400, 1, 5000),
    questions: wholeNumber(env, 'QUESTIONS', 100, 1, 500),
    concurrency: wholeNumber(env, 'CONCURRENCY', 50, 1, 500),
    seed: wholeNumber(env, 'SEED', Math.floor(Math.random() * 2 ** 31), 0, 2 ** 32 - 1),
  }
}

// ---------------------------------------------------------------------------
// The run's state
// ---------------------------------------------------------------------------

let cfg // the settings, once they have been read
const run = randomUUID().slice(0, 8) // in every name this run makes, so two runs never collide
const exam = {
  id: randomUUID(),
  title: `Rehearsal exam ${run}`,
  word: `rehearsal-${run}`,
  code: '',
  spareIds: [], // on the list, and no taker's
}
const officer = { email: `officer.${run}@${EMAIL_DOMAIN}`, name: 'Rehearsal Officer', id: null, token: '' }
let term = null
let questions = [] // in the officers' order
const byId = new Map() // question id -> question
let takers = []
// Taker 2 tries the ID of taker 1, so it waits here until taker 1 holds it.
const firstHolder = Promise.withResolvers()
// What this run made and must delete again. `draftId` is the second exam, the
// one the officer makes and deletes; it is set only while that exam is there.
const made = { termId: null, positionId: null, examId: null, draftId: null, userIds: [] }

const timings = new Map() // function name -> how long each call took, in ms
const tally = { calls: 0, retried: 0 }
const failures = []
const lines = [] // everything said, for the job summary

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))
const brief = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) return 'nothing'
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

function say(line = '') {
  console.log(line)
  lines.push(line)
}

// A mismatch: the run goes on, and ends with 1. `t` is the taker it is about,
// or null when it is about the exam as a whole.
function miss(t, message) {
  failures.push({ tag: t?.tag ?? null, message })
}

// The mismatches as lines to print. One that many takers share is said once,
// with how many and the first of them, so a fault that meets every taker does
// not bury the rest.
function failureLines() {
  const shared = new Map()
  for (const { tag, message } of failures) {
    if (!shared.has(message)) shared.set(message, new Set())
    if (tag) shared.get(message).add(tag)
  }
  return [...shared].map(([message, tags]) => {
    if (tags.size === 0) return message
    if (tags.size === 1) return `taker ${[...tags][0]}: ${message}`
    const first = [...tags].sort().slice(0, 3).join(', ')
    return `${tags.size} takers (${first}${tags.size > 3 ? ' and others' : ''}): ${message}`
  })
}

function same(t, what, got, want) {
  if (got !== want) miss(t, `${what} should be ${JSON.stringify(want)}, but is ${brief(got)}`)
}

// A mismatch after which this taker cannot go on.
class Stop extends Error {}
function stop(message) {
  throw new Stop(message)
}

// Runs the work over a list, `size` at a time. When one fails, nothing new is
// begun, what is under way is let finish, and then the first failure is
// thrown: nothing goes on running behind the caller's back, so the clean-up
// sees everything that was made.
async function pool(list, size, work) {
  let next = 0
  let failed = false
  let failure
  const worker = async () => {
    while (!failed && next < list.length) {
      const item = list[next]
      next += 1
      try {
        await work(item)
      } catch (err) {
        if (!failed) failure = err
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker))
  if (failed) throw failure
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

// One request to the local stack. `as` is the token it is made with; `apikey`
// is the key a browser sends beside it. With `again`, a call the network or
// the gateway dropped (no answer, 502, 503, 504) is sent again, as a phone
// does; with `timed`, how long it took is kept under that name.
async function call(method, path, { as, apikey = as, body, prefer, again = false, timed } = {}) {
  const headers = { apikey, Authorization: `Bearer ${as}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  for (let attempt = 0; ; attempt += 1) {
    const began = performance.now()
    let problem
    let gateway = false // the gateway itself answered, for an API that did not
    try {
      const res = await fetch(cfg.api + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      const ms = performance.now() - began
      if (![502, 503, 504].includes(res.status)) {
        let data = null
        if (text !== '') {
          try {
            data = JSON.parse(text)
          } catch {
            data = text
          }
        }
        tally.calls += 1
        if (timed) {
          if (!timings.has(timed)) timings.set(timed, [])
          timings.get(timed).push(ms)
        }
        return { status: res.status, ok: res.ok, data, ms, range: res.headers.get('content-range'), retried: attempt }
      }
      problem = `the gateway answered ${res.status}`
      gateway = true
    } catch (err) {
      problem =
        err.name === 'TimeoutError'
          ? `no answer in ${TIMEOUT_MS / 1000} seconds`
          : err.cause?.code || err.cause?.message || err.message
    }
    if (!again || attempt >= RETRY_WAITS.length) {
      throw Object.assign(new Error(`${method} ${path.split('?')[0]}: ${problem}`), { gateway })
    }
    if (timed) tally.retried += 1
    await sleep(RETRY_WAITS[attempt])
  }
}

// As the service role, for the set-up and the clean-up: anything but success
// stops with what the stack said. A read, a change or a delete that was
// dropped on the way is sent again; an insert is not, because sent twice it
// would collide with itself.
async function service(what, method, path, options = {}) {
  const res = await call(method, path, { as: cfg.serviceKey, again: method !== 'POST', ...options })
  if (!res.ok) throw new Error(`${what}: the stack answered ${res.status} ${brief(res.data)}`)
  return res.data
}

// How many rows a filter matches, counted by the database.
async function howMany(table, filter) {
  const res = await call('GET', `/rest/v1/${table}?${filter}&limit=1`, {
    as: cfg.serviceKey,
    prefer: 'count=exact',
    again: true,
  })
  const total = Number(String(res.range ?? '').split('/')[1])
  if (!res.ok || !Number.isInteger(total)) {
    throw new Error(`counting ${table}: the stack answered ${res.status} ${brief(res.data)}`)
  }
  return total
}

// A function called as a signed-in account would call it from a browser: the
// anon key as the apikey, the account's own token as the bearer.
const rpc = (name, args, token) =>
  call('POST', `/rest/v1/rpc/${name}`, { as: token, apikey: cfg.anonKey, body: args, again: true, timed: name })

// A taker's call that must go through: a refusal ends this taker's part.
async function ask(t, name, args) {
  const res = await rpc(name, args, t.token)
  if (!res.ok) stop(`${name} should be answered, but the stack refused it: ${res.status} ${brief(res.data)}`)
  return res
}

// ---------------------------------------------------------------------------
// The cast: the questions, and what each taker will do
// ---------------------------------------------------------------------------

function writeQuestions(roll) {
  return Array.from({ length: cfg.questions }, (_, i) => {
    const n = i + 1
    const correct = roll.below(OPTION_LETTERS.length)
    return {
      id: randomUUID(),
      n,
      correct,
      // a few keep their options in the officers' order
      keep: cfg.questions < 10 ? i === 0 : n % 10 === 0,
      body: `Rehearsal question ${n}. Which option is marked right?`,
      options: OPTION_LETTERS.map((letter, o) => `Q${n} option ${letter} (${o === correct ? 'right' : 'wrong'})`),
    }
  })
}

// One taker's answers, by question in the officers' order. `final` is the
// option they end on (the officers' index, or null for none), `first` the
// one they send before changing their mind, `flag` whether it ends flagged
// and `flagFirst` whether it is flagged on the page and cleared in review.
// The right ones are chosen first, so the grade is known before anyone sits.
function planAnswers(roll) {
  const count = questions.length
  const share = Math.min(1, Math.max(0, 0.62 + (roll.next() + roll.next() + roll.next() - 1.5) * 0.3))
  const right = Math.round(count * share)
  const blank = Math.min(count - right, Math.round(count * roll.pick([0, 0, 0.04, 0.12])))
  const answers = new Array(count)
  roll.shuffle([...questions.keys()]).forEach((qi, at) => {
    const { correct } = questions[qi]
    const wrong = (not = correct) => roll.pick([0, 1, 2, 3].filter((o) => o !== correct && o !== not))
    let final = null
    if (at < right) final = correct
    else if (at < count - blank) final = wrong()
    const answer = { final, flag: roll.chance(0.08), flagFirst: false }
    if (roll.chance(0.12)) {
      if (final === correct) answer.first = wrong()
      else if (final === null) answer.first = roll.below(4)
      else answer.first = roll.chance(0.5) ? correct : wrong(final)
    } else if (!answer.flag && roll.chance(0.04)) {
      answer.flagFirst = true
    }
    answers[qi] = answer
  })
  return { answers, right }
}

function castTakers(roll) {
  const n = cfg.takers
  const width = Math.max(4, String(n).length)
  const tag = (k) => String(k).padStart(width, '0')
  const few = (share) => (n < 3 ? 0 : Math.max(1, Math.round(n * share)))

  // How each one ends. Takers 1 and 2 are kept plain: one holds an ID and
  // the other tries it.
  const rest = roll.shuffle(Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 2))
  const ending = new Map()
  const take = (count, how) => rest.splice(0, count).forEach((i) => ending.set(i, how))
  take(few(0.02), 'sitting')
  take(few(0.015), 'timed out')
  take(n >= 20 ? 1 : 0, 'late')
  const handsIn = (i) => i >= 2 && !ending.has(i)
  const some = (share, among = (i) => i >= 2) =>
    new Set(roll.shuffle([...Array(n).keys()].filter(among)).slice(0, few(share)))
  const unlisted = some(0.02)
  const wrongCode = some(0.02)
  const doubleTaps = some(0.02)
  const refreshes = some(0.05)
  const junk = some(0.01)
  const edits = some(0.02)
  const checksAfter = some(0.03, handsIn)

  const list = []
  for (let i = 0; i < n; i += 1) {
    const k = i + 1
    const listedId = `M2026-${tag(k)}`
    const phone = `010${20000000 + k}`
    // one in forty shares the name and the answers of the taker before, so
    // the ranking has papers that only their attempt's id can order
    const twin = i % 40 === 11 && handsIn(i) && handsIn(i - 1) ? list[i - 1] : null
    const name = `Rehearsal Taker ${tag(k)}`
    const plan = twin ? { answers: twin.answers, right: twin.aimsFor } : planAnswers(dice(cfg.seed ^ Math.imul(k, 0x9e3779b1)))
    list.push({
      index: i,
      tag: tag(k),
      email: `taker-${tag(k)}.${run}@${EMAIL_DOMAIN}`,
      // typed in three ways: the ranking orders names without regard to case
      name: twin ? twin.name : [name, name.toUpperCase(), name.toLowerCase()][i % 3],
      year: FACULTY_YEARS[i % FACULTY_YEARS.length],
      phone: [phone, `+20 ${phone.slice(1, 4)} ${phone.slice(4, 8)} ${phone.slice(8)}`, arabicDigits(phone)][i % 3],
      // the ID as the officers listed it, and as this taker types it
      listedId,
      typedId: [listedId, `m2026${tag(k)}`, ` M 2026 ${tag(k)} `, `M${arabicDigits('2026')}-${arabicDigits(tag(k))}`][i % 4],
      unlistedId: unlisted.has(i) ? `M2099-${tag(k)}` : null,
      triesHeld: i === 1 ? `m 2026 ${tag(1)}` : null,
      newPhone: edits.has(i) ? `011${30000000 + k}` : null,
      wrongCodeFirst: wrongCode.has(i),
      doubleTaps: doubleTaps.has(i),
      refreshes: refreshes.has(i),
      sendsJunk: junk.has(i),
      checksAfter: checksAfter.has(i),
      ending: ending.get(i) ?? 'hand in',
      answers: plan.answers,
      aimsFor: plan.right,
      // filled in as the run goes
      id: null,
      token: '',
      attemptId: null,
      startedAt: null,
      deadlineAt: null,
      sheet: null, // its paper, kept for a taker who is left sitting
      paperOrder: '',
      shuffled: 0,
      clockAhead: 0, // the database's clock minus this machine's, in ms
      ledger: new Map(), // question id -> { c: the officers' index or null, f } as the database acknowledged it
      handedIn: false,
      moved: false,
      broken: false,
    })
  }
  return list
}

// ---------------------------------------------------------------------------
// 1. The exam, as the service role
// ---------------------------------------------------------------------------

async function setUp() {
  // Is anything there, and is it a stack that has the exam? On a runner this
  // comes seconds after the stack was started: while the API behind the
  // gateway is still coming up the gateway answers 502 or 503 for it, and
  // that is waited out for half a minute. Nothing listening at all is said
  // at once.
  let terms
  const until = performance.now() + WARM_UP_MS
  for (;;) {
    try {
      terms = await call('GET', '/rest/v1/terms?select=id,label&is_current=is.true', { as: cfg.serviceKey })
      break
    } catch (err) {
      if (!err.gateway) {
        throw new Error(`nothing answers at ${cfg.api} (${err.message}). Start the local stack first: supabase start`)
      }
      if (performance.now() > until) {
        throw new Error(`the API of the stack at ${cfg.api} did not come up in ${WARM_UP_MS / 1000} seconds (${err.message})`)
      }
      await sleep(1500)
    }
  }
  if (!terms.ok) {
    throw new Error(`the stack did not let the service role read the terms: ${terms.status} ${brief(terms.data)}`)
  }
  const probe = await call('GET', '/rest/v1/exams?select=id&limit=1', { as: cfg.serviceKey, again: true })
  if (!probe.ok) {
    throw new Error(
      `this stack has no exam tables (${probe.status} ${brief(probe.data)}). Is supabase/migrations/20261010120001_exchange_exam.sql applied?`,
    )
  }

  term = terms.data[0]
  if (!term) {
    const today = new Date()
    const nextYear = new Date(today.getTime() + 365 * 864e5)
    ;[term] = await service('adding a current term', 'POST', '/rest/v1/terms', {
      body: {
        label: `rehearsal-${run}`,
        starts_on: today.toISOString().slice(0, 10),
        ends_on: nextYear.toISOString().slice(0, 10),
        is_current: true,
      },
      prefer: 'return=representation',
    })
    made.termId = term.id
  }

  // A draft first, made ready once its questions and its list are in, as the
  // officers do it. Open for ten minutes already, so a clock that is a little
  // off between this machine and the database's changes nothing.
  const roll = dice(cfg.seed)
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const typedCode = `HALL-${Array.from({ length: 4 }, () => roll.pick([...letters])).join('')}`
  const now = Date.now()
  const [draft] = await service('adding the mock exam', 'POST', '/rest/v1/exams', {
    body: {
      id: exam.id,
      title: exam.title,
      address_word: exam.word,
      minutes: MINUTES,
      start_code: typedCode,
      opens_at: new Date(now - 10 * 60_000).toISOString(),
      closes_at: new Date(now + 120 * 60_000).toISOString(),
    },
    prefer: 'return=representation',
  })
  made.examId = exam.id
  exam.code = draft.start_code

  questions = writeQuestions(roll)
  for (const q of questions) byId.set(q.id, q)
  await service('adding the questions', 'POST', '/rest/v1/exam_questions', {
    body: questions.map((q) => ({
      id: q.id,
      exam_id: exam.id,
      sort: q.n,
      body: q.body,
      options: q.options,
      keep_option_order: q.keep,
    })),
  })
  await service('adding the key', 'POST', '/rest/v1/exam_key', {
    body: questions.map((q) => ({ question_id: q.id, correct_option: q.correct })),
  })

  takers = castTakers(roll)
  const spare = Array.from({ length: SPARE_IDS }, (_, i) => `M2027-${String(i + 1).padStart(4, '0')}`)
  exam.spareIds = spare
  for (const part of chunks([...takers.map((t) => t.listedId), ...spare], 500)) {
    await service('adding the list of student IDs', 'POST', '/rest/v1/exam_registrations', {
      body: part.map((id) => ({ exam_id: exam.id, student_id: id })),
    })
  }

  const [ready] = await service('making the exam ready', 'PATCH', `/rest/v1/exams?id=eq.${exam.id}`, {
    body: { status: 'ready' },
    prefer: 'return=representation',
  })
  if (ready?.status !== 'ready') throw new Error(`the exam should be ready now, but is ${brief(ready)}`)

  say(
    `Set up in the term ${term.label}: "${exam.title}" at /exam/${exam.word}, ${plural(questions.length, 'question')} ` +
      `(options kept in the officers' order on ${questions.filter((q) => q.keep).length}), ` +
      `${takers.length + spare.length} IDs on the list (${spare.length} that no taker uses), start code ${exam.code}.`,
  )
}

// ---------------------------------------------------------------------------
// 2 and 3. The accounts and their tokens
// ---------------------------------------------------------------------------

async function makeAccount(email, name) {
  const user = await service(`making the account ${email}`, 'POST', '/auth/v1/admin/users', {
    body: { email, email_confirm: true, user_metadata: { full_name: name } },
  })
  if (!user?.id) throw new Error(`making the account ${email}: the auth server gave no id (${brief(user)})`)
  made.userIds.push(user.id)
  // What a session's token carries, signed here so no sign-in is needed. It
  // says when it ends and not when it was issued, as the stack's own keys do:
  // the API of CLI 2.117 (PostgREST 16.2) now and then reads its clock late
  // after standing idle and would refuse a token as "issued at future" (put
  // right in 16.3), and one that names no such moment cannot meet that.
  const token = signToken(
    { sub: user.id, role: 'authenticated', aud: 'authenticated', email, exp: Math.floor(Date.now() / 1000) + 6 * 3600 },
    cfg.jwtSecret,
  )
  return { id: user.id, token }
}

async function makeAccounts() {
  const began = performance.now()

  // The officer. An officer's position is held only by its work email
  // (public.position_work_emails), so the rehearsal gets a SCOPE officer
  // position of its own and leaves the real ones and their addresses alone.
  const scope = await service('reading the SCOPE committee', 'GET', '/rest/v1/committees?select=id&slug=eq.scope')
  if (!scope[0]) throw new Error('the stack has no committee with the slug scope: the reference data is missing')
  Object.assign(officer, await makeAccount(officer.email, officer.name))
  const [position] = await service('adding an officer position for the rehearsal', 'POST', '/rest/v1/positions', {
    body: {
      key: `scope.exam-rehearsal-${run}`,
      committee_id: scope[0].id,
      title: `Exam rehearsal officer ${run}`,
      short_title: 'Rehearsal',
      level: 'officer',
      sort: 99,
    },
    prefer: 'return=representation',
  })
  made.positionId = position.id
  await service('setting the work email of the position', 'POST', '/rest/v1/position_work_emails', {
    body: { position_id: position.id, email: officer.email },
  })
  await service('giving the officer the position', 'POST', '/rest/v1/assignments', {
    body: { profile_id: officer.id, position_id: position.id, term_id: term.id },
  })

  // Before 400 more accounts are made: does the API take a token signed
  // here, and does the position make its holder an exam officer?
  const hello = await rpc('exam_door', { p_word: `no-exam-${run}` }, officer.token)
  if (hello.status === 401) {
    throw new Error(`the local API did not accept a token signed with JWT_SECRET: ${brief(hello.data)}`)
  }
  if (!hello.ok || !hello.data || hello.data.exam !== null) {
    throw new Error(
      `exam_door for a word that no exam has should answer {"exam":null}, but the stack answered ${hello.status} ${brief(hello.data)}`,
    )
  }
  const seen = await call('GET', `/rest/v1/exams?select=id&id=eq.${exam.id}`, {
    as: officer.token,
    apikey: cfg.anonKey,
    again: true,
  })
  if (!seen.ok || seen.data.length !== 1) {
    throw new Error(
      `the officer should be able to read the exam, but the stack answered ${seen.status} ${brief(seen.data)}: its position did not make it an exam officer`,
    )
  }

  // Each account costs the auth server one password hash, so not too many at once.
  await pool(takers, Math.min(cfg.concurrency, 20), async (t) => {
    Object.assign(t, await makeAccount(t.email, t.name))
  })
  say(
    `Made accounts for ${plural(takers.length, 'taker')} and one exam officer in ${seconds(performance.now() - began)}, ` +
      'and signed their tokens here.',
  )
}

// ---------------------------------------------------------------------------
// 4. One taker
// ---------------------------------------------------------------------------

const PAPER_FIELDS = {
  top: ['state', 'exam', 'attempt', 'now', 'questions', 'answers'],
  exam: ['title', 'minutes'],
  attempt: ['id', 'started_at', 'deadline_at'],
  question: ['id', 'body', 'options'],
  answer: ['q', 'c', 'f'],
}
const SAVE_FIELDS = ['state', 'submitted', 'saved', 'deadline_at', 'now']
const extra = (object, allowed) => Object.keys(object ?? {}).filter((key) => !allowed.includes(key))

// Nothing a taker is sent may name the key, a grade or the officers' order.
function noHints(t, name, value) {
  const found = new Set()
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') {
      for (const [key, inner] of Object.entries(node)) {
        if (/correct|score|grade|rank|right|mark|key|order/i.test(key)) found.add(key)
        walk(inner)
      }
    }
  }
  walk(value)
  if (found.size) miss(t, `${name} should say nothing of the key or a grade, but has the field ${[...found].join(', ')}`)
}

// Reads a paper as the taker's phone gets it and returns its questions in
// this taker's order, each with `shownAt`: where each of the officers'
// options stands on this paper. Every question once, every option once.
function readPaper(t, paper) {
  if (paper?.state !== 'sitting' || !Array.isArray(paper.questions)) {
    stop(`exam_paper should give its paper, but answered ${brief(paper)}`)
  }
  // Only the fields of the contract: any other could carry the key.
  const strangers = [
    ...extra(paper, PAPER_FIELDS.top),
    ...extra(paper.exam, PAPER_FIELDS.exam).map((key) => `exam.${key}`),
    ...extra(paper.attempt, PAPER_FIELDS.attempt).map((key) => `attempt.${key}`),
    ...new Set(paper.questions.flatMap((q) => extra(q, PAPER_FIELDS.question).map((key) => `questions.${key}`))),
    ...new Set((paper.answers ?? []).flatMap((a) => extra(a, PAPER_FIELDS.answer).map((key) => `answers.${key}`))),
  ]
  if (strangers.length) {
    miss(t, `exam_paper should carry only the fields the phone needs, but also has ${strangers.join(', ')}`)
  }
  if (paper.questions.length !== questions.length) {
    stop(`its paper should have ${questions.length} questions, but has ${paper.questions.length}`)
  }

  const seen = new Set()
  return paper.questions.map((shown, at) => {
    const q = byId.get(shown.id)
    if (!q) stop(`place ${at + 1} of its paper holds ${brief(shown.id)}, which is not a question of the exam`)
    if (seen.has(q.id)) stop(`its paper should show question ${q.n} once, but shows it twice`)
    seen.add(q.id)
    if (shown.body !== q.body) stop(`question ${q.n} should read "${q.body}", but its paper has ${brief(shown.body)}`)
    // An option's text says which of the officers' options it is.
    const shownAt = new Array(OPTION_LETTERS.length).fill(-1)
    const options = Array.isArray(shown.options) ? shown.options : []
    options.forEach((text, place) => {
      const told = /^Q(\d+) option ([A-D]) \((?:right|wrong)\)$/.exec(text)
      const o = told && Number(told[1]) === q.n ? OPTION_LETTERS.indexOf(told[2]) : -1
      if (o === -1 || shownAt[o] !== -1) {
        stop(`question ${q.n} should show its own four options once each, but its paper has ${brief(options)}`)
      }
      shownAt[o] = place
    })
    if (options.length !== OPTION_LETTERS.length) {
      stop(`question ${q.n} should show four options, but its paper has ${brief(options)}`)
    }
    const inOrder = shownAt.every((place, o) => place === o)
    if (q.keep && !inOrder) {
      miss(t, `question ${q.n} keeps its options in the officers' order, but its paper has ${brief(options)}`)
    }
    if (!q.keep && !inOrder) t.shuffled += 1
    return { ...q, qi: q.n - 1, shownAt }
  })
}

// What each kind of save must answer; n is how many answers it carried.
const SAVES = {
  saved: { when: 'while sitting', answer: (n) => ({ state: 'sitting', submitted: false, saved: n }), kept: true },
  'handed in': { when: 'that hands in', answer: (n) => ({ state: 'over', submitted: true, saved: n }), kept: true },
  late: { when: 'a few seconds past its deadline', answer: (n) => ({ submitted: false, saved: n }), kept: true },
  refused: {
    when: 'more than 30 seconds past its deadline',
    answer: () => ({ state: 'over', submitted: false, saved: 0 }),
    kept: false,
  },
  closed: { when: 'after handing in', answer: () => ({ state: 'over', submitted: true, saved: 0 }), kept: false },
}

// Sends answers as the phone does: each as the place of the chosen option on
// this taker's own paper. Only what the database says it saved goes into the
// taker's ledger, which is what the marking is compared with at the end.
async function send(t, items, kind = 'saved', junk = []) {
  const answers = [...items.map(({ q, c, f }) => ({ q: q.id, c: c === null ? null : q.shownAt[c], f })), ...junk]
  const args = { p_word: exam.word, p_answers: answers, p_hand_in: kind === 'handed in' }
  const res = await ask(t, 'exam_save', args)
  const got = res.data
  const odd = extra(got, SAVE_FIELDS)
  if (odd.length) miss(t, `exam_save should answer only ${SAVE_FIELDS.join(', ')}, but also has ${odd.join(', ')}`)
  // A save meant to land a few seconds late is judged by the database's own
  // clock: on a stack so slow that it arrived after the 30 seconds, being
  // refused is the right answer, and slowness is never held against a run.
  if (kind === 'late' && Date.parse(got?.now) - Date.parse(got?.deadline_at) > 30_000) kind = 'refused'
  const want = SAVES[kind].answer(items.length)
  // A hand-in that had to be sent again may have landed the first time: the
  // second then finds the paper handed in already and saves nothing more.
  const landedBefore =
    kind === 'handed in' && res.retried > 0 && got?.state === 'over' && got.submitted === true && got.saved === 0
  if (!landedBefore && Object.keys(want).some((key) => got?.[key] !== want[key])) {
    stop(`a save ${SAVES[kind].when} should answer ${JSON.stringify(want)}, but answered ${brief(got)}`)
  }
  if (SAVES[kind].kept) for (const { q, c, f } of items) t.ledger.set(q.id, { c, f })
  if (kind === 'handed in') t.handedIn = true
  if (got.now) t.clockAhead = Date.parse(got.now) - Date.now()
  return got
}

// Up to ten answers that would change this taker's marks if they were saved:
// the right option where they have not got it, a wrong one where they have.
const tamper = (t, sheet) =>
  sheet.slice(-PAGE).map((q) => ({
    q,
    c: t.ledger.get(q.id)?.c === q.correct ? (q.correct + 1) % OPTION_LETTERS.length : q.correct,
    f: false,
  }))

// A refresh in the middle: the start asks no code again, the paper comes in
// the same order, and every answer comes back at the place it was chosen.
async function refresh(t, sheet) {
  const again = (await ask(t, 'exam_start', { p_word: exam.word, p_code: '' })).data
  if (again?.ok !== true || again.attempt_id !== t.attemptId) {
    miss(t, `exam_start after a refresh should answer ok with the same attempt, but answered ${brief(again)}`)
  }
  const paper = (await ask(t, 'exam_paper', { p_word: exam.word })).data
  const second = readPaper(t, paper)
  const places = (list) => list.map((q) => `${q.id}:${q.shownAt.join('')}`).join(',')
  if (places(second) !== places(sheet)) {
    miss(t, 'its paper after a refresh should have the same order of questions and options, but it differs')
  }
  const back = new Map((paper.answers ?? []).map((a) => [a.q, a]))
  const wrong = []
  for (const q of sheet) {
    const mine = t.ledger.get(q.id)
    const want = mine ? { c: mine.c === null ? null : q.shownAt[mine.c], f: mine.f } : { c: null, f: false }
    const have = back.get(q.id) ?? { c: null, f: false }
    if ((have.c ?? null) !== want.c || Boolean(have.f) !== want.f) {
      wrong.push(`question ${q.n} should be ${JSON.stringify(want)} and is ${brief({ c: have.c, f: have.f })}`)
    }
  }
  if (wrong.length) {
    miss(
      t,
      `after a refresh every answer should come back at the place it was chosen on this paper, but ${wrong.length} do not: ` +
        `${wrong.slice(0, 3).join('; ')}${wrong.length > 3 ? '; and more' : ''}`,
    )
  }
}

async function play(t) {
  const word = { p_word: exam.word }

  // The door, before anything is known about them.
  const door = (await ask(t, 'exam_door', word)).data
  if (!door?.exam) stop(`exam_door should show the exam, but answered ${brief(door)}`)
  noHints(t, 'exam_door', door)
  same(t, 'the title at the door', door.exam.title, exam.title)
  same(t, 'the phase at the door', door.exam.phase, 'open')
  same(t, 'the minutes at the door', door.exam.minutes, MINUTES)
  same(t, 'the number of questions at the door', door.exam.questions, questions.length)
  same(t, 'its registration before it gives an ID', door.registration, 'none')
  same(t, 'its attempt before it starts', door.attempt, null)
  same(t, 'its email at the door', door.me?.email, t.email)

  // The details and the ID.
  const details = (studentId) => ({
    ...word,
    p_full_name: t.name,
    p_faculty_year: t.year,
    p_phone: t.phone,
    p_student_id: studentId,
  })
  if (t.triesHeld) {
    if (!(await firstHolder.promise)) stop(`it was to try the ID of taker ${takers[0].tag}, who never came to hold it`)
    const got = (await ask(t, 'exam_save_details', details(t.triesHeld))).data
    same(t, `the answer to an ID that taker ${takers[0].tag} holds (typed "${t.triesHeld}")`, got?.registration, 'taken')
  }
  if (t.unlistedId) {
    const got = (await ask(t, 'exam_save_details', details(t.unlistedId))).data
    same(t, `the answer to an ID that is not on the list (${t.unlistedId})`, got?.registration, 'not_listed')
    const early = (await ask(t, 'exam_start', { ...word, p_code: exam.code })).data
    if (early?.ok !== false || early.reason !== 'not_registered') {
      miss(t, `exam_start before it holds an ID should answer not_registered, but answered ${brief(early)}`)
    }
  }
  const held = (await ask(t, 'exam_save_details', details(t.typedId))).data
  if (held?.registration !== 'held') {
    stop(
      `exam_save_details with its own ID ${t.listedId} (typed "${t.typedId}") should answer held, but answered ${brief(held)}`,
    )
  }
  noHints(t, 'exam_save_details', held)
  same(t, 'the student ID kept on its profile, tidied', tidyId(held.me?.student_id), tidyId(t.listedId))
  if (t.index === 0) firstHolder.resolve(true)
  if (t.newPhone) {
    // "Edit my details": the same ID again with another phone number
    t.phone = t.newPhone
    const edited = (await ask(t, 'exam_save_details', details(t.typedId))).data
    same(t, 'the answer when it edits its details and keeps its ID', edited?.registration, 'held')
  }

  // The start code.
  if (t.wrongCodeFirst) {
    const res = await ask(t, 'exam_start', { ...word, p_code: 'NOT-THE-CODE' })
    if (res.data?.ok !== false || res.data.reason !== 'code') {
      miss(t, `exam_start with a wrong code should answer code, but answered ${brief(res.data)}`)
    } else if (!res.retried && res.data.tries_left !== 7) {
      miss(t, `exam_start with a first wrong code should leave 7 tries, but answered ${brief(res.data)}`)
    }
    const rows = await service(
      `looking for an attempt of taker ${t.tag}`,
      'GET',
      `/rest/v1/exam_attempts?select=id&exam_id=eq.${exam.id}&profile_id=eq.${t.id}`,
    )
    if (rows.length) miss(t, 'a wrong start code should make no attempt, but exam_attempts has one for it')
  }
  // typed as it was heard: in lower case, or with a space in it
  const typedCode = [exam.code, `  ${exam.code.toLowerCase()} `, `${exam.code.slice(0, 4)} ${exam.code.slice(4)}`][
    t.index % 3
  ]
  const taps = await Promise.all(
    Array.from({ length: t.doubleTaps ? 2 : 1 }, () => ask(t, 'exam_start', { ...word, p_code: typedCode })),
  )
  for (const { data } of taps) {
    if (data?.ok !== true || !data.attempt_id) {
      stop(`exam_start with the start code (typed "${typedCode}") should answer ok with its attempt, but answered ${brief(data)}`)
    }
    noHints(t, 'exam_start', data)
  }
  if (new Set(taps.map((tap) => tap.data.attempt_id)).size !== 1) {
    miss(t, 'two taps on Start at once should make one attempt, but each got its own')
  }
  t.attemptId = taps[0].data.attempt_id

  // The paper.
  const paper = (await ask(t, 'exam_paper', word)).data
  const sheet = readPaper(t, paper)
  t.paperOrder = sheet.map((q) => q.n).join(',')
  t.startedAt = paper.attempt?.started_at
  t.deadlineAt = paper.attempt?.deadline_at
  same(t, 'the attempt on its paper', paper.attempt?.id, t.attemptId)
  same(t, 'the answers on a paper just started', (paper.answers ?? []).length, 0)
  same(
    t,
    'the minutes from its start to its deadline',
    (Date.parse(paper.attempt?.deadline_at) - Date.parse(paper.attempt?.started_at)) / 60_000,
    MINUTES,
  )

  // The answers, a page at a time. A taker who is left sitting stops half
  // way; one whose time is to run out, a third of the way.
  const pages = chunks(sheet, PAGE)
  const reaches = { sitting: 1 / 2, 'timed out': 1 / 3, late: 1 / 3 }[t.ending]
  const pagesDone = reaches ? Math.max(1, Math.floor(pages.length * reaches)) : pages.length
  for (let p = 0; p < pagesDone; p += 1) {
    const items = pages[p].flatMap((q) => {
      const answer = t.answers[q.qi]
      const c = answer.first !== undefined ? answer.first : answer.final
      const f = answer.flag || answer.flagFirst
      return c === null && !f ? [] : [{ q, c, f }]
    })
    // What a phone that was tampered with might add: none of it may be
    // saved or counted, and none of it may lose the rest of the page.
    const junk =
      t.sendsJunk && p === 0
        ? [
            { q: randomUUID(), c: 0, f: false },
            { q: 'not-a-question', c: 0, f: false },
            ...(pages.length > 1 ? [{ q: sheet.at(-1).id, c: 99, f: true }] : []),
          ]
        : []
    if (items.length || junk.length) await send(t, items, 'saved', junk)
    if (p === 0) {
      // the heartbeat: nothing saved, and the deadline as the paper gave it
      const beat = await send(t, [])
      same(t, 'the deadline a heartbeat gives', Date.parse(beat.deadline_at), Date.parse(paper.attempt?.deadline_at))
    }
    if (t.refreshes && p === Math.min(1, pagesDone - 1)) await refresh(t, sheet)
  }
  if (t.ending === 'sitting') {
    // its paper is still running when the exam is closed to new starts, below
    t.sheet = sheet
    return
  }

  if (t.ending === 'timed out' || t.ending === 'late') {
    // The service role moves the start back, so the deadline has passed:
    // by two minutes, or by eight seconds, which is inside the 30 seconds a
    // save already on its way is given.
    const behind = MINUTES * 60 + (t.ending === 'late' ? 8 : 120)
    const startedAt = new Date(Date.now() + t.clockAhead - behind * 1000).toISOString()
    const rows = await service(
      `moving the start of taker ${t.tag} back`,
      'PATCH',
      `/rest/v1/exam_attempts?id=eq.${t.attemptId}`,
      { body: { started_at: startedAt }, prefer: 'return=representation' },
    )
    if (rows.length !== 1) stop('the service role should be able to move its start back, but no attempt changed')
    t.startedAt = startedAt
    t.moved = true
    await send(t, tamper(t, sheet), t.ending === 'late' ? 'late' : 'refused')
    const after = (await ask(t, 'exam_paper', word)).data
    if (after?.state !== 'over' || after.submitted !== false || extra(after, ['state', 'submitted']).length) {
      miss(
        t,
        `exam_paper past its deadline should answer only {"state":"over","submitted":false}, but answered ${brief(after)}`,
      )
    }
    return
  }

  // The review: every changed mind and every flag that is cleared, then the
  // hand-in, which for half of them carries the last of those answers.
  const review = chunks(
    sheet.flatMap((q) => {
      const answer = t.answers[q.qi]
      return answer.first !== undefined || answer.flagFirst ? [{ q, c: answer.final, f: answer.flag }] : []
    }),
    PAGE,
  )
  const withHandIn = t.index % 2 === 0 ? (review.pop() ?? []) : []
  for (const items of review) await send(t, items)
  await send(t, withHandIn, 'handed in')

  if (t.checksAfter) {
    // After the hand-in: nothing more is saved, and no question is shown.
    await send(t, tamper(t, sheet).slice(0, 1), 'closed')
    const after = (await ask(t, 'exam_paper', word)).data
    if (after?.state !== 'over' || after.submitted !== true || extra(after, ['state', 'submitted']).length) {
      miss(
        t,
        `exam_paper after handing in should answer only {"state":"over","submitted":true}, but answered ${brief(after)}`,
      )
    }
    const last = (await ask(t, 'exam_door', word)).data
    noHints(t, 'exam_door', last)
    if (last?.attempt?.over !== true || !last.attempt.submitted_at) {
      miss(t, `exam_door after handing in should show its attempt as over and handed in, but answered ${brief(last?.attempt)}`)
    }
  }
}

async function playAll() {
  // only the takers' own calls are timed and counted from here
  timings.clear()
  tally.retried = 0
  const began = performance.now()
  await pool(takers, cfg.concurrency, async (t) => {
    try {
      await play(t)
    } catch (err) {
      t.broken = true
      miss(t, err instanceof Stop ? err.message : `stopped by an error: ${err.message}`)
    } finally {
      // whatever happened to taker 1, taker 2 must not wait for ever
      if (t.index === 0) firstHolder.resolve(false)
    }
  })
  const took = performance.now() - began

  // Each paper is in an order of its own.
  const sat = takers.filter((t) => t.paperOrder)
  if (sat.length >= 5 && questions.length >= 8 && new Set(sat.map((t) => t.paperOrder)).size === 1) {
    miss(null, 'every paper should have its questions in an order of its own, but all have the same order')
  }
  const couldShuffle = sat.length * questions.filter((q) => !q.keep).length
  if (couldShuffle >= 20 && sat.every((t) => t.shuffled === 0)) {
    miss(null, 'the options of a question should come in an order of its own on each paper, but none was shuffled')
  }
  return took
}

// ---------------------------------------------------------------------------
// 4, continued. After the closing time
// ---------------------------------------------------------------------------

// The closing time is only the last moment at which a student may START.
// Every taker has the exam's full length from their own start, so closing
// never cuts a running paper short, and the officers may move the closing
// time at any moment. Here it is moved into the past while a few papers are
// still being sat: a running paper must keep its own deadline and go on being
// saved, and an account that has not started must be told the exam has closed.
async function closeToNewStarts() {
  const word = { p_word: exam.word }
  const running = takers.find((t) => t.sheet && !t.broken)
  // by the database's clock, as the takers' saves have shown it
  const ahead = (running ?? takers.find((t) => t.handedIn))?.clockAhead ?? 0
  const moved = await call('PATCH', `/rest/v1/exams?id=eq.${exam.id}`, {
    as: cfg.serviceKey,
    body: { closes_at: new Date(Date.now() + ahead - 60_000).toISOString() },
    prefer: 'return=representation',
    again: true,
  })
  if (!moved.ok || moved.data?.length !== 1) {
    miss(
      null,
      'the closing time should be free to move earlier while papers are being sat (it only decides who may still start), ' +
        `but the stack answered ${moved.status} ${brief(moved.data)}`,
    )
    return
  }

  if (running) {
    try {
      const beat = await send(running, [])
      same(
        running,
        "the deadline of a paper still being sat after the closing time (its own start and the exam's length)",
        Date.parse(beat.deadline_at),
        Date.parse(running.deadlineAt),
      )
      await send(running, tamper(running, running.sheet).slice(0, 1))
      const door = (await ask(running, 'exam_door', word)).data
      same(running, 'the phase at the door after the closing time', door?.exam?.phase, 'closed')
      if (door?.attempt?.id !== running.attemptId || door.attempt.over !== false) {
        miss(running, `exam_door after the closing time should show its paper as still running, but answered ${brief(door?.attempt)}`)
      }
      const paper = (await ask(running, 'exam_paper', word)).data
      same(running, 'the state of its paper after the closing time', paper?.state, 'sitting')
    } catch (err) {
      miss(running, `after the closing time, ${err instanceof Stop ? err.message : `it was stopped by an error: ${err.message}`}`)
    }
  }

  // Somebody who comes after the closing time: an ID on the list, the right
  // start code, and no paper.
  const late = { tag: 'latecomer', email: `latecomer.${run}@${EMAIL_DOMAIN}`, name: 'Rehearsal Latecomer' }
  try {
    Object.assign(late, await makeAccount(late.email, late.name))
    const held = (
      await ask(late, 'exam_save_details', {
        ...word,
        p_full_name: late.name,
        p_faculty_year: FACULTY_YEARS[0],
        p_phone: '01055500000',
        p_student_id: exam.spareIds[0],
      })
    ).data
    if (held?.registration !== 'held') {
      stop(`exam_save_details with an ID on the list (${exam.spareIds[0]}) should answer held after the closing time too, but answered ${brief(held)}`)
    }
    const start = (await ask(late, 'exam_start', { ...word, p_code: exam.code })).data
    if (start?.ok !== false || start.reason !== 'closed') {
      miss(late, `exam_start after the closing time should answer closed, but answered ${brief(start)}`)
    }
    const rows = await service(
      'looking for an attempt of the latecomer',
      'GET',
      `/rest/v1/exam_attempts?select=id&exam_id=eq.${exam.id}&profile_id=eq.${late.id}`,
    )
    if (rows.length) miss(late, 'a start after the closing time should make no attempt, but exam_attempts has one for it')
  } catch (err) {
    miss(late, err instanceof Stop ? err.message : `stopped by an error: ${err.message}`)
  }

  const sitting = takers.filter((t) => t.sheet).length
  say(
    `Moved the closing time into the past while ${plural(sitting, 'paper')} ${sitting === 1 ? 'was' : 'were'} still being sat: ` +
      `${running ? 'sent a save on one of them, and ' : ''}tried to start as an account that had not started.`,
  )
}

// ---------------------------------------------------------------------------
// 5. What must be refused
// ---------------------------------------------------------------------------

const EXAM_TABLES = ['exams', 'exam_key', 'exam_questions', 'exam_registrations', 'exam_attempts', 'exam_answers']

const examRows = async () => ({
  questions: await howMany('exam_questions', `select=id&exam_id=eq.${exam.id}`),
  registrations: await howMany('exam_registrations', `select=id&exam_id=eq.${exam.id}`),
  attempts: await howMany('exam_attempts', `select=id&exam_id=eq.${exam.id}`),
})

async function tryWhatMustBeRefused() {
  const done = takers.find((t) => t.handedIn && !t.broken)
  const sitting = takers.find((t) => t.attemptId && !t.broken && t.ending === 'sitting')
  const sample = [done, sitting].filter(Boolean)
  if (sample.length === 0) {
    miss(null, 'no taker got as far as a paper, so nothing could be tried as a taker')
    return
  }
  const [registration] = await service(
    'reading one row of the list',
    'GET',
    `/rest/v1/exam_registrations?select=id&exam_id=eq.${exam.id}&limit=1`,
  )
  if (!registration) throw new Error('the list of student IDs should still have its rows, but has none')
  const before = await examRows()
  let tried = 0

  // Refused outright (42501), by the function itself or by its grant.
  const refused = (who, what, res) => {
    tried += 1
    if (res.ok || res.data?.code !== '42501') {
      miss(null, `${who} ${what} should be refused (42501), but the stack answered ${res.status} ${brief(res.data)}`)
    }
  }
  // Refused, or answered with no row at all.
  const nothing = (who, what, res) => {
    tried += 1
    const empty = res.ok && Array.isArray(res.data) && res.data.length === 0
    if (!empty && res.data?.code !== '42501') {
      miss(null, `${who} ${what} should get nothing, but the stack answered ${res.status} ${brief(res.data)}`)
    }
  }
  // The officers' functions, with real ids: were one let through, it would
  // show in the marking as well.
  const officersCalls = (attemptId) => [
    ['exam_results', { p_exam: exam.id }],
    ['exam_question_stats', { p_exam: exam.id }],
    ['exam_registration_list', { p_exam: exam.id }],
    ['exam_sheet', { p_attempt: attemptId }],
    ['exam_add_registrations', { p_exam: exam.id, p_ids: ['M2098-0001'] }],
    ['exam_release_registration', { p_registration: registration.id }],
    [
      'save_exam_question',
      {
        p_exam: exam.id,
        p_question: questions[0].id,
        p_body: questions[0].body,
        p_options: questions[0].options,
        p_correct: (questions[0].correct + 1) % OPTION_LETTERS.length,
        p_keep_order: false,
      },
    ],
    [
      'import_exam_questions',
      { p_exam: exam.id, p_rows: [{ body: 'Slipped in', options: ['One', 'Two'], correct: 0, keep_order: false }] },
    ],
    ['exam_delete_attempt', { p_attempt: attemptId }],
  ]

  for (const t of sample) {
    const who = `taker ${t.tag}`
    // a refusal changes nothing, so a call the gateway dropped can be sent again
    const as = { as: t.token, apikey: cfg.anonKey, again: true }
    for (const table of EXAM_TABLES) {
      nothing(who, `reading ${table}`, await call('GET', `/rest/v1/${table}?select=*&limit=3`, as))
    }
    for (const [name, args] of officersCalls(t.attemptId)) {
      refused(who, `calling ${name}`, await rpc(name, args, t.token))
    }
    // What a taker might write directly to help themselves.
    const write = (method, path, body) => call(method, `/rest/v1/${path}`, { ...as, body, prefer: 'return=representation' })
    const later = new Date(Date.now() + 3600_000).toISOString()
    nothing(
      who,
      'moving its own start later',
      await write('PATCH', `exam_attempts?id=eq.${t.attemptId}`, { started_at: later, submitted_at: null }),
    )
    nothing(
      who,
      'writing an answer directly',
      await write('POST', 'exam_answers', { attempt_id: t.attemptId, question_id: questions[0].id, chosen_option: 0 }),
    )
    nothing(who, 'changing the key', await write('PATCH', `exam_key?question_id=eq.${questions[0].id}`, { correct_option: 0 }))
    nothing(who, 'changing its student ID directly', await write('PATCH', `profiles?id=eq.${t.id}`, { student_id: 'M2026-0000' }))
  }

  // A visitor who is not signed in: no table, and no function at all.
  const who = 'a visitor who is not signed in'
  for (const table of EXAM_TABLES) {
    nothing(who, `reading ${table}`, await call('GET', `/rest/v1/${table}?select=*&limit=3`, { as: cfg.anonKey, again: true }))
  }
  const takersCalls = [
    ['exam_door', { p_word: exam.word }],
    [
      'exam_save_details',
      { p_word: exam.word, p_full_name: 'Nobody At All', p_faculty_year: 'Year 1', p_phone: '01000000000', p_student_id: 'M2027-0001' },
    ],
    ['exam_start', { p_word: exam.word, p_code: exam.code }],
    ['exam_paper', { p_word: exam.word }],
    ['exam_save', { p_word: exam.word, p_answers: [] }],
  ]
  for (const [name, args] of [...takersCalls, ...officersCalls(sample[0].attemptId)]) {
    refused(who, `calling ${name}`, await rpc(name, args, cfg.anonKey))
  }

  const after = await examRows()
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    miss(null, `the refused calls should change nothing, but the exam's rows went from ${brief(before)} to ${brief(after)}`)
  }
  say(
    `Tried ${tried} reads, writes and calls that must be refused, as ${sample.length === 1 ? 'a taker' : 'two takers'} ` +
      'and as a visitor who is not signed in.',
  )
}

// ---------------------------------------------------------------------------
// 6. The marking, as the officer reads it
// ---------------------------------------------------------------------------

// A taker's marks as this script works them out, from what the database
// acknowledged and the key the script wrote.
function marksOf(t) {
  let score = 0
  let answered = 0
  for (const [id, answer] of t.ledger) {
    if (answer.c === null) continue
    answered += 1
    if (answer.c === byId.get(id).correct) score += 1
  }
  return { score, answered, state: t.handedIn ? 'handed_in' : t.moved ? 'timed_out' : 'sitting' }
}

const instant = (text) => (text ? Date.parse(text) : null)

async function compareMarking() {
  const sat = takers.filter((t) => t.attemptId)
  const sound = sat.filter((t) => !t.broken)
  const marks = new Map(sat.map((t) => [t, marksOf(t)]))
  // A taker who stopped early has a paper this script cannot vouch for, and
  // every rank and count depends on every paper.
  const whole = sound.length === sat.length
  if (!whole) {
    say(`${sat.length - sound.length} takers stopped early, so the ranks, the order and the question figures are not compared.`)
  }

  // The ranking.
  const read = await rpc('exam_results', { p_exam: exam.id }, officer.token)
  const rows = read.data?.attempts
  if (!read.ok || !Array.isArray(rows)) {
    miss(null, `exam_results as the officer should give the ranking, but the stack answered ${read.status} ${brief(read.data)}`)
    return
  }
  same(null, 'the number of questions in exam_results', read.data.questions, questions.length)
  same(null, 'the number of papers in exam_results', rows.length, sat.length)
  const byAttempt = new Map(rows.map((row) => [row.attempt_id, row]))
  const scores = [...marks.values()].map((m) => m.score)
  for (const t of sound) {
    const row = byAttempt.get(t.attemptId)
    const want = marks.get(t)
    if (!row) {
      miss(t, 'exam_results should list its paper, but does not')
      continue
    }
    same(t, 'its score', row.score, want.score)
    same(t, 'its number of answers', row.answered, want.answered)
    same(t, 'its state', row.state, want.state)
    if (whole) same(t, 'its rank', row.rank, 1 + scores.filter((score) => score > want.score).length)
    same(t, 'its student ID in the ranking, as the list spells it', row.student_id, t.listedId)
    same(t, 'its account in the ranking', row.profile_id, t.id)
    same(t, 'its name in the ranking', row.full_name, t.name)
    same(t, 'its email in the ranking', row.email, t.email)
    same(t, 'its year in the ranking', row.faculty_year, t.year)
    same(t, 'the digits of its phone in the ranking', digitsOf(row.phone), digitsOf(t.phone))
    same(t, 'its start in the ranking', instant(row.started_at), instant(t.startedAt))
    const deadline = instant(t.startedAt) + MINUTES * 60_000
    if (want.state === 'handed_in') {
      if (!row.submitted_at) miss(t, 'a paper that was handed in should have the time of its hand-in, but has none')
      same(t, 'the end of a paper that was handed in', instant(row.finished_at), instant(row.submitted_at))
      const took = (instant(row.submitted_at) - instant(row.started_at)) / 1000
      if (!(Math.abs(row.seconds - took) <= 1)) {
        miss(t, `its time taken should be ${Math.round(took)} seconds, from its start to its hand-in, but is ${brief(row.seconds)}`)
      }
    } else if (want.state === 'timed_out') {
      same(t, 'the hand-in of a paper whose time ran out', row.submitted_at, null)
      same(t, 'the end of a paper whose time ran out (its deadline)', instant(row.finished_at), deadline)
      same(t, 'the time taken by a paper whose time ran out', row.seconds, MINUTES * 60)
    } else {
      same(t, 'the hand-in of a paper still being sat', row.submitted_at, null)
      same(t, 'the end of a paper still being sat', row.finished_at, null)
      same(t, 'the time taken by a paper still being sat', row.seconds, null)
    }
  }
  if (whole && rows.length === sat.length) {
    // Highest score first, then the name without regard to case, then the
    // attempt's id.
    const text = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
    const expected = [...sat].sort(
      (a, b) =>
        marks.get(b).score - marks.get(a).score ||
        text(a.name.toLowerCase(), b.name.toLowerCase()) ||
        text(a.attemptId, b.attemptId),
    )
    const off = expected.findIndex((t, place) => rows[place].attempt_id !== t.attemptId)
    if (off !== -1) {
      const there = sat.find((t) => t.attemptId === rows[off].attempt_id)
      miss(
        expected[off],
        `it should stand at place ${off + 1} of the ranking (score ${marks.get(expected[off]).score}, name "${expected[off].name}"), ` +
          `but ${there ? `taker ${there.tag}` : 'a paper of no taker'} stands there`,
      )
    }
  }

  // The figures of each question.
  const figures = await rpc('exam_question_stats', { p_exam: exam.id }, officer.token)
  if (!figures.ok || !Array.isArray(figures.data?.questions)) {
    miss(null, `exam_question_stats as the officer should give the figures, but the stack answered ${figures.status} ${brief(figures.data)}`)
  } else if (whole) {
    same(null, 'the number of papers in exam_question_stats', figures.data.attempts, sat.length)
    same(null, 'the number of questions in exam_question_stats', figures.data.questions.length, questions.length)
    const counts = questions.map(() => OPTION_LETTERS.map(() => 0))
    for (const t of sat) {
      for (const [id, answer] of t.ledger) if (answer.c !== null) counts[byId.get(id).n - 1][answer.c] += 1
    }
    questions.forEach((q, i) => {
      const row = figures.data.questions[i]
      const want = counts[i]
      if (row?.question_id !== q.id || row.n !== q.n) {
        miss(null, `question ${q.n} should stand at place ${q.n} of exam_question_stats, but ${brief(row?.question_id)} stands there`)
        return
      }
      same(null, `the right option of question ${q.n} in exam_question_stats`, row.correct, q.correct)
      if (JSON.stringify(row.counts) !== JSON.stringify(want)) {
        miss(null, `question ${q.n} should count ${JSON.stringify(want)} takers for its options, but exam_question_stats counts ${brief(row.counts)}`)
      }
      same(null, `the takers who answered question ${q.n}`, row.answered, want.reduce((sum, n) => sum + n, 0))
      same(null, `the takers who got question ${q.n} right`, row.right, want[q.correct])
    })
  }

  // One paper of each kind, answer by answer.
  let sheets = 0
  let sheetMs = 0
  for (const how of ['hand in', 'sitting', 'timed out', 'late']) {
    const t = sound.find((one) => one.ending === how)
    if (!t) continue
    const res = await rpc('exam_sheet', { p_attempt: t.attemptId }, officer.token)
    const paper = res.data?.rows
    if (!res.ok || !Array.isArray(paper)) {
      miss(t, `exam_sheet as the officer should give its paper, but the stack answered ${res.status} ${brief(res.data)}`)
      continue
    }
    sheets += 1
    sheetMs = Math.max(sheetMs, res.ms)
    const want = marks.get(t)
    same(t, 'its score on its sheet', res.data.attempt?.score, want.score)
    same(t, 'its number of answers on its sheet', res.data.attempt?.answered, want.answered)
    same(t, 'its state on its sheet', res.data.attempt?.state, want.state)
    same(t, 'the number of questions on its sheet', paper.length, questions.length)
    const wrong = []
    questions.forEach((q, i) => {
      const row = paper[i]
      const mine = t.ledger.get(q.id) ?? { c: null, f: false }
      const good =
        row?.question_id === q.id &&
        row.n === q.n &&
        row.correct === q.correct &&
        (row.chosen ?? null) === mine.c &&
        Boolean(row.flagged) === mine.f &&
        JSON.stringify(row.options) === JSON.stringify(q.options)
      if (!good) {
        wrong.push(
          `question ${q.n} should show right ${q.correct}, chosen ${mine.c}, flagged ${mine.f}, but shows ` +
            brief({ n: row?.n, correct: row?.correct, chosen: row?.chosen, flagged: row?.flagged }),
        )
      }
    })
    if (wrong.length) {
      miss(
        t,
        `its sheet differs in ${plural(wrong.length, 'question')}: ${wrong.slice(0, 3).join('; ')}${wrong.length > 3 ? '; and more' : ''}`,
      )
    }
  }

  say(
    `Compared ${plural(sound.length, 'paper')} with the ranking, ${plural(whole ? questions.length : 0, 'question')} ` +
      `with their figures and ${plural(sheets, 'paper')} answer by answer. ` +
      `The officer's reads took: exam_results ${Math.round(read.ms)} ms, ` +
      `exam_question_stats ${Math.round(figures.ms)} ms, exam_sheet ${Math.round(sheetMs)} ms at most.`,
  )
}

// ---------------------------------------------------------------------------
// 6, continued. The portal's own reads and writes, as the officer
// ---------------------------------------------------------------------------

// The portal's Exam page reads and writes the exam's tables directly, through
// row-level security and the column grants, and everything above was set up
// as the service role, which passes both. So the page's own requests are made
// here once, as the officer and in the page's own words
// (src/portal/examQueries.js): the exam with its three counts, the questions
// with the key beside each, a question moved and moved back, and a second
// exam made from a title alone, filled, emptied and deleted again.
const EXAM_SELECT = '*,term:terms(label,is_current),exam_questions(count),exam_registrations(count),exam_attempts(count)'
const QUESTION_SELECT = 'id,exam_id,sort,body,options,keep_option_order,updated_at,exam_key(correct_option)'
const QUESTION_ORDER = 'sort.asc,created_at.asc,id.asc'
// The API gives a count asked for in this way as [{ count: n }] ...
const counted = (value) => (Array.isArray(value) ? value[0]?.count : undefined)
// ... and a question's key as an object, or as a list of one.
const keyOf = (row) => (Array.isArray(row?.exam_key) ? row.exam_key[0] : row?.exam_key)?.correct_option

async function readAndWriteAsThePortal() {
  const as = { as: officer.token, apikey: cfg.anonKey }
  const read = (path) => call('GET', `/rest/v1/${path}`, { ...as, again: true })
  // a change or a delete that was dropped on the way is sent again; an insert is not
  const write = (method, path, body, prefer) =>
    call(method, `/rest/v1/${path}`, { ...as, body, prefer, again: method !== 'POST' })
  const fn = (name, args, again = false) => call('POST', `/rest/v1/rpc/${name}`, { ...as, body: args, again })
  const went = (what, res) => {
    if (res.ok) return true
    miss(null, `as the officer, ${what} should go through, but the stack answered ${res.status} ${brief(res.data)}`)
    return false
  }
  const refused = (what, res) => {
    if (res.ok || res.data?.code !== '42501') {
      miss(null, `as the officer, ${what} should be refused (42501), but the stack answered ${res.status} ${brief(res.data)}`)
    }
  }
  const rowsOf = async (examId) => ({
    exams: await howMany('exams', `select=id&id=eq.${examId}`),
    questions: await howMany('exam_questions', `select=id&exam_id=eq.${examId}`),
    registrations: await howMany('exam_registrations', `select=id&exam_id=eq.${examId}`),
  })

  // The exam as the list of exams and the exam's own page read it.
  const one = await read(`exams?select=${EXAM_SELECT}&id=eq.${exam.id}`)
  if (went('reading the exam with its counts', one)) {
    const row = one.data?.[0]
    const own = await examRows()
    same(null, 'the number of exams the officer reads under the id of the mock exam', one.data?.length, 1)
    same(null, 'the term beside the exam (term:terms(label,is_current))', row?.term?.label, term.label)
    same(null, 'the number of questions the service role counts', own.questions, questions.length)
    same(null, 'the questions counted beside the exam (exam_questions(count))', counted(row?.exam_questions), own.questions)
    same(null, 'the IDs counted beside the exam (exam_registrations(count))', counted(row?.exam_registrations), own.registrations)
    same(null, 'the papers counted beside the exam (exam_attempts(count))', counted(row?.exam_attempts), own.attempts)
  }

  // The questions as the Questions tab reads them, the right answer beside each.
  const firstFew = questions.slice(0, 3)
  const list = await read(
    `exam_questions?select=${QUESTION_SELECT}&exam_id=eq.${exam.id}&order=${QUESTION_ORDER}&limit=${firstFew.length}`,
  )
  if (went('reading the questions with their key', list)) {
    firstFew.forEach((q, i) => {
      const row = list.data?.[i]
      if (row?.id !== q.id) {
        miss(null, `question ${q.n} should stand at place ${q.n} of the officer's list, but ${brief(row?.id)} stands there`)
      } else {
        same(null, `the right answer beside question ${q.n} (exam_key(correct_option))`, keyOf(row), q.correct)
      }
    })
  }

  // A drag: a question's place is the one column of it the officer writes
  // directly, also after the first start. Moved far down, then moved back.
  const moved = questions[0]
  const far = questions.length + 1000
  const placeOf = async () =>
    (await service('reading a question back', 'GET', `/rest/v1/exam_questions?select=sort&id=eq.${moved.id}`))[0]?.sort
  if (went('moving a question (its sort)', await write('PATCH', `exam_questions?id=eq.${moved.id}`, { sort: far }))) {
    same(null, 'the place of the question the officer moved', await placeOf(), far)
    if (went('moving the question back', await write('PATCH', `exam_questions?id=eq.${moved.id}`, { sort: moved.n }))) {
      same(null, 'the place of the question the officer moved back', await placeOf(), moved.n)
    }
  }
  refused(
    'rewording a question directly (its wording goes through save_exam_question)',
    await write('PATCH', `exam_questions?id=eq.${moved.id}`, { body: 'Reworded directly' }),
  )

  // A second exam, as the page makes one: a title and nothing else.
  const added = await write('POST', `exams?select=${EXAM_SELECT}`, { title: `Rehearsal draft ${run}` }, 'return=representation')
  if (!went('adding an exam from a title alone', added)) return
  const draft = Array.isArray(added.data) ? added.data[0] : added.data
  if (!draft?.id) {
    miss(null, `adding an exam should give the new row back, but the stack answered ${added.status} ${brief(added.data)}`)
    return
  }
  made.draftId = draft.id
  same(null, 'the status of a new exam', draft.status, 'draft')
  same(null, 'the term of a new exam', draft.term_id, term.id)
  same(null, 'the maker of a new exam', draft.created_by, officer.id)
  same(null, 'the questions counted beside a new exam', counted(draft.exam_questions), 0)
  if (!/^[a-z0-9]{12}$/.test(draft.address_word ?? '')) {
    miss(null, `a new exam should get a random word of twelve letters and digits for its address, but got ${brief(draft.address_word)}`)
  }

  // Its set-up, through the column grants. The database tidies the start code.
  const set = await write(
    'PATCH',
    `exams?id=eq.${draft.id}&select=${EXAM_SELECT}`,
    { minutes: 90, start_code: ' ab cd ' },
    'return=representation',
  )
  if (went('setting the length and the start code of the new exam', set)) {
    same(null, 'the length the officer set', set.data?.[0]?.minutes, 90)
    same(null, 'the start code the officer set, as the database keeps it', set.data?.[0]?.start_code, 'ABCD')
  }
  refused(
    'changing who made an exam (a column the officer does not write)',
    await write('PATCH', `exams?id=eq.${draft.id}`, { created_by: null }),
  )

  // Questions and IDs go in through the functions the page calls. Their
  // arguments are a list of rows and a list of texts, which only the real API
  // shows arriving as the database wants them.
  const single = await fn('save_exam_question', {
    p_exam: draft.id,
    p_question: null,
    p_body: 'Rehearsal draft question',
    p_options: ['One', 'Two'],
    p_correct: 1,
    p_keep_order: false,
  })
  const singleId = typeof single.data === 'string' ? single.data : null
  if (went('adding a question with save_exam_question', single) && !singleId) {
    miss(null, `save_exam_question should answer the new question's id, but answered ${brief(single.data)}`)
  }
  const imported = await fn('import_exam_questions', {
    p_exam: draft.id,
    p_rows: [
      { body: 'Imported question one', options: ['A', 'B', 'C'], correct: 2, keep_order: true },
      { body: 'Imported question two', options: ['Yes', 'No'], correct: 0, keep_order: false },
    ],
  })
  if (went('importing two questions with import_exam_questions', imported)) {
    same(null, 'the number of questions import_exam_questions says it added', imported.data, 2)
  }
  // two IDs, one of them twice in two spellings, and one that is no ID
  const listed = await fn('exam_add_registrations', { p_exam: draft.id, p_ids: ['D-0001', 'd 0001', 'D-0002', ' - '] })
  if (went('adding IDs with exam_add_registrations', listed)) {
    const { added: fresh, already, invalid } = listed.data ?? {}
    same(null, 'what exam_add_registrations says of four items (added, already, invalid)', `${fresh}, ${already}, ${invalid}`, '2, 1, 1')
  }

  if (singleId) {
    const back = await read(`exam_questions?select=${QUESTION_SELECT}&id=eq.${singleId}`)
    if (went('reading the new question with its key', back)) {
      same(null, 'the right answer beside the new question', keyOf(back.data?.[0]), 1)
    }
    // The page's direct deletes: a question, then an ID.
    went('removing a question', await write('DELETE', `exam_questions?id=eq.${singleId}`))
  }
  const ids = await fn('exam_registration_list', { p_exam: draft.id }, true)
  if (went('reading the list of the new exam', ids)) {
    const onList = Array.isArray(ids.data) ? ids.data : []
    same(null, 'the IDs on the list of the new exam, in order', JSON.stringify(onList.map((r) => r.student_id)), JSON.stringify(['D-0001', 'D-0002']))
    if (onList[0]?.id) went('removing an ID from the list', await write('DELETE', `exam_registrations?id=eq.${onList[0].id}`))
  }
  const filled = await read(`exams?select=${EXAM_SELECT}&id=eq.${draft.id}`)
  if (went('reading the new exam with its counts', filled)) {
    const own = await rowsOf(draft.id)
    same(null, 'the questions left in the new exam (three added, one removed)', own.questions, 2)
    same(null, 'the IDs left on the list of the new exam (two added, one removed)', own.registrations, 1)
    same(null, 'the questions counted beside the new exam', counted(filled.data?.[0]?.exam_questions), own.questions)
    same(null, 'the IDs counted beside the new exam', counted(filled.data?.[0]?.exam_registrations), own.registrations)
  }

  // "Delete this exam": the row, and everything of it with it.
  if (went('deleting the new exam', await write('DELETE', `exams?id=eq.${draft.id}`))) {
    const left = await rowsOf(draft.id)
    if (left.exams + left.questions + left.registrations === 0) made.draftId = null
    else miss(null, `the officer's delete should take the exam and every row of it, but ${brief(left)} are left`)
  }

  say(
    'Read and wrote as the portal does, as the officer: the exam with its counts, the questions with their key, ' +
      'a question moved and moved back, and a second exam made from a title, filled, emptied and deleted.',
  )
}

// ---------------------------------------------------------------------------
// 8. The clean-up
// ---------------------------------------------------------------------------

async function cleanUp() {
  const step = async (what, work) => {
    try {
      await work()
      return true
    } catch (err) {
      miss(null, `Clean-up, ${what}: ${err.message}`)
      return false
    }
  }
  const done = []

  if (made.examId) {
    const gone = await step('deleting the mock exam', async () => {
      const res = await call('DELETE', `/rest/v1/exams?id=eq.${made.examId}`, {
        as: cfg.serviceKey,
        prefer: 'return=representation',
        again: true,
      })
      if (!res.ok) throw new Error(`the stack answered ${res.status} ${brief(res.data)}`)
      // sent a second time, the delete may find the exam gone already
      const rows = Array.isArray(res.data) ? res.data.length : 0
      if (rows !== 1 && !(rows === 0 && res.retried)) throw new Error(`one exam should be deleted, but ${rows} were`)
      // Deleting the exam must take everything of it along.
      const left = {
        exams: await howMany('exams', `select=id&id=eq.${made.examId}`),
        exam_questions: await howMany('exam_questions', `select=id&exam_id=eq.${made.examId}`),
        exam_registrations: await howMany('exam_registrations', `select=id&exam_id=eq.${made.examId}`),
        exam_attempts: await howMany('exam_attempts', `select=id&exam_id=eq.${made.examId}`),
        exam_key: 0,
        exam_answers: 0,
      }
      // the key and the answers hang on the questions, whose ids only this exam had
      for (const part of chunks(questions.map((q) => q.id), 40)) {
        left.exam_key += await howMany('exam_key', `select=question_id&question_id=in.(${part.join(',')})`)
        left.exam_answers += await howMany('exam_answers', `select=question_id&question_id=in.(${part.join(',')})`)
      }
      const still = Object.entries(left).filter(([, rowsLeft]) => rowsLeft !== 0)
      if (still.length) {
        throw new Error(
          `none of the exam's rows should be left, but ${still.map(([table, rowsLeft]) => `${table} still has ${rowsLeft}`).join(', ')}`,
        )
      }
    })
    if (gone) done.push('the mock exam and every row of it')
  }

  // The officer deletes the second exam itself; it is still here only when
  // that part stopped half way.
  if (made.draftId) {
    const gone = await step('deleting the second exam, which the officer should have deleted', () =>
      service('deleting the second exam', 'DELETE', `/rest/v1/exams?id=eq.${made.draftId}`),
    )
    if (gone) done.push('the second exam')
  }

  if (made.userIds.length) {
    const gone = await step('deleting the accounts', async () => {
      let kept = 0
      let why = ''
      await pool(made.userIds, 20, async (id) => {
        const res = await call('DELETE', `/auth/v1/admin/users/${id}`, { as: cfg.serviceKey, again: true }).catch(
          (err) => ({ ok: false, status: 0, data: err.message }),
        )
        // 404: gone already, as after a delete that had to be sent twice
        if (res.ok || res.status === 404) return
        kept += 1
        why ||= res.status ? `${res.status} ${brief(res.data)}` : res.data
      })
      if (kept) throw new Error(`every account should be deleted, but ${kept} could not be (the first: ${why})`)
      const profiles = await howMany('profiles', `select=id&email=like.${encodeURIComponent(`*.${run}@${EMAIL_DOMAIN}`)}`)
      if (profiles) throw new Error(`no profile of this run should be left, but ${profiles} are`)
    })
    if (gone) done.push(`${made.userIds.length} accounts`)
  }

  if (made.positionId) {
    const gone = await step('deleting the officer position of the rehearsal', () =>
      service('deleting the position', 'DELETE', `/rest/v1/positions?id=eq.${made.positionId}`),
    )
    if (gone) done.push('the officer position')
  }
  if (made.termId) {
    const gone = await step('deleting the term this run added', () =>
      service('deleting the term', 'DELETE', `/rest/v1/terms?id=eq.${made.termId}`),
    )
    if (gone) done.push('the term it added')
  }
  if (done.length) say(`Cleaned up: ${done.join(', ')} deleted.`)
}

// ---------------------------------------------------------------------------
// 7. What happened
// ---------------------------------------------------------------------------

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

function sayTimings(played, took, sentAgain) {
  const names = ['exam_door', 'exam_save_details', 'exam_start', 'exam_paper', 'exam_save']
  const cell = (ms) => `${Math.round(ms)} ms`.padStart(10)
  say()
  say('Timings of the calls the takers made, as a phone would see them (gateway and API included):')
  say(`  ${'call'.padEnd(18)}${'calls'.padStart(8)}${'median'.padStart(10)}${'95th'.padStart(10)}${'slowest'.padStart(10)}`)
  let calls = 0
  for (const name of names) {
    const { count, median, p95, slowest } = spread(played.get(name) ?? [])
    calls += count
    say(`  ${name.padEnd(18)}${String(count).padStart(8)}${cell(median)}${cell(p95)}${cell(slowest)}`)
  }
  say(
    `  ${calls} calls in ${seconds(took)} with ${cfg.concurrency} takers at a time: ` +
      `${Math.round(calls / (took / 1000))} calls a second. ${sentAgain} had to be sent again.`,
  )
}

function sayCast() {
  const count = (test) => takers.filter(test).length
  const started = count((t) => t.attemptId)
  const aims = takers.filter((t) => t.ending === 'hand in').map((t) => t.aimsFor)
  say(
    `Played ${plural(takers.length, 'taker')}. Started: ${started}. Handed in: ${count((t) => t.handedIn)}. ` +
      `Left sitting: ${count((t) => t.attemptId && t.ending === 'sitting')}. ` +
      `Moved past the deadline, next save refused: ${count((t) => t.moved && t.ending === 'timed out')}. ` +
      `Saved a few seconds after the deadline: ${count((t) => t.moved && t.ending === 'late')}.`,
  )
  say(
    `On the way in. An ID that is not on the list first: ${count((t) => t.unlistedId)}. ` +
      `An ID already held: ${count((t) => t.triesHeld)}. A wrong start code first: ${count((t) => t.wrongCodeFirst)}. ` +
      `Start tapped twice at once: ${count((t) => t.doubleTaps)}. A refresh in the middle: ${count((t) => t.refreshes)}.`,
  )
  if (aims.length) {
    say(`Grades the script aimed for: from ${Math.min(...aims)} to ${Math.max(...aims)} out of ${questions.length}.`)
  }
}

// ---------------------------------------------------------------------------

async function main() {
  try {
    cfg = readSettings(process.env)
  } catch (err) {
    if (!(err instanceof Refusal)) throw err
    console.error(`exam-rehearsal: ${err.message}`)
    process.exit(2)
  }

  const began = performance.now()
  say(`Exam rehearsal against the local stack at ${cfg.api}`)
  say(
    `${plural(cfg.takers, 'taker')}, ${plural(cfg.questions, 'question')}, ${cfg.concurrency} at a time. ` +
      `SEED=${cfg.seed} plays the same parts again.`,
  )

  // Ctrl+C still leaves the stack as it was found.
  process.once('SIGINT', () => {
    say('Interrupted: cleaning up before leaving.')
    cleanUp().finally(() => process.exit(130))
  })

  let played = null
  let took = 0
  let sentAgain = 0
  try {
    await setUp()
    await makeAccounts()
    took = await playAll()
    played = new Map([...timings].map(([name, list]) => [name, [...list]]))
    sentAgain = tally.retried
    sayCast()
    // each on its own: one that stops early must not hide what the others find
    for (const [what, part] of [
      ['Closing the exam to new starts', closeToNewStarts],
      ['Trying what must be refused', tryWhatMustBeRefused],
      ['Comparing the marking', compareMarking],
      ['Reading and writing as the portal does', readAndWriteAsThePortal],
    ]) {
      try {
        await part()
      } catch (err) {
        miss(null, `${what} stopped early: ${err.message}`)
      }
    }
  } catch (err) {
    miss(null, `The rehearsal stopped early: ${err.message}`)
  }
  await cleanUp()
  if (played) sayTimings(played, took, sentAgain)

  say()
  say(`Whole run: ${seconds(performance.now() - began)}, ${tally.calls} requests.`)
  if (failures.length === 0) {
    say('Result: everything matched.')
  } else {
    const found = failureLines()
    say(`Result: ${failures.length} ${failures.length === 1 ? 'thing' : 'things'} did not match.`)
    for (const line of found.slice(0, 60)) say(`  - ${line}`)
    if (found.length > 60) say(`  and ${found.length - 60} more kinds of mismatch.`)
  }

  // On a GitHub runner, the same lines on the run's summary page.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['```', ...lines, '```', ''].join('\n'))
    } catch {
      // the log has them anyway
    }
  }
  process.exitCode = failures.length ? 1 : 0
}

// Only when run as a script: a test may import the parts above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('exam-rehearsal failed:', err)
    process.exit(1)
  })
}
