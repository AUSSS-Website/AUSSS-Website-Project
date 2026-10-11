import { describe, expect, it, vi } from 'vitest'

// officerQueries.js builds the portal's database client as it loads. The
// checks here are of what it works out by itself, so the client is left out.
vi.mock('../lib/supabase.js', () => ({ supabase: null, supabaseEnabled: false }))

import { callProblems, todayCairo } from './officerQueries.js'

const TODAY = '2026-10-11'
const YESTERDAY = '2026-10-10'
const base = { title: 'Local officers', deadline: '', status: 'open', notifyEmail: '', positions: [], questions: [] }
// What is wrong with the form once these fields are changed, on TODAY.
const problems = (form, options = {}) => callProblems({ ...base, ...form }, { today: TODAY, ...options })
const fields = (form, options) => Object.keys(problems(form, options))

describe('callProblems: the title', () => {
  it('passes a call with a title and nothing else', () => {
    expect(problems({})).toEqual({})
  })

  it('asks for one when only spaces are typed', () => {
    expect(problems({ title: '   ' })).toEqual({ title: 'Give the call a title.' })
  })
})

describe('callProblems: the deadline', () => {
  it('accepts today and any later day', () => {
    expect(problems({ deadline: TODAY })).toEqual({})
    expect(problems({ deadline: '2026-10-12' })).toEqual({})
  })

  it('refuses a day that has passed on an open call', () => {
    expect(problems({ deadline: YESTERDAY })).toEqual({
      deadline: 'That day has passed. Choose a later one, or clear the deadline.',
    })
  })

  it('leaves a past day alone on a draft or a closed call', () => {
    expect(problems({ deadline: YESTERDAY, status: 'draft' })).toEqual({})
    expect(problems({ deadline: YESTERDAY, status: 'closed' })).toEqual({})
  })

  it('lets an expired call be edited while its day and status stay as saved', () => {
    expect(problems({ deadline: YESTERDAY }, { saved: { status: 'open', deadline: YESTERDAY } })).toEqual({})
  })

  it('holds the day against a call reopened with it, or given another past day', () => {
    expect(fields({ deadline: YESTERDAY }, { saved: { status: 'closed', deadline: YESTERDAY } })).toEqual(['deadline'])
    expect(fields({ deadline: '2026-10-09' }, { saved: { status: 'open', deadline: YESTERDAY } })).toEqual(['deadline'])
  })
})

describe('callProblems: the notification address', () => {
  it('accepts an address, with spaces around it or not', () => {
    expect(problems({ notifyEmail: ' scope@ausss-ainshams.org ' })).toEqual({})
  })

  it('refuses what is not an address', () => {
    expect(problems({ notifyEmail: 'scope@ausss' })).toEqual({ notifyEmail: 'That doesn’t look like an email address.' })
    expect(fields({ notifyEmail: 'two words@x.org' })).toEqual(['notifyEmail'])
  })
})

describe('callProblems: positions', () => {
  it('leaves a row with nothing typed in it alone', () => {
    expect(problems({ positions: [{ id: 'p1', title: '', blurb: '', slots: ' ' }] })).toEqual({})
  })

  it('asks for a title when the row holds anything else', () => {
    expect(problems({ positions: [{ id: 'p1', title: '', blurb: 'does things', slots: '' }] })).toEqual({
      'position:p1': 'Give this position a title, or remove it.',
    })
    expect(fields({ positions: [{ id: 'p1', title: ' ', blurb: '', slots: '2' }] })).toEqual(['position:p1'])
  })

  it('needs no more than the title', () => {
    expect(problems({ positions: [{ id: 'p1', title: 'Lead', blurb: '', slots: '' }] })).toEqual({})
  })
})

describe('callProblems: questions', () => {
  it('leaves a question with nothing typed in it alone', () => {
    expect(problems({ questions: [{ id: 'q1', label: '', type: 'short', options: [] }] })).toEqual({})
  })

  it('asks for the wording when only the choices are typed', () => {
    expect(problems({ questions: [{ id: 'q1', label: '', type: 'select', options: ['a'] }] })).toEqual({
      'question:q1': 'Write the question, or remove it.',
    })
  })

  it('asks for the choices of a "choose one" question, not counting blank ones', () => {
    expect(problems({ questions: [{ id: 'q1', label: 'Which?', type: 'select', options: [' ', ''] }] })).toEqual({
      'options:q1': 'Add the choices, separated by commas.',
    })
    expect(problems({ questions: [{ id: 'q1', label: 'Which?', type: 'select', options: ['a', 'b'] }] })).toEqual({})
  })

  it('wants no choices from a written answer', () => {
    expect(problems({ questions: [{ id: 'q1', label: 'Why?', type: 'long', options: [] }] })).toEqual({})
  })
})

describe('callProblems: what it is given', () => {
  it('reads a form with no lists, and takes today from the Cairo clock', () => {
    expect(callProblems({ title: 'Local officers', status: 'open' })).toEqual({})
  })

  it('names each fault by its own field, all at once', () => {
    expect(
      fields({
        title: '',
        deadline: YESTERDAY,
        notifyEmail: 'nobody',
        positions: [{ id: 'p1', title: '', blurb: 'does things', slots: '' }],
        questions: [{ id: 'q1', label: 'Which?', type: 'select', options: [] }],
      }),
    ).toEqual(['title', 'deadline', 'notifyEmail', 'position:p1', 'options:q1'])
  })
})

describe('todayCairo', () => {
  it('is a day written year first', () => {
    expect(todayCairo()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
