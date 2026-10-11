import { describe, expect, it } from 'vitest'
import { boardKept, examLoss, formatBytes, formatDay, startBlocker, termProblem, workAccountState } from './rollover.js'

const current = { label: '2026-27', starts_on: '2026-09-01', ends_on: '2027-08-31' }

describe('termProblem', () => {
  it('accepts the year after the current term', () => {
    expect(termProblem({ label: '2027-28', startsOn: '2027-09-01', endsOn: '2028-08-31' }, current)).toBe('')
  })

  it('asks for a name like 2027-28', () => {
    expect(termProblem({ label: 'next year', startsOn: '2027-09-01', endsOn: '2028-08-31' }, current)).toBe(
      'Name the term like 2027-28.',
    )
  })

  it('wants both days, the last after the first', () => {
    expect(termProblem({ label: '2027-28', startsOn: '', endsOn: '2028-08-31' }, current)).toMatch(/first and a last day/)
    expect(termProblem({ label: '2027-28', startsOn: '2027-09-01', endsOn: '2027-09-01' }, current)).toMatch(
      /last day must come after/,
    )
  })

  it('refuses a term that starts before the current one started', () => {
    expect(termProblem({ label: '2027-28', startsOn: '2026-08-01', endsOn: '2027-07-31' }, current)).toBe(
      'The new term must start after 2026-27 started.',
    )
  })

  it('allows an early handover, before the current term ends', () => {
    expect(termProblem({ label: '2027-28', startsOn: '2027-08-15', endsOn: '2028-08-31' }, current)).toBe('')
  })
})

describe('workAccountState', () => {
  it('tells apart an account, an address without one, and no address', () => {
    expect(workAccountState({ email: 'lore@x.org', has_account: true })).toBe('keeps')
    expect(workAccountState({ email: 'lore@x.org', has_account: false })).toBe('first-sign-in')
    expect(workAccountState({ email: null, has_account: false })).toBe('no-email')
  })
})

describe('boardKept', () => {
  it('needs a board or webmaster work account that exists', () => {
    const officer = { level: 'officer', email: 'lore@x.org', has_account: true }
    const president = { level: 'eb', email: 'president@x.org', has_account: true }
    const webmasterWaiting = { level: 'webmaster', email: 'web@x.org', has_account: false }
    expect(boardKept([officer, president])).toBe(true)
    expect(boardKept([officer, webmasterWaiting])).toBe(false)
    expect(boardKept([])).toBe(false)
  })
})

describe('startBlocker', () => {
  const ready = { problem: '', board: true, label: '2027-28' }

  it('lets the button be pressed once the name is typed exactly', () => {
    expect(startBlocker({ ...ready, typed: '2027-28' })).toBe('')
  })

  it('does not count spaces around the name, on either side', () => {
    expect(startBlocker({ ...ready, typed: ' 2027-28 ' })).toBe('')
    expect(startBlocker({ ...ready, label: ' 2027-28 ', typed: '2027-28' })).toBe('')
  })

  it('asks for the name while nothing, or only its start, is typed', () => {
    expect(startBlocker({ ...ready, typed: '' })).toBe('Type 2027-28 in the box to use the button.')
    expect(startBlocker({ ...ready, typed: '2027-' })).toBe('Type 2027-28 in the box to use the button.')
    expect(startBlocker({ ...ready })).toBe('Type 2027-28 in the box to use the button.')
  })

  it('says so when what is typed is not the name', () => {
    // An en dash for the hyphen, the current term, and one character too many.
    for (const typed of ['2027–28', '2026-27', '2027-289']) {
      expect(startBlocker({ ...ready, typed })).toBe('That is not 2027-28. Type the name exactly as part 1 has it.')
    }
  })

  it('puts a problem with the term first, whatever is typed', () => {
    expect(startBlocker({ ...ready, problem: 'Name the term like 2027-28.', label: 'next year', typed: 'next year' })).toBe(
      'Part 1 is not ready. Name the term like 2027-28.',
    )
  })

  it('then the board, before the typing', () => {
    expect(startBlocker({ ...ready, board: false, typed: '2027-28' })).toMatch(/^Nobody on the board would keep their access/)
  })
})

describe('examLoss', () => {
  it('counts the registered IDs and the papers an exam would lose', () => {
    expect(examLoss({ registrations: 396, attempts: 388 })).toBe('396 registered IDs and 388 papers')
    expect(examLoss({ registrations: 1, attempts: 1 })).toBe('1 registered ID and 1 paper')
    expect(examLoss({ registrations: 12, attempts: 0 })).toBe('12 registered IDs and 0 papers')
  })

  it('is empty for an exam that holds neither', () => {
    expect(examLoss({ registrations: 0, attempts: 0 })).toBe('')
    expect(examLoss({})).toBe('')
  })
})

describe('formatting', () => {
  it('writes storage in MB, then GB', () => {
    expect(formatBytes(56.2 * 1024 ** 2)).toBe('56 MB')
    expect(formatBytes(3.4 * 1024 ** 2)).toBe('3.4 MB')
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB')
    expect(formatBytes(1024 ** 3)).toBe('1 GB')
  })

  it('writes a day the British way', () => {
    expect(formatDay('2027-09-01')).toBe('1 September 2027')
    expect(formatDay(null)).toBe('')
  })
})
