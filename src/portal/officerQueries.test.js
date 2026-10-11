import { describe, expect, it, vi } from 'vitest'

// officerQueries.js builds the portal's database client as it loads. The
// checks here are of what it works out by itself, so the client is left out.
vi.mock('../lib/supabase.js', () => ({ supabase: null, supabaseEnabled: false }))

import { callProblems, groupByRemovedCall, todayCairo } from './officerQueries.js'

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

describe('groupByRemovedCall', () => {
  // An application as the list reads it, newest first: only what the grouping looks at.
  const sent = (id, call_title, created_at) => ({ id, call_title, created_at })

  it('has no groups for no applications', () => {
    expect(groupByRemovedCall([])).toEqual([])
    expect(groupByRemovedCall(undefined)).toEqual([])
  })

  it('gathers the applications under the title their call had, in the order they came in', () => {
    const rows = [
      sent('a3', 'Welcome booklet team', '2026-10-03T10:00:00Z'),
      sent('a2', 'Airport rota', '2026-10-02T10:00:00Z'),
      sent('a1', 'Welcome booklet team', '2026-10-01T10:00:00Z'),
    ]
    expect(groupByRemovedCall(rows)).toEqual([
      { key: 'Welcome booklet team', title: 'Welcome booklet team', latest: '2026-10-03T10:00:00Z', applications: [rows[0], rows[2]] },
      { key: 'Airport rota', title: 'Airport rota', latest: '2026-10-02T10:00:00Z', applications: [rows[1]] },
    ])
  })

  it('puts the group with the newest application first, whatever order the rows come in', () => {
    const groups = groupByRemovedCall([
      sent('a1', 'Older call', '2026-09-01T10:00:00Z'),
      sent('a2', 'Newer call', '2026-10-01T10:00:00Z'),
      sent('a3', 'Older call', '2026-09-20T10:00:00Z'),
    ])
    expect(groups.map((g) => [g.key, g.latest])).toEqual([
      ['Newer call', '2026-10-01T10:00:00Z'],
      ['Older call', '2026-09-20T10:00:00Z'],
    ])
  })

  it('takes a title with spaces around it as the same call', () => {
    const groups = groupByRemovedCall([sent('a1', ' Airport rota ', '2026-10-02T10:00:00Z'), sent('a2', 'Airport rota', '2026-10-01T10:00:00Z')])
    expect(groups).toHaveLength(1)
    expect(groups[0].applications.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('keeps titles that differ only by their capitals apart', () => {
    expect(groupByRemovedCall([sent('a1', 'Airport rota', ''), sent('a2', 'airport rota', '')]).map((g) => g.key)).toEqual(['Airport rota', 'airport rota'])
  })

  it('gives a call that left no title a name and a key of its own', () => {
    const groups = groupByRemovedCall([sent('a1', '', '2026-10-02T10:00:00Z'), sent('a2', null, '2026-10-01T10:00:00Z'), sent('a3', '   ')])
    expect(groups).toEqual([
      { key: 'untitled', title: 'Untitled call', latest: '2026-10-02T10:00:00Z', applications: [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' }), expect.objectContaining({ id: 'a3' })] },
    ])
  })
})
