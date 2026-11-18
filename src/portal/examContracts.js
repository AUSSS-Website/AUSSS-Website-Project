import { cairoStamp, sitsWords, stateLabel, typedCell } from './examStats.js'

// The exam's contracts on the portal's side, worked out without React or the
// network: reading a pasted list or a sheet, grouping the contracts for the
// page, counting how many students chose each, and the columns of the
// preferences' export. examContracts.test.js proves each line.
//
// A contract is { id, programme: 'scope' | 'score', class: 'A' | 'B' | 'C',
// country, places, note }; `places` is how many contracts there are of it, 1
// unless the officers say more. The database holds the rules
// (supabase/migrations/20261118120001_exam_contracts.sql); what is repeated
// here is only what lets the page say which line of a pasted list is wrong
// before anything is sent.

export const CONTRACT_PROGRAMMES = [
  { id: 'scope', short: 'SCOPE', name: 'Professional exchange (SCOPE)' },
  { id: 'score', short: 'SCORE', name: 'Research exchange (SCORE)' },
]
export const CONTRACT_CLASSES = ['A', 'B', 'C']
export const MAX_CONTRACTS = 500
export const COUNTRY_MAX = 80
export const NOTE_MAX = 200
export const PLACES_MAX = 999

const list = (value) => (Array.isArray(value) ? value : [])
const tidy = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

// A sentence written for the officer: errorText (src/lib/errorText.js) shows
// it as it is.
const refusal = (message) => Object.assign(new Error(message), { rejected: true })

// ---- reading what an officer typed ---------------------------------------------

// 'scope' or 'score' from what was typed: the abbreviation in any case, or
// the programme's name ('Professional exchange', 'research'). '' for
// anything else.
export function programmeId(value) {
  const text = tidy(value).toLowerCase()
  if (text === 'scope' || /^(professional|clinical)\b/.test(text)) return 'scope'
  if (text === 'score' || /^research\b/.test(text)) return 'score'
  return ''
}

// 'A', 'B' or 'C' from what was typed: the letter in either case, with or
// without the word "class" before it. '' for anything else.
export function classId(value) {
  const found = /^(?:class\s*)?([abc])$/i.exec(tidy(value))
  return found ? found[1].toUpperCase() : ''
}

// How many contracts there are of one, from what was typed: a whole number
// from 1 to 999; nothing typed is 1; anything else is 0, which no contract has.
export function placesOf(value) {
  const text = tidy(value)
  if (!text) return 1
  return /^\d{1,3}$/.test(text) && Number(text) >= 1 ? Number(text) : 0
}

// What is wrong with a contract, in the database's sentences, or ''.
export function contractFault({ programme, class: cls, country, places, note } = {}) {
  if (!programmeId(programme)) return 'Choose the contract’s programme: SCOPE or SCORE.'
  if (!classId(cls)) return 'Choose the contract’s class: A, B or C.'
  const name = tidy(country)
  if (!name || name.length > COUNTRY_MAX) return `A contract needs its country, in at most ${COUNTRY_MAX} characters.`
  if (placesOf(places) === 0) return `A contract has between 1 and ${PLACES_MAX} places.`
  if (tidy(note).length > NOTE_MAX) return `A contract’s note can have at most ${NOTE_MAX} characters.`
  return ''
}

// A contract as the database takes it.
export function tidyContract({ programme, class: cls, country, places, note } = {}) {
  return { programme: programmeId(programme), class: classId(cls), country: tidy(country), places: placesOf(places), note: tidy(note) }
}

const HEADINGS = /^(programme|program|committee|class|country|contract|note|notes)$/i

// The contracts in rows of cells (a sheet, or a pasted list cut into cells):
// programme, class, country, then how many contracts there are of it and a
// note, either of which may be left out: a fourth cell that is a number is
// the number, and anything else there is the note. Empty rows are passed
// over, and so is a first row of headings. Answers { rows, problems }: `rows`
// are the contracts as the database takes them, and `problems` one sentence
// for each row that is not a contract, with its line as the officer counts
// them. Nothing should be sent while there is a problem. Lines that are the
// same contract are counted together (compactContracts), and `lines` is how
// many lines of contracts were read before that.
export function contractsFromGrid(grid) {
  const rows = []
  const problems = []
  let seen = false
  list(grid).forEach((cells, i) => {
    const [programme, cls, country, ...rest] = list(cells).map(tidy)
    if (!programme && !cls && !country && rest.every((c) => !c)) return
    const first = !seen
    seen = true
    // a row of headings: none of its first three cells is a value
    if (first && !programmeId(programme) && [programme, cls, country].filter(Boolean).every((c) => HEADINGS.test(c))) return
    const counted = /^\d+$/.test(rest[0] || '')
    const contract = { programme, class: cls, country, places: counted ? rest[0] : '', note: (counted ? rest.slice(1) : rest).filter(Boolean).join(', ') }
    const fault = contractFault(contract)
    if (fault) problems.push(`Line ${i + 1}: ${fault}`)
    else rows.push(tidyContract(contract))
  })
  return { rows: compactContracts(rows), problems, lines: rows.length }
}

// A list in which the same contract comes more than once, made into one
// contract for each: the officers' sheets often have a line for every single
// contract, so three lines of "SCOPE, A, Spain" are three contracts of that
// one, not three things to choose between. Two lines are the same contract
// when they have the same programme, class, country and note (both with none
// counts as the same), whatever the capitals. The contract keeps the place and
// the spelling of its first line, and its number is the sum of the lines'
// numbers. The list given is left as it was.
export function compactContracts(rows) {
  const byKey = new Map()
  for (const row of list(rows)) {
    const key = [row.programme, row.class, tidy(row.country).toLowerCase(), tidy(row.note).toLowerCase()].join('\n')
    const found = byKey.get(key)
    if (found) found.places += Number(row.places) || 1
    else byKey.set(key, { ...row, places: Number(row.places) || 1 })
  }
  return [...byKey.values()]
}

// A pasted list: one contract a line. Cells copied from a spreadsheet come
// apart at their tabs; a typed line at its commas or semicolons, and whatever
// follows the country is the note, commas and all.
export function contractsFromText(text) {
  const lines = String(text ?? '').split(/\r\n|\n|\r/)
  const tabbed = lines.some((line) => line.includes('\t'))
  return contractsFromGrid(lines.map((line) => line.split(tabbed ? '\t' : /[,;]/)))
}

// What to say for a list that cannot be added: its first problems, and how
// many more there are.
export function problemSentences(problems, show = 5) {
  const all = list(problems)
  const more = all.length - show
  return more > 0 ? [...all.slice(0, show), `And ${more} more ${more === 1 ? 'line' : 'lines'}.`] : all
}

// Refuses a list the database would refuse whole, in a sentence of its own.
export function checkContractList({ rows, problems }) {
  if (list(problems).length > 0) throw refusal(problemSentences(problems).join(' '))
  if (list(rows).length === 0) throw refusal('There are no contracts in that.')
  // lines counted together can come to more than one contract may have
  const over = rows.find((row) => row.places > PLACES_MAX)
  if (over) {
    const programme = CONTRACT_PROGRAMMES.find((p) => p.id === over.programme)?.short ?? ''
    throw refusal(
      `The lines for ${over.country} (${programme}, Class ${over.class}) come to ${over.places} contracts. A contract has between 1 and ${PLACES_MAX} places.`,
    )
  }
  if (rows.length > MAX_CONTRACTS) {
    throw refusal(`Add at most ${MAX_CONTRACTS} contracts at a time. This list has ${rows.length}: add it in parts.`)
  }
  return rows
}

// What a list did, in words. `made` is how many new contracts the database
// made of it (rpc/import_exam_contracts answers with that), `sent` how many
// contracts the list held, and `lines` how many lines it had before the lines
// that were the same contract were counted together. A contract of the list
// that the exam already had was added to, not made again.
//   'Added 12 contracts.'
//   'Added 3 contracts. Added to 2 contracts already in the list. Lines that
//    were the same contract were counted together.'
export function addedContracts(made, sent = made, lines = sent) {
  const count = (n) => `${n} ${n === 1 ? 'contract' : 'contracts'}`
  const topped = Math.max(0, sent - made)
  const parts = []
  if (made > 0 || topped === 0) parts.push(`Added ${count(made)}.`)
  if (topped > 0) parts.push(`Added to ${count(topped)} already in the list.`)
  if (lines > sent) parts.push('Lines that were the same contract were counted together.')
  return parts.join(' ')
}

// What removing every contract takes with it, said before the second click:
// `students` are the rows of the preferences' list.
export function removeAllWords(contracts, students) {
  const n = list(contracts).length
  const chose = list(students).filter((s) => list(s?.picks).length > 0).length
  const all = n === 1 ? 'the one contract' : `all ${n} contracts`
  if (chose === 0) return `This removes ${all} of this exam.`
  return `This removes ${all} of this exam, and with them the choices of the ${chose === 1 ? 'one student who has' : `${chose} students who have`} chosen among them.`
}

// ---- the list on the page --------------------------------------------------------

// The contracts by programme and class, in the officers' order; a programme
// or a class with none is left out: [{ programme, classes: [{ class, contracts }] }].
export function contractGroups(contracts) {
  return CONTRACT_PROGRAMMES.map((programme) => ({
    programme,
    classes: CONTRACT_CLASSES.map((cls) => ({
      class: cls,
      contracts: list(contracts).filter((c) => c.programme === programme.id && c.class === cls),
    })).filter((group) => group.contracts.length > 0),
  })).filter((group) => group.classes.length > 0)
}

// How many contracts a list holds in all: each one's number of places.
export function placesIn(contracts) {
  return list(contracts).reduce((n, c) => n + (Number(c?.places) || 1), 0)
}

// A contract in one line: 'Spain (Madrid, July)'.
export function contractLabel(contract) {
  if (!contract) return ''
  return contract.note ? `${contract.country} (${contract.note})` : contract.country
}

// One student's picks by programme and class, each in the student's order:
// { scope: { A: [contract, ...], B: [...], C: [...] }, score: { ... } }. A
// pick whose contract is not on the list is passed over.
export function picksByClass(contracts, picks) {
  const byId = new Map(list(contracts).map((c) => [c.id, c]))
  const out = Object.fromEntries(
    CONTRACT_PROGRAMMES.map((p) => [p.id, Object.fromEntries(CONTRACT_CLASSES.map((cls) => [cls, []]))]),
  )
  for (const id of list(picks)) {
    const contract = byId.get(id)
    if (contract && out[contract.programme]?.[contract.class]) out[contract.programme][contract.class].push(contract)
  }
  return out
}

// How many students chose each contract, and how many of them put it first in
// its class: a Map from a contract's id to { chosen, first }, holding only
// the contracts somebody chose. `students` are rpc/exam_preference_list's rows.
export function demandOf(contracts, students) {
  const demand = new Map()
  for (const student of list(students)) {
    const mine = picksByClass(contracts, student?.picks)
    for (const classes of Object.values(mine)) {
      for (const chosen of Object.values(classes)) {
        chosen.forEach((contract, i) => {
          const now = demand.get(contract.id) || { chosen: 0, first: 0 }
          demand.set(contract.id, { chosen: now.chosen + 1, first: now.first + (i === 0 ? 1 : 0) })
        })
      }
    }
  }
  return demand
}

// 'Chosen by 12 students, the first choice of 5', or '' for a contract nobody chose.
export function demandWords(entry) {
  const chosen = entry?.chosen || 0
  if (chosen === 0) return ''
  const first = entry.first || 0
  return `Chosen by ${chosen} ${chosen === 1 ? 'student' : 'students'}${first > 0 ? `, the first choice of ${first}` : ''}`
}

// How many students have saved preferences, and how many of those have
// started: { saved, started }.
export function preferenceTally(students) {
  const saved = list(students).filter((s) => s?.saved_at)
  return { saved: saved.length, started: saved.filter((s) => s.attempt_id).length }
}

// ---- the export -------------------------------------------------------------------

// The sections a student's preferences go with, in words: what their paper
// sits once they have one, what they ticked before that. '' in an exam with
// no choice.
export function studentSections(student) {
  if (student?.attempt_id) return sitsWords(student)
  return sitsWords({ sits_scope: student?.chose_scope === true, sits_score: student?.chose_score === true })
}

// The students' rows with each one's paper beside it: `result` is the row of
// rpc/exam_results that has the same paper, or null before they start.
export function preferenceRows(students, attempts) {
  const byPaper = new Map(list(attempts).map((a) => [a.attempt_id, a]))
  return list(students).map((s) => ({ ...s, result: (s.attempt_id && byPaper.get(s.attempt_id)) || null }))
}

const cells = (chosen) => chosen.map((c) => typedCell(contractLabel(c)))

// The columns of the preferences' export, for rows from preferenceRows: who
// the student is, their marks and ranks, then their choices. Class A and
// Class B have a column for the first choice and one for the second; Class C
// is one column, in the student's order.
//   contracts  the exam's contracts: a programme with none gets no columns
//   choice     the exam has two optional sections (a mark and a rank for each
//              programme, and which sections the student answers)
export function preferenceColumns(contracts, choice = false) {
  const marks = choice
    ? CONTRACT_PROGRAMMES.flatMap((p) => [
        { label: `${p.short} mark`, value: (r) => r.result?.[`total_${p.id}`] ?? '' },
        { label: `${p.short} rank`, value: (r) => r.result?.[`rank_${p.id}`] ?? '' },
      ])
    : [
        { label: 'Grade', value: (r) => r.result?.score ?? '' },
        { label: 'Rank', value: (r) => r.result?.rank ?? '' },
      ]
  const chosen = CONTRACT_PROGRAMMES.filter((p) => list(contracts).some((c) => c.programme === p.id)).flatMap((p) => {
    const mine = (r, cls) => cells(picksByClass(contracts, r.picks)[p.id][cls])
    return [
      { label: `${p.short} Class A, first choice`, value: (r) => mine(r, 'A')[0] ?? '' },
      { label: `${p.short} Class A, second choice`, value: (r) => mine(r, 'A')[1] ?? '' },
      { label: `${p.short} Class B, first choice`, value: (r) => mine(r, 'B')[0] ?? '' },
      { label: `${p.short} Class B, second choice`, value: (r) => mine(r, 'B')[1] ?? '' },
      { label: `${p.short} Class C, in order`, value: (r) => mine(r, 'C').join('; ') },
    ]
  })
  return [
    { label: 'Student ID', value: (r) => r.student_id },
    { label: 'Name', value: (r) => typedCell(r.full_name) },
    { label: 'Year', value: (r) => typedCell(r.faculty_year) },
    ...(choice ? [{ label: 'Sections', value: (r) => studentSections(r) }] : []),
    ...marks,
    ...chosen,
    { label: 'Paper', value: (r) => (r.result ? stateLabel(r.result.state) : r.attempt_id ? 'Started' : 'Not started') },
    { label: 'Email', value: (r) => typedCell(r.email) },
    { label: 'Phone', value: (r) => typedCell(r.phone) },
    { label: 'Preferences saved (Cairo time)', value: (r) => cairoStamp(r.saved_at) },
  ]
}
