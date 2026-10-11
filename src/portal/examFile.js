// The exchange exam's set-up, the parts that are plain work on text and lists
// (no database, no screen), so they can be tested on their own:
//
//   the questions' spreadsheet (.xlsx or .csv) into the rows
//     rpc/import_exam_questions takes, and the template that shows its layout;
//   the registered students' IDs, pasted or from a file, into the array
//     rpc/exam_add_registrations takes;
//   the checks a question passes before it is sent, shared by the file and
//     the form, and the two small sums the questions' list needs.
//
// The questions' layout is by position, one question a row:
//   A Question, B to G Option A to Option F, H Answer, I Keep order.
// A first row whose first cell is "Question" is a header. Answer is a letter
// (A to F), a number (1 to 6) or the right option's exact text; Keep order is
// "yes" for a question whose options must stay as written, else blank.
// Nothing is imported unless every row is good: each bad row is named by its
// number in the sheet, with the reason.
import { UNREACHED } from '../lib/errorText.js'
import { parseCsv } from './rosterFile.js'
import { toCsv } from './exportFile.js'

// An error whose message is a sentence of this file's own, written for the
// officer. The mark is what errorText (src/lib/errorText.js) looks for: it
// shows a marked sentence as written, and puts the page's own words in place
// of anything else a failed read threw (the spreadsheet reader's, the
// browser's).
const refusal = (sentence) => Object.assign(new Error(sentence), { rejected: true })

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
export const MAX_OPTIONS = OPTION_LETTERS.length
// What one call of each RPC takes.
export const MAX_IMPORT = 500
export const MAX_IDS = 5000

const BODY_MAX = 2000
const OPTION_MAX = 500
const ANSWER_COL = 1 + MAX_OPTIONS
const KEEP_COL = ANSWER_COL + 1
const HEADERS = ['Question', ...OPTION_LETTERS.map((l) => `Option ${l}`), 'Answer', 'Keep order']

const cell = (v) => String(v ?? '').trim()
// Length as the database counts it: characters, not UTF-16 units.
const chars = (s) => [...s].length
// What a browser puts where a file's bytes are not the text it was told to
// expect (U+FFFD), named by its code point so that no editor can lose it.
const UNREADABLE = String.fromCharCode(0xfffd)
// How two texts are compared when an answer names an option by its words.
const plain = (s) => cell(s).replace(/\s+/g, ' ').toLowerCase()

// 'A' for 0; '' for anything that is not an option's place.
export function letterOf(index) {
  return OPTION_LETTERS[index] ?? ''
}

// ---- one question -----------------------------------------------------------

// What the database would refuse about a question, and where in the form it
// is, or null: { at, index, problem }. `problem` is the database's own
// sentence. `at` is 'body', 'options' or 'correct', so the form can say it
// beside that part and take the officer there; for 'options', `index` is the
// place of the first option that is empty or too long, or null when there are
// simply too few or too many. `correct` is the right option's place, from 0.
export function questionFault({ body, options, correct }) {
  const text = cell(body)
  if (text === '' || chars(text) > BODY_MAX) return { at: 'body', index: null, problem: 'A question needs its text.' }
  const opts = Array.isArray(options) ? options.map(cell) : []
  const bad = opts.findIndex((o) => o === '' || chars(o) > OPTION_MAX)
  if (opts.length < 2 || opts.length > MAX_OPTIONS || bad !== -1) {
    return {
      at: 'options',
      index: bad === -1 ? null : bad,
      problem: 'A question needs between 2 and 6 options, none of them empty.',
    }
  }
  if (!Number.isInteger(correct) || correct < 0 || correct >= opts.length) {
    return { at: 'correct', index: null, problem: 'Choose which option is right.' }
  }
  return null
}

// That refusal as the sentence alone, or ''.
export function questionProblem(question) {
  return questionFault(question)?.problem ?? ''
}

// The form's options without the one at `index`, and where the right answer
// sits afterwards: one place up when it came after the removed option, and
// unchosen (null) when it was the removed option.
export function dropOption(options, correct, index) {
  const next = options.filter((_, i) => i !== index)
  if (correct == null) return { options: next, correct: null }
  return { options: next, correct: correct === index ? null : correct > index ? correct - 1 : correct }
}

// ---- the questions' order ---------------------------------------------------

// The rows to write after a drag: `questions` in the order they were, `ids` in
// the new order. The numbers already in use are dealt out again in the new
// order, so only the rows between where the question left and where it landed
// change; when the old numbers do not make an order (two the same), every row
// is numbered afresh.
export function sortChanges(questions, ids) {
  const byId = new Map(questions.map((q) => [q.id, q]))
  if (ids.length !== questions.length || ids.some((id) => !byId.has(id))) return []
  const used = questions.map((q) => q.sort).sort((a, b) => a - b)
  const usable = used.every((n, i) => Number.isInteger(n) && (i === 0 || n > used[i - 1]))
  return ids
    .map((id, i) => ({ id, sort: usable ? used[i] : i }))
    .filter((change) => byId.get(change.id).sort !== change.sort)
}

// ---- the questions' spreadsheet ---------------------------------------------

const A_LETTER = /^[a-f]$/i
const A_NUMBER = /^[1-6]$/

// What to write in place of an answer that can be read two ways: the right
// option's number where the answer was a letter, and its letter where it was
// a number. When an option's own text reads like one of those too, neither is
// safe and only rewording is.
function wayOut(answer, options) {
  const wasLetter = A_LETTER.test(answer)
  if (options.some((o) => (wasLetter ? A_NUMBER : A_LETTER).test(plain(o)))) return 'Reword one of them.'
  return wasLetter
    ? `Give the right option’s number (1 to ${options.length}) instead.`
    : `Give the right option’s letter (A to ${letterOf(options.length - 1)}) instead.`
}

// Which option an Answer cell names, or the reason it names none.
function readAnswer(answer, options) {
  const last = letterOf(options.length - 1)
  if (answer === '') return { problem: 'The Answer column is empty.' }
  // Read as a place (a letter or a number), and as an option's own words.
  let byPlace = -1
  if (A_LETTER.test(answer)) byPlace = OPTION_LETTERS.indexOf(answer.toUpperCase())
  else if (A_NUMBER.test(answer)) byPlace = Number(answer) - 1
  const inRange = byPlace !== -1 && byPlace < options.length
  const byText = options.flatMap((o, i) => (plain(o) === plain(answer) ? [i] : []))

  if (byText.length > 1) {
    return { problem: `The answer “${answer}” matches more than one option. Give its letter instead.` }
  }
  if (inRange && byText.length === 1 && byText[0] !== byPlace) {
    // "3" where the options are 2, 3, 4 and 5: the third option, or the one
    // that reads 3? "C" where they are K, E, D and C: the third, or the C?
    return {
      problem: `The answer “${answer}” can be read two ways: as option ${letterOf(byPlace)}, or as the option that reads “${answer}”. ${wayOut(answer, options)}`,
    }
  }
  if (byText.length === 1) return { correct: byText[0] }
  if (byPlace === -1) {
    return {
      problem: `The answer “${answer}” is not one of the options. Give a letter (A to ${last}), a number (1 to ${options.length}) or the option’s exact text.`,
    }
  }
  if (!inRange) {
    return { problem: `The answer “${answer}” is past the last option: the question has ${options.length}.` }
  }
  return { correct: byPlace }
}

// One row of the sheet: { row } as the RPC takes it, or { problem }.
function readQuestion(cells) {
  const body = cell(cells[0])
  if (body === '') return { problem: 'A question needs its text.' }
  if (chars(body) > BODY_MAX) return { problem: `The question is longer than ${BODY_MAX} characters.` }

  const filled = OPTION_LETTERS.map((_, i) => cell(cells[1 + i]))
  const count = filled.reduce((n, o, i) => (o === '' ? n : i + 1), 0)
  const options = filled.slice(0, count)
  const gap = options.indexOf('')
  if (gap !== -1) {
    return { problem: `Option ${letterOf(gap)} is empty but a later option is not. Fill the options from A with no gap.` }
  }
  if (count < 2) return { problem: 'A question needs between 2 and 6 options, none of them empty.' }
  const long = options.findIndex((o) => chars(o) > OPTION_MAX)
  if (long !== -1) return { problem: `Option ${letterOf(long)} is longer than ${OPTION_MAX} characters.` }

  const answer = readAnswer(cell(cells[ANSWER_COL]), options)
  if (answer.problem) return answer

  const keep = cell(cells[KEEP_COL]).toLowerCase()
  if (!['', 'yes', 'y', 'true', 'no', 'n', 'false'].includes(keep)) {
    return { problem: 'Keep order is “yes” or left blank.' }
  }
  return { row: { body, options, correct: answer.correct, keep_order: ['yes', 'y', 'true'].includes(keep) } }
}

// grid: the sheet as an array of rows of cell text. Returns { rows, problems }:
// `rows` are for rpc/import_exam_questions, and are to be sent only when
// `problems` (sentences an officer can act on) is empty.
export function questionsFromGrid(grid) {
  const lines = (grid || []).map((r) => (Array.isArray(r) ? r : []))
  const blank = (r) => r.slice(0, KEEP_COL + 1).every((c) => cell(c) === '')
  const first = lines.findIndex((r) => !blank(r))
  if (first === -1) return { rows: [], problems: ['That file is empty.'] }

  // A .csv saved where the list separator is a semicolon arrives as one cell a
  // row. Say so, rather than refuse every row for having no options.
  if (cell(lines[first][0]).includes(';') && lines[first].slice(1).every((c) => cell(c) === '')) {
    return {
      rows: [],
      problems: ['This file separates its cells with semicolons. Save it as an Excel workbook (.xlsx) and import that.'],
    }
  }

  // A .csv that Excel saved as plain "CSV (Comma delimited)" is not UTF-8, and
  // every character outside plain English in it (a curly apostrophe, a degree
  // sign, all Arabic) arrives as the "cannot be read" mark. Students would be
  // shown that mark, so the file is refused whole.
  if (lines.some((r) => r.slice(0, KEEP_COL + 1).some((c) => String(c ?? '').includes(UNREADABLE)))) {
    return {
      rows: [],
      problems: [
        'Some characters in this file cannot be read, because it was not saved as UTF-8. Save it as “CSV UTF-8” or as an Excel workbook (.xlsx) and import that.',
      ],
    }
  }

  const header = cell(lines[first][0]).toLowerCase() === 'question' ? first : -1
  const rows = []
  const problems = []
  lines.forEach((r, i) => {
    if (i === header || blank(r)) return
    const read = readQuestion(r)
    if (!read.problem) {
      rows.push(read.row)
      return
    }
    // A header the import did not take as one (its first cell reads something
    // else, or a title sits above it) is refused as a question whose answer
    // is "Answer". Say what it is.
    const looksLikeHeader = cell(r[ANSWER_COL]).toLowerCase() === 'answer'
    problems.push(
      `Row ${i + 1}: ${
        looksLikeHeader
          ? 'This looks like the header. The header is the sheet’s first row, and its first cell reads “Question”.'
          : read.problem
      }`,
    )
  })
  const found = rows.length + problems.length
  if (found === 0) return { rows: [], problems: ['That file has a header but no questions under it.'] }
  if (found > MAX_IMPORT) {
    // The database's own sentence, with what this file holds.
    return {
      rows: [],
      problems: [
        `Import between 1 and ${MAX_IMPORT} questions at a time. This file has ${found}: import it in ${Math.ceil(found / MAX_IMPORT)} parts.`,
      ],
    }
  }
  return { rows, problems }
}

// What the export writes in a question's Answer cell: the right option's
// letter. Where the import would read that letter two ways (the options are
// single letters themselves, as with vitamins K, E, D and C), it is the
// option's number, and failing that its own text: the first of the three the
// import reads back as the same option. '' for a question with no right answer.
export function answerCell(question) {
  const options = (Array.isArray(question?.options) ? question.options : []).map(cell)
  const correct = question?.correct
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) return ''
  const ways = [letterOf(correct), String(correct + 1), options[correct]]
  return ways.find((way) => readAnswer(way, options).correct === correct) ?? ways[0]
}

// The same layout, as columns for an export: a question from the portal's list
// ({ body, options, correct, keep_option_order }) per row. A CSV made from
// them can be imported into another exam as it is.
export const questionColumns = [
  { label: HEADERS[0], value: (q) => q.body },
  ...OPTION_LETTERS.map((_, i) => ({ label: HEADERS[1 + i], value: (q) => q.options?.[i] ?? '' })),
  { label: HEADERS[ANSWER_COL], value: answerCell },
  { label: HEADERS[KEEP_COL], value: (q) => (q.keep_option_order ? 'yes' : '') },
]

// "Download a template": the header and two made-up questions, one answered by
// letter and one by number with its options kept in order.
export function questionTemplateCsv() {
  return toCsv(questionColumns, [
    {
      body: 'Which vitamin does the skin make in sunlight?',
      options: ['Vitamin A', 'Vitamin B12', 'Vitamin C', 'Vitamin D'],
      correct: 3,
      keep_option_order: false,
    },
    {
      body: 'Which of these are parts of the small intestine?',
      options: ['The duodenum', 'The jejunum', 'The ileum', 'All of the above'],
      correct: 3,
      keep_option_order: true,
    },
  ])
}

// ---- the registered students' IDs --------------------------------------------

// The characters below are named by their code points, never written as
// themselves: several cannot be seen, and an editor that tidied them away
// would change what these expressions match without a line of the file
// looking different.
const chr = (code) => String.fromCharCode(code)
// For a character class: every character from one code point to another.
const span = (from, to) => `${chr(from)}-${chr(to)}`

// Western, Arabic-Indic (U+0660 to U+0669), Persian (U+06F0 to U+06F9) or
// full-width (U+FF10 to U+FF19): an ID typed with any of them is an ID.
// ZEROS holds where each of the three other sets begins.
const ZEROS = [0x0660, 0x06f0, 0xff10]
const OTHER_DIGITS = ZEROS.map((zero) => span(zero, zero + 9)).join('')
const DIGIT = new RegExp(`[0-9${OTHER_DIGITS}]`)
const OTHER_DIGIT = new RegExp(`[${OTHER_DIGITS}]`, 'g')

// What app.tidy_student_id drops from an ID, in its own order: every kind of
// space (\s, then the ones it names: no-break, the typographic ones, the line
// and paragraph separators, narrow no-break, ideographic); what cannot be seen
// (soft hyphen, the zero-width characters, the direction marks with their
// embeddings and isolates, word joiner, byte order mark); and the separators
// - . _ / \ with the dashes U+2010 to U+2015 and the minus sign.
const SPACES = [0x00a0, 0x1680, [0x2000, 0x200a], 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]
const UNSEEN = [0x00ad, 0x061c, [0x200b, 0x200f], [0x202a, 0x202e], 0x2060, [0x2066, 0x2069], 0xfeff]
const DASHES = [[0x2010, 0x2015], 0x2212]
const DROPPED = new RegExp(
  `[\\s${[...SPACES, ...UNSEEN, ...DASHES].map((c) => (Array.isArray(c) ? span(c[0], c[1]) : chr(c))).join('')}\\-._/\\\\]`,
  'g',
)

// A student ID as the database compares them (app.tidy_student_id): Arabic-Indic,
// Persian and full-width digits read as Western ones; spaces, characters that
// cannot be seen, the separators - . _ / \ and every kind of dash dropped;
// upper case. So an ID pasted from a document, where a hyphen has become a
// dash or the number sits inside direction marks, is still that ID. The
// database does the comparing. Here it finds a row on the screen (the
// Registered list's search and the Results' search) and looks a list over
// before it is sent.
export function tidyId(v) {
  return String(v ?? '')
    .replace(OTHER_DIGIT, (d) => {
      const code = d.charCodeAt(0)
      return String(code - ZEROS.find((zero) => code >= zero && code <= zero + 9))
    })
    .replace(DROPPED, '')
    .toUpperCase()
}

// A pasted list: one ID a line; commas, semicolons and tabs also separate.
// Spaces do not (the database reads "2023 1234" as 20231234). The IDs are left
// as typed: the database tidies them, and counts the ones that are repeated or
// are no ID at all.
export function idsFromText(text) {
  return String(text ?? '')
    .split(/[\n\r,;\t]+/)
    .map(cell)
    .filter(Boolean)
}

// A file's list: its first column; a first cell with no digit is a header. A
// cell that still holds a semicolon or a tab (a .csv saved with one of them
// between its cells) gives its first part.
export function idsFromGrid(grid) {
  const ids = (grid || []).map((r) => cell(cell(Array.isArray(r) ? r[0] : '').split(/[;\t]/)[0])).filter(Boolean)
  if (ids.length > 0 && !DIGIT.test(ids[0])) ids.shift()
  return ids
}

// How long one ID can be, tidied, before it looks like several run together
// (the database itself takes up to 40 characters as typed).
const ONE_ID_AT_MOST = 20
// How much of a doubtful item is quoted back.
const QUOTED_AT_MOST = 24

// The items of a list that do not look like one student ID, each once and as
// typed: no digit in it (a heading, or a name from the next column of a pasted
// spreadsheet), more than 20 characters once tidied (several IDs on one line
// with spaces between them), or a character that could not be read. The
// database would add every one of them to the list as an ID, so the page asks
// before sending them.
export function doubtfulIds(ids) {
  const odd = (ids || []).filter(
    (id) => !DIGIT.test(id) || chars(tidyId(id)) > ONE_ID_AT_MOST || String(id).includes(UNREADABLE),
  )
  return [...new Set(odd)]
}

// Those items in words: '“Student ID”, “Name” and 3 others do not look like
// student IDs.' '' for none.
export function doubtSentence(odd) {
  const items = odd || []
  if (items.length === 0) return ''
  const quote = (id) => {
    const text = [...String(id)]
    return `“${text.length > QUOTED_AT_MOST ? `${text.slice(0, QUOTED_AT_MOST).join('')}…` : text.join('')}”`
  }
  if (items.length === 1) return `${quote(items[0])} does not look like a student ID.`
  if (items.length === 2) return `${quote(items[0])} and ${quote(items[1])} do not look like student IDs.`
  const rest = items.length - 2
  return `${quote(items[0])}, ${quote(items[1])} and ${rest} ${rest === 1 ? 'other' : 'others'} do not look like student IDs.`
}

// What rpc/exam_add_registrations answered, in words:
// "Added 396. 3 were already on the list. 1 was not an ID."
export function addedSentence({ added = 0, already = 0, invalid = 0 } = {}) {
  const parts = [`Added ${added}.`]
  if (already > 0) parts.push(already === 1 ? '1 was already on the list.' : `${already} were already on the list.`)
  if (invalid > 0) parts.push(invalid === 1 ? '1 was not an ID.' : `${invalid} were not IDs.`)
  return parts.join(' ')
}

// ---- reading a file ----------------------------------------------------------

// A spreadsheet shows a long whole number (a 14-digit ID typed into a plain
// cell) as 2.02312E+13. What was typed is the number itself, so that is what
// is read; every other cell is read as it is shown, which keeps leading zeros.
export function cellText(shown, stored) {
  const text = String(shown ?? '')
  if (typeof stored === 'number' && Number.isSafeInteger(stored) && /^-?\d(\.\d+)?e\+?\d+$/i.test(text.trim())) {
    return String(stored)
  }
  return text
}

// The first sheet of a workbook, or a .csv, as rows of cell text. Row i of the
// answer is row i + 1 of the sheet, and its first cell is column A, whatever
// the sheet leaves empty at its top or left.
export async function fileGrid(file) {
  const name = String(file?.name || '').toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(await file.text())
  if (name.endsWith('.xlsx')) {
    // Loaded on demand, as the roster's import does: the spreadsheet reader is
    // large and only these buttons need it. When it cannot be fetched, the
    // trouble is the connection, whatever the browser calls it.
    const XLSX = await import('xlsx').catch(() => {
      throw refusal(UNREACHED)
    })
    let wb
    try {
      wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    } catch {
      // The reader's own words (a damaged file, one locked with a password)
      // are not written for an officer.
      throw refusal('That workbook could not be read. Save it again as an Excel workbook (.xlsx) and choose that.')
    }
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) throw refusal('That workbook has no sheets.')
    if (!sheet['!ref']) return []
    const range = { s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(sheet['!ref']).e }
    const read = (raw) => XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, range, raw })
    const stored = read(true)
    return read(false).map((row, i) => row.map((shown, j) => cellText(shown, stored[i]?.[j])))
  }
  throw refusal('Choose an .xlsx or a .csv file.')
}

// The questions in a file: { rows, problems }, as questionsFromGrid gives them.
export async function parseQuestionFile(file) {
  return questionsFromGrid(await fileGrid(file))
}

// The IDs in a file's first column. Throws when there are none.
export async function parseIdFile(file) {
  const ids = idsFromGrid(await fileGrid(file))
  if (ids.length === 0) throw refusal('No IDs found in the first column of that file.')
  return ids
}
