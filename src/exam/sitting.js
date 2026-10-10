// The rules under a taker's exam pages: the pages of ten, the answers and which
// of them still wait to be sent, the review lists, the clock, and what to do
// when the database does not answer. Nothing here touches React, the network,
// storage or a clock (the time is always handed in), so sitting.test.js proves
// each rule; useSitting.js ties them to the page.
//
// The shapes, as rpc/exam_paper and rpc/exam_save use them:
//   question   { id, body, options: [text, ...] }, in this taker's order
//   answer     { c, f }: c is the chosen option's position as shown to this
//              taker (from 0), or null; f is the flag
//   held       what the phone holds: { answers: { [question id]: answer },
//              waiting: [question id, ...] }. `waiting` are the questions
//              whose latest answer the database has not confirmed yet.
//   reading    the phone's two clocks at one moment, { wall, mono }:
//              Date.now() and performance.now()
//   clock      what the database last said about time, pinned to a reading

export const PAGE_SIZE = 10
// The most answers in one save. The database refuses a list of more than 300.
export const BATCH_MAX = 200
// A save goes out this long after the last change, so quick taps travel together.
export const SEND_AFTER_MS = 400
// How often the page asks the database for the time when nothing else is sent.
export const HEARTBEAT_MS = 60 * 1000
// How far the phone's two clocks may drift apart before the database is asked again.
export const CLOCK_TOLERANCE_MS = 2000

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

// ---- the word in the address ----------------------------------------------------

const WORD = /^[a-z0-9]+(-[a-z0-9]+)*$/

// The last part of /exam/<word> as the database reads it (trimmed, lower case),
// or null when it could not be an exam's word. `callback` is the sign-in's own
// address and never an exam.
export function examWord(value) {
  if (typeof value !== 'string') return null
  const word = value.trim().toLowerCase()
  if (word.length > 60 || word === 'callback') return null
  return WORD.test(word) ? word : null
}

// ---- pages ----------------------------------------------------------------------

// Pages and question numbers both count from 1, as the screen shows them.
export function pageCount(total) {
  return Math.max(1, Math.ceil((Number(total) || 0) / PAGE_SIZE))
}

// A page number kept inside the paper.
export function clampPage(page, total) {
  const n = Math.trunc(Number(page)) || 1
  return Math.min(Math.max(n, 1), pageCount(total))
}

// The questions of one page, each with `n`, its number in this taker's order.
export function pageQuestions(questions, page) {
  const start = (clampPage(page, questions.length) - 1) * PAGE_SIZE
  return questions.slice(start, start + PAGE_SIZE).map((q, i) => ({ ...q, n: start + i + 1 }))
}

// The page a question number is on.
export function pageOf(n) {
  return Math.max(1, Math.ceil((Math.trunc(Number(n)) || 1) / PAGE_SIZE))
}

// ---- answers --------------------------------------------------------------------

const BLANK = Object.freeze({ c: null, f: false })
const same = (a, b) => a.c === b.c && a.f === b.f

export function emptyHeld() {
  return { answers: {}, waiting: [] }
}

// A question's answer, blank when it has none. Read only: never change what
// comes back.
export function answerOf(answers, id) {
  return answers && own(answers, id) ? answers[id] : BLANK
}

// How many options each question has, by id.
function optionCounts(questions) {
  return new Map((Array.isArray(questions) ? questions : []).map((q) => [q.id, q.options.length]))
}

// Whether `c` is an answer the question can take: null (cleared) or the
// position of one of its options. False for a question that is not on the paper.
export function canChoose(questions, id, c = null) {
  const count = optionCounts(questions).get(id)
  if (count === undefined) return false
  return c === null || (Number.isInteger(c) && c >= 0 && c < count)
}

// The one way an answer changes. A change that changes nothing returns the
// same object, so nothing is saved or sent for it.
function put(held, id, next) {
  if (same(answerOf(held.answers, id), next)) return held
  return {
    answers: { ...held.answers, [id]: next },
    waiting: held.waiting.includes(id) ? held.waiting : [...held.waiting, id],
  }
}

export function setAnswer(held, id, c) {
  if (!Number.isInteger(c) || c < 0) return held
  return put(held, id, { c, f: answerOf(held.answers, id).f })
}

// A cleared answer is an answer too: the database holds the old choice until
// it is told otherwise.
export function clearAnswer(held, id) {
  return put(held, id, { c: null, f: answerOf(held.answers, id).f })
}

// A flag stands on its own, on an answered question or an unanswered one.
export function toggleFlag(held, id) {
  const now = answerOf(held.answers, id)
  return put(held, id, { c: now.c, f: !now.f })
}

// ---- sending --------------------------------------------------------------------

// What to send next: the latest answer of each waiting question, as
// rpc/exam_save takes them. Taking a batch changes nothing, so a save that
// fails has lost nothing, and the next batch carries whatever is latest by then.
export function takeBatch(held, max = BATCH_MAX) {
  return held.waiting.slice(0, max).map((id) => ({ q: id, ...answerOf(held.answers, id) }))
}

// After the database answered a save. A question stops waiting only when the
// phone still holds exactly what was sent: one changed again while the save was
// in flight stays waiting, and its newer answer goes out next.
// Once the exam is over the database saves nothing (`saved` is 0), except
// within the thirty seconds it allows a late save; then `saved` says it landed.
export function settleBatch(held, batch, reply) {
  if (batch.length === 0) return held
  const landed = reply?.state !== 'over' || Number(reply?.saved) >= batch.length
  if (!landed) return held
  const done = new Set()
  for (const item of batch) {
    if (same(answerOf(held.answers, item.q), item)) done.add(item.q)
  }
  const waiting = held.waiting.filter((id) => !done.has(id))
  return waiting.length === held.waiting.length ? held : { answers: held.answers, waiting }
}

// Marks questions as waiting again, so their latest answer goes out once more.
// For a save whose outcome nobody knows (it left the phone and no answer came
// back): if it reaches the database late, after a newer answer to the same
// question was saved, the old one would stand, and sending the latest again
// puts it right. Only a question whose answer is held can wait (see tidyHeld).
export function waitAgain(held, ids) {
  const more = [...new Set(ids)].filter((id) => own(held.answers, id) && !held.waiting.includes(id))
  return more.length === 0 ? held : { answers: held.answers, waiting: [...held.waiting, ...more] }
}

function tidyAnswer(value, count) {
  if (!value || typeof value !== 'object' || count === undefined) return null
  const c = value.c ?? null
  if (c !== null && !(Number.isInteger(c) && c >= 0 && c < count)) return null
  return { c, f: value.f === true }
}

// What localStorage gave back, made safe to use: only this paper's questions,
// only positions those questions have. A question waits only if its answer is
// held, since sending a blank for it would wipe what the database has.
export function tidyHeld(value, questions) {
  const counts = optionCounts(questions)
  const from = value && typeof value === 'object' && value.answers && typeof value.answers === 'object' ? value.answers : {}
  const answers = {}
  for (const [id, count] of counts) {
    const answer = own(from, id) ? tidyAnswer(from[id], count) : null
    if (answer) answers[id] = answer
  }
  const listed = Array.isArray(value?.waiting) ? value.waiting : []
  const waiting = [...new Set(listed)].filter((id) => typeof id === 'string' && own(answers, id))
  return { answers, waiting }
}

// After a refresh: the database's answers (rpc/exam_paper's `answers`) with
// what the phone holds. Answers still waiting to be sent win, because the
// database has not seen them; everything else follows the database. A waiting
// answer the database already has stops waiting.
export function mergeAnswers(held, saved, questions) {
  const counts = optionCounts(questions)
  const answers = {}
  for (const row of Array.isArray(saved) ? saved : []) {
    const answer = tidyAnswer(row, counts.get(row?.q))
    if (answer) answers[row.q] = answer
  }
  const mine = tidyHeld(held, questions)
  const waiting = []
  for (const id of mine.waiting) {
    const answer = mine.answers[id]
    if (same(answer, answerOf(answers, id))) continue
    answers[id] = answer
    waiting.push(id)
  }
  return { answers, waiting }
}

// ---- the review and the page buttons --------------------------------------------

export function answeredCount(questions, answers) {
  return questions.filter((q) => answerOf(answers, q.id).c !== null).length
}

// Question numbers (from 1, this taker's order) still without an answer.
export function unansweredNumbers(questions, answers) {
  return questions.flatMap((q, i) => (answerOf(answers, q.id).c === null ? [i + 1] : []))
}

export function flaggedNumbers(questions, answers) {
  return questions.flatMap((q, i) => (answerOf(answers, q.id).f ? [i + 1] : []))
}

// One row per page: its question numbers `from` to `to`, how many of them are
// unanswered and how many are flagged.
export function pageSummaries(questions, answers) {
  const out = []
  for (let page = 1; page <= pageCount(questions.length); page += 1) {
    const start = (page - 1) * PAGE_SIZE
    const slice = questions.slice(start, start + PAGE_SIZE)
    out.push({
      page,
      from: start + 1,
      to: start + slice.length,
      unanswered: slice.filter((q) => answerOf(answers, q.id).c === null).length,
      flagged: slice.filter((q) => answerOf(answers, q.id).f).length,
    })
  }
  return out
}

// ---- the paper ------------------------------------------------------------------

// A paper from the database, or the phone's copy of one, as the pages take it:
// { exam: { title, minutes }, attempt: { id, started_at, deadline_at },
// questions }. Null for anything that is not a whole paper, so a broken copy
// is never shown with a question missing.
export function tidyPaper(value) {
  const attempt = value?.attempt
  if (!attempt || typeof attempt.id !== 'string' || !attempt.id) return null
  if (!Array.isArray(value.questions)) return null
  const seen = new Set()
  const questions = []
  for (const q of value.questions) {
    if (!q || typeof q.id !== 'string' || !q.id || seen.has(q.id)) return null
    if (!Array.isArray(q.options) || q.options.length === 0) return null
    seen.add(q.id)
    questions.push({ id: q.id, body: String(q.body ?? ''), options: q.options.map((o) => String(o ?? '')) })
  }
  return {
    exam: { title: String(value.exam?.title ?? ''), minutes: Number(value.exam?.minutes) || 0 },
    attempt: { id: attempt.id, started_at: attempt.started_at ?? null, deadline_at: attempt.deadline_at ?? null },
    questions,
  }
}

// ---- the clock ------------------------------------------------------------------
//
// The time left is the database's: its `deadline_at` less its `now`. The phone
// only counts the seconds since that answer arrived, as a stopwatch, so a phone
// whose clock is hours out still shows the right time. Every answer from the
// database (a save, the heartbeat) starts the stopwatch afresh, which is also
// how a deadline the officers moved later reaches the page.
//
// The stopwatch reads two clocks. Date.now() jumps when the phone's time is
// changed; performance.now() cannot be changed but stands still on many phones
// while they sleep. Each can only fall behind in its own way, so the larger of
// the two is the truer count, and when they disagree the page asks the
// database rather than trust either.

const pad = (n) => String(n).padStart(2, '0')

// A time from the database, in ms. Postgres writes six decimals and, as plain
// text, a space and a short offset ('2026-10-10 12:00:00.123456+00'), which
// not every phone's browser reads; they are put right first.
export function toMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value !== 'string') return NaN
  const text = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/(T.*[+-]\d{2})$/, '$1:00')
    .replace(/(T.*[+-]\d{2})(\d{2})$/, '$1:$2')
  return Date.parse(text)
}

// The database's `deadline_at` and `now` from one answer, pinned to the
// phone's clocks. `received` is the reading when the answer arrived and `sent`
// the one when the question left: the database read its clock somewhere
// between the two, and halfway is the best guess. Null when either time is
// missing, so a bad answer never replaces a good clock.
export function syncClock(deadlineAt, now, received, sent = received) {
  const deadline = toMs(deadlineAt)
  const at = toMs(now)
  if (!Number.isFinite(deadline) || !Number.isFinite(at) || !received) return null
  return {
    deadline,
    now: at,
    at: { wall: (sent.wall + received.wall) / 2, mono: (sent.mono + received.mono) / 2 },
  }
}

// Milliseconds on the stopwatch since `at`.
export function elapsedSince(at, reading) {
  const wall = reading.wall - at.wall
  const mono = reading.mono - at.mono
  return Math.max(0, Number.isFinite(wall) ? wall : 0, Number.isFinite(mono) ? mono : 0)
}

// Milliseconds left, never below 0; null while there is no clock yet.
export function remaining(clock, reading) {
  if (!clock) return null
  return Math.max(0, clock.deadline - clock.now - elapsedSince(clock.at, reading))
}

// True when the phone's two clocks no longer tell the same story (its time was
// changed, or it slept): time to ask the database again.
export function clocksDisagree(clock, reading, tolerance = CLOCK_TOLERANCE_MS) {
  if (!clock) return false
  const wall = reading.wall - clock.at.wall
  const mono = reading.mono - clock.at.mono
  return Number.isFinite(wall) && Number.isFinite(mono) && Math.abs(wall - mono) > tolerance
}

// Whether the time is up, by this phone's count:
//   'no'      there is time left, or no clock yet
//   'yes'     the count has reached zero and nothing on the phone says otherwise
//   'unsure'  only the phone's wall clock says so: its stopwatch still shows
//             time. The phone slept past the end, or its time was set ahead,
//             and it cannot tell which. The database is asked, and the paper
//             stays open until it answers: it refuses a late answer anyway,
//             so closing early would only lock a taker out of time they have.
export function timeUp(clock, reading, tolerance = CLOCK_TOLERANCE_MS) {
  if (remaining(clock, reading) !== 0) return 'no'
  const mono = reading.mono - clock.at.mono
  if (!Number.isFinite(mono)) return 'yes'
  return clock.deadline - clock.now - Math.max(0, mono) > tolerance ? 'unsure' : 'yes'
}

// The database takes a save that arrives up to this long after the deadline.
export const LATE_SAVE_MS = 30 * 1000

// Milliseconds since the deadline passed, by the phone's count: 0 until then,
// null while there is no clock.
export function overtime(clock, reading) {
  if (!clock) return null
  return Math.max(0, elapsedSince(clock.at, reading) - (clock.deadline - clock.now))
}

// True for the thirty seconds after the deadline, while a late save still
// lands: the time to try hard.
export function lateSaveOpen(clock, reading) {
  const over = overtime(clock, reading)
  return over !== null && remaining(clock, reading) === 0 && over <= LATE_SAVE_MS
}

// The clock as the phone keeps it between visits (plain numbers for
// localStorage). performance.now() starts again with every page load, so only
// the wall clock carries over.
export function holdClock(clock) {
  return clock ? { deadline: clock.deadline, now: clock.now, wall: clock.at.wall } : null
}

// The kept clock, picked up after a reload that the database did not answer.
// It leans on the phone's own clock for the time in between, which is the best
// there is until the database answers; a clock set back gives no time back.
export function heldClock(kept, reading) {
  if (!kept || ![kept.deadline, kept.now, kept.wall].every(Number.isFinite)) return null
  return {
    deadline: kept.deadline,
    now: kept.now + Math.max(0, reading.wall - kept.wall),
    at: { wall: reading.wall, mono: reading.mono },
  }
}

// '1:59:59', '9:05', '0:00'. A started second counts as a whole one, so 0:00
// shows only when the time is up. '' while the time left is not known.
export function formatClock(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return ''
  const total = Math.max(0, Math.ceil(Number(ms) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// ---- when the database does not answer ------------------------------------------

const RETRY_DELAYS = [2000, 5000, 10000]
const RETRY_EVERY = 15000

// How long to wait before trying again, after `failures` tries in a row have
// failed: 2 s, 5 s, 10 s, then every 15 s.
export function retryDelay(failures) {
  return RETRY_DELAYS[Math.max(1, Math.trunc(failures) || 1) - 1] ?? RETRY_EVERY
}

// With answers waiting in the thirty seconds after the deadline there is no
// time for that schedule: a failed save is tried again this soon, and a call
// that has not answered is given up this early so the next one can go.
export const HURRY_EVERY_MS = 1500
export const HURRY_TIMEOUT_MS = 8000

// What a failed call means, from the error's code and the HTTP status:
//   refused     the database said no in its own sentence (the exam's functions
//               raise those as 22023 or 23505); asking again will get the same
//               answer
//   signed_out  the session is gone or was not accepted
//   offline     no answer, a slow one, or a fault nobody wrote a sentence for:
//               worth trying again, and nothing held on the phone is given up
export function failureKind(code, status) {
  if (code === '22023' || code === '23505') return 'refused'
  if (code === '42501' || status === 401 || status === 403 || /^PGRST30\d$/.test(String(code || ''))) return 'signed_out'
  return 'offline'
}

// The save state for the header, ready to be put into words:
//   saved    everything the taker chose is in the database
//   saving   answers are on their way (`count` still waiting)
//   offline  the last try failed, or the phone says it has no connection;
//            `count` answers wait on the phone
export function saveStatus({ waiting = 0, sending = false, failures = 0, online = true }) {
  if (waiting > 0 && (failures > 0 || !online)) return { kind: 'offline', count: waiting }
  if (waiting > 0 || sending) return { kind: 'saving', count: waiting }
  return { kind: 'saved', count: 0 }
}
