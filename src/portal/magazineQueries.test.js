import { describe, expect, it, vi } from 'vitest'

// magazineQueries.js builds the portal's database client as it loads. The
// checks here are of what it works out by itself, so the client is left out.
vi.mock('../lib/supabase.js', () => ({ supabase: null, supabaseEnabled: false }))

import { NO_PERMISSION, UNREACHED } from '../lib/errorText.js'
import { issueErrorText, stalePagesFolders } from './magazineQueries.js'

const DAY = 86400000
const NOW = 1_800_000_000_000
// The folder of an upload that began so many days before NOW.
const folder = (daysAgo) => `pages-${NOW - daysAgo * DAY}`

describe('stalePagesFolders', () => {
  it('never returns the live folder', () => {
    expect(stalePagesFolders([folder(30)], folder(30), NOW)).toEqual([])
    expect(stalePagesFolders(['pages'], 'pages', NOW)).toEqual([])
  })

  it('keeps the replaced folder for a week after the new one began', () => {
    expect(stalePagesFolders([folder(30), folder(1)], folder(1), NOW)).toEqual([])
    expect(stalePagesFolders([folder(30), folder(6.9)], folder(6.9), NOW)).toEqual([])
    expect(stalePagesFolders([folder(30), folder(7.1)], folder(7.1), NOW)).toEqual([folder(30)])
  })

  it('treats the old fixed folder as older than everything', () => {
    expect(stalePagesFolders(['pages', folder(2)], folder(2), NOW)).toEqual([])
    expect(stalePagesFolders(['pages', folder(8)], folder(8), NOW)).toEqual(['pages'])
  })

  it('keeps an upload that began lately and is not live yet', () => {
    expect(stalePagesFolders([folder(40), folder(0.001)], folder(40), NOW)).toEqual([])
    expect(stalePagesFolders([folder(40), folder(8)], folder(40), NOW)).toEqual([folder(8)])
    expect(stalePagesFolders(['pages', folder(0.01)], 'pages', NOW)).toEqual([])
    expect(stalePagesFolders(['pages', folder(9)], 'pages', NOW)).toEqual([folder(9)])
  })

  it('with no live folder in the bucket, removes what is over a week old', () => {
    expect(stalePagesFolders(['pages', folder(8), folder(1)], null, NOW)).toEqual(['pages', folder(8)])
  })

  it('leaves folders it does not know alone', () => {
    expect(stalePagesFolders(['covers', 'pages-old', 'pages-12x', '.emptyFolderPlaceholder'], null, NOW)).toEqual([])
  })

  it('handles several replaced folders', () => {
    expect(stalePagesFolders([folder(50), folder(40), folder(30), folder(10)], folder(10), NOW)).toEqual([
      folder(50),
      folder(40),
      folder(30),
    ])
    expect(stalePagesFolders([folder(50), folder(40), folder(30), folder(3)], folder(3), NOW)).toEqual([])
  })
})

describe('issueErrorText', () => {
  const FALLBACK = 'We couldn’t save the edition.'
  // An error as supabase-js hands it back from the database.
  const db = (message, code) => ({ name: 'PostgrestError', message, details: null, hint: null, code })

  it('names an ID another edition has', () => {
    expect(issueErrorText(db('duplicate key value violates unique constraint "magazine_issues_slug_key"', '23505'), FALLBACK)).toBe(
      'Another edition already has that ID. Choose a different one.',
    )
  })

  it('says what the ID needs, in the form’s word for it', () => {
    expect(issueErrorText(db('an edition needs a link name', '22023'), FALLBACK)).toBe(
      'The ID needs at least one English letter or number, for example vol-8.',
    )
  })

  it('asks for a title', () => {
    expect(issueErrorText(db('an edition needs a title', '22023'), FALLBACK)).toBe('Give the edition a title.')
  })

  it('says a link needs https', () => {
    expect(
      issueErrorText(db('new row for relation "magazine_issues" violates check constraint "magazine_issues_urls"', '23514'), FALLBACK),
    ).toBe('A link has to start with https://.')
  })

  it('falls back for any other constraint', () => {
    expect(
      issueErrorText(db('new row for relation "magazine_issues" violates check constraint "magazine_issues_pages"', '23514'), FALLBACK),
    ).toBe(FALLBACK)
  })

  it('says so when the request got no answer', () => {
    expect(issueErrorText(new TypeError('Failed to fetch'), FALLBACK)).toBe(UNREACHED)
  })

  it('says so when the database refuses the editor', () => {
    expect(
      issueErrorText(db('new row violates row-level security policy for table "magazine_issues"', '42501'), FALLBACK),
    ).toBe(NO_PERMISSION)
  })

  it('shows a sentence the module marked as its own', () => {
    expect(issueErrorText(Object.assign(new Error('That PDF has no pages.'), { rejected: true }), FALLBACK)).toBe('That PDF has no pages.')
  })

  it('falls back when it is given nothing', () => {
    expect(issueErrorText(null, FALLBACK)).toBe(FALLBACK)
  })
})
