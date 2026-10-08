import { describe, expect, it } from 'vitest'
import { boardKept, formatBytes, formatDay, termProblem, workAccountState } from './rollover.js'

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
