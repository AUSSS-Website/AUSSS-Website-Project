import { describe, expect, it } from 'vitest'
import {
  addedContracts,
  checkContractList,
  classId,
  contractFault,
  contractGroups,
  contractLabel,
  contractsFromGrid,
  contractsFromText,
  demandOf,
  demandWords,
  picksByClass,
  placesIn,
  placesOf,
  preferenceColumns,
  preferenceRows,
  preferenceTally,
  problemSentences,
  programmeId,
  studentSections,
  compactContracts,
  removeAllWords,
} from './examContracts.js'

const c = (id, programme, cls, country, note = '') => ({ id, programme, class: cls, country, note })
const contracts = [
  c('es', 'scope', 'A', 'Spain', 'Madrid, July'),
  c('it', 'scope', 'A', 'Italy'),
  c('gr', 'scope', 'B', 'Greece'),
  c('tn', 'scope', 'C', 'Tunisia'),
  c('jo', 'scope', 'C', 'Jordan'),
  c('de', 'score', 'A', 'Germany'),
]

describe('reading what was typed', () => {
  it('reads a programme by its abbreviation or its name', () => {
    expect(['scope', 'SCOPE', ' Scope ', 'Professional exchange', 'clinical'].map(programmeId)).toEqual(Array(5).fill('scope'))
    expect(['score', 'SCORE', 'Research', 'research exchange (SCORE)'].map(programmeId)).toEqual(Array(4).fill('score'))
    expect(['', 'scoph', 'scopes', null, 'A'].map(programmeId)).toEqual(Array(5).fill(''))
  })
  it('reads a class by its letter, with or without the word', () => {
    expect(['a', 'B', ' c ', 'Class A', 'class  b', 'classC'].map(classId)).toEqual(['A', 'B', 'C', 'A', 'B', 'C'])
    expect(['', 'D', 'AB', 'Class', '1', null].map(classId)).toEqual(Array(6).fill(''))
  })
  it('says what a contract lacks', () => {
    expect(contractFault({ programme: 'x', class: 'A', country: 'Spain' })).toBe('Choose the contract’s programme: SCOPE or SCORE.')
    expect(contractFault({ programme: 'scope', class: '', country: 'Spain' })).toBe('Choose the contract’s class: A, B or C.')
    expect(contractFault({ programme: 'scope', class: 'A', country: '  ' })).toBe('A contract needs its country, in at most 80 characters.')
    expect(contractFault({ programme: 'scope', class: 'A', country: 'x'.repeat(81) })).toBe('A contract needs its country, in at most 80 characters.')
    expect(contractFault({ programme: 'scope', class: 'A', country: 'Spain', note: 'x'.repeat(201) })).toBe('A contract’s note can have at most 200 characters.')
    expect(contractFault({ programme: 'scope', class: 'A', country: 'Spain', places: '0' })).toBe('A contract has between 1 and 999 places.')
    expect(contractFault({ programme: 'scope', class: 'A', country: 'Spain', places: 'two' })).toBe('A contract has between 1 and 999 places.')
    expect(contractFault({ programme: 'SCORE', class: 'class b', country: 'Spain', places: 4, note: '' })).toBe('')
    expect(contractFault({ programme: 'SCORE', class: 'class b', country: 'Spain', note: '' })).toBe('')
  })
  it('reads how many contracts there are of one', () => {
    expect(['', null, ' 1 ', '3', 999, '012'].map(placesOf)).toEqual([1, 1, 1, 3, 999, 12])
    expect(['0', '1000', '-2', '1.5', 'two'].map(placesOf)).toEqual([0, 0, 0, 0, 0])
    expect(placesIn([{ places: 3 }, { places: 1 }, {}])).toBe(5)
    expect(placesIn(null)).toBe(0)
  })
})

describe('a pasted list', () => {
  it('reads cells copied from a spreadsheet', () => {
    const text = 'Programme\tClass\tCountry\tNumber\tNote\nSCOPE\tA\tSpain\t3\tMadrid, July\n\nscore\tclass b\t Czech  Republic \t\t\n'
    expect(contractsFromText(text)).toEqual({
      rows: [
        { programme: 'scope', class: 'A', country: 'Spain', places: 3, note: 'Madrid, July' },
        { programme: 'score', class: 'B', country: 'Czech Republic', places: 1, note: '' },
      ],
      problems: [],
      lines: 2,
    })
  })
  it('reads typed lines at their commas, and keeps a note whole', () => {
    expect(contractsFromText('scope, A, Spain, Madrid, in July\nscore; C; Japan\nscope, B, Greece, 2, Athens, in August\nscope, B, Malta, 4').rows).toEqual([
      // a fourth cell that is no number is the note
      { programme: 'scope', class: 'A', country: 'Spain', places: 1, note: 'Madrid, in July' },
      { programme: 'score', class: 'C', country: 'Japan', places: 1, note: '' },
      { programme: 'scope', class: 'B', country: 'Greece', places: 2, note: 'Athens, in August' },
      { programme: 'scope', class: 'B', country: 'Malta', places: 4, note: '' },
    ])
  })
  it('names the line of each row that is not a contract', () => {
    const { rows, problems } = contractsFromText('scope, A, Spain\nscope, D, Italy\n\nscore, B\nSCOPH, A, Peru\nscope, A, Chile, 0')
    expect(rows).toHaveLength(1)
    expect(problems).toEqual([
      'Line 2: Choose the contract’s class: A, B or C.',
      'Line 4: A contract needs its country, in at most 80 characters.',
      'Line 5: Choose the contract’s programme: SCOPE or SCORE.',
      'Line 6: A contract has between 1 and 999 places.',
    ])
  })
  it('passes over a row of headings only at the top', () => {
    expect(contractsFromGrid([['Committee', 'Class', 'Country'], ['scope', 'A', 'Spain']]).rows).toHaveLength(1)
    expect(contractsFromGrid([['scope', 'A', 'Spain'], ['Programme', 'Class', 'Country']]).problems).toEqual([
      'Line 2: Choose the contract’s programme: SCOPE or SCORE.',
    ])
  })
  it('reads nothing as no contracts', () => {
    expect(contractsFromText('')).toEqual({ rows: [], problems: [], lines: 0 })
    expect(contractsFromGrid(null)).toEqual({ rows: [], problems: [], lines: 0 })
  })
})

describe('checkContractList', () => {
  it('hands a good list on', () => {
    const rows = [{ programme: 'scope', class: 'A', country: 'Spain', places: 1, note: '' }]
    expect(checkContractList({ rows, problems: [] })).toBe(rows)
  })
  it('refuses a list with a problem, an empty one and one that is too long, each in a sentence to show', () => {
    const thrown = (list) => {
      try {
        checkContractList(list)
      } catch (err) {
        return [err.message, err.rejected]
      }
      return null
    }
    expect(thrown({ rows: [], problems: ['Line 2: no.'] })).toEqual(['Line 2: no.', true])
    expect(thrown({ rows: [], problems: [] })).toEqual(['There are no contracts in that.', true])
    expect(thrown({ rows: Array(501).fill({}), problems: [] })).toEqual([
      'Add at most 500 contracts at a time. This list has 501: add it in parts.',
      true,
    ])
  })
  it('shows the first problems and counts the rest', () => {
    const problems = Array.from({ length: 7 }, (_, i) => `Line ${i + 1}: no.`)
    expect(problemSentences(problems)).toEqual([...problems.slice(0, 5), 'And 2 more lines.'])
    expect(problemSentences(problems.slice(0, 6)).at(-1)).toBe('And 1 more line.')
    expect(problemSentences(problems.slice(0, 5))).toHaveLength(5)
  })
  it('says how many were added', () => {
    expect(addedContracts(1)).toBe('Added 1 contract.')
    expect(addedContracts(12)).toBe('Added 12 contracts.')
  })
})

describe('the list on the page', () => {
  it('groups by programme and class, without the empty ones', () => {
    expect(contractGroups(contracts).map((g) => [g.programme.id, g.classes.map((k) => [k.class, k.contracts.map((x) => x.id)])])).toEqual([
      ['scope', [['A', ['es', 'it']], ['B', ['gr']], ['C', ['tn', 'jo']]]],
      ['score', [['A', ['de']]]],
    ])
    expect(contractGroups([])).toEqual([])
  })
  it('writes a contract in one line', () => {
    expect(contractLabel(contracts[0])).toBe('Spain (Madrid, July)')
    expect(contractLabel(contracts[1])).toBe('Italy')
    expect(contractLabel(null)).toBe('')
  })
  it('sorts a student’s picks into their classes, in the student’s order', () => {
    const mine = picksByClass(contracts, ['jo', 'it', 'gone', 'tn', 'es', 'de'])
    expect(mine.scope.A.map((x) => x.id)).toEqual(['it', 'es'])
    expect(mine.scope.C.map((x) => x.id)).toEqual(['jo', 'tn'])
    expect(mine.scope.B).toEqual([])
    expect(mine.score.A.map((x) => x.id)).toEqual(['de'])
  })
  it('counts who chose each contract and who put it first', () => {
    const demand = demandOf(contracts, [{ picks: ['it', 'es', 'tn'] }, { picks: ['es', 'jo', 'tn'] }, { picks: [] }, null])
    expect(demand.get('es')).toEqual({ chosen: 2, first: 1 })
    expect(demand.get('it')).toEqual({ chosen: 1, first: 1 })
    expect(demand.get('tn')).toEqual({ chosen: 2, first: 1 })
    expect(demand.has('gr')).toBe(false)
    expect(demandWords(demand.get('es'))).toBe('Chosen by 2 students, the first choice of 1')
    expect(demandWords({ chosen: 1, first: 0 })).toBe('Chosen by 1 student')
    expect(demandWords(undefined)).toBe('')
  })
  it('counts the students who saved, and those of them who started', () => {
    expect(preferenceTally([{ saved_at: 'x', attempt_id: 'a' }, { saved_at: 'x', attempt_id: null }, { saved_at: null, attempt_id: 'b' }])).toEqual({
      saved: 2,
      started: 1,
    })
    expect(preferenceTally(null)).toEqual({ saved: 0, started: 0 })
  })
})

describe('the export', () => {
  const students = [
    {
      student_id: '2001',
      full_name: 'Amal Adel',
      faculty_year: 'Year 3',
      email: 'amal@example.com',
      phone: '+201001234567',
      saved_at: '2026-11-14T16:05:00+00:00',
      chose_scope: true,
      chose_score: false,
      attempt_id: 'p1',
      sits_scope: true,
      sits_score: true,
      picks: ['it', 'es', 'jo', 'tn', 'de'],
    },
    {
      student_id: '2002',
      full_name: '=cmd',
      faculty_year: 'Year 4',
      email: 'b@example.com',
      phone: '',
      saved_at: '2026-11-14T16:06:00+00:00',
      chose_scope: false,
      chose_score: true,
      attempt_id: null,
      sits_scope: null,
      sits_score: null,
      picks: ['de'],
    },
  ]
  const attempts = [{ attempt_id: 'p1', state: 'handed_in', score: 70, rank: 3, total_scope: 61, rank_scope: 2, total_score: 55, rank_score: 4 }]
  const rows = preferenceRows(students, attempts)
  const read = (columns, row) => Object.fromEntries(columns.map((col) => [col.label, col.value(row)]))

  it('puts each student’s paper beside their preferences', () => {
    expect(rows[0].result).toBe(attempts[0])
    expect(rows[1].result).toBe(null)
  })
  it('says which sections the preferences go with', () => {
    // the paper's own once there is one, what was ticked before that
    expect(studentSections(students[0])).toBe('SCOPE and SCORE')
    expect(studentSections(students[1])).toBe('SCORE only')
  })
  it('gives a programme its marks and its choices, first and second', () => {
    const line = read(preferenceColumns(contracts, true), rows[0])
    expect(line).toMatchObject({
      'Student ID': '2001',
      Name: 'Amal Adel',
      Sections: 'SCOPE and SCORE',
      'SCOPE mark': 61,
      'SCOPE rank': 2,
      'SCORE mark': 55,
      'SCORE rank': 4,
      'SCOPE Class A, first choice': 'Italy',
      'SCOPE Class A, second choice': 'Spain (Madrid, July)',
      'SCOPE Class B, first choice': '',
      'SCOPE Class C, in order': 'Jordan; Tunisia',
      'SCORE Class A, first choice': 'Germany',
      'SCORE Class A, second choice': '',
      Paper: 'Handed in',
      'Preferences saved (Cairo time)': '2026-11-14 18:05',
    })
  })
  it('leaves the marks of a student who has not started empty, and guards a typed name', () => {
    const line = read(preferenceColumns(contracts, true), rows[1])
    expect(line).toMatchObject({ Name: "'=cmd", 'SCOPE mark': '', 'SCORE rank': '', Paper: 'Not started', 'SCORE Class A, first choice': 'Germany' })
  })
  it('has one grade and no sections in an exam with no choice, and no columns for a programme with no contract', () => {
    const scopeOnly = contracts.filter((x) => x.programme === 'scope')
    const labels = preferenceColumns(scopeOnly, false).map((col) => col.label)
    expect(labels).toContain('Grade')
    expect(labels).toContain('Rank')
    expect(labels).not.toContain('Sections')
    expect(labels.some((l) => l.startsWith('SCORE'))).toBe(false)
    expect(read(preferenceColumns(scopeOnly, false), rows[0])).toMatchObject({ Grade: 70, Rank: 3 })
  })
})

describe('the same contract on several lines', () => {
  it('counts them together as one contract, at the first one’s place', () => {
    const read = contractsFromGrid([
      ['scope', 'A', 'Spain'],
      ['score', 'B', 'Poland', 'Warsaw'],
      ['SCOPE', 'a', ' spain '],
      ['scope', 'A', 'Spain', '3'],
      ['score', 'B', 'Poland', 'warsaw'],
      ['scope', 'A', 'Italy'],
    ])
    expect(read.problems).toEqual([])
    expect(read.lines).toBe(6)
    expect(read.rows).toEqual([
      { programme: 'scope', class: 'A', country: 'Spain', places: 5, note: '' },
      { programme: 'score', class: 'B', country: 'Poland', places: 2, note: 'Warsaw' },
      { programme: 'scope', class: 'A', country: 'Italy', places: 1, note: '' },
    ])
  })

  it('keeps apart what differs in programme, class, country or note', () => {
    const rows = [
      { programme: 'scope', class: 'A', country: 'Spain', places: 1, note: '' },
      { programme: 'scope', class: 'A', country: 'Spain', places: 1, note: 'Madrid' },
      { programme: 'scope', class: 'A', country: 'Spain', places: 1, note: 'Seville' },
      { programme: 'scope', class: 'B', country: 'Spain', places: 1, note: '' },
      { programme: 'score', class: 'A', country: 'Spain', places: 1, note: '' },
    ]
    expect(compactContracts(rows)).toEqual(rows)
    expect(compactContracts(null)).toEqual([])
  })

  it('leaves the list it was given as it was', () => {
    const rows = [
      { programme: 'scope', class: 'A', country: 'Spain', places: 1, note: '' },
      { programme: 'scope', class: 'A', country: 'Spain', places: 2, note: '' },
    ]
    expect(compactContracts(rows)).toEqual([{ programme: 'scope', class: 'A', country: 'Spain', places: 3, note: '' }])
    expect(rows[0].places).toBe(1)
  })

  it('refuses a contract that comes to more than 999', () => {
    const read = contractsFromGrid([['scope', 'A', 'Spain', '600'], ['scope', 'A', 'Spain', '400']])
    expect(read.rows[0].places).toBe(1000)
    expect(() => checkContractList(read)).toThrow('The lines for Spain (SCOPE, Class A) come to 1000 contracts. A contract has between 1 and 999 places.')
  })

  it('says how many lines became how many contracts', () => {
    expect(addedContracts(3, 3, 6)).toBe('Added 3 contracts. Lines that were the same contract were counted together.')
    expect(addedContracts(3, 3, 3)).toBe('Added 3 contracts.')
    expect(addedContracts(3)).toBe('Added 3 contracts.')
  })

  it('says when a list added to contracts the exam already had', () => {
    expect(addedContracts(3, 5)).toBe('Added 3 contracts. Added to 2 contracts already in the list.')
    expect(addedContracts(0, 1)).toBe('Added to 1 contract already in the list.')
    expect(addedContracts(1, 4, 9)).toBe(
      'Added 1 contract. Added to 3 contracts already in the list. Lines that were the same contract were counted together.',
    )
    expect(addedContracts(0, 0)).toBe('Added 0 contracts.')
  })

  it('says what removing every contract takes with it', () => {
    const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(removeAllWords(three, [])).toBe('This removes all 3 contracts of this exam.')
    expect(removeAllWords([{ id: 'a' }], null)).toBe('This removes the one contract of this exam.')
    expect(removeAllWords(three, [{ picks: ['a'] }, { picks: [] }])).toBe(
      'This removes all 3 contracts of this exam, and with them the choices of the one student who has chosen among them.',
    )
    expect(removeAllWords(three, [{ picks: ['a'] }, { picks: ['b', 'c'] }])).toBe(
      'This removes all 3 contracts of this exam, and with them the choices of the 2 students who have chosen among them.',
    )
  })
})
