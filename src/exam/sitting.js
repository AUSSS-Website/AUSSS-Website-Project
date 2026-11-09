// The rules under a taker's exam pages: the sections and the pages, the answers
// and which of them still wait to be sent, the review lists, the clock, and
// what to do when the database does not answer. Nothing here touches React, the network,
// storage or a clock (the time is always handed in), so sitting.test.js proves
// each rule; useSitting.js ties them to the page.
//
// The shapes, as rpc/exam_paper and rpc/exam_save use them:
//   question   { id, body, options: [text, ...], section, passage, image }, in
//              this taker's order. `section` is 'shared', 'scope' or 'score';
//              `passage` is the id of the text it is read with, or null;
//              `image` is its picture's place in the bucket, or null
//   sits       which of the two optional blocks this taker answers,
//              { scope, score }: never neither
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

// ---- sections -------------------------------------------------------------------
//
// An exam may end with two optional blocks of questions, one for each exchange
// programme: 'scope' (professional exchange) and 'score' (research exchange).
// Everybody answers the 'shared' questions; each taker sits one block or both,
// and may change that until the paper is handed in. The database sends every
// question, and the pages show the ones this taker sits.

export const BLOCKS = ['scope', 'score']

// A question's section; anything the page does not know reads as 'shared'.
export function sectionOf(question) {
  return question?.section === 'scope' || question?.section === 'score' ? question.section : 'shared'
}

// Which blocks a paper sits, made safe to use: both unless told otherwise, and
// never neither (the database refuses that too).
export function tidySits(value) {
  const scope = value?.scope !== false
  const score = value?.score !== false
  return scope || score ? { scope, score } : { scope: true, score: true }
}

export function sameSits(a, b) {
  return Boolean(a && b) && a.scope === b.scope && a.score === b.score
}

// How many questions each section has, and whether there is a choice to make:
// only when both blocks have questions.
export function sectionCounts(questions) {
  const counts = { shared: 0, scope: 0, score: 0 }
  for (const q of Array.isArray(questions) ? questions : []) counts[sectionOf(q)] += 1
  return { ...counts, choice: counts.scope > 0 && counts.score > 0 }
}

// The questions a taker sees: the shared ones and the blocks they sit, in the
// paper's order. The same array when nothing is left out.
export function visibleQuestions(questions, sits) {
  const list = Array.isArray(questions) ? questions : []
  const chosen = tidySits(sits)
  if (chosen.scope && chosen.score) return list
  return list.filter((q) => {
    const section = sectionOf(q)
    return section === 'shared' || chosen[section]
  })
}

// How many questions of each block have an answer, whether the block is sat or
// not: what a taker is told before leaving a block out.
export function blockAnswered(questions, answers) {
  const out = { scope: 0, score: 0 }
  for (const q of Array.isArray(questions) ? questions : []) {
    const section = sectionOf(q)
    if (section !== 'shared' && answerOf(answers, q.id).c !== null) out[section] += 1
  }
  return out
}

// ---- pages ----------------------------------------------------------------------
//
// Pages and question numbers both count from 1, as the screen shows them. A
// page holds up to ten questions, with two exceptions that keep things
// together: a section starts on a page of its own, and the questions that are
// read with one passage are never split (a passage with more than ten
// questions gets a page as long as it needs). A paper with no sections and no
// passages is plain pages of ten.

// The pages of a list of questions: [{ page, section, from, to, questions }],
// where each question carries `n`, its number in this list, and `from` and
// `to` are the first and last of those. Empty for an empty list.
export function layoutPages(questions) {
  const list = Array.isArray(questions) ? questions : []
  const pages = []
  let current = null
  let i = 0
  while (i < list.length) {
    // one unit: a single question, or the run of questions read with one passage
    const passage = list[i].passage || null
    let j = i + 1
    if (passage) while (j < list.length && list[j].passage === passage) j += 1
    const section = sectionOf(list[i])
    const full = current && current.questions.length > 0 && current.questions.length + (j - i) > PAGE_SIZE
    if (!current || current.section !== section || full) {
      current = { page: pages.length + 1, section, from: i + 1, to: i, questions: [] }
      pages.push(current)
    }
    for (let k = i; k < j; k += 1) current.questions.push({ ...list[k], n: k + 1 })
    current.to = j
    i = j
  }
  return pages
}

// How many pages a paper of `total` plain questions has. With sections or
// passages the count is layoutPages(...).length.
export function pageCount(total) {
  return Math.max(1, Math.ceil((Number(total) || 0) / PAGE_SIZE))
}

// A page number kept inside `pages` pages (at least one).
function clampTo(page, pages) {
  const n = Math.trunc(Number(page)) || 1
  return Math.min(Math.max(n, 1), Math.max(1, pages))
}

// A page number kept inside a paper of `total` plain questions.
export function clampPage(page, total) {
  return clampTo(page, pageCount(total))
}

// The questions of one page, each with `n`, its number in this taker's order.
export function pageQuestions(questions, page) {
  const pages = layoutPages(questions)
  return pages.length === 0 ? [] : pages[clampTo(page, pages.length) - 1].questions
}

// The page a question number is on, in a paper of plain pages of ten.
export function pageOf(n) {
  return Math.max(1, Math.ceil((Math.trunc(Number(n)) || 1) / PAGE_SIZE))
}

// The page a question number is on, in these pages (from layoutPages).
export function pageOfQuestion(pages, n) {
  const number = Math.trunc(Number(n)) || 1
  const found = (Array.isArray(pages) ? pages : []).find((p) => number >= p.from && number <= p.to)
  if (found) return found.page
  return number < 1 || !pages || pages.length === 0 ? 1 : pages.length
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

// One row per page: its section, its question numbers `from` to `to`, how many
// of them are unanswered and how many are flagged. `pages` are layoutPages of
// the same questions, for a caller that already has them. A paper with no
// question still has its one, empty page.
export function pageSummaries(questions, answers, pages = layoutPages(questions)) {
  if (pages.length === 0) return [{ page: 1, section: 'shared', from: 1, to: 0, unanswered: 0, flagged: 0 }]
  return pages.map((p) => ({
    page: p.page,
    section: p.section,
    from: p.from,
    to: p.to,
    unanswered: p.questions.filter((q) => answerOf(answers, q.id).c === null).length,
    flagged: p.questions.filter((q) => answerOf(answers, q.id).f).length,
  }))
}

// ---- the paper ------------------------------------------------------------------

const textOrNull = (value) => (typeof value === 'string' && value ? value : null)

// A paper from the database, or the phone's copy of one, as the pages take it:
// { exam: { title, minutes, sections }, attempt: { id, started_at,
// deadline_at, sits }, questions, passages }. `sections` is counted from the
// questions (sectionCounts); `sits` is the choice of blocks the database
// holds; `passages` is { [passage id]: { body, image } } for the passages a
// question names. Null for anything that is not a whole paper, so a broken
// copy is never shown with a question missing.
export function tidyPaper(value) {
  const attempt = value?.attempt
  if (!attempt || typeof attempt.id !== 'string' || !attempt.id) return null
  if (!Array.isArray(value.questions)) return null
  // the database sends a list, the phone's copy holds the tidied map
  const given = Array.isArray(value.passages)
    ? value.passages
    : Object.entries(value.passages && typeof value.passages === 'object' ? value.passages : {}).map(([id, p]) => ({ id, ...p }))
  const texts = new Map()
  for (const p of given) {
    if (p && typeof p.id === 'string' && p.id) texts.set(p.id, { body: String(p.body ?? ''), image: textOrNull(p.image) })
  }
  const seen = new Set()
  const questions = []
  const passages = {}
  for (const q of value.questions) {
    if (!q || typeof q.id !== 'string' || !q.id || seen.has(q.id)) return null
    if (!Array.isArray(q.options) || q.options.length === 0) return null
    seen.add(q.id)
    // a passage the paper does not carry is no passage: the question stands alone
    const passage = textOrNull(q.passage)
    const known = passage && texts.has(passage) ? passage : null
    if (known) passages[known] = texts.get(known)
    questions.push({
      id: q.id,
      body: String(q.body ?? ''),
      options: q.options.map((o) => String(o ?? '')),
      section: sectionOf(q),
      passage: known,
      image: textOrNull(q.image),
    })
  }
  return {
    exam: {
      title: String(value.exam?.title ?? ''),
      minutes: Number(value.exam?.minutes) || 0,
      sections: sectionCounts(questions),
    },
    attempt: {
      id: attempt.id,
      started_at: attempt.started_at ?? null,
      deadline_at: attempt.deadline_at ?? null,
      sits: tidySits(attempt.sits ?? { scope: attempt.sits_scope, score: attempt.sits_score }),
    },
    questions,
    passages,
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
// `choice` is true while a change of sections waits to be confirmed: it is
// something not saved yet, as an answer is. `count` does not include it; the
// state then carries `choice: true` beside it.
export function saveStatus({ waiting = 0, sending = false, failures = 0, online = true, choice = false }) {
  const something = waiting > 0 || choice
  const more = choice ? { choice: true } : {}
  if (something && (failures > 0 || !online)) return { kind: 'offline', count: waiting, ...more }
  if (something || sending) return { kind: 'saving', count: waiting, ...more }
  return { kind: 'saved', count: 0 }
}
