import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { errorText } from '../lib/errorText.js'
import { parseCsv } from './rosterFile.js'
import { toCsv } from './exportFile.js'
import {
  MAX_IMPORT,
  addedSentence,
  answerCell,
  cellText,
  doubtSentence,
  doubtfulIds,
  dropOption,
  fileGrid,
  idsFromGrid,
  idsFromText,
  letterOf,
  parseIdFile,
  parseQuestionFile,
  questionColumns,
  questionFault,
  questionProblem,
  questionTemplateCsv,
  questionsFromGrid,
  sortChanges,
  tidyId,
} from './examFile.js'

const HEADER = ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F', 'Answer', 'Keep order']
// One row of the sheet: the question, its options, the answer, keep order.
const line = (body, options, answer, keep = '') => [body, ...options, ...Array(6 - options.length).fill(''), answer, keep]

// Characters by their code points: the ones nobody can see are never written
// into this file as themselves, where an editor could lose them.
const chr = (...codes) => String.fromCharCode(...codes)

// What the file inputs hand over, without a browser.
const csvFile = (name, text) => ({ name, text: async () => text })
const xlsxFile = (name, sheet) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1')
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return { name, arrayBuffer: async () => bytes }
}

describe('the questions spreadsheet', () => {
  it('reads a row into what the import takes', () => {
    const { rows, problems } = questionsFromGrid([HEADER, line(' What is 2 + 2? ', ['3', ' 4 ', '5'], 'B')])
    expect(problems).toEqual([])
    expect(rows).toEqual([{ body: 'What is 2 + 2?', options: ['3', '4', '5'], correct: 1, keep_order: false }])
  })

  it('takes a first row whose first cell is Question as a header, and works without one', () => {
    const row = line('Which is a bone?', ['Femur', 'Liver'], 'a')
    expect(questionsFromGrid([[' question ', 'anything'], row]).rows).toHaveLength(1)
    expect(questionsFromGrid([row]).rows).toHaveLength(1)
  })

  it('takes the answer as a letter, a number or the option’s exact text', () => {
    const options = ['Heart', 'Lung', 'Kidney', 'Spleen']
    const correct = (answer) => questionsFromGrid([line('Which?', options, answer)]).rows[0]?.correct
    expect(correct('c')).toBe(2)
    expect(correct('C')).toBe(2)
    expect(correct('4')).toBe(3)
    expect(correct('  lung ')).toBe(1)
  })

  it('reads the answer as the option’s text when its number is past the last option', () => {
    const { rows, problems } = questionsFromGrid([line('How many lobes?', ['3', '4', '5'], '5')])
    expect(problems).toEqual([])
    expect(rows[0].correct).toBe(2)
  })

  it('refuses an answer that can be read two ways', () => {
    // "3": the third option (4), or the option that reads 3?
    const { rows, problems } = questionsFromGrid([HEADER, line('How many?', ['2', '3', '4', '5'], '3')])
    expect(rows).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^Row 2: The answer “3” can be read two ways/)
  })

  it('takes a number that is also that option’s text', () => {
    expect(questionsFromGrid([line('How many?', ['1', '2', '3'], '2')]).rows[0].correct).toBe(1)
  })

  it('names each bad row by its number in the sheet, with the reason', () => {
    const { rows, problems } = questionsFromGrid([
      HEADER,
      line('Good one', ['Yes', 'No'], 'A'),
      [],
      line('', ['Yes', 'No'], 'A'),
      line('One option', ['Only'], 'A'),
      line('A gap', ['First', '', 'Third'], 'A'),
      line('No answer', ['Yes', 'No'], ''),
      line('Past the end', ['Yes', 'No'], 'D'),
      line('Not there', ['Yes', 'No'], 'Maybe'),
      line('Twice', ['Same', 'same', 'Other'], 'Same'),
      line('Keep?', ['Yes', 'No'], 'A', 'perhaps'),
      line('x'.repeat(2001), ['Yes', 'No'], 'A'),
      line('Long option', ['Yes', 'y'.repeat(501)], 'A'),
    ])
    expect(rows).toHaveLength(1)
    expect(problems).toEqual([
      'Row 4: A question needs its text.',
      'Row 5: A question needs between 2 and 6 options, none of them empty.',
      'Row 6: Option B is empty but a later option is not. Fill the options from A with no gap.',
      'Row 7: The Answer column is empty.',
      'Row 8: The answer “D” is past the last option: the question has 2.',
      'Row 9: The answer “Maybe” is not one of the options. Give a letter (A to B), a number (1 to 2) or the option’s exact text.',
      'Row 10: The answer “Same” matches more than one option. Give its letter instead.',
      'Row 11: Keep order is “yes” or left blank.',
      'Row 12: The question is longer than 2000 characters.',
      'Row 13: Option B is longer than 500 characters.',
    ])
  })

  it('keeps the options in order only where the sheet says yes', () => {
    const keep = (word) => questionsFromGrid([line('Which?', ['One', 'Two', 'All of the above'], 'C', word)]).rows[0].keep_order
    expect(keep('yes')).toBe(true)
    expect(keep(' YES ')).toBe(true)
    expect(keep('')).toBe(false)
    expect(keep('no')).toBe(false)
  })

  it('counts length in characters, as the database does', () => {
    // 2000 characters from beyond the basic plane are 4000 UTF-16 units.
    const wide = '\u{1D4B3}'
    expect(wide).toHaveLength(2)
    expect(questionsFromGrid([line(wide.repeat(2000), ['Yes', 'No'], 'A')]).problems).toEqual([])
    expect(questionsFromGrid([line(wide.repeat(2001), ['Yes', 'No'], 'A')]).problems).toEqual([
      'Row 1: The question is longer than 2000 characters.',
    ])
  })

  it('says what is wrong with a file that holds no questions', () => {
    expect(questionsFromGrid([]).problems).toEqual(['That file is empty.'])
    expect(questionsFromGrid([['', ''], []]).problems).toEqual(['That file is empty.'])
    expect(questionsFromGrid([HEADER]).problems).toEqual(['That file has a header but no questions under it.'])
  })

  it('says so when a .csv was saved with semicolons between its cells', () => {
    const { rows, problems } = questionsFromGrid(parseCsv('Question;Option A;Option B;Answer\r\nWhich?;Yes;No;A\r\n'))
    expect(rows).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/semicolons/)
  })

  it('takes no more than one import’s worth', () => {
    const many = Array.from({ length: MAX_IMPORT + 1 }, (_, i) => line(`Question ${i + 1}`, ['Yes', 'No'], 'A'))
    expect(questionsFromGrid(many.slice(0, MAX_IMPORT)).rows).toHaveLength(MAX_IMPORT)
    const over = questionsFromGrid(many)
    expect(over.rows).toEqual([])
    expect(over.problems).toEqual(['Import between 1 and 500 questions at a time. This file has 501: import it in 2 parts.'])
  })

  it('says how many parts a file far over the limit needs', () => {
    const many = Array.from({ length: 1201 }, (_, i) => line(`Question ${i + 1}`, ['Yes', 'No'], 'A'))
    expect(questionsFromGrid(many).problems).toEqual([
      'Import between 1 and 500 questions at a time. This file has 1201: import it in 3 parts.',
    ])
  })

  it('says which way out there is for an answer that can be read two ways', () => {
    const problem = (options, answer) => questionsFromGrid([line('Which?', options, answer)]).problems[0]
    // a letter that is also another option's text: its number is safe
    expect(problem(['K', 'E', 'D', 'C'], 'C')).toBe(
      'Row 1: The answer “C” can be read two ways: as option C, or as the option that reads “C”. Give the right option’s number (1 to 4) instead.',
    )
    // a number that is also another option's text: its letter is safe
    expect(problem(['2', '3', '4', '5'], '3')).toBe(
      'Row 1: The answer “3” can be read two ways: as option C, or as the option that reads “3”. Give the right option’s letter (A to D) instead.',
    )
    // letters and numbers both among the options: neither is safe
    expect(problem(['2', '1', 'B', 'A'], 'A')).toBe(
      'Row 1: The answer “A” can be read two ways: as option A, or as the option that reads “A”. Reword one of them.',
    )
  })

  it('names a header the import did not take as one', () => {
    const header = 'This looks like the header. The header is the sheet’s first row, and its first cell reads “Question”.'
    // its first cell reads something else
    const reworded = questionsFromGrid([['Questions', ...HEADER.slice(1)], line('Which?', ['Yes', 'No'], 'A')])
    expect(reworded.rows).toHaveLength(1)
    expect(reworded.problems).toEqual([`Row 1: ${header}`])
    // a title sits above it
    const titled = questionsFromGrid([['Exchange exam 2026'], HEADER, line('Which?', ['Yes', 'No'], 'A')])
    expect(titled.problems).toEqual([
      'Row 1: A question needs between 2 and 6 options, none of them empty.',
      `Row 2: ${header}`,
    ])
  })

  it('refuses a file whose characters could not be read', () => {
    const { rows, problems } = questionsFromGrid([
      HEADER,
      line('Which?', ['Yes', 'No'], 'A'),
      line('Crohn�s disease: fever of 38�C', ['Yes', 'No'], 'A'),
    ])
    expect(rows).toEqual([])
    expect(problems).toEqual([
      'Some characters in this file cannot be read, because it was not saved as UTF-8. Save it as “CSV UTF-8” or as an Excel workbook (.xlsx) and import that.',
    ])
    // a mark in a column the import never reads does not matter
    const beyond = [...line('Which?', ['Yes', 'No'], 'A'), 'a note�']
    expect(questionsFromGrid([beyond]).problems).toEqual([])
  })
})

describe('the template and the export', () => {
  it('the template is a header and two questions the import takes', () => {
    const grid = parseCsv(questionTemplateCsv())
    expect(grid[0]).toEqual(HEADER)
    const { rows, problems } = questionsFromGrid(grid)
    expect(problems).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ correct: 3, keep_order: false })
    expect(rows[1]).toMatchObject({ options: ['The duodenum', 'The jejunum', 'The ileum', 'All of the above'], correct: 3, keep_order: true })
  })

  it('an exported list comes back in as the same questions', () => {
    const questions = [
      { body: 'A question, with a comma and a "quote"', options: ['One', 'Two\nlines', 'Three'], correct: 1, keep_option_order: false },
      { body: 'سؤال بالعربية', options: ['نعم', 'لا'], correct: 0, keep_option_order: true },
      { body: 'Six of them', options: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'], correct: 5, keep_option_order: false },
    ]
    const { rows, problems } = questionsFromGrid(parseCsv(toCsv(questionColumns, questions)))
    expect(problems).toEqual([])
    expect(rows).toEqual(
      questions.map((q) => ({ body: q.body, options: q.options, correct: q.correct, keep_order: q.keep_option_order })),
    )
  })

  it('letters the options from A', () => {
    expect([0, 5, 6, null].map(letterOf)).toEqual(['A', 'F', '', ''])
  })

  it('writes the answer as its letter, and as its number where the letter would be read two ways', () => {
    expect(answerCell({ options: ['Heart', 'Lung', 'Kidney'], correct: 1 })).toBe('B')
    // the options are single letters themselves: "C" would be the third option or the one that reads C
    expect(answerCell({ options: ['K', 'E', 'D', 'C'], correct: 2 })).toBe('3')
    // the letter is the option's own text at its own place: nothing to mistake
    expect(answerCell({ options: ['A', 'B', 'AB', 'O'], correct: 1 })).toBe('B')
    // numbers elsewhere do not disturb a letter
    expect(answerCell({ options: ['2', '3', '4', '5'], correct: 1 })).toBe('B')
    // no right answer set, or one that is not an option
    expect(answerCell({ options: ['Yes', 'No'], correct: null })).toBe('')
    expect(answerCell({ options: ['Yes', 'No'], correct: 4 })).toBe('')
    expect(answerCell(undefined)).toBe('')
  })

  it('an exported list of single-letter options comes back in with the same right answers', () => {
    const questions = [
      { body: 'Which vitamin does the skin make in sunlight?', options: ['K', 'E', 'D', 'C'], correct: 2, keep_option_order: false },
      { body: 'Which hepatitis virus is a DNA virus?', options: ['B', 'C', 'A', 'E'], correct: 0, keep_option_order: false },
      { body: 'Which blood group has the A antigen only?', options: ['O', 'A', 'B', 'AB'], correct: 1, keep_option_order: true },
      { body: 'How many lobes has the right lung?', options: ['2', '1', '3', '4'], correct: 2, keep_option_order: false },
      { body: 'Which is first?', options: ['B', 'A'], correct: 0, keep_option_order: false },
    ]
    const { rows, problems } = questionsFromGrid(parseCsv(toCsv(questionColumns, questions)))
    expect(problems).toEqual([])
    expect(rows.map((r) => r.correct)).toEqual(questions.map((q) => q.correct))
    expect(rows.map((r) => r.options)).toEqual(questions.map((q) => q.options))
  })
})

describe('one question, before it is sent', () => {
  const good = { body: 'Which?', options: ['Yes', 'No'], correct: 0 }

  it('passes a whole question', () => {
    expect(questionProblem(good)).toBe('')
  })

  it('refuses, in the database’s words, what the database would refuse', () => {
    expect(questionProblem({ ...good, body: '   ' })).toBe('A question needs its text.')
    expect(questionProblem({ ...good, options: ['Yes'] })).toBe('A question needs between 2 and 6 options, none of them empty.')
    expect(questionProblem({ ...good, options: ['Yes', ' '] })).toBe('A question needs between 2 and 6 options, none of them empty.')
    expect(questionProblem({ ...good, options: ['1', '2', '3', '4', '5', '6', '7'] })).toBe(
      'A question needs between 2 and 6 options, none of them empty.',
    )
    expect(questionProblem({ ...good, correct: null })).toBe('Choose which option is right.')
    expect(questionProblem({ ...good, correct: 2 })).toBe('Choose which option is right.')
  })

  it('says where in the form the refusal is, so the form can take the officer there', () => {
    expect(questionFault(good)).toBeNull()
    expect(questionFault({ ...good, body: '   ' })).toEqual({ at: 'body', index: null, problem: 'A question needs its text.' })
    // the first option that is empty or too long
    expect(questionFault({ ...good, options: ['Yes', ' ', ''] })).toEqual({
      at: 'options',
      index: 1,
      problem: 'A question needs between 2 and 6 options, none of them empty.',
    })
    expect(questionFault({ ...good, options: ['y'.repeat(501), 'No'] })).toMatchObject({ at: 'options', index: 0 })
    // too few or too many, with no one option to point at
    expect(questionFault({ ...good, options: ['Yes'] })).toMatchObject({ at: 'options', index: null })
    expect(questionFault({ ...good, options: ['1', '2', '3', '4', '5', '6', '7'] })).toMatchObject({ at: 'options', index: null })
    expect(questionFault({ ...good, correct: null })).toEqual({ at: 'correct', index: null, problem: 'Choose which option is right.' })
    // the text is looked at first, then the options, then the right answer
    expect(questionFault({ body: '', options: [], correct: null })).toMatchObject({ at: 'body' })
    expect(questionFault({ body: 'Which?', options: [], correct: null })).toMatchObject({ at: 'options' })
  })

  it('removing an option moves the right answer with its option', () => {
    const options = ['a', 'b', 'c', 'd']
    expect(dropOption(options, 3, 1)).toEqual({ options: ['a', 'c', 'd'], correct: 2 })
    expect(dropOption(options, 0, 2)).toEqual({ options: ['a', 'b', 'd'], correct: 0 })
    // the right option itself was removed: nothing is chosen any more
    expect(dropOption(options, 2, 2)).toEqual({ options: ['a', 'b', 'd'], correct: null })
    expect(dropOption(options, null, 0)).toEqual({ options: ['b', 'c', 'd'], correct: null })
  })
})

describe('the questions’ order after a drag', () => {
  const questions = [
    { id: 'a', sort: 1 },
    { id: 'b', sort: 2 },
    { id: 'c', sort: 3 },
    { id: 'd', sort: 4 },
  ]

  it('writes only the rows between where the question left and where it landed', () => {
    expect(sortChanges(questions, ['a', 'c', 'b', 'd'])).toEqual([
      { id: 'c', sort: 2 },
      { id: 'b', sort: 3 },
    ])
    expect(sortChanges(questions, ['a', 'b', 'c', 'd'])).toEqual([])
  })

  it('keeps the numbers in use, gaps included', () => {
    const gapped = [
      { id: 'a', sort: 0 },
      { id: 'b', sort: 10 },
      { id: 'c', sort: 11 },
    ]
    expect(sortChanges(gapped, ['c', 'a', 'b'])).toEqual([
      { id: 'c', sort: 0 },
      { id: 'a', sort: 10 },
      { id: 'b', sort: 11 },
    ])
  })

  it('numbers every row afresh when two rows share a number', () => {
    const tied = [
      { id: 'a', sort: 0 },
      { id: 'b', sort: 0 },
      { id: 'c', sort: 0 },
    ]
    expect(sortChanges(tied, ['b', 'a', 'c'])).toEqual([
      { id: 'a', sort: 1 },
      { id: 'c', sort: 2 },
    ])
  })

  it('writes nothing for a list that is not these questions', () => {
    expect(sortChanges(questions, ['a', 'b', 'c'])).toEqual([])
    expect(sortChanges(questions, ['a', 'b', 'c', 'x'])).toEqual([])
  })
})

describe('the registered students’ IDs', () => {
  it('reads a pasted list: one a line, or apart by commas, semicolons and tabs', () => {
    expect(idsFromText('20231234\n2023-1235\r\n\r\n 20231236 ,20231237;20231238\t20231239\n')).toEqual([
      '20231234',
      '2023-1235',
      '20231236',
      '20231237',
      '20231238',
      '20231239',
    ])
  })

  it('leaves an ID as typed: a space inside it does not split it, and a repeat is the database’s to count', () => {
    expect(idsFromText('2023 1234\n٢٠٢٣١٢٣٥\n2023 1234')).toEqual(['2023 1234', '٢٠٢٣١٢٣٥', '2023 1234'])
    expect(idsFromText('')).toEqual([])
    expect(idsFromText(null)).toEqual([])
  })

  it('reads a file’s first column, and skips a first cell with no digit as a header', () => {
    expect(idsFromGrid([['Student ID', 'Name'], ['20231234', 'A'], ['', 'B'], [' 20231235 ', 'C']])).toEqual(['20231234', '20231235'])
    expect(idsFromGrid([['20231234'], ['20231235']])).toEqual(['20231234', '20231235'])
    // Arabic digits are digits: the first row is an ID, not a header
    expect(idsFromGrid([['٢٠٢٣١٢٣٤'], ['٢٠٢٣١٢٣٥']])).toEqual(['٢٠٢٣١٢٣٤', '٢٠٢٣١٢٣٥'])
    expect(idsFromGrid([])).toEqual([])
    expect(idsFromGrid([['Student ID']])).toEqual([])
  })

  it('reads the first column of a .csv saved with semicolons', () => {
    expect(idsFromGrid(parseCsv('ID;Name\r\n20231234;Sara\r\n20231235;Omar\r\n'))).toEqual(['20231234', '20231235'])
  })

  it('tidies an ID the way the database compares them', () => {
    expect(tidyId('2023-1234')).toBe('20231234')
    expect(tidyId(' 2023 1234 ')).toBe('20231234')
    expect(tidyId('٢٠٢٣١٢٣٤')).toBe('20231234') // Arabic-Indic digits
    expect(tidyId('۲۰۲۳ 1234')).toBe('20231234') // Persian digits
    expect(tidyId('ab.2020_15/7\\x')).toBe('AB2020157X')
    expect(tidyId(null)).toBe('')
    expect(tidyId('  -  ')).toBe('')
  })

  it('reads an ID pasted from a document or a chat as the database does', () => {
    // a byte-order mark, a no-break space, a zero-width space and a direction mark are dropped
    expect(tidyId(`${chr(0xfeff)}2023${chr(0x00a0)}12${chr(0x200b)}3${chr(0x200f)}4`)).toBe('20231234')
    // the hyphen became an en dash, an em dash, a minus sign or a non-breaking hyphen
    for (const dash of [0x2013, 0x2014, 0x2212, 0x2011]) expect(tidyId(`2023${chr(dash)}1234`)).toBe('20231234')
    // full-width digits
    expect(tidyId(`${chr(0xff12, 0xff10, 0xff12, 0xff13)}1234`)).toBe('20231234')
    // the number wrapped in an embedding, with a soft hyphen and a word joiner inside it
    expect(tidyId(`${chr(0x202a)}2023${chr(0x00ad)}12${chr(0x2060)}34${chr(0x202c)}`)).toBe('20231234')
    // a thin space, a narrow no-break space and an ideographic space
    expect(tidyId(`2023${chr(0x2009)}12${chr(0x202f)}34${chr(0x3000)}`)).toBe('20231234')
    // an isolate round the whole of it, and an Arabic letter mark
    expect(tidyId(`${chr(0x2066)}${chr(0x061c)}ab-2020${chr(0x2069)}`)).toBe('AB2020')
  })

  it('takes a first cell in full-width digits for an ID, not for a heading', () => {
    const first = `${chr(0xff12, 0xff10, 0xff12, 0xff13)}1234`
    expect(idsFromGrid([[first], ['20231235']])).toEqual([first, '20231235'])
    expect(doubtfulIds([first, `2023${chr(0x2013)}1234`])).toEqual([])
  })

  it('picks out what does not look like one student ID', () => {
    // a paste straight from a spreadsheet: a heading and a second column
    const pasted = idsFromText('Student ID\tName\n20231234\tSara Adel\n20231235\tOmar Said\n')
    expect(doubtfulIds(pasted)).toEqual(['Student ID', 'Name', 'Sara Adel', 'Omar Said'])
    // several IDs on one line with spaces between them
    expect(doubtfulIds(['20231234 20231235 20231236'])).toEqual(['20231234 20231235 20231236'])
    // a character that could not be read
    expect(doubtfulIds(['2023�1234'])).toEqual(['2023�1234'])
    // each once
    expect(doubtfulIds(['Name', '20231234', 'Name'])).toEqual(['Name'])
  })

  it('leaves real IDs alone, however they were typed', () => {
    expect(
      doubtfulIds(['20231234', '2023-1234', '2023 1234', 'AB 2020 15', '٢٠٢٣١٢٣٤', '30201011234567', '12345678901234567890']),
    ).toEqual([])
    expect(doubtfulIds([])).toEqual([])
    expect(doubtfulIds(undefined)).toEqual([])
  })

  it('says what looks wrong, in words', () => {
    expect(doubtSentence([])).toBe('')
    expect(doubtSentence(['Student ID'])).toBe('“Student ID” does not look like a student ID.')
    expect(doubtSentence(['Student ID', 'Name'])).toBe('“Student ID” and “Name” do not look like student IDs.')
    expect(doubtSentence(['Student ID', 'Name', 'Sara Adel'])).toBe('“Student ID”, “Name” and 1 other do not look like student IDs.')
    expect(doubtSentence(['Student ID', 'Name', 'Sara Adel', 'Omar Said'])).toBe(
      '“Student ID”, “Name” and 2 others do not look like student IDs.',
    )
    // a long one is cut short
    expect(doubtSentence(['20231234 20231235 20231236 20231237'])).toBe('“20231234 20231235 202312…” does not look like a student ID.')
  })

  it('says what the database did with a list, in words', () => {
    expect(addedSentence({ added: 396, already: 3, invalid: 1 })).toBe('Added 396. 3 were already on the list. 1 was not an ID.')
    expect(addedSentence({ added: 2, already: 1, invalid: 2 })).toBe('Added 2. 1 was already on the list. 2 were not IDs.')
    expect(addedSentence({ added: 5, already: 0, invalid: 0 })).toBe('Added 5.')
    expect(addedSentence({ added: 0, already: 4, invalid: 0 })).toBe('Added 0. 4 were already on the list.')
  })
})

describe('reading a file', () => {
  it('reads a long whole number as it was typed, not as the sheet shows it', () => {
    expect(cellText('2.02312E+13', 20231234567890)).toBe('20231234567890')
    // shown as typed: left alone, leading zeros and all
    expect(cellText('0001234', 1234)).toBe('0001234')
    expect(cellText('20231234', 20231234)).toBe('20231234')
    // text that only looks like such a number stays text
    expect(cellText('1E+5', '1E+5')).toBe('1E+5')
    expect(cellText('', '')).toBe('')
  })

  it('reads the questions out of a workbook, row for row', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([HEADER, line('Which?', ['Yes', 'No'], 'B'), [], line('How many?', [3, 4], 1, 'yes')])
    const { rows, problems } = await parseQuestionFile(xlsxFile('Questions.XLSX', sheet))
    expect(problems).toEqual([])
    expect(rows).toEqual([
      { body: 'Which?', options: ['Yes', 'No'], correct: 1, keep_order: false },
      { body: 'How many?', options: ['3', '4'], correct: 0, keep_order: true },
    ])
  })

  it('numbers a workbook’s rows as the sheet does, even when its top is empty', async () => {
    // the sheet's used range starts at B3
    const sheet = XLSX.utils.aoa_to_sheet([['stray'], ['Which?', 'Yes', 'No']], { origin: 'B3' })
    const grid = await fileGrid(xlsxFile('q.xlsx', sheet))
    expect(grid[2]).toEqual(['', 'stray', '', ''])
    expect(grid[3]).toEqual(['', 'Which?', 'Yes', 'No'])
    const { problems } = questionsFromGrid(grid)
    expect(problems.map((p) => p.slice(0, 6))).toEqual(['Row 3:', 'Row 4:'])
  })

  it('reads IDs out of a workbook: long numbers whole, text as typed', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Student ID'], [20231234], [20231234567890], ['0012345'], ['']])
    expect(await parseIdFile(xlsxFile('ids.xlsx', sheet))).toEqual(['20231234', '20231234567890', '0012345'])
  })

  it('refuses a questions .csv that was not saved as UTF-8', async () => {
    // "Crohn’s" as Excel's plain "CSV (Comma delimited)" writes it: the curly
    // apostrophe is the single byte 0x92 of Windows-1252, which is not UTF-8.
    const ascii = (s) => [...s].map((c) => c.charCodeAt(0))
    const bytes = new Uint8Array([...ascii(`${HEADER.join(',')}\r\nCrohn`), 0x92, ...ascii('s disease is,Yes,No,,,,,A,\r\n')])
    // A real Blob, so the text is decoded the way the browser decodes a chosen file.
    const file = Object.assign(new Blob([bytes]), { name: 'questions.csv' })
    const { rows, problems } = await parseQuestionFile(file)
    expect(rows).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/not saved as UTF-8/)
  })

  it('reads a questions .csv that was saved as UTF-8, curly apostrophe and all', async () => {
    const file = Object.assign(new Blob([`﻿${HEADER.join(',')}\r\nCrohn’s disease: fever of 38°C,Yes,No,,,,,A,\r\n`]), {
      name: 'questions.csv',
    })
    const { rows, problems } = await parseQuestionFile(file)
    expect(problems).toEqual([])
    expect(rows).toEqual([{ body: 'Crohn’s disease: fever of 38°C', options: ['Yes', 'No'], correct: 0, keep_order: false }])
  })

  it('reads a .csv, and refuses any other kind of file', async () => {
    expect(await parseIdFile(csvFile('ids.csv', '\uFEFFID\r\n20231234\r\n20231235\r\n'))).toEqual(['20231234', '20231235'])
    await expect(parseIdFile(csvFile('ids.csv', 'ID\r\n'))).rejects.toThrow('No IDs found in the first column of that file.')
    await expect(fileGrid({ name: 'ids.pdf' })).rejects.toThrow('Choose an .xlsx or a .csv file.')
  })

  it('marks its own sentences as written for the officer, so the pages show them as they are', async () => {
    const wrongKind = await fileGrid({ name: 'ids.pdf' }).catch((e) => e)
    expect(errorText(wrongKind, 'That file could not be imported.')).toBe('Choose an .xlsx or a .csv file.')
    const noIds = await parseIdFile(csvFile('ids.csv', 'ID\r\n')).catch((e) => e)
    expect(errorText(noIds, 'The IDs could not be added.')).toBe('No IDs found in the first column of that file.')
  })

  it('says a workbook could not be read in its own words, not in the reader’s', async () => {
    const unreadable = {
      name: 'broken.xlsx',
      arrayBuffer: async () => {
        throw new Error('ZIP end of central directory not found')
      },
    }
    const err = await fileGrid(unreadable).catch((e) => e)
    expect(errorText(err, 'That file could not be imported.')).toBe(
      'That workbook could not be read. Save it again as an Excel workbook (.xlsx) and choose that.',
    )
  })
})
