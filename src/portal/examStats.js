// The arithmetic of the Exam page's Results and Overview tabs
// (pages/exam/ResultsPanel.jsx, AttemptSheet.jsx, OverviewPanel.jsx), kept
// away from the screens so it can be tested. Pure: no network and no clock.
//
// The database marks and ranks (rpc/exam_results, exam_sheet and
// exam_question_stats, migration 20261010120001_exchange_exam.sql). Nothing
// here marks an answer or puts the ranking in order: these functions count
// what came back, say it in words and build the columns of the exports. Each
// of them takes an empty list, a missing figure or an exam nobody has sat and
// answers with zeros, nulls or '', never by dividing by nothing.
//
// Also here, because every part of the page asks it: where an exam stands on
// the clock, how long a page waits before it asks the database again by
// itself, and what a page says when a read fails. The time is always handed in
// (`now`), never read here.

import { errorText } from '../lib/errorText.js'
import { isoToCairoLocal } from '../lib/eventTime.js'
import { normalize } from '../lib/text.js'
import { tidyId } from './examFile.js'
import { prepareRoster, searchRoster } from './rosterSearch.js'

const list = (v) => (Array.isArray(v) ? v : [])
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const num = (v) => (isNum(v) ? v : 0)

// ---- the exam on the clock --------------------------------------------------

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// Where an exam stands at `now` (milliseconds):
//   'draft'      students cannot reach it;
//   'before'     open to students, who can sign in and check their ID, but its
//                opening time has not come;
//   'open'       a student on the list can start;
//   'finishing'  past its closing time, so nobody else can start, while a
//                paper started just before it may still be running (every
//                paper runs its full length from its own start);
//   'over'       the last paper that could have been started has run out.
export function examPhase(exam, now) {
  if (exam?.status !== 'ready') return 'draft'
  const opens = Date.parse(exam.opens_at)
  const closes = Date.parse(exam.closes_at)
  if (!Number.isFinite(opens) || now < opens) return 'before'
  if (!Number.isFinite(closes) || now < closes) return 'open'
  return now < closes + num(exam.minutes) * MINUTE ? 'finishing' : 'over'
}

// How long a page waits before it asks the database again by itself, in
// milliseconds, or false when nothing can change without an officer's doing.
// While a student can start it is `every`, and for two more reads after the
// closing time, for the student who started in its last seconds. Before the
// opening time it is the wait until then (an hour at most), so a page left
// open wakes up when the exam opens. Papers that are still running are the
// ranking's own business (anySitting).
export function refreshIn(exam, now, every) {
  const phase = examPhase(exam, now)
  if (phase === 'open') return every
  if (phase === 'before') {
    const opens = Date.parse(exam.opens_at)
    return Number.isFinite(opens) ? Math.min(HOUR, opens - now + 1000) : false
  }
  if (phase === 'finishing' && now < Date.parse(exam.closes_at) + 2 * every) return every
  return false
}

// ---- a read that failed -----------------------------------------------------

// What a page says when it could not read something: what it was doing, then
// why, when the reason is one an officer can act on (no connection, no
// permission, a refusal the database wrote in a sentence). `doing` is the rest
// of "Couldn’t …", such as 'load the results'. Anything else the database or
// the browser said is left out: it was not written for people. With no error
// at all, the read came back empty.
export function readProblem(doing, err) {
  if (!err) return `Couldn’t ${doing}: the database sent nothing back.`
  const why = errorText(err, '')
  return why ? `Couldn’t ${doing}. ${why}` : `Couldn’t ${doing}.`
}

// ---- states -----------------------------------------------------------------

// A paper's state as rpc/exam_results names it, in the words the pages show.
// A state this file does not know shows as it came.
const STATE_LABEL = {
  handed_in: 'Handed in',
  timed_out: 'Time ran out',
  sitting: 'Still sitting',
}

export function stateLabel(state) {
  return STATE_LABEL[state] || String(state || '')
}

// A finished paper was handed in or ran out of time. The averages and the
// spread of grades count these only: a paper still being sat has a grade so
// far, not a grade.
export function isFinished(row) {
  return row?.state === 'handed_in' || row?.state === 'timed_out'
}

export function anySitting(attempts) {
  return list(attempts).some((r) => r?.state === 'sitting')
}

// How many started, and where each paper is now.
export function tally(attempts) {
  const out = { started: 0, handedIn: 0, timedOut: 0, sitting: 0, finished: 0 }
  for (const r of list(attempts)) {
    out.started += 1
    if (r?.state === 'handed_in') out.handedIn += 1
    else if (r?.state === 'timed_out') out.timedOut += 1
    else if (r?.state === 'sitting') out.sitting += 1
  }
  out.finished = out.handedIn + out.timedOut
  return out
}

// The ranks more than one paper holds: equal grades share a rank, and the
// pages mark a shared one ('=3') so a row on its own still says so.
export function sharedRanks(attempts) {
  const seen = new Set()
  const shared = new Set()
  for (const r of list(attempts)) {
    if (r?.rank == null) continue
    if (seen.has(r.rank)) shared.add(r.rank)
    else seen.add(r.rank)
  }
  return shared
}

// ---- averages and words -----------------------------------------------------

function mean(values) {
  const nums = values.filter(isNum)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

// The average grade and the average time (in seconds) of the finished papers,
// and how many those are. Each average is null until a paper has finished.
export function averages(attempts) {
  const done = list(attempts).filter(isFinished)
  return {
    papers: done.length,
    grade: mean(done.map((r) => r.score)),
    seconds: mean(done.map((r) => r.seconds)),
  }
}

// '61.4', '62': one decimal place, dropped when it is zero. '' for no number.
export function oneDecimal(n) {
  return isNum(n) ? (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '') : ''
}

// A share (0 to 1) as a whole percentage, '23%'. '' when there was nothing to
// divide by.
export function percent(share) {
  return isNum(share) ? `${Math.round(share * 100)}%` : ''
}

// A length of time in words: '45 s', '48 min', '2 h', '1 h 12 min'. From a
// minute up it is the nearest whole minute. '' when there is no time yet (a
// paper still being sat).
export function durationWords(seconds) {
  if (!isNum(seconds) || seconds < 0) return ''
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const minutes = Math.round(s / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

// An instant on Cairo's clock for a spreadsheet cell, '2026-11-14 18:05'. ''
// for none.
export function cairoStamp(iso) {
  return isoToCairoLocal(iso).replace('T', ' ')
}

// ---- the spread of grades ---------------------------------------------------

const BANDS = 10

// The ranges of grades the spread is drawn in, lowest first: ten equal bands
// of an exam's grades, the top one closed at full marks (0–9, 10–19 ... 90–100
// for a hundred questions). An exam of fewer than ten questions has one band
// for each grade it can give.
export function gradeBands(questions) {
  const n = Math.max(0, Math.floor(num(questions)))
  const band = (from, to) => ({ from, to, label: from === to ? String(from) : `${from}–${to}` })
  if (n < BANDS) return Array.from({ length: n + 1 }, (_, grade) => band(grade, grade))
  return Array.from({ length: BANDS }, (_, i) =>
    band(Math.ceil((i * n) / BANDS), i === BANDS - 1 ? n : Math.ceil(((i + 1) * n) / BANDS) - 1),
  )
}

// The bands with how many finished papers scored in each.
export function gradeSpread(attempts, questions) {
  const bands = gradeBands(questions).map((b) => ({ ...b, count: 0 }))
  for (const r of list(attempts)) {
    if (!isFinished(r) || !isNum(r.score)) continue
    const at = bands.findIndex((b) => r.score <= b.to)
    bands[at === -1 ? bands.length - 1 : at].count += 1
  }
  return bands
}

// ---- the questions ----------------------------------------------------------

// 'A' for the first option, as the officers wrote them.
export function optionLetter(i) {
  return String.fromCharCode(65 + i)
}

// 'B. Aspirin': an option of a question by its place in the officers' order.
// '' when the question has no such option (an unanswered one has none chosen).
export function optionText(question, i) {
  const options = list(question?.options)
  return Number.isInteger(i) && i >= 0 && i < options.length ? `${optionLetter(i)}. ${options[i]}` : ''
}

// The share of the papers that got a question right, 0 to 1, where `papers` is
// how many there are (rpc/exam_question_stats counts every paper, finished or
// not). A question left unanswered counts as not right. null with no paper.
export function shareRight(question, papers) {
  return papers > 0 ? Math.min(1, num(question?.right) / papers) : null
}

// The questions most people got wrong first. Every question is out of the
// same number of papers, so the fewest right answers is the smallest share;
// equal ones stay in the officers' order.
export function hardestFirst(questions) {
  return [...list(questions)].sort((a, b) => num(a?.right) - num(b?.right) || num(a?.n) - num(b?.n))
}

// How one question was answered: a line for each option in the officers' order
// (how many chose it and what share of the papers that is, null with no
// paper), and how many papers left the question unanswered.
export function optionShares(question, papers) {
  const counts = list(question?.counts)
  const share = (count) => (papers > 0 ? Math.min(1, count / papers) : null)
  const options = list(question?.options).map((text, i) => ({
    index: i,
    letter: optionLetter(i),
    text,
    count: num(counts[i]),
    share: share(num(counts[i])),
    correct: i === question?.correct,
  }))
  const answered = isNum(question?.answered) ? question.answered : options.reduce((sum, o) => sum + o.count, 0)
  const blank = Math.max(0, num(papers) - answered)
  return { options, blank: { count: blank, share: share(blank) } }
}

// ---- one paper --------------------------------------------------------------

// A line of a paper (rpc/exam_sheet) is 'right', 'wrong', or 'blank' when no
// option was chosen.
export function rowOutcome(row) {
  if (row?.chosen == null) return 'blank'
  return row.chosen === row.correct ? 'right' : 'wrong'
}

export const OUTCOME_LABEL = { right: 'Right', wrong: 'Wrong', blank: 'Not answered' }

// How many lines of a paper are right, wrong, unanswered and flagged.
export function sheetCounts(rows) {
  const out = { all: 0, right: 0, wrong: 0, blank: 0, flagged: 0 }
  for (const row of list(rows)) {
    out.all += 1
    out[rowOutcome(row)] += 1
    if (row?.flagged) out.flagged += 1
  }
  return out
}

// ---- the search box ---------------------------------------------------------

// The ranking narrowed to what was typed: every word must be in the name, the
// email, the student ID or the phone. The rows keep the database's order and
// each keeps its own `rank`, so a search never moves anyone up.
//
// When nobody matches as typed, `similar` is true and the rows are the names a
// spelling away (Mohamed for Muhammad), found the way the roster's search
// finds them and still in the ranking's order.
export function searchResults(attempts, q) {
  const rows = list(attempts)
  const tokens = normalize(q).split(' ').filter(Boolean).slice(0, 8)
  if (tokens.length === 0) return { rows, similar: false }
  const ids = tokens.map(tidyId)
  const exact = rows.filter((row) => {
    const text = [row?.full_name, row?.email, row?.student_id].map(normalize).join('\n')
    const id = `${tidyId(row?.student_id)}\n${tidyId(row?.phone)}`
    return tokens.every((tok, i) => text.includes(tok) || (ids[i] !== '' && id.includes(ids[i])))
  })
  if (exact.length > 0) return { rows: exact, similar: false }
  const people = rows.map((row) => ({ full_name: row?.full_name || '', email: row?.email || '', paper: row }))
  const near = new Set(searchRoster(prepareRoster(people), q).map((person) => person.paper))
  return { rows: rows.filter((row) => near.has(row)), similar: near.size > 0 }
}

// ---- exports ----------------------------------------------------------------
// Columns in the shape exportFile.js takes ({ label, value }), shared by the
// CSV and the PDF of each list.

// The name of an export's file, before the date and the extension that
// ExportButtons adds: 'ausss-exam-exchange-exam-2026-results'. The words come
// from the exam's title, never from the hidden word of its address.
export function exportName(title, ...parts) {
  const slug = (v) =>
    normalize(v)
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
      .replace(/^-+|-+$/g, '')
  return ['ausss-exam', slug(title), ...parts.map(slug)].filter(Boolean).join('-')
}

// A cell that holds what a student typed (a name, a year, a phone number, the
// address of the account), made safe for a spreadsheet. A spreadsheet program
// takes a cell that starts with = + - or @ (or with a tab or a carriage
// return) for a formula, and a formula can fetch from the internet or start a
// program on the officer's computer. Such a cell gets a single quote in
// front, which makes it text. A phone number in the international form
// ('+20 100 123 4567') stays as typed: a sign followed only by digits, spaces
// and a phone's own punctuation is a number at worst.
//
// Only the people's columns go through this, never every export: the
// questions' CSV has to read back as it was written, and '-2' or '+ve' is an
// option as the officers wrote it (examFile.js).
const READ_AS_FORMULA = /^[=+\-@\t\r]/
const ONLY_A_NUMBER = /^[+-][\d\s().-]*$/

export function typedCell(v) {
  const text = v == null ? '' : String(v)
  return READ_AS_FORMULA.test(text) && !ONLY_A_NUMBER.test(text) ? `'${text}` : text
}

// The ranking. `questions` is how many the exam has. The email and the phone
// are here though the screen leaves them out: the officers write to people
// from this file. Times are Cairo's.
export function resultColumns(questions) {
  return [
    { label: 'Rank', value: (r) => r.rank },
    { label: 'Name', value: (r) => typedCell(r.full_name) },
    { label: 'Student ID', value: (r) => r.student_id },
    { label: 'Year', value: (r) => typedCell(r.faculty_year) },
    { label: `Grade (of ${num(questions)})`, value: (r) => r.score },
    { label: 'Answered', value: (r) => r.answered },
    { label: 'Time taken', value: (r) => durationWords(r.seconds) },
    { label: 'State', value: (r) => stateLabel(r.state) },
    { label: 'Email', value: (r) => typedCell(r.email) },
    { label: 'Phone', value: (r) => typedCell(r.phone) },
    { label: 'Started (Cairo time)', value: (r) => cairoStamp(r.started_at) },
    { label: 'Finished (Cairo time)', value: (r) => cairoStamp(r.finished_at) },
  ]
}

// The lines printed above a list of papers: how many, and the averages.
export function resultSummary(attempts, questions) {
  const t = tally(attempts)
  const avg = averages(attempts)
  return [
    ['Papers', t.started],
    ['Handed in', t.handedIn],
    ['Time ran out', t.timedOut],
    ['Still sitting', t.sitting],
    ['Average grade', avg.grade == null ? 'No finished paper yet' : `${oneDecimal(avg.grade)} of ${num(questions)}`],
    ['Average time', avg.seconds == null ? 'No finished paper yet' : durationWords(avg.seconds)],
  ]
}

// One paper, a line for each question in the officers' order.
export function sheetColumns() {
  return [
    { label: 'No.', value: (r) => r.n },
    { label: 'Question', value: (r) => r.body },
    { label: 'Right answer', value: (r) => optionText(r, r.correct) },
    { label: 'Chosen answer', value: (r) => optionText(r, r.chosen) },
    { label: 'Result', value: (r) => OUTCOME_LABEL[rowOutcome(r)] },
    { label: 'Flagged', value: (r) => (r.flagged ? 'Flagged' : '') },
  ]
}

// The lines printed above one paper: whose it is, the grade and the time.
// `questions` is how many the paper has.
export function sheetSummary(attempt, questions) {
  const a = attempt || {}
  return [
    ['Student ID', a.student_id],
    ['Year', a.faculty_year],
    ['Email', a.email],
    ['Phone', a.phone],
    ['Grade', `${num(a.score)} of ${num(questions)}`],
    ['Answered', `${num(a.answered)} of ${num(questions)}`],
    ['State', stateLabel(a.state)],
    ['Time taken', durationWords(a.seconds)],
    ['Started (Cairo time)', cairoStamp(a.started_at)],
    ['Finished (Cairo time)', cairoStamp(a.finished_at)],
  ].filter(([, value]) => value != null && value !== '')
}

// The question figures: each question with how many papers answered it, got
// it right and chose each option. `stats` is what rpc/exam_question_stats
// returned. There is a column for each option of the question that has most.
export function questionColumns(stats) {
  const papers = num(stats?.attempts)
  const most = Math.max(0, ...list(stats?.questions).map((q) => list(q?.options).length))
  return [
    { label: 'No.', value: (q) => q.n },
    { label: 'Question', value: (q) => q.body },
    { label: 'Right answer', value: (q) => optionText(q, q.correct) },
    { label: 'Papers', value: () => papers },
    { label: 'Answered', value: (q) => q.answered },
    { label: 'Right', value: (q) => q.right },
    { label: 'Share right', value: (q) => percent(shareRight(q, papers)) },
    ...Array.from({ length: most }, (_, i) => ({
      label: `Chose ${optionLetter(i)}`,
      value: (q) => (i < list(q.options).length ? num(list(q.counts)[i]) : ''),
    })),
    { label: 'No answer', value: (q) => optionShares(q, papers).blank.count },
  ]
}
