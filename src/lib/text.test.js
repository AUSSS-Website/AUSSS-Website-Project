import { describe, expect, it } from 'vitest'
import { initials, normalize, splitPositions } from './text.js'

describe('normalize', () => {
  it('strips accents, case and extra spaces', () => {
    expect(normalize('  Élodie   DUPONT ')).toBe('elodie dupont')
    expect(normalize(null)).toBe('')
  })
})

describe('splitPositions', () => {
  it('splits a roster cell on line breaks and drops blanks', () => {
    expect(splitPositions('LEO-Out\r\nNational CBSD Team, TEDA\n\n')).toEqual(['LEO-Out', 'National CBSD Team, TEDA'])
    expect(splitPositions('')).toEqual([])
  })
})

describe('initials', () => {
  it('takes up to two, ignoring a title', () => {
    expect(initials('Dr. Mona Hassan Ali')).toBe('MH')
    expect(initials('plato')).toBe('P')
    expect(initials('')).toBe('?')
  })
})
