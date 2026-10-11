import { describe, expect, it } from 'vitest'
import { fillText, ordinal, termVars, yearsOf } from './anniversary.js'

const term = (ends_on) => ({ label: 'x', starts_on: '2000-09-01', ends_on })

describe('yearsOf', () => {
  it('counts from the year the term ends in', () => {
    expect(yearsOf(term('2026-08-31'))).toBe(55)
    expect(yearsOf(term('2027-08-31'))).toBe(56)
    expect(yearsOf(term('2028-08-31'))).toBe(57)
  })

  it('does not depend on the date once the term is known', () => {
    expect(yearsOf(term('2027-08-31'), new Date(2031, 0, 1))).toBe(56)
  })

  it('counts from the date when no term is known: terms turn over on 1 September', () => {
    expect(yearsOf(null, new Date(2026, 7, 31))).toBe(55)
    expect(yearsOf(null, new Date(2026, 8, 1))).toBe(56)
    expect(yearsOf(null, new Date(2027, 0, 15))).toBe(56)
    expect(yearsOf({}, new Date(2027, 8, 1))).toBe(57)
    expect(yearsOf({ ends_on: 'soon' }, new Date(2027, 2, 1))).toBe(56)
  })
})

describe('ordinal', () => {
  it('ends each number the way it is said', () => {
    expect([55, 56, 57, 60, 61, 62, 63, 64].map(ordinal)).toEqual(['55th', '56th', '57th', '60th', '61st', '62nd', '63rd', '64th'])
    expect([100, 101, 111, 112, 113, 121].map(ordinal)).toEqual(['100th', '101st', '111th', '112th', '113th', '121st'])
  })
})

describe('fillText', () => {
  const vars = termVars(term('2027-08-31'))

  it('fills both placeholders, as often as they appear', () => {
    expect(vars).toEqual({ years: '56', anniversary: '56th' })
    expect(fillText('its **{anniversary} anniversary**', vars)).toBe('its **56th anniversary**')
    expect(fillText('{years} Years of Youth · {years} Years of Impact', vars)).toBe('56 Years of Youth · 56 Years of Impact')
  })

  it('leaves everything else as typed', () => {
    expect(fillText('No placeholder here.', vars)).toBe('No placeholder here.')
    expect(fillText('{year} {Years} { years } {name}', vars)).toBe('{year} {Years} { years } {name}')
    expect(fillText('', vars)).toBe('')
    expect(fillText(undefined, vars)).toBe(undefined)
    expect(fillText('{years}', null)).toBe('{years}')
  })
})
