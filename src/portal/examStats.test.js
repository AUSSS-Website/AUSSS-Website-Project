import { describe, expect, it } from 'vitest'
import {
  anySitting,
  averages,
  cairoStamp,
  durationWords,
  examPhase,
  exportName,
  gradeBands,
  gradeSpread,
  hardestFirst,
  isFinished,
  oneDecimal,
  optionShares,
  optionText,
  percent,
  questionColumns,
  readProblem,
  refreshIn,
  resultColumns,
  resultSummary,
  rowOutcome,
  searchResults,
  shareRight,
  sharedRanks,
  sheetColumns,
  sheetCounts,
  sheetSummary,
  stateLabel,
  tally,
  typedCell,
} from './examStats.js'

// A row of rpc/exam_results.
const paper = (over = {}) => ({
  attempt_id: 'a1',
  profile_id: 'p1',
  full_name: 'Sara Adel Mansour',
  email: 'sara.adel@gmail.com',
  phone: '+20 100 123 4567',
  faculty_year: 'Year 3',
  student_id: '2023-1234',
  started_at: '2026-11-14T16:05:00Z',
  submitted_at: '2026-11-14T17:17:00Z',
  finished_at: '2026-11-14T17:17:00Z',
  state: 'handed_in',
  answered: 100,
  score: 80,
  seconds: 4320,
  rank: 1,
  ...over,
})
const sitting = (over = {}) =>
  paper({ state: 'sitting', submitted_at: null, finished_at: null, seconds: null, ...over })

describe('states', () => {
  it('says each state in words, and shows one it does not know as it came', () => {
    expect(['handed_in', 'timed_out', 'sitting'].map(stateLabel)).toEqual(['Handed in', 'Time ran out', 'Still sitting'])
    expect(stateLabel('paused')).toBe('paused')
    expect(stateLabel(null)).toBe('')
  })

  it('counts a paper as finished once it is handed in or out of time', () => {
    expect(isFinished(paper())).toBe(true)
    expect(isFinished(paper({ state: 'timed_out' }))).toBe(true)
    expect(isFinished(sitting())).toBe(false)
    expect(isFinished(undefined)).toBe(false)
  })

  it('counts who started and where each paper is', () => {
    const rows = [paper(), paper(), paper({ state: 'timed_out' }), sitting()]
    expect(tally(rows)).toEqual({ started: 4, handedIn: 2, timedOut: 1, sitting: 1, finished: 3 })
    expect(anySitting(rows)).toBe(true)
    expect(anySitting(rows.slice(0, 3))).toBe(false)
  })

  it('answers with zeros when nobody has started', () => {
    const none = { started: 0, handedIn: 0, timedOut: 0, sitting: 0, finished: 0 }
    expect(tally([])).toEqual(none)
    expect(tally(undefined)).toEqual(none)
    expect(anySitting(undefined)).toBe(false)
  })
})

describe('shared ranks', () => {
  it('are the ranks more than one paper holds', () => {
    const rows = [11, 11, 9, 9, 9, 4].map((score, i) => paper({ attempt_id: `a${i}`, score, rank: [1, 1, 3, 3, 3, 6][i] }))
    expect([...sharedRanks(rows)]).toEqual([1, 3])
    expect(sharedRanks(rows).has(6)).toBe(false)
  })

  it('are none when every grade differs, and none with no paper', () => {
    expect(sharedRanks([paper({ rank: 1 }), paper({ rank: 2 })]).size).toBe(0)
    expect(sharedRanks([]).size).toBe(0)
    expect(sharedRanks(undefined).size).toBe(0)
    expect(sharedRanks([paper({ rank: null }), paper({ rank: undefined })]).size).toBe(0)
  })
})

// An exam that opens at 18:00 and closes at 18:15 Cairo time, two hours long:
// the last paper that can be started runs until 20:15.
const at = (clock) => Date.parse(`2026-11-14T${clock}:00+02:00`)
const exam = (over = {}) => ({
  status: 'ready',
  opens_at: '2026-11-14T16:00:00Z',
  closes_at: '2026-11-14T16:15:00Z',
  minutes: 120,
  ...over,
})

describe('the exam on the clock', () => {
  it('is a draft until it is open to students, whatever the time', () => {
    expect(examPhase(exam({ status: 'draft' }), at('18:05'))).toBe('draft')
    expect(examPhase(null, at('18:05'))).toBe('draft')
    expect(examPhase(undefined, at('18:05'))).toBe('draft')
  })

  it('opens at its opening time and stops taking new starts at its closing time', () => {
    expect(examPhase(exam(), at('17:59'))).toBe('before')
    expect(examPhase(exam(), at('18:00'))).toBe('open')
    expect(examPhase(exam(), at('18:14'))).toBe('open')
    expect(examPhase(exam(), at('18:15'))).toBe('finishing')
  })

  it('is not over at its closing time: the last paper runs its full length', () => {
    expect(examPhase(exam(), at('19:00'))).toBe('finishing')
    expect(examPhase(exam(), at('20:14'))).toBe('finishing')
    expect(examPhase(exam(), at('20:15'))).toBe('over')
    // made longer after the start: the last paper runs longer too
    expect(examPhase(exam({ minutes: 150 }), at('20:15'))).toBe('finishing')
  })

  it('waits for a time that is not set', () => {
    expect(examPhase(exam({ opens_at: null, closes_at: null }), at('18:05'))).toBe('before')
  })
})

describe('when a page asks again by itself', () => {
  const EVERY = 30_000

  it('never does for a draft, or once nobody else can start', () => {
    expect(refreshIn(exam({ status: 'draft' }), at('18:05'), EVERY)).toBe(false)
    expect(refreshIn(exam(), at('18:17'), EVERY)).toBe(false)
    expect(refreshIn(exam(), at('21:00'), EVERY)).toBe(false)
    expect(refreshIn(null, at('18:05'), EVERY)).toBe(false)
  })

  it('does every half minute while a student can start', () => {
    expect(refreshIn(exam(), at('18:00'), EVERY)).toBe(EVERY)
    expect(refreshIn(exam(), at('18:14'), EVERY)).toBe(EVERY)
  })

  it('does twice more after the closing time, for a start in its last seconds', () => {
    expect(refreshIn(exam(), at('18:15'), EVERY)).toBe(EVERY)
    expect(refreshIn(exam(), at('18:15') + 59_000, EVERY)).toBe(EVERY)
    expect(refreshIn(exam(), at('18:16'), EVERY)).toBe(false)
  })

  it('wakes just after the opening time, and within the hour when that is far off', () => {
    expect(refreshIn(exam(), at('17:50'), EVERY)).toBe(10 * 60_000 + 1000)
    expect(refreshIn(exam(), at('18:00') - 1, EVERY)).toBe(1001)
    expect(refreshIn(exam(), at('09:00'), EVERY)).toBe(60 * 60_000)
    // never a wait of nothing, which would stop the asking altogether
    expect(refreshIn(exam(), at('18:00') - 1, EVERY)).toBeGreaterThan(0)
    expect(refreshIn(exam({ opens_at: null, closes_at: null }), at('18:05'), EVERY)).toBe(false)
  })
})

describe('a read that failed', () => {
  // An error as supabase-js hands it back from the database.
  const db = (message, code) => ({ name: 'PostgrestError', message, details: null, hint: null, code })

  it('says what could not be read, then why when the reason is one to act on', () => {
    expect(readProblem('refresh the list', new TypeError('Failed to fetch'))).toBe(
      'Couldn’t refresh the list. We couldn’t reach the server. Check your connection and try again.',
    )
    expect(readProblem('load the results', db('Only the exchange officers and the Executive Board can do this.', '42501'))).toBe(
      'Couldn’t load the results. Only the exchange officers and the Executive Board can do this.',
    )
    expect(readProblem('load this paper', db('That paper is not there any more.', '22023'))).toBe(
      'Couldn’t load this paper. That paper is not there any more.',
    )
  })

  it('leaves out words that were not written for people', () => {
    expect(readProblem('load the exam', db('JSON object requested, multiple (or no) rows returned', 'PGRST116'))).toBe(
      'Couldn’t load the exam.',
    )
    expect(readProblem('load the exams', new Error('boom'))).toBe('Couldn’t load the exams.')
  })

  it('says the read came back empty when there was no error', () => {
    expect(readProblem('load the results', null)).toBe('Couldn’t load the results: the database sent nothing back.')
    expect(readProblem('load the results', undefined)).toBe('Couldn’t load the results: the database sent nothing back.')
  })
})

describe('averages', () => {
  it('are over the finished papers only', () => {
    const rows = [
      paper({ score: 80, seconds: 4000 }),
      paper({ state: 'timed_out', score: 61, seconds: 7200 }),
      sitting({ score: 3 }),
    ]
    expect(averages(rows)).toEqual({ papers: 2, grade: 70.5, seconds: 5600 })
  })

  it('are null, never NaN, until a paper has finished', () => {
    expect(averages([])).toEqual({ papers: 0, grade: null, seconds: null })
    expect(averages(undefined)).toEqual({ papers: 0, grade: null, seconds: null })
    expect(averages([sitting(), sitting()])).toEqual({ papers: 0, grade: null, seconds: null })
  })

  it('of one paper are that paper', () => {
    expect(averages([paper({ score: 0, seconds: 30 })])).toEqual({ papers: 1, grade: 0, seconds: 30 })
  })

  it('leave out a time that is missing', () => {
    expect(averages([paper({ seconds: 600 }), paper({ seconds: null })]).seconds).toBe(600)
  })
})

describe('words', () => {
  it('writes a length of time', () => {
    expect(durationWords(4320)).toBe('1 h 12 min')
    expect(durationWords(2880)).toBe('48 min')
    expect(durationWords(7200)).toBe('2 h')
    expect(durationWords(45)).toBe('45 s')
    expect(durationWords(0)).toBe('0 s')
  })

  it('rounds to the nearest minute and carries into the hour', () => {
    expect(durationWords(59.6)).toBe('1 min')
    expect(durationWords(89)).toBe('1 min')
    expect(durationWords(90)).toBe('2 min')
    expect(durationWords(3599)).toBe('1 h')
    expect(durationWords(4319.4)).toBe('1 h 12 min')
  })

  it('writes nothing for a paper with no time yet', () => {
    expect(durationWords(null)).toBe('')
    expect(durationWords(undefined)).toBe('')
    expect(durationWords(NaN)).toBe('')
    expect(durationWords(-5)).toBe('')
  })

  it('writes an average and a share', () => {
    expect(oneDecimal(61.44)).toBe('61.4')
    expect(oneDecimal(62)).toBe('62')
    expect(oneDecimal(61.96)).toBe('62')
    expect(oneDecimal(null)).toBe('')
    expect(percent(0.234)).toBe('23%')
    expect(percent(0)).toBe('0%')
    expect(percent(1)).toBe('100%')
    expect(percent(null)).toBe('')
  })

  it('writes an instant on the Cairo clock', () => {
    expect(cairoStamp('2026-11-14T16:05:00Z')).toBe('2026-11-14 18:05')
    expect(cairoStamp(null)).toBe('')
    expect(cairoStamp('not a time')).toBe('')
  })
})

describe('the bands of the spread', () => {
  it('are ten for a hundred questions, the top one closed at full marks', () => {
    expect(gradeBands(100).map((b) => b.label)).toEqual([
      '0–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–100',
    ])
  })

  it('split a number of questions that ten does not divide', () => {
    expect(gradeBands(25).map((b) => b.label)).toEqual([
      '0–2', '3–4', '5–7', '8–9', '10–12', '13–14', '15–17', '18–19', '20–22', '23–25',
    ])
    expect(gradeBands(10).map((b) => b.label)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9–10'])
  })

  it('are one for each grade of a short exam', () => {
    expect(gradeBands(5).map((b) => b.label)).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(gradeBands(0).map((b) => b.label)).toEqual(['0'])
    expect(gradeBands(undefined).map((b) => b.label)).toEqual(['0'])
  })

  it('hold every grade of any exam exactly once', () => {
    for (let n = 0; n <= 130; n++) {
      const bands = gradeBands(n)
      expect(bands[0].from).toBe(0)
      expect(bands[bands.length - 1].to).toBe(n)
      bands.forEach((b, i) => {
        expect(b.from).toBeLessThanOrEqual(b.to)
        if (i > 0) expect(b.from).toBe(bands[i - 1].to + 1)
      })
    }
  })
})

describe('the spread of grades', () => {
  it('counts the finished papers in their bands', () => {
    const rows = [
      paper({ score: 0 }),
      paper({ score: 9 }),
      paper({ score: 10 }),
      paper({ score: 89, state: 'timed_out' }),
      paper({ score: 90 }),
      paper({ score: 100 }),
      sitting({ score: 55 }),
    ]
    expect(gradeSpread(rows, 100).map((b) => b.count)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 1, 2])
  })

  it('is all zeros with no paper, and has one paper in one band', () => {
    expect(gradeSpread([], 100).map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(gradeSpread(undefined, 0)).toEqual([{ from: 0, to: 0, label: '0', count: 0 }])
    expect(gradeSpread([paper({ score: 3 })], 5).map((b) => b.count)).toEqual([0, 0, 0, 1, 0, 0])
  })

  it('keeps a grade beyond the exam in the top band', () => {
    expect(gradeSpread([paper({ score: 12 })], 10).map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
  })
})

// Rows of rpc/exam_question_stats, out of four papers.
const question = (over = {}) => ({
  question_id: 'q1',
  n: 1,
  body: 'Which of these is a loop diuretic?',
  options: ['Furosemide', 'Spironolactone', 'Amiloride', 'Mannitol'],
  correct: 0,
  answered: 4,
  right: 3,
  counts: [3, 1, 0, 0],
  ...over,
})

describe('the questions', () => {
  it('gives the share that got one right, and null with no paper', () => {
    expect(shareRight(question(), 4)).toBe(0.75)
    expect(shareRight(question({ right: 0 }), 4)).toBe(0)
    expect(shareRight(question(), 0)).toBeNull()
    expect(shareRight(undefined, 4)).toBe(0)
  })

  it('puts the hardest first, and equal ones in question order', () => {
    const rows = [
      question({ n: 1, right: 3 }),
      question({ n: 2, right: 1 }),
      question({ n: 3, right: 4 }),
      question({ n: 4, right: 1 }),
      question({ n: 5, right: 0 }),
    ]
    expect(hardestFirst(rows).map((q) => q.n)).toEqual([5, 2, 4, 1, 3])
    expect(rows.map((q) => q.n)).toEqual([1, 2, 3, 4, 5])
    expect(hardestFirst(undefined)).toEqual([])
  })

  it('says how often each option was chosen and how many left it unanswered', () => {
    const { options, blank } = optionShares(question({ answered: 3, right: 2, counts: [2, 1, 0, 0] }), 4)
    expect(options.map((o) => [o.letter, o.count, o.share, o.correct])).toEqual([
      ['A', 2, 0.5, true],
      ['B', 1, 0.25, false],
      ['C', 0, 0, false],
      ['D', 0, 0, false],
    ])
    expect(blank).toEqual({ count: 1, share: 0.25 })
  })

  it('reads a missing count as nobody, and divides by nothing for nobody', () => {
    const short = optionShares(question({ counts: [3], answered: 3 }), 4)
    expect(short.options.map((o) => o.count)).toEqual([3, 0, 0, 0])
    const empty = optionShares(question({ answered: 0, right: 0, counts: [0, 0, 0, 0] }), 0)
    expect(empty.options.map((o) => o.share)).toEqual([null, null, null, null])
    expect(empty.blank).toEqual({ count: 0, share: null })
    expect(optionShares(undefined, 0)).toEqual({ options: [], blank: { count: 0, share: null } })
  })

  it('names an option by its letter', () => {
    expect(optionText(question(), 1)).toBe('B. Spironolactone')
    expect(optionText(question(), null)).toBe('')
    expect(optionText(question(), 9)).toBe('')
  })
})

// Rows of rpc/exam_sheet.
const line = (over = {}) => ({
  n: 1,
  question_id: 'q1',
  body: 'Which of these is a loop diuretic?',
  options: ['Furosemide', 'Spironolactone', 'Amiloride', 'Mannitol'],
  correct: 0,
  chosen: 0,
  flagged: false,
  answered_at: '2026-11-14T16:10:00Z',
  ...over,
})

describe('one paper', () => {
  it('marks a line right, wrong or not answered', () => {
    expect(rowOutcome(line())).toBe('right')
    expect(rowOutcome(line({ chosen: 2 }))).toBe('wrong')
    expect(rowOutcome(line({ chosen: null }))).toBe('blank')
  })

  it('takes the first option as an answer, not as no answer', () => {
    expect(rowOutcome(line({ correct: 2, chosen: 0 }))).toBe('wrong')
  })

  it('counts its lines', () => {
    const rows = [line(), line({ chosen: 1, flagged: true }), line({ chosen: null, flagged: true }), line({ chosen: null })]
    expect(sheetCounts(rows)).toEqual({ all: 4, right: 1, wrong: 1, blank: 2, flagged: 2 })
    expect(sheetCounts(undefined)).toEqual({ all: 0, right: 0, wrong: 0, blank: 0, flagged: 0 })
  })
})

describe('the search box', () => {
  // In the order and with the ranks the database gave.
  const ranking = [
    paper({ attempt_id: 'a1', rank: 1, full_name: 'Sara Adel Mansour', email: 'sara.adel@gmail.com', student_id: '2023-1234', phone: '+20 100 123 4567' }),
    paper({ attempt_id: 'a2', rank: 1, full_name: 'Youssef Ibrahim', email: 'y.ibrahim@gmail.com', student_id: '20230777', phone: '01155550000', faculty_year: 'Year 5' }),
    paper({ attempt_id: 'a3', rank: 3, full_name: 'Mohamed Ali Hassan', email: 'mo.hassan@gmail.com', student_id: '20219999', phone: '01200000000' }),
    paper({ attempt_id: 'a4', rank: 4, full_name: 'Adel Samir', email: 'adel.samir@gmail.com', student_id: 'AB 2020 15', phone: '' }),
  ]
  const found = (q) => searchResults(ranking, q).rows.map((r) => r.attempt_id)

  it('shows everyone when nothing is typed', () => {
    expect(searchResults(ranking, '')).toEqual({ rows: ranking, similar: false })
    expect(searchResults(ranking, '   ').rows).toBe(ranking)
  })

  it('finds a name by its words in any order, whatever their case', () => {
    expect(found('adel')).toEqual(['a1', 'a4'])
    expect(found('MANSOUR sara')).toEqual(['a1'])
    expect(found('adel samir')).toEqual(['a4'])
  })

  it('keeps the order of the ranking and every row its own rank', () => {
    const { rows } = searchResults(ranking, 'adel')
    expect(rows.map((r) => r.rank)).toEqual([1, 4])
    expect(rows[1]).toBe(ranking[3])
    expect(ranking.map((r) => r.rank)).toEqual([1, 1, 3, 4])
  })

  it('finds a student ID however it was typed', () => {
    expect(found('20231234')).toEqual(['a1'])
    expect(found('2023-1234')).toEqual(['a1'])
    expect(found('٢٠٢٣ ١٢٣٤')).toEqual(['a1'])
    expect(found('ab202015')).toEqual(['a4'])
    expect(found('2023')).toEqual(['a1', 'a2'])
  })

  it('finds an email and a phone', () => {
    expect(found('y.ibrahim')).toEqual(['a2'])
    expect(found('01001234567')).toEqual(['a1'])
    expect(found('0115 555')).toEqual(['a2'])
  })

  it('offers the names a spelling away when nobody matches as typed', () => {
    const { rows, similar } = searchResults(ranking, 'Muhammad')
    expect(similar).toBe(true)
    expect(rows.map((r) => [r.attempt_id, r.rank])).toEqual([['a3', 3]])
  })

  it('finds nobody without making anyone up', () => {
    expect(searchResults(ranking, 'zzzz')).toEqual({ rows: [], similar: false })
    expect(searchResults([], 'sara')).toEqual({ rows: [], similar: false })
    expect(searchResults(undefined, 'sara')).toEqual({ rows: [], similar: false })
  })

  it('reads a paper with no name', () => {
    expect(searchResults([paper({ full_name: null, email: null, phone: null })], 'someone')).toEqual({ rows: [], similar: false })
  })
})

describe('the exports', () => {
  const cells = (columns, row) => Object.fromEntries(columns.map((c) => [c.label, c.value(row)]))

  it('name a file after the exam and what is in it', () => {
    expect(exportName('Exchange exam 2026/27', 'results')).toBe('ausss-exam-exchange-exam-2026-27-results')
    expect(exportName('Exchange exam', 'paper', '2023-1234')).toBe('ausss-exam-exchange-exam-paper-2023-1234')
    expect(exportName('امتحان التبادل', 'results')).toBe('ausss-exam-results')
    expect(exportName(null, 'questions')).toBe('ausss-exam-questions')
  })

  it('give the ranking with the email, the phone and Cairo times', () => {
    expect(cells(resultColumns(100), paper())).toEqual({
      Rank: 1,
      Name: 'Sara Adel Mansour',
      'Student ID': '2023-1234',
      Year: 'Year 3',
      'Grade (of 100)': 80,
      Answered: 100,
      'Time taken': '1 h 12 min',
      State: 'Handed in',
      Email: 'sara.adel@gmail.com',
      Phone: '+20 100 123 4567',
      'Started (Cairo time)': '2026-11-14 18:05',
      'Finished (Cairo time)': '2026-11-14 19:17',
    })
  })

  it('keep what a student typed from being read as a formula by a spreadsheet', () => {
    // a name, a year, an address or a phone that starts as a formula does gets a quote in front
    expect(typedCell('=HYPERLINK("http://example.com","Sara")')).toBe('\'=HYPERLINK("http://example.com","Sara")')
    expect(typedCell('@SUM(1+1)')).toBe("'@SUM(1+1)")
    expect(typedCell('+1+cmd|x!A0')).toBe("'+1+cmd|x!A0")
    expect(typedCell('-2+3+cmd')).toBe("'-2+3+cmd")
    expect(typedCell('\t=1+1')).toBe("'\t=1+1")
    expect(typedCell('\r=1+1')).toBe("'\r=1+1")
    // a phone number in the international form is a number at worst, and stays as typed
    expect(typedCell('+20 100 123 4567')).toBe('+20 100 123 4567')
    expect(typedCell('+20 (100) 123-4567')).toBe('+20 (100) 123-4567')
    expect(typedCell('-')).toBe('-')
    // everything else is left alone
    expect(typedCell('Sara Adel')).toBe('Sara Adel')
    expect(typedCell('a=b')).toBe('a=b')
    expect(typedCell('01001234567')).toBe('01001234567')
    expect(typedCell(null)).toBe('')
    expect(typedCell(undefined)).toBe('')

    const row = cells(
      resultColumns(100),
      paper({ full_name: '=1+1', faculty_year: '@year', email: '=x@example.com', phone: '+1+cmd|x!A0', student_id: '-2023' }),
    )
    expect([row.Name, row.Year, row.Email, row.Phone]).toEqual(["'=1+1", "'@year", "'=x@example.com", "'+1+cmd|x!A0"])
    // the ID is the list's spelling, which the officers wrote: it stays
    expect(row['Student ID']).toBe('-2023')
  })

  it('leave the time and the end of a paper still being sat empty', () => {
    const row = cells(resultColumns(100), sitting({ score: 12, answered: 20 }))
    expect([row['Time taken'], row['Finished (Cairo time)'], row.State]).toEqual(['', '', 'Still sitting'])
  })

  it('head a list of papers with the counts and the averages', () => {
    expect(resultSummary([paper({ score: 80 }), paper({ score: 61, seconds: 3000 }), sitting()], 100)).toEqual([
      ['Papers', 3],
      ['Handed in', 2],
      ['Time ran out', 0],
      ['Still sitting', 1],
      ['Average grade', '70.5 of 100'],
      ['Average time', '1 h 1 min'],
    ])
    expect(resultSummary([], 100).slice(4)).toEqual([
      ['Average grade', 'No finished paper yet'],
      ['Average time', 'No finished paper yet'],
    ])
  })

  it('give one paper a line for each question', () => {
    const columns = sheetColumns()
    expect(cells(columns, line({ n: 7, chosen: 1, flagged: true }))).toEqual({
      'No.': 7,
      Question: 'Which of these is a loop diuretic?',
      'Right answer': 'A. Furosemide',
      'Chosen answer': 'B. Spironolactone',
      Result: 'Wrong',
      Flagged: 'Flagged',
    })
    const blank = cells(columns, line({ chosen: null }))
    expect([blank['Chosen answer'], blank.Result, blank.Flagged]).toEqual(['', 'Not answered', ''])
  })

  it('head one paper with whose it is, leaving out what is not known yet', () => {
    expect(sheetSummary(sitting({ score: 12, answered: 20, phone: '' }), 100)).toEqual([
      ['Student ID', '2023-1234'],
      ['Year', 'Year 3'],
      ['Email', 'sara.adel@gmail.com'],
      ['Grade', '12 of 100'],
      ['Answered', '20 of 100'],
      ['State', 'Still sitting'],
      ['Started (Cairo time)', '2026-11-14 18:05'],
    ])
    expect(sheetSummary(undefined, 0)).toEqual([
      ['Grade', '0 of 0'],
      ['Answered', '0 of 0'],
    ])
  })

  it('give the question figures a column for each option of the longest question', () => {
    const stats = {
      attempts: 4,
      questions: [
        question({ answered: 3, right: 2, counts: [2, 1, 0, 0] }),
        question({ n: 2, options: ['True', 'False'], correct: 1, answered: 4, right: 1, counts: [3, 1] }),
      ],
    }
    const columns = questionColumns(stats)
    expect(columns.map((c) => c.label)).toEqual([
      'No.', 'Question', 'Right answer', 'Papers', 'Answered', 'Right', 'Share right',
      'Chose A', 'Chose B', 'Chose C', 'Chose D', 'No answer',
    ])
    expect(cells(columns, stats.questions[0])).toMatchObject({
      'Right answer': 'A. Furosemide', Papers: 4, Answered: 3, Right: 2, 'Share right': '50%',
      'Chose A': 2, 'Chose B': 1, 'Chose C': 0, 'Chose D': 0, 'No answer': 1,
    })
    expect(cells(columns, stats.questions[1])).toMatchObject({
      'Right answer': 'B. False', 'Share right': '25%', 'Chose A': 3, 'Chose B': 1, 'Chose C': '', 'Chose D': '', 'No answer': 0,
    })
  })

  it('give the question figures of an exam nobody has sat without a share', () => {
    const stats = { attempts: 0, questions: [question({ answered: 0, right: 0, counts: [0, 0, 0, 0] })] }
    expect(cells(questionColumns(stats), stats.questions[0])).toMatchObject({ Papers: 0, 'Share right': '', 'No answer': 0 })
    expect(questionColumns(undefined).map((c) => c.label)).toEqual([
      'No.', 'Question', 'Right answer', 'Papers', 'Answered', 'Right', 'Share right', 'No answer',
    ])
  })
})
