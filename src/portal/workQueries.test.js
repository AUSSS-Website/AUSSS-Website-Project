import { describe, expect, it, vi } from 'vitest'

// workQueries.js builds the portal's database client as it loads (and so does
// the sign-in code it imports). The checks here are of what it works out by
// itself, so the client is left out.
vi.mock('../lib/supabase.js', () => ({ supabase: null, supabaseEnabled: false }))

import { postTimeProblems } from './workQueries.js'

const NOW = Date.parse('2026-10-11T12:00:00Z')
// A time so many hours from NOW, as the editor hands it over.
const at = (hours) => new Date(NOW + hours * 3600e3).toISOString()
const problems = (post) => postTimeProblems(post, NOW)

const NONE = { publishAt: '', expiresAt: '' }
const PICK = 'Pick when it should go out.'
const PASSED = 'That time has passed. Pick a later one.'
const AFTER = 'Pick a time after the update goes out.'
const DOWN = 'That time has passed. Pick a later one, or leave this empty.'

describe('postTimeProblems: when the update goes out', () => {
  it('finds nothing wrong with one published now and never taken down', () => {
    expect(problems({ timing: 'now', publishAt: null, expiresAt: null })).toEqual(NONE)
  })

  it('does not check a draft for its schedule', () => {
    expect(problems({ timing: 'draft', publishAt: at(-5), expiresAt: null })).toEqual(NONE)
  })

  it('asks for the time of a scheduled update', () => {
    expect(problems({ timing: 'at', publishAt: null, expiresAt: null })).toEqual({ publishAt: PICK, expiresAt: '' })
  })

  it('refuses a schedule in the past, or for this very moment', () => {
    expect(problems({ timing: 'at', publishAt: at(-1), expiresAt: null })).toEqual({ publishAt: PASSED, expiresAt: '' })
    expect(problems({ timing: 'at', publishAt: at(0), expiresAt: null })).toEqual({ publishAt: PASSED, expiresAt: '' })
  })

  it('accepts a schedule ahead', () => {
    expect(problems({ timing: 'at', publishAt: at(2), expiresAt: null })).toEqual(NONE)
  })
})

describe('postTimeProblems: when it comes down', () => {
  it('has to be after it goes out', () => {
    expect(problems({ timing: 'at', publishAt: at(2), expiresAt: at(1) })).toEqual({ publishAt: '', expiresAt: AFTER })
    expect(problems({ timing: 'at', publishAt: at(2), expiresAt: at(2) })).toEqual({ publishAt: '', expiresAt: AFTER })
    expect(problems({ timing: 'at', publishAt: at(2), expiresAt: at(3) })).toEqual(NONE)
  })

  it('may not have passed already on an update nobody has seen', () => {
    expect(problems({ timing: 'now', publishAt: null, expiresAt: at(-1) })).toEqual({ publishAt: '', expiresAt: DOWN })
    expect(problems({ timing: 'draft', publishAt: null, expiresAt: at(-1) })).toEqual({ publishAt: '', expiresAt: DOWN })
    expect(problems({ timing: 'now', publishAt: null, expiresAt: at(1) })).toEqual(NONE)
  })

  it('is left alone when it is the time an expired update already had', () => {
    expect(problems({ timing: 'now', publishAt: null, expiresAt: at(-1), expiryChanged: false })).toEqual(NONE)
  })

  it('may be now or earlier on an update that is out and stays out, which retires it', () => {
    expect(problems({ timing: 'now', publishAt: null, expiresAt: at(-1), alreadyOut: true })).toEqual(NONE)
  })

  it('is not held against a schedule time left over under "now"', () => {
    expect(problems({ timing: 'now', publishAt: at(5), expiresAt: at(1) })).toEqual(NONE)
  })
})

describe('postTimeProblems: both fields', () => {
  it('can be wrong at once', () => {
    expect(problems({ timing: 'at', publishAt: null, expiresAt: at(-1) })).toEqual({ publishAt: PICK, expiresAt: DOWN })
  })

  it('reads the clock when it is given no time of its own', () => {
    const ahead = new Date(Date.now() + 3600e3).toISOString()
    const behind = new Date(Date.now() - 3600e3).toISOString()
    expect(postTimeProblems({ timing: 'at', publishAt: ahead, expiresAt: null })).toEqual(NONE)
    expect(postTimeProblems({ timing: 'at', publishAt: behind, expiresAt: null })).toEqual({ publishAt: PASSED, expiresAt: '' })
  })
})
