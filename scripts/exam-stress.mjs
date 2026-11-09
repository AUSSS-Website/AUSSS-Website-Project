// The stress test of the exchange exam: a few hundred made-up students sit a
// mock exam AT THE SAME TIME, each behaving as the exam's page does on a phone,
// to see before the day that the database and the site carry a full hall, lose
// no answer and mark every paper correctly while they do.
//
// It is the companion of scripts/exam-rehearsal.mjs. The rehearsal plays its
// takers some at a time, as fast as the stack answers, and checks every rule
// of the exam. This one keeps all of them in flight together, at a hall's
// pace and then far above it, and measures.
//
// The mock exam is in sections, as the real one is: shared questions, then the
// professional exchange's block (SCOPE) and the research exchange's (SCORE),
// with two passages and a handful of pictures. A third of the takers sit one
// block, a third the other, a third both, and some change their mind half way.
//
// What it does:
//   1. Makes the accounts, two mock exams (the hall exam and a short one for
//      the spikes), their questions, key, passages, pictures and lists.
//   2. THE HALL. Every taker comes to the door before the exam opens and asks
//      it again every 30 seconds, as the page does; when it opens they start
//      within three quarters of a minute of one another, fetch their paper
//      and its pictures, and answer question after question with a pause
//      between taps. Each tap is saved 400 ms later; a phone with nothing to
//      send asks for the time once a minute; some refresh the page, some lose
//      their connection for half a minute and send what piled up, some add or
//      leave out a section. Most hand in. The slow ones are still answering
//      when their time runs out, and send what they hold in the thirty seconds
//      the database allows.
//   3. THE SPIKES, on the short exam: every taker presses Start in the same
//      instant, fetches the paper in the same instant, saves an answer in the
//      same instant, round after round, the last rounds with a second request
//      beside each (twice the hall at once), and hands in in the same instant.
//   4. Reads every paper back as the service role, marks it itself from the
//      key, and compares with what each taker's phone was told was saved:
//      every answer, every choice of sections, both programmes' marks.
//   5. Prints how long everything took and what went wrong, then deletes what
//      it made and checks nothing is left.
//
// WHERE IT RUNS
//
//   A local stack (\`supabase start\`; the exam-rehearsal workflow starts one on
//   a GitHub runner). Tokens are signed here with the stack's JWT secret, as in
//   the rehearsal, so the local sign-in limits are never met:
//
//     supabase status -o env > stack.env
//     node --env-file=stack.env scripts/exam-stress.mjs
//
//   The live project, only when asked in so many words, with its ref typed out:
//
//     node --env-file=.env.local scripts/exam-stress.mjs --live <project ref> --yes
//
//   There every account signs in for real, with a password, through the live
//   sign-in service, and renews its session once. Everything the run makes is
//   named so it can be found again: the exams' titles begin "Stress test,
//   delete me", the accounts' addresses end in the run's own domain. It refuses
//   to start while a real exam is ready and not yet closed. It cleans up when
//   it ends, when it is stopped with Ctrl-C and when it fails, and
//
//     node --env-file=.env.local scripts/exam-stress.mjs --live <project ref> --clean
//
//   removes whatever any earlier run left, and says what it found.
//
// It ends with 0 when everything matched, with 1 when anything did not, and
// with 2 when it refused to run. The timings are measured against the bars
// below and said; they fail the run only with STRICT=1.
//
// SIGNING IN AS WITH GOOGLE, on a throwaway stack only
//
//   A student signs in to the exam with Google. No script can sign made-up
//   students in to the real Google, so on a throwaway stack a stand-in takes
//   its place (scripts/exam-fake-provider.mjs, which the workflow adds to the
//   runner's own stack as one more sign-in provider). With PROVIDER=keycloak
//   every taker's account is then made as a first Google sign-in makes it: the
//   phone is sent to the provider, comes back with a code, and the sign-in
//   service asks the provider who it is, makes the account and hands a session
//   over. ONLY_SIGN_IN=1 stops there: every session is tried at the exam's
//   door, renewed once, all within a minute, and the run ends. The live
//   project is never given such a provider, and this script refuses to use one
//   there: a provider that vouches for any address would let a stranger in as
//   an officer.
//
// Settings, all optional: TAKERS (400), EXAM_MINUTES (the hall exam's length:
// 5 on a local stack, 20 live), LEAD_SECONDS (how long before it opens the
// takers begin to arrive: 75, and 150 live), SPIKE_ROUNDS (10), SEED, STRICT,
// RESULT_FILE (the figures as JSON), and live only:
// SIGN_INS_PER_5_MIN (28: the sign-in service's own limit is 30 from one
// address; 0 when the limit has been raised for the run), EMAIL_DOMAIN. And
// with the site's address in SITE: the exam's page and its files are loaded
// from it once for every phone, and BROWSERS (0, at most 40) of the takers sit
// the hall exam in real headless browsers, through the page itself
// (scripts/exam-stress-phones.mjs), while the rest are played from here.
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeFor } from './exam-fake-provider.mjs'
import { dice, localApi, readToken, signToken } from './exam-rehearsal.mjs'

// ---- the page's own numbers (src/exam/sitting.js, useSitting.js, ExamDoor.jsx) ----
const SEND_AFTER_MS = 400
const HEARTBEAT_MS = 60_000
const DOOR_EVERY_MS = 30_000
const CALL_TIMEOUT_MS = 20_000
const HURRY_TIMEOUT_MS = 8_000
const HURRY_EVERY_MS = 1_500
const LATE_SAVE_MS = 30_000
const BATCH_MAX = 200
const RETRY_WAITS = [2000, 5000, 10000]
const RETRY_EVERY = 15000

// ---- the mock exams ---------------------------------------------------------------
const TAG = 'Stress test, delete me'
const SHARED = 80
const BLOCK = 20
const SPIKE_QUESTIONS = 20
const OPTION_LETTERS = ['A', 'B', 'C', 'D']
const SPARE_IDS = 5
const FACULTY_YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', '1st year intern', '2nd year intern']
const PICTURES = 'exam-pictures'
// A real photo of the size the portal uploads, as every picture of the paper.
const PICTURE_FILE = fileURLToPath(new URL('../public/assets/exchange/incomings/campus.jpg', import.meta.url))

// ---- the bars ---------------------------------------------------------------------
// At a hall's pace a save must feel instant; in a spike nothing may be lost and
// every call must come back well inside the twenty seconds the page waits.
const BARS = { hallP95: 1000, hallP99: 3000, spikeP99: 10_000 }

class Refusal extends Error {}
// Thrown to leave the run early on purpose (ONLY_SIGN_IN): the clean-up and the result still follow.
const ONLY_THAT = Symbol('the run was asked for its first part only')
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
const brief = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text === undefined ? 'nothing' : text.length > 240 ? `${text.slice(0, 240)}...` : text
}
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

// The median, the 95th and 99th percentiles and the slowest of some durations.
export function spreadOf(list) {
  const sorted = [...list].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return { count: 0, median: 0, p95: 0, p99: 0, slowest: 0 }
  const at = (share) => sorted[Math.min(n - 1, Math.ceil(share * n) - 1)]
  return { count: n, median: (sorted[(n - 1) >> 1] + sorted[n >> 1]) / 2, p95: at(0.95), p99: at(0.99), slowest: sorted[n - 1] }
}

// What a failed call means, as the page reads it (failureKind in sitting.js).
export function failureKind(code, status) {
  if (code === '22023' || code === '23505') return 'refused'
  if (code === '42501' || status === 401 || status === 403 || /^PGRST30\d$/.test(String(code || ''))) return 'signed_out'
  return 'offline'
}

// How long the page waits before it tries again.
export const retryDelay = (failures) => RETRY_WAITS[Math.max(1, Math.trunc(failures) || 1) - 1] ?? RETRY_EVERY

// A paper's marks from its answers: `answers` is a Map of question id to the
// chosen option (the officers' index, or null), `questions` a Map of question
// id to { section, correct }, `sits` which blocks the paper sits.
export function marksOf(answers, questions, sits) {
  const out = { shared: 0, scope: 0, score: 0, answered: 0 }
  for (const [id, chosen] of answers) {
    const q = questions.get(id)
    if (!q || chosen === null || chosen === undefined) continue
    const counted = q.section === 'shared' || sits[q.section]
    if (counted) out.answered += 1
    if (chosen === q.correct) out[q.section] += 1
  }
  return {
    shared: out.shared,
    answered: out.answered,
    scope: sits.scope ? out.scope : null,
    score: sits.score ? out.score : null,
    totalScope: sits.scope ? out.shared + out.scope : null,
    totalScore: sits.score ? out.shared + out.score : null,
  }
}

// ---------------------------------------------------------------------------
// Where, and with what
// ---------------------------------------------------------------------------

function wholeNumber(env, name, fallback, min, max) {
  const raw = String(env[name] ?? '').trim()
  if (raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new Refusal(`${name} must be a whole number from ${min} to ${max}, not "${raw}".`)
  return n
}

// The live project is never reached by accident: it takes --live, the
// project's ref typed out, the same ref in the address the environment holds,
// and --yes (or --clean).
export function readSettings(argv, env) {
  const value = (name) => String(env[name] ?? '').trim()
  const flag = (name) => argv.includes(name)
  const liveAt = argv.indexOf('--live')
  const live = liveAt !== -1
  const clean = flag('--clean')
  let api
  let serviceKey
  let anonKey
  let jwtSecret = ''
  let ref = ''
  if (live) {
    ref = String(argv[liveAt + 1] ?? '').trim()
    if (!/^[a-z0-9]{20}$/.test(ref)) throw new Refusal('--live must be followed by the project ref, typed out (twenty lower-case letters and digits).')
    const given = value('VITE_SUPABASE_URL') || value('SUPABASE_URL')
    let host = ''
    try {
      host = new URL(given).host
    } catch {
      // said below
    }
    if (host !== `${ref}.supabase.co`) {
      throw new Refusal(`The address in the environment (${given || 'none'}) is not that project's: nothing was sent. Run it with --env-file=.env.local.`)
    }
    if (!clean && !flag('--yes')) throw new Refusal('A run against the live project also takes --yes. Nothing was sent.')
    api = `https://${ref}.supabase.co`
    serviceKey = value('SUPABASE_SECRET_KEY')
    anonKey = value('VITE_SUPABASE_ANON_KEY')
    if (!serviceKey || !anonKey) throw new Refusal('SUPABASE_SECRET_KEY and VITE_SUPABASE_ANON_KEY must both be set (they are in .env.local).')
    if (/^sb_publishable_/.test(serviceKey) || readToken(serviceKey)?.claims?.role === 'anon') {
      throw new Refusal('SUPABASE_SECRET_KEY holds a publishable key; the stress test needs the secret (service-role) key.')
    }
  } else {
    const given = value('API_URL')
    if (!given) throw new Refusal('API_URL is not set. For a local stack: supabase status -o env > stack.env, then node --env-file=stack.env scripts/exam-stress.mjs')
    api = localApi(given)
    if (!api) throw new Refusal(`API_URL is ${given.slice(0, 200)}, which is not a local stack. The live project takes --live and its ref.`)
    jwtSecret = value('JWT_SECRET')
    serviceKey = value('SERVICE_ROLE_KEY') || value('SECRET_KEY')
    anonKey = value('ANON_KEY') || value('PUBLISHABLE_KEY')
    if (!jwtSecret || !serviceKey || !anonKey) throw new Refusal('JWT_SECRET, SERVICE_ROLE_KEY and ANON_KEY must be set, as supabase status -o env prints them.')
  }
  const provider = value('PROVIDER')
  if (provider && live) throw new Refusal('PROVIDER is for a throwaway stack only: the live project is never given a stand-in for Google. Nothing was sent.')
  if (provider && !/^[a-z]+$/.test(provider)) throw new Refusal(`PROVIDER must be a provider's name, not "${provider}".`)
  const site = value('SITE').replace(/\/+$/, '')
  if (site && !/^https?:\/\//.test(site)) throw new Refusal(`SITE must be an address beginning http:// or https://, not "${site}".`)
  return {
    live,
    clean,
    ref,
    api,
    serviceKey,
    anonKey,
    jwtSecret,
    site,
    provider,
    onlySignIn: value('ONLY_SIGN_IN') === '1',
    browsers: (() => {
      const n = wholeNumber(env, 'BROWSERS', 0, 0, 40)
      if (n > 0 && !site) throw new Refusal('BROWSERS needs SITE: the phones sit the exam on the site itself.')
      return n
    })(),
    // where the page keeps its session: supabase-js names it after the first part of the API's host
    storageKey: value('PHONES_STORAGE_KEY') || `sb-${new URL(api).hostname.split('.')[0]}-auth-token`,
    strict: value('STRICT') === '1',
    takers: wholeNumber(env, 'TAKERS', 400, 3, 900),
    // an exam is at least five minutes long: the database refuses a shorter one
    minutes: wholeNumber(env, 'EXAM_MINUTES', live ? 20 : 5, 5, 180),
    spikeRounds: wholeNumber(env, 'SPIKE_ROUNDS', 10, 0, SPIKE_QUESTIONS - 2),
    // how long before the hall exam opens the takers begin to come to its door
    lead: wholeNumber(env, 'LEAD_SECONDS', live ? 150 : 75, 25, 3600),
    signInsPer5Min: wholeNumber(env, 'SIGN_INS_PER_5_MIN', 28, 0, 100_000),
    seed: wholeNumber(env, 'SEED', Math.floor(Math.random() * 2 ** 31), 0, 2 ** 32 - 1),
    emailDomain: value('EMAIL_DOMAIN') || (live ? 'stress.ausss.invalid' : 'exam-stress.test'),
    resultFile: value('RESULT_FILE'),
  }
}

// ---------------------------------------------------------------------------
// The run's state
// ---------------------------------------------------------------------------

let cfg
const run = randomUUID().slice(0, 8)
const lines = []
const failures = []
const made = { termId: null, positionId: null, examIds: [], userIds: [], pictures: [] }
let stopping = false

// How long each kind of call took, by phase ('hall', 'spike', 'other').
let phase = 'other'
const timings = new Map()
const counts = { calls: 0, retried: 0, refusedForRate: 0, serverErrors: 0, timeouts: 0, noAnswer: 0 }
const keep = (label, ms) => {
  const name = `${phase}|${label}`
  if (!timings.has(name)) timings.set(name, [])
  timings.get(name).push(ms)
}

function say(line = '') {
  console.log(line)
  lines.push(line)
}
function miss(who, message) {
  failures.push({ who, message })
}
function failureLines() {
  const shared = new Map()
  for (const { who, message } of failures) {
    if (!shared.has(message)) shared.set(message, [])
    if (who) shared.get(message).push(who)
  }
  return [...shared].map(([message, who]) => {
    if (who.length === 0) return message
    if (who.length === 1) return `taker ${who[0]}: ${message}`
    return `${who.length} takers (${who.slice(0, 3).join(', ')}${who.length > 3 ? ' and others' : ''}): ${message}`
  })
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

// One request. Never throws for an answer, whatever its status; throws
// { kind: 'offline' } when none came (the network, a timeout, the gateway's
// 502, 503 or 504). `timed` keeps how long it took under that name.
async function request(method, url, { token, apikey, body, raw, type, prefer, timeout = CALL_TIMEOUT_MS, timed } = {}) {
  const headers = {}
  if (prefer) headers.Prefer = prefer
  if (apikey) headers.apikey = apikey
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (type) headers['Content-Type'] = type
  const began = performance.now()
  let res
  let text = ''
  try {
    res = await fetch(url, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    })
    text = timed === 'picture' || timed === 'site' ? String((await res.arrayBuffer()).byteLength) : await res.text()
  } catch (err) {
    const ms = performance.now() - began
    counts.calls += 1
    if (err.name === 'TimeoutError') counts.timeouts += 1
    else counts.noAnswer += 1
    if (timed) keep(`${timed} (no answer)`, ms)
    throw Object.assign(new Error(`${method} ${url.split('?')[0]}: ${err.name === 'TimeoutError' ? `no answer in ${timeout / 1000} s` : err.cause?.code || err.message}`), { kind: 'offline' })
  }
  const ms = performance.now() - began
  counts.calls += 1
  if (res.status === 429) counts.refusedForRate += 1
  if (res.status >= 500) counts.serverErrors += 1
  if ([502, 503, 504].includes(res.status)) {
    if (timed) keep(`${timed} (no answer)`, ms)
    throw Object.assign(new Error(`${method} ${url.split('?')[0]}: the gateway answered ${res.status}`), { kind: 'offline', status: res.status })
  }
  if (timed) keep(timed, ms)
  let data = null
  if (text !== '') {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status: res.status, ok: res.ok, data, ms, headers: res.headers }
}

// As the service role, for the set-up, the checks and the clean-up: anything
// but success stops with what was said. Everything but an insert is sent
// again when it got no answer.
async function service(what, method, path, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await request(method, cfg.api + path, { token: cfg.serviceKey, apikey: cfg.serviceKey, timeout: 60_000, ...options })
      if (!res.ok) throw new Error(`${what}: answered ${res.status} ${brief(res.data)}`)
      return res.data
    } catch (err) {
      if (err.kind !== 'offline' || method === 'POST' || attempt >= 4) throw err.kind === 'offline' ? new Error(`${what}: ${err.message}`) : err
      await sleep(1000 * (attempt + 1))
    }
  }
}

// A taker's call of one of the exam's functions, as the page makes it: the
// anon key as the apikey, the taker's own session as the bearer. Answers with
// the function's JSON; throws { kind } for anything else, as the page's own
// ExamError does.
async function rpc(t, name, args, { timeout = CALL_TIMEOUT_MS, timed = name } = {}) {
  const res = await request('POST', `${cfg.api}/rest/v1/rpc/${name}`, { token: t.token, apikey: cfg.anonKey, body: args, timeout, timed })
  if (res.ok) return res.data
  const kind = res.status === 429 ? 'offline' : failureKind(res.data?.code, res.status)
  throw Object.assign(new Error(`${name}: ${res.status} ${brief(res.data)}`), { kind, status: res.status })
}

// A call that must go through: tried again as the page tries, until it is
// answered, refused in so many words, or the run is over.
async function insist(t, name, args, options) {
  for (let tries = 1; ; tries += 1) {
    try {
      return await rpc(t, name, args, options)
    } catch (err) {
      if (err.kind === 'refused' || tries >= 8 || stopping) throw err
      counts.retried += 1
      await sleep(retryDelay(tries))
    }
  }
}

// ---------------------------------------------------------------------------
// The exams
// ---------------------------------------------------------------------------

function writeQuestions(roll, examId, layout) {
  const out = []
  for (const [section, count] of layout) {
    for (let i = 0; i < count; i += 1) {
      const n = out.length + 1
      const correct = roll.below(OPTION_LETTERS.length)
      out.push({
        id: randomUUID(),
        exam_id: examId,
        n,
        section,
        correct,
        keep: n % 10 === 0,
        body: `Stress question ${n}. Which option is marked right?`,
        options: OPTION_LETTERS.map((letter, o) => `Q${n} option ${letter} (${o === correct ? 'right' : 'wrong'})`),
        passage_id: null,
        image_path: null,
      })
    }
  }
  return out
}

const hall = { id: randomUUID(), title: `${TAG}: the hall ${run}`, word: `stress-hall-${run}`, code: 'HALL-STRESS', questions: [], byId: new Map(), passages: [] }
const spike = { id: randomUUID(), title: `${TAG}: the spikes ${run}`, word: `stress-spike-${run}`, code: 'SPIKE-STRESS', questions: [], byId: new Map(), passages: [] }
const officer = { id: null, token: '', email: '' }
let takers = []

async function addExam(exam, { minutes, opensAt, closesAt, status }) {
  await service(`adding "${exam.title}"`, 'POST', '/rest/v1/exams', {
    body: { id: exam.id, title: exam.title, address_word: exam.word, minutes, start_code: exam.code, opens_at: opensAt, closes_at: closesAt },
  })
  made.examIds.push(exam.id)
  if (exam.passages.length) {
    await service('adding the passages', 'POST', '/rest/v1/exam_passages', {
      body: exam.passages.map((p) => ({ id: p.id, exam_id: exam.id, section: p.section, body: p.body, image_path: p.image_path })),
    })
  }
  await service('adding the questions', 'POST', '/rest/v1/exam_questions', {
    body: exam.questions.map((q) => ({
      id: q.id,
      exam_id: exam.id,
      sort: q.n,
      body: q.body,
      options: q.options,
      keep_option_order: q.keep,
      section: q.section,
      passage_id: q.passage_id,
      image_path: q.image_path,
    })),
  })
  await service('adding the key', 'POST', '/rest/v1/exam_key', { body: exam.questions.map((q) => ({ question_id: q.id, correct_option: q.correct })) })
  const spare = Array.from({ length: SPARE_IDS }, (_, i) => `X${run}-${String(i + 1).padStart(4, '0')}`)
  for (const part of chunks([...takers.map((t) => t.listedId), ...spare], 500)) {
    await service('adding the list of student IDs', 'POST', '/rest/v1/exam_registrations', { body: part.map((id) => ({ exam_id: exam.id, student_id: id })) })
  }
  if (status === 'ready') await service('making the exam ready', 'PATCH', `/rest/v1/exams?id=eq.${exam.id}`, { body: { status: 'ready' } })
}

async function uploadPicture(path, bytes) {
  const res = await request('POST', `${cfg.api}/storage/v1/object/${PICTURES}/${path}`, {
    token: cfg.serviceKey,
    apikey: cfg.serviceKey,
    raw: bytes,
    type: 'image/jpeg',
    timeout: 60_000,
  })
  if (!res.ok) throw new Error(`uploading a picture: answered ${res.status} ${brief(res.data)}`)
  made.pictures.push(path)
}

// ---------------------------------------------------------------------------
// The accounts
// ---------------------------------------------------------------------------

function castTakers(roll) {
  const n = cfg.takers
  const width = Math.max(4, String(n).length)
  return Array.from({ length: n }, (_, i) => {
    const tag = String(i + 1).padStart(width, '0')
    const r = dice(cfg.seed ^ Math.imul(i + 1, 0x9e3779b1))
    // a third each: SCOPE only, SCORE only, both
    const starts = [{ scope: true, score: false }, { scope: false, score: true }, { scope: true, score: true }][i % 3]
    return {
      index: i,
      tag,
      email: `stress-taker-${tag}.${run}@${cfg.emailDomain}`,
      name: `Stress Taker ${tag}`,
      year: FACULTY_YEARS[i % FACULTY_YEARS.length],
      phone: `010${String(30000000 + i)}`,
      listedId: `S${run}-${tag}`,
      roll: r,
      starts,
      // the last few sit in a real browser, through the page itself
      browser: i >= n - cfg.browsers,
      session: null,
      // how this one behaves
      pace: 0.6 + r.next() * 0.9, // a quick one to a careful one
      slow: r.chance(0.15), // still answering when the time runs out
      wrongCodeFirst: r.chance(0.02),
      refreshes: r.chance(0.1),
      dropsOut: r.chance(0.1),
      changesMind: r.chance(0.08),
      share: Math.min(0.97, Math.max(0.2, 0.62 + (r.next() + r.next() + r.next() - 1.5) * 0.3)), // how much they know
      // filled in as the run goes
      id: null,
      token: '',
      refreshToken: '',
      signedInAt: 0,
      ahead: 0, // the database's clock minus this machine's, in ms
      at: 'not here yet', // where in the sitting this taker is, for the lines said as the hall sits
      papers: new Map(), // exam id -> what this taker's phone holds of it
      broken: '',
    }
  })
}

async function makeAccount(email, name, password) {
  const user = await service(`making the account ${email}`, 'POST', '/auth/v1/admin/users', {
    body: { email, email_confirm: true, user_metadata: { full_name: name }, ...(password ? { password } : {}) },
  })
  if (!user?.id) throw new Error(`making the account ${email}: the sign-in service gave no id (${brief(user)})`)
  made.userIds.push(user.id)
  return user.id
}

const signedHere = (id, email) =>
  signToken({ sub: id, role: 'authenticated', aud: 'authenticated', email, exp: Math.floor(Date.now() / 1000) + 6 * 3600 }, cfg.jwtSecret)

async function pool(list, size, work) {
  let next = 0
  let failure = null
  const worker = async () => {
    while (!failure && next < list.length) {
      const item = list[next]
      next += 1
      try {
        await work(item)
      } catch (err) {
        failure = failure || err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker))
  if (failure) throw failure
}

async function signIn(t, password) {
  const res = await request('POST', `${cfg.api}/auth/v1/token?grant_type=password`, { apikey: cfg.anonKey, body: { email: t.email, password }, timed: 'sign-in' })
  if (!res.ok || !res.data?.access_token) throw Object.assign(new Error(`signing in ${t.email}: ${res.status} ${brief(res.data)}`), { status: res.status })
  t.token = res.data.access_token
  t.refreshToken = res.data.refresh_token
  t.session = res.data
  t.signedInAt = Date.now()
}

async function renew(t) {
  const res = await request('POST', `${cfg.api}/auth/v1/token?grant_type=refresh_token`, { apikey: cfg.anonKey, body: { refresh_token: t.refreshToken }, timed: 'session renewed' })
  if (!res.ok || !res.data?.access_token) throw Object.assign(new Error(`renewing the session of ${t.email}: ${res.status} ${brief(res.data)}`), { status: res.status })
  t.token = res.data.access_token
  t.refreshToken = res.data.refresh_token
  t.session = res.data
  t.signedInAt = Date.now()
}

// A first sign-in as the exam's page does it with Google, through the stack's
// outside provider: the sign-in service sends the phone to the provider with a
// `state` of its own; the provider sends it back with a code; the sign-in
// service asks the provider who the code is, makes the account, and sends the
// phone on to the exam's callback with a session after the #. The hop to the
// provider itself is not made here (its address is the one the sign-in
// service's container knows it by, which this machine does not), so the phone
// comes back with the code the provider would have given it.
async function signInThroughProvider(t) {
  const began = performance.now()
  const callback = 'http://localhost:5173/exam/callback'
  const out = await fetch(`${cfg.api}/auth/v1/authorize?provider=${cfg.provider}&redirect_to=${encodeURIComponent(callback)}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const toProvider = out.headers.get('location') || ''
  const state = toProvider ? new URL(toProvider).searchParams.get('state') : null
  if (out.status !== 302 || !state) throw new Error(`the sign-in service should send the phone on to the provider, but answered ${out.status} ${brief(await out.text())}`)
  const back = await fetch(`${cfg.api}/auth/v1/callback?code=${codeFor(t.email)}&state=${encodeURIComponent(state)}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const home = back.headers.get('location') || ''
  const given = new URLSearchParams(home.split('#')[1] || '')
  const token = given.get('access_token')
  if (back.status === 429) counts.refusedForRate += 1
  if (!home.startsWith(callback) || !token) {
    throw Object.assign(new Error(`the sign-in service should send the phone to the exam's callback with a session, but answered ${back.status} ${brief(home || (await back.text()))}`), { status: back.status })
  }
  t.token = token
  t.refreshToken = given.get('refresh_token') || ''
  t.id = readToken(token)?.claims?.sub || null
  if (!t.id) throw new Error('the session the sign-in service gave names no account')
  made.userIds.push(t.id)
  t.signedInAt = Date.now()
  counts.calls += 2
  keep('sign-in through the provider', performance.now() - began)
}

// Every phone renews its session within the same minute, as a hall that
// opened the page together an hour before would: what the token refresh
// limit (from one address) has to allow.
async function renewTogether() {
  const wave = performance.now()
  const refused = []
  await Promise.all(
    takers.map(async (t, i) => {
      await sleep((i / takers.length) * 60_000)
      try {
        await renew(t)
      } catch (err) {
        refused.push(err.status || 0)
      }
    }),
  )
  if (refused.length) {
    miss(null, `every session should be renewed when ${takers.length} phones renew within a minute, but ${refused.length} were refused (${[...new Set(refused)].join(', ')}): the token refresh limit is too low for the hall`)
  }
  say(`Renewed ${takers.length - refused.length} of ${takers.length} sessions within a minute, in ${seconds(performance.now() - wave)}${refused.length ? `: ${refused.length} REFUSED` : ''}.`)
}

async function makeAccounts() {
  const began = performance.now()
  if (cfg.provider) {
    await pool(takers, 20, signInThroughProvider)
    say(`Signed ${plural(takers.length, 'new account')} in through the provider "${cfg.provider}", as a first sign-in with Google goes, in ${seconds(performance.now() - began)}.`)
    return
  }
  const password = cfg.live ? randomBytes(24).toString('base64url') : ''
  await pool(takers, 20, async (t) => {
    t.id = await makeAccount(t.email, t.name, password)
    if (!cfg.live) t.token = signedHere(t.id, t.email)
  })
  say(`Made ${plural(takers.length, 'account')} in ${seconds(performance.now() - began)}.`)

  if (!cfg.live) {
    // An exam officer of the run's own, as in the rehearsal: a SCOPE officer
    // position whose work email is the account's. It reads the results while
    // the hall is saving, as the officers' Results tab does every 30 seconds.
    const [term] = await service('reading the current term', 'GET', '/rest/v1/terms?select=id&is_current=is.true')
    const [scope] = await service('reading the SCOPE committee', 'GET', '/rest/v1/committees?select=id&slug=eq.scope')
    if (term && scope) {
      officer.email = `stress-officer.${run}@${cfg.emailDomain}`
      officer.id = await makeAccount(officer.email, 'Stress Officer', '')
      officer.token = signedHere(officer.id, officer.email)
      const [position] = await service('adding an officer position for the run', 'POST', '/rest/v1/positions', {
        body: { key: `scope.exam-stress-${run}`, committee_id: scope.id, title: `Exam stress officer ${run}`, short_title: 'Stress', level: 'officer', sort: 99 },
        prefer: 'return=representation',
      })
      made.positionId = position.id
      await service('setting the work email of the position', 'POST', '/rest/v1/position_work_emails', { body: { position_id: position.id, email: officer.email } })
      await service('giving the officer the position', 'POST', '/rest/v1/assignments', { body: { profile_id: officer.id, position_id: position.id, term_id: term.id } })
    }
    return
  }

  // Live: every account signs in for real. The sign-in service takes 30 from
  // one address in five minutes unless the limit was raised for the run.
  const per = cfg.signInsPer5Min
  const signing = performance.now()
  if (per === 0) {
    await pool(takers, 20, (t) => signIn(t, password))
  } else {
    const groups = chunks(takers, per)
    say(`Signing ${takers.length} accounts in, ${per} every five minutes: about ${Math.ceil((groups.length - 1) * 5)} minutes. (SIGN_INS_PER_5_MIN=0 once the limit is raised.)`)
    for (let g = 0; g < groups.length; g += 1) {
      const groupBegan = Date.now()
      await pool(groups[g], 10, (t) => signIn(t, password))
      // a session lasts an hour: the early ones are renewed before they end
      const old = takers.filter((t) => t.token && Date.now() - t.signedInAt > 40 * 60_000)
      for (const part of chunks(old, 25)) {
        await pool(part, 5, renew)
        await sleep(2000)
      }
      if (g < groups.length - 1) await sleep(5 * 60_000 + 5000 - (Date.now() - groupBegan))
    }
  }
  say(`Signed ${plural(takers.length, 'account')} in through the sign-in service in ${seconds(performance.now() - signing)}.`)
  await renewTogether()
}

// ONLY_SIGN_IN: the sessions the provider's sign-in gave are tried where a
// phone would use them first, at an exam's door, and renewed once.
async function trySessions() {
  let wrong = 0
  await pool(takers, 40, async (t) => {
    const door = await insist(t, 'exam_door', { p_word: `no-exam-${run}` })
    if (!door || door.exam !== null) wrong += 1
  })
  if (wrong) miss(null, `every new session should be taken at an exam's door, but ${wrong} were not answered as a signed-in account is`)
  say(`Tried ${takers.length} sessions at an exam's door: ${takers.length - wrong} were taken.`)
  const profiles = await service('counting the profiles the sign-ins made', 'GET', `/rest/v1/profiles?select=id&email=like.*.${run}@${cfg.emailDomain}&limit=1000`)
  if (profiles.length !== takers.length) miss(null, `each first sign-in should make one profile, ${takers.length} in all, but there are ${profiles.length}`)
  await renewTogether()
}

// ---------------------------------------------------------------------------
// A phone
// ---------------------------------------------------------------------------

// What a taker's phone holds of one exam. `held` is what was tapped (the
// position on this taker's own paper), `waiting` the questions the database
// has not confirmed, `confirmed` what it said it saved, as the officers' index.
function newPaper(exam) {
  return {
    exam,
    attemptId: null,
    questions: [], // in this taker's order, each with shownAt: officers' index -> position on this paper
    deadline: 0, // on this machine's clock
    held: new Map(),
    waiting: new Set(),
    confirmed: new Map(),
    sits: { scope: true, score: true },
    sitsWaiting: false,
    dbSits: { scope: true, score: true },
    // answers carried by a save that got no answer: whether it reached the
    // database nobody here knows, until a later save of them is answered
    doubt: new Set(),
    busy: null,
    timer: null,
    beat: null,
    offline: false,
    failures: 0,
    lastSent: 0,
    over: '', // '', 'handed_in', 'time' or 'gone'
    pictures: 0,
  }
}

function readPaper(t, p, paper) {
  if (paper?.state !== 'sitting' || !Array.isArray(paper.questions)) throw new Error(`exam_paper should give the paper, but answered ${brief(paper)}`)
  const known = p.exam.byId
  if (paper.questions.length !== known.size) throw new Error(`the paper should have ${known.size} questions, but has ${paper.questions.length}`)
  const order = { shared: 0, scope: 1, score: 2 }
  let last = 0
  p.questions = paper.questions.map((shown) => {
    const q = known.get(shown.id)
    if (!q) throw new Error(`the paper holds ${brief(shown.id)}, which is not a question of the exam`)
    if (shown.section !== q.section) miss(t.tag, `question ${q.n} should be in the section ${q.section}, but its paper says ${shown.section}`)
    if (order[shown.section] < last) miss(t.tag, 'its paper should have the shared questions, then SCOPE, then SCORE, but they are out of that order')
    last = order[shown.section] ?? last
    if ((shown.passage ?? null) !== (q.passage_id ?? null)) miss(t.tag, `question ${q.n} should be read with its passage, but its paper says ${brief(shown.passage)}`)
    if ((shown.image ?? null) !== (q.image_path ?? null)) miss(t.tag, `question ${q.n} should carry its picture, but its paper says ${brief(shown.image)}`)
    const shownAt = new Array(OPTION_LETTERS.length).fill(-1)
    ;(shown.options || []).forEach((text, place) => {
      const told = /^Q(\d+) option ([A-D]) \((?:right|wrong)\)$/.exec(text)
      const o = told && Number(told[1]) === q.n ? OPTION_LETTERS.indexOf(told[2]) : -1
      if (o !== -1) shownAt[o] = place
    })
    if (shownAt.includes(-1)) throw new Error(`question ${q.n} should show its four options once each, but its paper has ${brief(shown.options)}`)
    return { ...q, shownAt }
  })
  // a passage's questions stand together
  const seen = new Set()
  let before = null
  for (const q of p.questions) {
    if (q.passage_id && q.passage_id !== before && seen.has(q.passage_id)) miss(t.tag, 'the questions read with one passage should stand together on its paper, but they are apart')
    if (q.passage_id) seen.add(q.passage_id)
    before = q.passage_id
  }
  const wantPassages = p.exam.passages.length
  if ((paper.passages || []).length !== wantPassages) miss(t.tag, `its paper should carry ${plural(wantPassages, 'passage')}, but carries ${(paper.passages || []).length}`)
  p.attemptId = paper.attempt?.id
  p.sits = { scope: paper.attempt?.sits_scope !== false, score: paper.attempt?.sits_score !== false }
  p.dbSits = { ...p.sits }
  t.ahead = Date.parse(paper.now) - Date.now()
  p.deadline = Date.parse(paper.attempt?.deadline_at) - t.ahead
  return paper
}

const sameSits = (a, b) => a.scope === b.scope && a.score === b.score

// One save, as the page sends it: what waits (at most 200), a waiting choice
// of sections with it, and the hand-in when asked. Only what the database
// says it saved is confirmed.
async function saveOnce(t, p, { handIn = false, hurry = false, label } = {}) {
  const ids = [...p.waiting].slice(0, BATCH_MAX)
  const batch = ids.map((id) => ({ q: id, ...p.held.get(id) }))
  const told = p.sitsWaiting ? { ...p.sits } : null
  const final = handIn && ids.length === p.waiting.size
  const args = { p_word: p.exam.word, p_answers: batch, p_hand_in: final, ...(told ? { p_scope: told.scope, p_score: told.score } : {}) }
  const name = label || (final ? 'exam_save (hand-in)' : batch.length ? 'exam_save' : 'exam_save (heartbeat)')
  p.lastSent = performance.now()
  let reply
  try {
    reply = await rpc(t, 'exam_save', args, { timeout: hurry ? HURRY_TIMEOUT_MS : CALL_TIMEOUT_MS, timed: name })
  } catch (err) {
    // no answer: it may have been saved all the same
    if (err.kind === 'offline') for (const id of ids) p.doubt.add(id)
    throw err
  }
  if (reply?.state !== 'sitting' && reply?.state !== 'over') throw Object.assign(new Error(`exam_save answered ${brief(reply)}`), { kind: 'offline' })
  p.failures = 0
  const landed = reply.state !== 'over' || Number(reply.saved) >= batch.length
  if (landed) {
    const byId = new Map(p.questions.map((q) => [q.id, q]))
    for (const item of batch) {
      const q = byId.get(item.q)
      p.doubt.delete(item.q)
      p.confirmed.set(item.q, item.c === null ? null : q.shownAt.indexOf(item.c))
      const now = p.held.get(item.q)
      if (now && now.c === item.c && now.f === item.f) p.waiting.delete(item.q)
    }
    if (batch.length && Number(reply.saved) !== batch.length && reply.state === 'sitting') {
      miss(t.tag, `a save of ${batch.length} answers should say it saved ${batch.length}, but said ${reply.saved}`)
    }
  }
  if (typeof reply.sits_scope === 'boolean' && typeof reply.sits_score === 'boolean') {
    const stands = { scope: reply.sits_scope, score: reply.sits_score }
    if (told && p.sitsWaiting && sameSits(told, p.sits)) {
      p.sitsWaiting = false
      if (reply.state === 'sitting' && !sameSits(stands, told)) miss(t.tag, `a save that carried the choice ${brief(told)} should be answered with it, but was answered ${brief(stands)}`)
    }
    p.dbSits = stands
    if (!p.sitsWaiting) p.sits = { ...stands }
  } else if (p.exam === hall) {
    miss(t.tag, 'a save should say which sections the paper sits, but did not')
  }
  if (reply.now) t.ahead = Date.parse(reply.now) - Date.now()
  if (reply.deadline_at) p.deadline = Date.parse(reply.deadline_at) - t.ahead
  if (reply.state === 'over') p.over = reply.submitted ? 'handed_in' : 'time'
  return reply
}

// The page's queue: one call in flight at a time, each carrying whatever
// waits at the moment it leaves. A call that got no answer is tried again
// after 2, 5, 10 and then every 15 seconds (every 1.5 in the thirty seconds
// after the deadline). `beat` sends one call even with nothing waiting (the
// heartbeat); `handIn` goes on until the paper is over; without either it
// sends until nothing waits.
async function deliver(t, p, options = {}) {
  while (p.busy) await p.busy.catch(() => {})
  if (p.over || stopping) return
  const work = (async () => {
    let first = true
    for (;;) {
      if (p.over || stopping) return
      const something = p.waiting.size > 0 || p.sitsWaiting
      if (!something && !options.handIn && !(options.beat && first)) return
      if (p.offline && !options.handIn && !options.hurry) return
      const hurry = Boolean(options.hurry) || Date.now() >= p.deadline
      try {
        await saveOnce(t, p, { handIn: options.handIn, hurry, label: options.label })
        first = false
      } catch (err) {
        // a fault of this script, not of the call: do not go round on it
        if (!err.kind) throw err
        if (err.kind === 'refused') {
          p.over = p.over || 'gone'
          miss(t.tag, `a save should be taken, but was refused: ${err.message}`)
          return
        }
        p.failures += 1
        counts.retried += 1
        // past the thirty seconds nothing more lands
        if (Date.now() > p.deadline + LATE_SAVE_MS + 5000) return
        await sleep(hurry ? HURRY_EVERY_MS : retryDelay(p.failures))
      }
    }
  })()
  p.busy = work
  try {
    await work
  } finally {
    if (p.busy === work) p.busy = null
  }
}

function tap(t, p, q, officersIndex, flag = false) {
  p.held.set(q.id, { c: officersIndex === null ? null : q.shownAt[officersIndex], f: flag })
  p.waiting.add(q.id)
  if (p.offline) return
  clearTimeout(p.timer)
  p.timer = setTimeout(() => deliver(t, p).catch(() => {}), SEND_AFTER_MS)
}

async function fetchPictures(t, p) {
  const paths = [...new Set([...p.questions.map((q) => q.image_path), ...p.exam.passages.map((x) => x.image_path)].filter(Boolean))]
  await Promise.all(
    paths.map(async (path) => {
      try {
        const res = await request('GET', `${cfg.api}/storage/v1/object/public/${PICTURES}/${path}`, { timed: 'picture', timeout: 30_000 })
        if (res.ok) p.pictures += 1
        else miss(t.tag, `a picture of its paper should load, but the address answered ${res.status}`)
      } catch {
        miss(t.tag, 'a picture of its paper should load, but no answer came')
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// The hall
// ---------------------------------------------------------------------------

// One taker's whole sitting of the hall exam. `opensAt` and `thinkMs` are the
// run's: when the exam opens on this machine's clock, and the mean pause
// between two taps.
async function sit(t, opensAt, thinkMs) {
  const r = t.roll
  const word = { p_word: hall.word }
  const p = newPaper(hall)
  t.papers.set(hall.id, p)

  // The door, some time before the exam opens, then every 30 seconds.
  await sleep(r.next() * Math.max(0, opensAt - Date.now() - 20_000))
  t.at = 'at the door'
  let door = await insist(t, 'exam_door', word)
  if (!door?.exam) throw new Error(`exam_door should show the exam, but answered ${brief(door)}`)
  t.ahead = Date.parse(door.now) - Date.now()
  const wantSections = { shared: SHARED, scope: BLOCK, score: BLOCK, choice: true }
  // field by field: the database gives an object's fields in an order of its own
  if (Object.keys(wantSections).some((name) => door.exam.sections?.[name] !== wantSections[name])) miss(t.tag, `the door should name the sections ${brief(wantSections)}, but says ${brief(door.exam.sections)}`)
  const held = await insist(t, 'exam_save_details', { ...word, p_full_name: t.name, p_faculty_year: t.year, p_phone: t.phone, p_student_id: t.listedId })
  if (held?.registration !== 'held') throw new Error(`exam_save_details with its own ID should answer held, but answered ${brief(held)}`)
  while (Date.now() < opensAt) {
    await sleep(Math.min(DOOR_EVERY_MS, opensAt - Date.now()))
    if (Date.now() < opensAt) door = await insist(t, 'exam_door', word)
  }
  // The page asks once more as the time comes, half a second to three after it.
  await sleep(500 + r.next() * 2500)
  for (let look = 0; look < 20; look += 1) {
    door = await insist(t, 'exam_door', word)
    if (door.exam.phase === 'open') break
    await sleep(1000)
  }
  if (door.exam.phase !== 'open') throw new Error(`the door should say the exam is open by now, but says ${door.exam.phase}`)

  // The start code is read out: everyone types it within three quarters of a minute.
  t.at = 'typing the start code'
  await sleep(r.next() * 45_000)
  if (t.wrongCodeFirst) {
    const no = await insist(t, 'exam_start', { ...word, p_code: 'NOT-THE-CODE', p_scope: t.starts.scope, p_score: t.starts.score })
    if (no?.ok !== false || no.reason !== 'code') miss(t.tag, `exam_start with a wrong code should answer code, but answered ${brief(no)}`)
  }
  const started = await insist(t, 'exam_start', { ...word, p_code: hall.code, p_scope: t.starts.scope, p_score: t.starts.score })
  if (started?.ok !== true) throw new Error(`exam_start with the start code should answer ok, but answered ${brief(started)}`)
  t.at = 'fetching the paper'
  readPaper(t, p, await insist(t, 'exam_paper', word))
  if (!sameSits(p.sits, t.starts)) miss(t.tag, `its paper should sit ${brief(t.starts)} as chosen at the start, but says ${brief(p.sits)}`)
  await fetchPictures(t, p)
  t.at = 'answering'

  // The heartbeat: a phone with nothing to send asks for the time once a minute.
  p.beat = setInterval(() => {
    if (!p.busy && !p.over && !p.offline && performance.now() - p.lastSent >= HEARTBEAT_MS - 500) deliver(t, p, { beat: true }).catch(() => {})
  }, 5000)

  // What this taker answers: the questions of the sections they sit, in their
  // paper's order, the right option for the share of them they know.
  const sitsNow = () => p.questions.filter((q) => q.section === 'shared' || p.sits[q.section])
  let todo = sitsNow()
  const answerOf = (q) => (r.chance(0.04) ? null : r.chance(t.share) ? q.correct : (q.correct + 1 + r.below(3)) % 4)
  const mean = thinkMs * t.pace * (t.slow ? 3 : 1)
  const refreshAt = t.refreshes ? Math.floor(todo.length * (0.2 + r.next() * 0.5)) : -1
  const dropAt = t.dropsOut ? Math.floor(todo.length * (0.2 + r.next() * 0.5)) : -1
  const changeAt = t.changesMind ? Math.floor(todo.length * (0.4 + r.next() * 0.3)) : -1

  for (let i = 0; i < todo.length; i += 1) {
    // a pause between taps: most short, a few long
    await sleep(Math.min(mean * 4, -Math.log(1 - r.next() * 0.999) * mean))
    if (p.over || stopping || Date.now() >= p.deadline) break
    const q = todo[i]
    const choice = answerOf(q)
    if (choice !== null || r.chance(0.5)) tap(t, p, q, choice, r.chance(0.05))
    // now and then an earlier answer is changed
    if (i > 3 && r.chance(0.08)) {
      const back = todo[r.below(i)]
      tap(t, p, back, answerOf(back) ?? back.correct)
    }

    if (i === refreshAt) {
      // A refresh: the start asks no code again, the paper comes in the same
      // order, and every answer the database confirmed comes back.
      await deliver(t, p).catch(() => {})
      const again = await insist(t, 'exam_start', { ...word, p_code: '' })
      if (again?.ok !== true || again.attempt_id !== p.attemptId) miss(t.tag, `exam_start after a refresh should answer ok with the same paper, but answered ${brief(again)}`)
      const paper = await insist(t, 'exam_paper', word)
      if (paper?.state === 'sitting') {
        const order = paper.questions.map((x) => x.id).join()
        if (order !== p.questions.map((x) => x.id).join()) miss(t.tag, 'its paper after a refresh should be in the same order, but is not')
        const back = new Map((paper.answers || []).map((a) => [a.q, a]))
        const byId = new Map(p.questions.map((x) => [x.id, x]))
        let wrong = 0
        for (const [id, officersIndex] of p.confirmed) {
          if (p.waiting.has(id)) continue
          const shown = officersIndex === null ? null : byId.get(id).shownAt[officersIndex]
          if ((back.get(id)?.c ?? null) !== shown) wrong += 1
        }
        if (wrong) miss(t.tag, `after a refresh every saved answer should come back, but ${wrong} did not`)
      }
    }
    if (i === dropAt) {
      // No connection for half a minute: the taps pile up on the phone, and go
      // out together when it is back.
      p.offline = true
      clearTimeout(p.timer)
      setTimeout(
        () => {
          p.offline = false
          deliver(t, p).catch(() => {})
        },
        20_000 + r.next() * 25_000,
      )
    }
    if (i === changeAt && !p.over) {
      // A change of mind: one who sat a single block adds the other, one who
      // sat both leaves the last one out.
      const next = p.sits.scope && p.sits.score ? { scope: true, score: false } : { scope: true, score: true }
      p.sits = next
      p.sitsWaiting = true
      clearTimeout(p.timer)
      if (!p.offline) p.timer = setTimeout(() => deliver(t, p).catch(() => {}), SEND_AFTER_MS)
      const done = new Set(todo.slice(0, i + 1).map((x) => x.id))
      todo = [...todo.slice(0, i + 1), ...sitsNow().filter((x) => !done.has(x.id))]
    }
  }

  // The end: a hand-in for whoever finished, the thirty seconds for whoever
  // was still answering when the time ran out.
  t.at = 'at the end'
  clearTimeout(p.timer)
  if (p.offline) {
    // the connection is not back yet: wait for it, as a student would
    while (p.offline && !stopping) await sleep(500)
  }
  if (!p.over && Date.now() < p.deadline) {
    await sleep(1000 + r.next() * 4000) // a look at the review
    await deliver(t, p, { handIn: true })
    const beaten = p.over === 'time' && Date.now() >= p.deadline - 5000
    if (p.over !== 'handed_in' && !beaten) miss(t.tag, `a hand-in should end the paper as handed in, but it ended as ${p.over || 'still sitting'}`)
  } else if (!p.over) {
    await deliver(t, p, { hurry: true })
    // the page asks until the database says it is over
    for (let look = 0; look < 45 && !p.over && !stopping; look += 1) {
      await sleep(1000)
      await saveOnce(t, p, { label: 'exam_save (time up)' }).catch(() => {})
    }
    if (p.over !== 'time') miss(t.tag, `a paper whose time ran out should end as out of time, but ended as ${p.over || 'still sitting'}`)
  }
  clearInterval(p.beat)
  t.at = p.over === 'handed_in' ? 'handed in' : 'out of time'
}

// The officers' Results tab, open while the hall sits: it reads the ranking
// and the question figures every 30 seconds.
async function watchAsOfficer(until) {
  if (!officer.token) return
  while (Date.now() < until && !stopping) {
    await sleep(30_000)
    for (const name of ['exam_results', 'exam_question_stats']) {
      try {
        const res = await request('POST', `${cfg.api}/rest/v1/rpc/${name}`, { token: officer.token, apikey: cfg.anonKey, body: { p_exam: hall.id }, timeout: 60_000, timed: `officer: ${name}` })
        if (!res.ok) miss(null, `the officer's ${name} should be answered while the hall sits, but was refused: ${res.status} ${brief(res.data)}`)
      } catch (err) {
        miss(null, `the officer's ${name} should be answered while the hall sits, but: ${err.message}`)
      }
    }
  }
}

// A few takers sit the hall exam in real headless browsers, through the page
// itself. They are put on the list from here (a made-up student cannot type
// their details into Google), handed to scripts/exam-stress-phones.mjs with
// their sessions, and what each browser met comes back.
async function sitInBrowsers(opensAt) {
  const phones = takers.filter((t) => t.browser)
  if (phones.length === 0) return
  await pool(phones, 10, async (t) => {
    const held = await insist(t, 'exam_save_details', { p_word: hall.word, p_full_name: t.name, p_faculty_year: t.year, p_phone: t.phone, p_student_id: t.listedId })
    if (held?.registration !== 'held') throw new Error(`exam_save_details for a browser's account should answer held, but answered ${brief(held)}`)
  })
  const now = Math.floor(Date.now() / 1000)
  const sessionOf = (t) =>
    t.session
      ? { ...t.session, expires_at: t.session.expires_at || now + (t.session.expires_in || 3600) }
      : {
          // a local stack's token is signed here: the page takes it as the session a sign-in left
          access_token: t.token,
          refresh_token: 'signed-by-the-stress-test',
          token_type: 'bearer',
          expires_in: 6 * 3600,
          expires_at: now + 6 * 3600,
          user: { id: t.id, aud: 'authenticated', role: 'authenticated', email: t.email, app_metadata: {}, user_metadata: { full_name: t.name } },
        }
  const shots = path.join(tmpdir(), `exam-stress-${run}`)
  const file = path.join(tmpdir(), `exam-stress-phones-${run}.json`)
  writeFileSync(
    file,
    JSON.stringify({
      site: cfg.site,
      word: hall.word,
      code: hall.code,
      storageKey: cfg.storageKey,
      opensAt,
      minutes: cfg.minutes,
      shots,
      phones: phones.map((t) => ({ tag: t.tag, session: sessionOf(t), sits: t.starts, share: t.share })),
    }),
  )
  let said = ''
  const child = spawn(process.execPath, [fileURLToPath(new URL('./exam-stress-phones.mjs', import.meta.url)), file], { stdio: ['ignore', 'pipe', 'inherit'] })
  child.stdout.on('data', (part) => {
    said += part
  })
  const code = await new Promise((done) => child.on('exit', done))
  rmSync(file, { force: true }) // it held sessions
  const line = said.split('\n').find((l) => l.startsWith('PHONES '))
  if (!line) {
    miss(null, `the browsers should say what they met, but the script ended with ${code} and said nothing`)
    return
  }
  const met = JSON.parse(line.slice(7))
  for (const one of met) {
    const t = phones.find((x) => x.tag === one.tag)
    if (t) t.phone = one
    if (!one.ok) miss(one.tag, `in a real browser it should sit the exam from the door to "Your exam was received.", but stopped: ${one.errors.join('; ') || one.stage}`)
    else if (one.errors.length) miss(one.tag, `in a real browser the page should meet no error, but: ${one.errors.slice(0, 3).join('; ')}`)
    if (one.noConnection) miss(one.tag, 'in a real browser the page should never say "No connection", but it did')
  }
  const done = met.filter((one) => one.ok)
  const mid = (list) => (list.length ? Math.round(spreadOf(list).median) : 0)
  say(
    `${plural(met.length, 'real browser')} sat the hall exam on ${cfg.site}: ${done.length} reached "Your exam was received.", ` +
      `${met.reduce((n, one) => n + one.answered, 0)} answers tapped. From Start to the first question: ${mid(done.map((one) => one.startMs))} ms at the median, ` +
      `${Math.max(0, ...done.map((one) => one.startMs))} ms at the slowest. The hand-in: ${mid(done.map((one) => one.handInMs))} ms at the median. ` +
      `Requests that failed: ${met.reduce((n, one) => n + one.failed, 0)}; answered with an error: ${met.reduce((n, one) => n + one.refused, 0)}. A picture of each screen at the end is in ${shots}.`,
  )
}

// Every phone loads the exam's page and the files it names from the site.
async function loadTheSite() {
  if (!cfg.site) return
  const began = performance.now()
  const first = await request('GET', `${cfg.site}/exam/${hall.word}`, { timed: 'site', timeout: 30_000 }).catch((err) => ({ ok: false, status: 0, data: err.message }))
  if (!first.ok) {
    miss(null, `the exam's page should load from ${cfg.site}, but answered ${first.status} ${brief(first.data)}`)
    return
  }
  const html = await (await fetch(`${cfg.site}/exam/${hall.word}`)).text()
  const files = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))].slice(0, 12)
  let failed = 0
  await pool(takers, 50, async () => {
    for (const path of ['/exam/' + hall.word, ...files]) {
      try {
        const res = await request('GET', cfg.site + path, { timed: 'site', timeout: 30_000 })
        if (!res.ok) failed += 1
      } catch {
        failed += 1
      }
    }
  })
  if (failed) miss(null, `every phone should load the exam's page and its files, but ${failed} of ${takers.length * (files.length + 1)} loads failed`)
  say(`Loaded the exam's page and ${plural(files.length, 'file')} from ${cfg.site} once for each of ${takers.length} phones in ${seconds(performance.now() - began)}.`)
}

async function theHall() {
  // The database's clock, from a door every taker can reach already.
  const probe = await insist(takers[0], 'exam_door', { p_word: spike.word })
  const ahead = Date.parse(probe.now) - Date.now()
  const lead = cfg.lead * 1000
  const opensAt = Date.now() + lead
  await service('setting when the hall exam opens', 'PATCH', `/rest/v1/exams?id=eq.${hall.id}`, {
    body: { opens_at: new Date(opensAt + ahead).toISOString(), closes_at: new Date(opensAt + ahead + (cfg.minutes + 30) * 60_000).toISOString(), status: 'ready' },
  })
  // A typical taker reaches the last question at about two thirds of the time.
  const thinkMs = (cfg.minutes * 60_000 * 0.62) / (SHARED + BLOCK * 1.33)
  const realThink = (120 * 60_000 * 0.62) / (SHARED + BLOCK * 1.33)
  say(
    `The hall: ${plural(takers.length, 'taker')}, ${SHARED} shared questions and two blocks of ${BLOCK}, ${cfg.minutes} minutes. ` +
      `A tap every ${(thinkMs / 1000).toFixed(1)} s for a typical taker, which is about ${Math.round(realThink / thinkMs)} times the pace of a two-hour exam. ` +
      `The exam opens in ${Math.round(lead / 1000)} seconds.`,
  )
  await loadTheSite()
  phase = 'hall'
  const began = performance.now()
  const watching = watchAsOfficer(opensAt + cfg.minutes * 60_000)
  // Every half minute, where the hall stands: a long run should not be silent.
  const telling = setInterval(() => {
    const where = new Map()
    for (const t of takers) where.set(t.at, (where.get(t.at) || 0) + 1)
    const saves = [...timings].filter(([name]) => name.startsWith('hall|exam_save') && !name.includes('details')).reduce((n, [, list]) => n + list.length, 0)
    console.log(
      `  ${seconds(performance.now() - began).padStart(6)}  ${[...where].map(([at, n]) => `${n} ${at}`).join(', ')}. ` +
        `${saves} saves, ${counts.retried} sent again, ${counts.refusedForRate} refused for rate.`,
    )
  }, 30_000)
  const inNode = takers.filter((t) => !t.browser)
  for (const t of takers) if (t.browser) t.at = 'in a real browser'
  const browsers = sitInBrowsers(opensAt).catch((err) => miss(null, `the real browsers: ${err.message}`))
  const results = await Promise.allSettled(
    inNode.map((t) =>
      sit(t, opensAt, thinkMs).catch((err) => {
        t.at = 'stopped early'
        throw err
      }),
    ),
  )
  results.forEach((res, i) => {
    if (res.status === 'rejected') {
      inNode[i].broken = res.reason?.message || String(res.reason)
      miss(inNode[i].tag, `stopped: ${inNode[i].broken}`)
      const p = inNode[i].papers.get(hall.id)
      clearInterval(p?.beat)
      clearTimeout(p?.timer)
    }
  })
  await browsers
  clearInterval(telling)
  await watching
  phase = 'other'
  const papers = takers.map((t) => t.papers.get(hall.id)).filter((p) => p?.attemptId)
  say(
    `The hall sat for ${seconds(performance.now() - began)}: ${papers.length} started, ${papers.filter((p) => p.over === 'handed_in').length} handed in, ` +
      `${papers.filter((p) => p.over === 'time').length} ran out of time (${papers.filter((p) => p.over === 'time' && p.waiting.size > 0).length} of them with answers the clock beat), ` +
      `${papers.reduce((n, p) => n + p.doubt.size, 0)} answers whose save got no answer, ` +
      `${takers.filter((t) => t.broken).length} stopped early. ${papers.reduce((n, p) => n + p.pictures, 0)} pictures fetched.`,
  )
}

// ---------------------------------------------------------------------------
// The spikes
// ---------------------------------------------------------------------------

// Everybody at once. Whatever gets no answer is sent again, one by one, so
// nothing is lost; how many needed that is said.
async function atOnce(label, work) {
  const began = performance.now()
  const results = await Promise.allSettled(takers.map((t) => (t.broken || t.browser ? null : work(t))))
  const failed = results.filter((res) => res.status === 'rejected')
  return { ms: performance.now() - began, failed: failed.length, label, reasons: [...new Set(failed.map((f) => f.reason?.message?.slice(0, 120)))].slice(0, 3) }
}

async function theSpikes() {
  if (cfg.spikeRounds === 0) return
  phase = 'spike'
  const word = { p_word: spike.word }
  const rounds = []
  const live = () => takers.filter((t) => !t.broken && !t.browser)

  // Before the spikes: each account's ID on the short exam's list (their
  // profile holds it already), a few at a time.
  await pool(live(), 40, async (t) => {
    const held = await insist(t, 'exam_save_details', { ...word, p_full_name: t.name, p_faculty_year: t.year, p_phone: t.phone, p_student_id: t.listedId }, { timed: 'spike: exam_save_details' })
    if (held?.registration !== 'held') throw new Error(`exam_save_details on the short exam should answer held, but answered ${brief(held)}`)
    t.papers.set(spike.id, newPaper(spike))
  }).catch((err) => miss(null, `the short exam's list: ${err.message}`))

  // Start, all in one instant.
  rounds.push(
    await atOnce('everyone presses Start', async (t) => {
      const started = await insist(t, 'exam_start', { ...word, p_code: spike.code }, { timed: 'spike: exam_start' })
      if (started?.ok !== true) throw new Error(`exam_start should answer ok, but answered ${brief(started)}`)
    }),
  )
  // The paper, all in one instant.
  rounds.push(
    await atOnce('everyone fetches the paper', async (t) => {
      readPaper(t, t.papers.get(spike.id), await insist(t, 'exam_paper', word, { timed: 'spike: exam_paper' }))
    }),
  )
  // An answer, all in one instant, round after round. In the last three
  // rounds each phone asks the door in the same instant too: twice the hall.
  for (let round = 0; round < cfg.spikeRounds; round += 1) {
    await sleep(2000)
    const doubled = round >= cfg.spikeRounds - 3
    rounds.push(
      await atOnce(`round ${round + 1}: everyone saves an answer${doubled ? ' and asks the door' : ''}`, async (t) => {
        const p = t.papers.get(spike.id)
        if (!p.attemptId) return
        const q = p.questions[round]
        const choice = (t.index + round) % 3 === 0 ? (q.correct + 1) % 4 : q.correct
        p.held.set(q.id, { c: q.shownAt[choice], f: false })
        p.waiting.add(q.id)
        const both = [deliver(t, p, { label: 'spike: exam_save' })]
        if (doubled) both.push(insist(t, 'exam_door', word, { timed: 'spike: exam_door' }))
        await Promise.all(both)
        if (p.waiting.size) throw new Error('an answer was not saved')
      }),
    )
  }
  await sleep(2000)
  rounds.push(
    await atOnce('everyone hands in', async (t) => {
      const p = t.papers.get(spike.id)
      if (!p.attemptId) return
      await deliver(t, p, { handIn: true, label: 'spike: exam_save (hand-in)' })
      if (p.over !== 'handed_in') throw new Error(`the hand-in ended as ${p.over || 'still sitting'}`)
    }),
  )
  phase = 'other'
  say(`The spikes, ${plural(live().length, 'phone')} in the same instant:`)
  for (const one of rounds) {
    say(`  ${one.label}: all answered in ${seconds(one.ms)}${one.failed ? `, ${one.failed} FAILED (${one.reasons.join('; ')})` : ''}`)
    if (one.failed) miss(null, `${one.label}: every phone should be answered, but ${one.failed} were not (${one.reasons.join('; ')})`)
  }
}

// ---------------------------------------------------------------------------
// The marking
// ---------------------------------------------------------------------------

// Reads an exam's papers back as the service role, marks them here from the
// key, and compares with what each taker's phone was told was saved.
async function compare(exam) {
  const sat = takers.filter((t) => t.papers.get(exam.id)?.attemptId)
  if (sat.length === 0) {
    miss(null, `nobody got as far as a paper of "${exam.title}", so nothing could be compared`)
    return null
  }
  const every = await service('reading the papers', 'GET', `/rest/v1/exam_attempts?select=id,profile_id,submitted_at,sits_scope,sits_score&exam_id=eq.${exam.id}&limit=1000`)
  // The papers sat in real browsers were answered by the page, not from here:
  // what they hold is theirs. Each must be there, sit what was ticked, and be
  // handed in if its browser saw "Your exam was received."
  const inBrowser = new Map(takers.filter((t) => t.browser).map((t) => [t.id, t]))
  for (const a of every) {
    const t = inBrowser.get(a.profile_id)
    if (!t?.phone) continue
    if (t.phone.ok && !a.submitted_at) miss(t.tag, 'its browser saw "Your exam was received.", so its paper should be handed in, but the database says it is not')
    if (a.sits_scope !== t.starts.scope || a.sits_score !== t.starts.score) miss(t.tag, `its paper should sit ${brief(t.starts)} as ticked in the browser, but the database holds ${brief({ scope: a.sits_scope, score: a.sits_score })}`)
  }
  if (exam === hall) {
    for (const t of inBrowser.values()) {
      if (t.phone?.startMs !== null && t.phone && !every.some((a) => a.profile_id === t.id)) miss(t.tag, 'its browser started the exam, so it should have a paper, but the database has none')
    }
  }
  const attempts = every.filter((a) => !inBrowser.has(a.profile_id))
  if (attempts.length !== sat.length) miss(null, `"${exam.title}" should have ${sat.length} papers sat from here, but has ${attempts.length}`)
  const byAttempt = new Map(attempts.map((a) => [a.id, a]))
  const rows = new Map(attempts.map((a) => [a.id, new Map()]))
  for (const part of chunks(attempts.map((a) => a.id), 6)) {
    const answers = await service('reading the answers', 'GET', `/rest/v1/exam_answers?select=attempt_id,question_id,chosen_option&attempt_id=in.(${part.join(',')})&limit=1000`)
    for (const row of answers) rows.get(row.attempt_id)?.set(row.question_id, row.chosen_option)
  }
  const key = new Map(exam.questions.map((q) => [q.id, { section: q.section, correct: q.correct }]))
  const hasBlocks = exam.questions.some((q) => q.section !== 'shared')
  const totals = { papers: 0, sitScope: 0, sitScore: 0, sumScope: 0, sumScore: 0, sumAll: 0, handedIn: 0, answers: 0, inDoubt: 0, doubtful: 0 }
  for (const t of sat) {
    const p = t.papers.get(exam.id)
    const attempt = byAttempt.get(p.attemptId)
    if (!attempt) {
      miss(t.tag, `its paper of "${exam.title}" should be in the database, but is not`)
      continue
    }
    const stored = rows.get(p.attemptId)
    const sits = { scope: attempt.sits_scope, score: attempt.sits_score }
    totals.papers += 1
    totals.answers += [...stored.values()].filter((c) => c !== null).length
    if (t.broken || p.over === 'gone') {
      // a taker who stopped: what the database holds is all there is to say,
      // and it is not held against the run twice
      totals.inDoubt += 1
      continue
    }
    // An answer whose save got no answer may be in the database or not: for
    // those alone, what the database holds is taken as it is, and counted.
    const expected = new Map(p.confirmed)
    for (const id of p.doubt) {
      totals.doubtful += 1
      if (stored.has(id)) expected.set(id, stored.get(id))
    }
    if (hasBlocks && !sameSits(sits, p.dbSits)) miss(t.tag, `its paper should sit ${brief(p.dbSits)}, the last choice the database answered, but the database holds ${brief(sits)}`)
    if (Boolean(attempt.submitted_at) !== (p.over === 'handed_in')) miss(t.tag, `its paper should be ${p.over === 'handed_in' ? 'handed in' : 'not handed in'}, but the database says otherwise`)
    let wrong = 0
    for (const [id, officersIndex] of expected) if ((stored.get(id) ?? null) !== officersIndex) wrong += 1
    for (const id of stored.keys()) if (!expected.has(id)) wrong += 1
    if (wrong) miss(t.tag, `every answer its phone was told was saved should be in the database, and no other, but ${plural(wrong, 'answer')} differ`)
    // Marked twice, from the two sides: they agree when the answers do.
    const mine = marksOf(expected, key, hasBlocks ? p.dbSits : { scope: false, score: false })
    const theirs = marksOf(stored, key, hasBlocks ? sits : { scope: false, score: false })
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) miss(t.tag, `its marks should be ${brief(mine)}, but the database's answers give ${brief(theirs)}`)
    if (theirs.totalScope !== null) {
      totals.sitScope += 1
      totals.sumScope += theirs.totalScope
    }
    if (theirs.totalScore !== null) {
      totals.sitScore += 1
      totals.sumScore += theirs.totalScore
    }
    totals.sumAll += theirs.shared + (theirs.scope ?? 0) + (theirs.score ?? 0)
    if (attempt.submitted_at) totals.handedIn += 1
    t.marks = t.marks || new Map()
    t.marks.set(exam.id, theirs)
  }

  // On a local stack the database's own marking is read too, as the officer,
  // and must agree paper by paper.
  if (officer.token) {
    const res = await request('POST', `${cfg.api}/rest/v1/rpc/exam_results`, { token: officer.token, apikey: cfg.anonKey, body: { p_exam: exam.id }, timeout: 60_000, timed: 'officer: exam_results (after)' })
    if (!res.ok || !Array.isArray(res.data?.attempts)) {
      miss(null, `exam_results as the officer should give the ranking, but answered ${res.status} ${brief(res.data)}`)
    } else {
      const ranked = new Map(res.data.attempts.map((row) => [row.attempt_id, row]))
      for (const t of sat) {
        const p = t.papers.get(exam.id)
        const mine = t.marks?.get(exam.id)
        const row = ranked.get(p.attemptId)
        if (!mine || !row) continue
        const want = hasBlocks ? [mine.shared, mine.scope, mine.score, mine.totalScope, mine.totalScore] : [mine.shared, null, null, null, null]
        const got = [row.mark_shared, row.mark_scope, row.mark_score, row.total_scope, row.total_score]
        if (JSON.stringify(want) !== JSON.stringify(got)) miss(t.tag, `the database's own marking should give ${brief(want)} (shared, each block, each programme), but gives ${brief(got)}`)
      }
      for (const programme of hasBlocks ? ['scope', 'score'] : []) {
        const mine = sat.map((t) => t.marks?.get(exam.id)?.[programme === 'scope' ? 'totalScope' : 'totalScore']).filter((n) => n !== null && n !== undefined)
        for (const t of sat) {
          const total = t.marks?.get(exam.id)?.[programme === 'scope' ? 'totalScope' : 'totalScore']
          const row = ranked.get(t.papers.get(exam.id).attemptId)
          // a rank depends on every paper: with one set aside, or sat in a browser (whose answers are its own), it is not compared
          if (total === null || total === undefined || !row || totals.inDoubt || inBrowser.size) continue
          const want = 1 + mine.filter((n) => n > total).length
          if (row[`rank_${programme}`] !== want) miss(t.tag, `its ${programme.toUpperCase()} rank should be ${want}, but the database says ${row[`rank_${programme}`]}`)
        }
      }
    }
  }
  say(
    `Compared ${plural(totals.papers - totals.inDoubt, 'paper')} of "${exam.title}" answer by answer (${totals.answers} answers in the database` +
      `${totals.inDoubt ? `; ${totals.inDoubt} papers set aside` : ''}${totals.doubtful ? `; ${totals.doubtful} answers taken as the database holds them, their save having got no answer` : ''}). ` +
      (hasBlocks
        ? `SCOPE: ${totals.sitScope} papers, marks ${totals.sumScope} in all. SCORE: ${totals.sitScore} papers, marks ${totals.sumScore} in all. `
        : `Marks ${totals.sumAll} in all. `) +
      `Handed in: ${totals.handedIn}.`,
  )
  return totals
}

// ---------------------------------------------------------------------------
// Clearing up
// ---------------------------------------------------------------------------

async function removePictures(paths) {
  for (const part of chunks(paths, 50)) {
    await request('DELETE', `${cfg.api}/storage/v1/object/${PICTURES}`, { token: cfg.serviceKey, apikey: cfg.serviceKey, body: { prefixes: part }, timeout: 60_000 }).catch(() => {})
  }
}

async function cleanUp() {
  const began = performance.now()
  const problems = []
  const quietly = async (what, work) => {
    try {
      await work()
    } catch (err) {
      problems.push(`${what}: ${err.message}`)
    }
  }
  for (const id of made.examIds) await quietly('deleting an exam', () => service('deleting an exam', 'DELETE', `/rest/v1/exams?id=eq.${id}`))
  await quietly('removing the pictures', () => removePictures(made.pictures))
  await pool(made.userIds, 20, (id) =>
    quietly('deleting an account', async () => {
      const res = await request('DELETE', `${cfg.api}/auth/v1/admin/users/${id}`, { token: cfg.serviceKey, apikey: cfg.serviceKey, timeout: 60_000 })
      // 404: gone already
      if (!res.ok && res.status !== 404) throw new Error(`answered ${res.status} ${brief(res.data)}`)
    }),
  ).catch(() => {})
  if (made.positionId) await quietly('deleting the officer position', () => service('deleting the officer position', 'DELETE', `/rest/v1/positions?id=eq.${made.positionId}`))
  if (made.termId) await quietly('deleting the term this run added', () => service('deleting the term', 'DELETE', `/rest/v1/terms?id=eq.${made.termId}`))
  // Is anything left?
  let left = ''
  await quietly('checking that nothing is left', async () => {
    const exams = await service('looking for exams', 'GET', `/rest/v1/exams?select=id&address_word=like.stress-*-${run}`)
    const attempts = made.examIds.length ? await service('looking for papers', 'GET', `/rest/v1/exam_attempts?select=id&exam_id=in.(${made.examIds.join(',')})&limit=1`) : []
    const profiles = await service('looking for accounts', 'GET', `/rest/v1/profiles?select=id&email=like.*.${run}@${cfg.emailDomain}&limit=5`)
    if (exams.length || attempts.length || profiles.length) left = `${exams.length} exams, ${attempts.length ? 'papers' : 'no papers'}, ${profiles.length ? 'accounts' : 'no accounts'}`
  })
  if (left) problems.push(`left behind: ${left}`)
  if (problems.length) {
    for (const problem of problems.slice(0, 10)) miss(null, `clean-up: ${problem}`)
    say(`Clean-up had ${plural(problems.length, 'problem')}. Run it again with --clean.`)
  } else {
    say(`Deleted ${plural(made.examIds.length, 'exam')}, ${plural(made.pictures.length, 'picture')} and ${plural(made.userIds.length, 'account')} in ${seconds(performance.now() - began)}; nothing of the run is left.`)
  }
}

// --clean: whatever any run left behind, found by its names.
async function cleanEverything() {
  const exams = await service('looking for stress exams', 'GET', `/rest/v1/exams?select=id,title&title=like.${encodeURIComponent(TAG)}*`)
  for (const exam of exams) {
    const listed = await request('POST', `${cfg.api}/storage/v1/object/list/${PICTURES}`, { token: cfg.serviceKey, apikey: cfg.serviceKey, body: { prefix: exam.id, limit: 1000 } }).catch(() => ({ data: [] }))
    await service(`deleting "${exam.title}"`, 'DELETE', `/rest/v1/exams?id=eq.${exam.id}`)
    await removePictures((Array.isArray(listed.data) ? listed.data : []).map((o) => `${exam.id}/${o.name}`))
  }
  const positions = await service('looking for stress positions', 'GET', '/rest/v1/positions?select=id&key=like.scope.exam-stress-*')
  for (const position of positions) await service('deleting a stress position', 'DELETE', `/rest/v1/positions?id=eq.${position.id}`)
  let accounts = 0
  for (;;) {
    const profiles = await service('looking for stress accounts', 'GET', `/rest/v1/profiles?select=id,email&email=like.stress-*@${cfg.emailDomain}&limit=500`)
    if (profiles.length === 0) break
    await pool(profiles, 20, (p) => service('deleting an account', 'DELETE', `/auth/v1/admin/users/${p.id}`))
    accounts += profiles.length
  }
  say(`Clean: deleted ${plural(exams.length, 'exam')}, ${plural(positions.length, 'position')} and ${plural(accounts, 'account')} that stress runs had left.`)
}

// ---------------------------------------------------------------------------
// What it took
// ---------------------------------------------------------------------------

function sayTimings() {
  const ms = (n) => String(Math.round(n)).padStart(7)
  const table = (wanted) => {
    const rows = [...timings].filter(([name]) => name.startsWith(`${wanted}|`)).sort(([a], [b]) => a.localeCompare(b))
    if (rows.length === 0) return
    say(`  ${'call'.padEnd(34)}${'calls'.padStart(8)}${'median'.padStart(8)}${'95th'.padStart(8)}${'99th'.padStart(8)}${'slowest'.padStart(8)}  (ms)`)
    for (const [name, list] of rows) {
      const s = spreadOf(list)
      say(`  ${name.split('|')[1].padEnd(34)}${String(s.count).padStart(8)}${ms(s.median)} ${ms(s.p95)} ${ms(s.p99)} ${ms(s.slowest)}`)
    }
  }
  say('')
  say('The hall, as each phone saw it:')
  table('hall')
  say('The spikes:')
  table('spike')
  say('Everything else:')
  table('other')
  say('')
  say(
    `${counts.calls} requests in all. Sent again after no answer: ${counts.retried}. Timed out: ${counts.timeouts}. No answer at all: ${counts.noAnswer}. ` +
      `Refused for rate (429): ${counts.refusedForRate}. Server errors (5xx): ${counts.serverErrors}.`,
  )

  // The bars.
  const of = (name) => spreadOf(timings.get(name) || [])
  const hallSave = of('hall|exam_save')
  const spikeAll = spreadOf([...timings].filter(([name]) => name.startsWith('spike|')).flatMap(([, list]) => list))
  const bars = [
    ['A save at the hall\'s pace, 95th percentile', hallSave.p95, BARS.hallP95, hallSave.count],
    ['A save at the hall\'s pace, 99th percentile', hallSave.p99, BARS.hallP99, hallSave.count],
    ['Any call in a spike, 99th percentile', spikeAll.p99, BARS.spikeP99, spikeAll.count],
  ]
  let missed = 0
  say('')
  for (const [what, got, bar, n] of bars) {
    if (n === 0) continue
    const met = got <= bar
    if (!met) missed += 1
    say(`  ${met ? 'met   ' : 'MISSED'}  ${what}: ${Math.round(got)} ms (the bar is ${bar} ms)`)
  }
  for (const [what, n] of [['Requests refused for rate', counts.refusedForRate], ['Server errors', counts.serverErrors]]) {
    if (n) missed += 1
    say(`  ${n ? 'MISSED' : 'met   '}  ${what}: ${n} (the bar is none)`)
  }
  return missed
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  try {
    cfg = readSettings(process.argv.slice(2), process.env)
  } catch (err) {
    if (!(err instanceof Refusal)) throw err
    console.error(`exam-stress: ${err.message}`)
    process.exit(2)
  }
  say(`exam-stress ${run} against ${cfg.live ? `THE LIVE PROJECT ${cfg.ref}` : `the local stack at ${cfg.api}`}. SEED=${cfg.seed}`)

  if (cfg.clean) {
    await cleanEverything()
    return
  }

  // Never beside a real exam.
  const others = await service('looking for exams that are ready', 'GET', '/rest/v1/exams?select=id,title,closes_at&status=eq.ready')
  const real = others.filter((e) => !String(e.title).startsWith(TAG) && (!e.closes_at || Date.parse(e.closes_at) > Date.now() - 3 * 3600_000))
  if (cfg.live && real.length) {
    console.error(`exam-stress: a real exam is ready ("${real[0].title}"). The stress test does not run beside one. Nothing was made.`)
    process.exit(2)
  }
  const stale = others.filter((e) => String(e.title).startsWith(TAG))
  if (stale.length) say(`Note: ${plural(stale.length, 'exam')} of an earlier stress run ${stale.length === 1 ? 'is' : 'are'} still there. Remove ${stale.length === 1 ? 'it' : 'them'} afterwards with --clean.`)

  const stopNow = () => {
    if (stopping) return
    stopping = true
    say('Stopping: clearing up what was made. Do not close this window.')
  }
  process.on('SIGINT', stopNow)
  process.on('SIGTERM', stopNow)

  let missedBars = 0
  try {
    const roll = dice(cfg.seed)
    takers = castTakers(roll)

    // The hall exam: sections, two passages, eight pictures.
    hall.questions = writeQuestions(roll, hall.id, [['shared', SHARED], ['scope', BLOCK], ['score', BLOCK]])
    const picture = () => `${hall.id}/${randomBytes(16).toString('hex')}.jpg`
    hall.passages = [
      { id: randomUUID(), section: 'shared', body: 'A passage that four shared questions are read with. '.repeat(12).trim(), image_path: null },
      { id: randomUUID(), section: 'scope', body: 'A picture that two of the professional exchange\'s questions are read with.', image_path: picture() },
    ]
    for (const n of [21, 22, 23, 24]) hall.questions[n - 1].passage_id = hall.passages[0].id
    for (const n of [SHARED + 1, SHARED + 2]) hall.questions[n - 1].passage_id = hall.passages[1].id
    for (const n of [3, 40, 55, 71, 72, SHARED + 5, SHARED + BLOCK + 3]) hall.questions[n - 1].image_path = picture()
    for (const q of hall.questions) hall.byId.set(q.id, q)
    spike.questions = writeQuestions(roll, spike.id, [['shared', SPIKE_QUESTIONS]])
    for (const q of spike.questions) spike.byId.set(q.id, q)

    // An exam belongs to the current term. A stack that was only just made
    // may have none; the live project always has.
    const terms = await service('reading the current term', 'GET', '/rest/v1/terms?select=id&is_current=is.true')
    if (terms.length === 0) {
      if (cfg.live) throw new Error('the live project has no current term, so no exam can be made')
      const today = new Date()
      const [term] = await service('adding a current term', 'POST', '/rest/v1/terms', {
        body: { label: `stress-${run}`, starts_on: today.toISOString().slice(0, 10), ends_on: new Date(today.getTime() + 365 * 864e5).toISOString().slice(0, 10), is_current: true },
        prefer: 'return=representation',
      })
      made.termId = term.id
    }

    await makeAccounts()
    if (cfg.onlySignIn) {
      await trySessions()
      missedBars = sayTimings()
      throw ONLY_THAT
    }
    const bytes = readFileSync(PICTURE_FILE)
    const paths = [...hall.questions.map((q) => q.image_path), ...hall.passages.map((p) => p.image_path)].filter(Boolean)
    for (const path of paths) await uploadPicture(path, bytes)
    const now = Date.now()
    // The hall exam is a draft until its opening time is set; the short one is open already.
    await addExam(hall, { minutes: cfg.minutes, opensAt: null, closesAt: null, status: 'draft' })
    await addExam(spike, { minutes: 30, opensAt: new Date(now - 10 * 60_000).toISOString(), closesAt: new Date(now + 6 * 3600_000).toISOString(), status: 'ready' })
    say(`Set up two exams, ${hall.questions.length + spike.questions.length} questions, ${hall.passages.length} passages and ${paths.length} pictures of ${Math.round(bytes.length / 1024)} KB.`)

    if (!stopping) await theHall()
    if (!stopping) await theSpikes()
    const totals = { hall: await compare(hall), spike: cfg.spikeRounds ? await compare(spike) : null }
    missedBars = sayTimings()
    if (cfg.live && totals.hall) {
      say('')
      say('To check the database\'s own marking of the hall exam against these sums (before the clean-up finishes, or from the note of them):')
      say(`  select count(*) filter (where sits_scope), sum(total_scope), count(*) filter (where sits_score), sum(total_score) from app.exam_result_rows('${hall.id}');`)
      say(`  expected: ${totals.hall.sitScope}, ${totals.hall.sumScope}, ${totals.hall.sitScore}, ${totals.hall.sumScore}${totals.hall.inDoubt ? ` (less the ${totals.hall.inDoubt} papers set aside)` : ''}`)
      if (process.env.PAUSE_BEFORE_CLEAN === '1') {
        say('PAUSE_BEFORE_CLEAN=1: waiting two minutes before the clean-up, for that query.')
        await sleep(120_000)
      }
    }
    if (cfg.resultFile) {
      writeFileSync(cfg.resultFile, JSON.stringify({ run, seed: cfg.seed, takers: cfg.takers, minutes: cfg.minutes, counts, totals, timings: Object.fromEntries([...timings].map(([k, v]) => [k, spreadOf(v)])), failures: failureLines() }, null, 2))
    }
  } catch (err) {
    if (err !== ONLY_THAT) miss(null, `stopped by an error: ${err.message}`)
  } finally {
    await cleanUp().catch((err) => miss(null, `clean-up failed: ${err.message}. Run it again with --clean.`))
  }

  say('')
  if (failures.length === 0) {
    say(`Result: everything matched${missedBars ? `, and ${plural(missedBars, 'bar')} for time or refusals ${missedBars === 1 ? 'was' : 'were'} missed` : ', and every bar was met'}.`)
  } else {
    const found = failureLines()
    say(`Result: ${plural(failures.length, 'thing')} did not match.`)
    for (const line of found.slice(0, 60)) say(`  - ${line}`)
    if (found.length > 60) say(`  and ${found.length - 60} more kinds of mismatch.`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['```', ...lines, '```', ''].join('\n'))
    } catch {
      // the log has them anyway
    }
  }
  process.exitCode = failures.length || (cfg.strict && missedBars) ? 1 : 0
}

// Only when run as a script: a test may import the parts above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('exam-stress failed:', err)
    process.exit(1)
  })
}
