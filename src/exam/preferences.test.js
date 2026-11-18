import { describe, expect, it } from 'vitest'
import {
  canChoose,
  chosenIn,
  chosenSections,
  classCount,
  classGroups,
  classRule,
  hasContracts,
  keptPicks,
  movePick,
  offeredProgrammes,
  ordinal,
  pickNote,
  placesWords,
  preferencesLine,
  preferencesProblem,
  rankOf,
  tidyContracts,
  togglePick,
} from './preferences.js'

const c = (id, programme, cls, country = id) => ({ id, programme, class: cls, country, note: '' })
const contracts = [
  c('es', 'scope', 'A', 'Spain'),
  c('it', 'scope', 'A', 'Italy'),
  c('br', 'scope', 'A', 'Brazil'),
  c('gr', 'scope', 'B', 'Greece'),
  c('tn', 'scope', 'C', 'Tunisia'),
  c('jo', 'scope', 'C', 'Jordan'),
  c('ma', 'scope', 'C', 'Morocco'),
  c('de', 'score', 'A', 'Germany'),
  c('pl', 'score', 'B', 'Poland'),
]
const both = { scope: true, score: true }

describe('hasContracts', () => {
  it('is true when either programme has one', () => {
    expect(hasContracts({ contracts: { scope: 0, score: 3 } })).toBe(true)
  })
  it('is false for none, and for an exam from before contracts', () => {
    expect(hasContracts({ contracts: { scope: 0, score: 0 } })).toBe(false)
    expect(hasContracts({})).toBe(false)
    expect(hasContracts(null)).toBe(false)
  })
})

describe('tidyContracts', () => {
  it('keeps what is a contract and drops the rest', () => {
    const tidy = tidyContracts([
      { id: 'a', programme: 'scope', class: 'A', country: 'Spain', places: 3, note: 'July', more: 1 },
      { id: 'b', programme: 'scoph', class: 'A', country: 'X' },
      { id: 'c', programme: 'score', class: 'D', country: 'X' },
      { id: 'd', programme: 'score', class: 'B', country: ' ' },
      null,
      { id: 'e', programme: 'score', class: 'C', country: 'Chile' },
    ])
    expect(tidy).toEqual([
      { id: 'a', programme: 'scope', class: 'A', country: 'Spain', places: 3, note: 'July' },
      // no number of places is one
      { id: 'e', programme: 'score', class: 'C', country: 'Chile', places: 1, note: '' },
    ])
  })
  it('reads anything but a list as none', () => {
    expect(tidyContracts(undefined)).toEqual([])
    expect(tidyContracts({})).toEqual([])
  })
})

describe('offeredProgrammes', () => {
  it('offers the ticked sections in an exam with the choice', () => {
    expect(offeredProgrammes(contracts, { scope: true, score: false }, true)).toEqual(['scope'])
    expect(offeredProgrammes(contracts, both, true)).toEqual(['scope', 'score'])
    expect(offeredProgrammes(contracts, { scope: false, score: false }, true)).toEqual([])
  })
  it('offers every programme in an exam without it', () => {
    expect(offeredProgrammes(contracts, null, false)).toEqual(['scope', 'score'])
  })
  it('leaves out a programme with no contract', () => {
    expect(offeredProgrammes([c('es', 'scope', 'A')], both, true)).toEqual(['scope'])
  })
})

describe('classGroups', () => {
  it('gives a programme its classes in order, without the empty ones', () => {
    expect(classGroups(contracts, 'score').map((g) => [g.class, g.contracts.map((x) => x.id)])).toEqual([
      ['A', ['de']],
      ['B', ['pl']],
    ])
    expect(classGroups(contracts, 'scope').map((g) => g.class)).toEqual(['A', 'B', 'C'])
  })
})

describe('choosing', () => {
  it('adds a contract last in its class and ranks it there', () => {
    const picks = togglePick(contracts, togglePick(contracts, ['tn'], 'it'), 'es')
    expect(picks).toEqual(['tn', 'it', 'es'])
    expect(rankOf(contracts, picks, 'it')).toBe(1)
    expect(rankOf(contracts, picks, 'es')).toBe(2)
    expect(rankOf(contracts, picks, 'tn')).toBe(1)
    expect(rankOf(contracts, picks, 'br')).toBe(0)
  })
  it('takes a chosen contract out, and the one behind it moves up', () => {
    const picks = togglePick(contracts, ['it', 'es'], 'it')
    expect(picks).toEqual(['es'])
    expect(rankOf(contracts, picks, 'es')).toBe(1)
  })
  it('holds Class A and Class B to two in a programme', () => {
    expect(canChoose(contracts, ['it', 'es'], 'br')).toBe(false)
    expect(togglePick(contracts, ['it', 'es'], 'br')).toEqual(['it', 'es'])
    // the other programme has two of its own
    expect(canChoose(contracts, ['it', 'es'], 'de')).toBe(true)
  })
  it('lets Class C take any number', () => {
    expect(togglePick(contracts, ['tn', 'jo'], 'ma')).toEqual(['tn', 'jo', 'ma'])
    expect(chosenIn(contracts, ['tn', 'jo', 'ma', 'es'], 'scope', 'C')).toBe(3)
  })
  it('does not choose a contract twice, or one that is not there', () => {
    expect(canChoose(contracts, ['es'], 'es')).toBe(false)
    expect(togglePick(contracts, [], 'nowhere')).toEqual([])
  })
})

describe('movePick', () => {
  it('moves a contract up among its own class only', () => {
    // Class C in order: Tunisia, Jordan, Morocco, with a Class A pick between
    const picks = ['tn', 'es', 'jo', 'ma']
    const next = movePick(contracts, picks, 'ma', -1)
    expect(next).toEqual(['tn', 'es', 'ma', 'jo'])
    expect(rankOf(contracts, next, 'ma')).toBe(2)
    expect(rankOf(contracts, next, 'es')).toBe(1)
  })
  it('moves one down', () => {
    expect(movePick(contracts, ['tn', 'jo'], 'tn', 1)).toEqual(['jo', 'tn'])
  })
  it('stays at either end, and for a contract that is not chosen', () => {
    const picks = ['tn', 'jo']
    expect(movePick(contracts, picks, 'tn', -1)).toEqual(picks)
    expect(movePick(contracts, picks, 'jo', 1)).toEqual(picks)
    expect(movePick(contracts, picks, 'ma', -1)).toEqual(picks)
  })
})

describe('keptPicks', () => {
  it('drops a contract that is gone, a repeat, and one of a section not ticked', () => {
    expect(keptPicks(contracts, ['es', 'gone', 'es', 'de', 'tn'], ['scope'])).toEqual(['es', 'tn'])
  })
  it('drops what is over a class limit', () => {
    expect(keptPicks(contracts, ['es', 'it', 'br'], ['scope'])).toEqual(['es', 'it'])
  })
  it('reads anything but a list as none', () => {
    expect(keptPicks(contracts, null, ['scope'])).toEqual([])
  })
})

describe('preferencesProblem', () => {
  it('asks for a section first', () => {
    expect(preferencesProblem({ contracts, picks: ['es'], sits: { scope: false, score: false }, choice: true })).toBe(
      'Choose at least one section.',
    )
  })
  it('asks for a contract in each ticked programme that has some', () => {
    expect(preferencesProblem({ contracts, picks: ['es'], sits: both, choice: true })).toBe(
      'Choose at least one contract for the research exchange (SCORE).',
    )
    expect(preferencesProblem({ contracts, picks: ['de'], sits: both, choice: true })).toBe(
      'Choose at least one contract for the professional exchange (SCOPE).',
    )
  })
  it('does not count a pick in a section that is no longer ticked', () => {
    expect(preferencesProblem({ contracts, picks: ['de'], sits: { scope: true, score: false }, choice: true })).toBe(
      'Choose at least one contract for the professional exchange (SCOPE).',
    )
  })
  it('asks nothing of a ticked programme that has no contract', () => {
    const scopeOnly = contracts.filter((x) => x.programme === 'scope')
    expect(preferencesProblem({ contracts: scopeOnly, picks: [], sits: { scope: false, score: true }, choice: true })).toBe('')
  })
  it('passes a full choice', () => {
    expect(preferencesProblem({ contracts, picks: ['es', 'de'], sits: both, choice: true })).toBe('')
  })
  it('asks for one contract of any programme in an exam with no choice', () => {
    expect(preferencesProblem({ contracts, picks: [], sits: null, choice: false })).toBe('Choose at least one contract.')
    expect(preferencesProblem({ contracts, picks: ['pl'], sits: null, choice: false })).toBe('')
  })
})

describe('the words', () => {
  it('counts in words up to ten, then in figures', () => {
    expect([1, 2, 3, 10].map(ordinal)).toEqual(['first', 'second', 'third', 'tenth'])
    expect([11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
  })
  it('says what each class asks', () => {
    expect(classRule('A')).toBe('Choose up to two. The one you choose first is your first choice.')
    expect(classRule('C')).toBe('Choose as many as you like. The order you choose them in is your order of preference.')
  })
  it('says how many contracts there are of one', () => {
    expect(placesWords({ places: 3 })).toBe('3 contracts')
    expect(placesWords({ places: 1 })).toBe('1 contract')
    expect(placesWords({})).toBe('1 contract')
  })
  it('says how full a class is', () => {
    expect(classCount('B', 1)).toBe('1 of 2 chosen')
    expect(classCount('C', 4)).toBe('4 chosen')
  })
  it('tells a screen reader what a tap did', () => {
    expect(pickNote(contracts, ['it', 'es'], 'es')).toBe('Spain is your second choice in Class A.')
    expect(pickNote(contracts, ['it'], 'es')).toBe('Spain is no longer chosen.')
    expect(pickNote(contracts, [], 'nowhere')).toBe('')
  })
  it('sums the saved preferences up on the start card', () => {
    expect(preferencesLine({ picks: 5 })).toBe('You have chosen 5 contracts. You can change them until you start the exam.')
    expect(preferencesLine({ picks: 1 })).toBe('You have chosen 1 contract. You can change it until you start the exam.')
  })
  it('reads the sections chosen with the preferences', () => {
    expect(chosenSections({ scope: true, score: null })).toEqual({ scope: true, score: false })
    expect(chosenSections(null)).toEqual({ scope: false, score: false })
  })
})
