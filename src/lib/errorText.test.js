import { describe, expect, it } from 'vitest'
import { NO_PERMISSION, UNREACHED, WENT_WRONG, errorText } from './errorText.js'

const FALLBACK = 'Could not save.'

// An error as src/lib/supabaseRest.js throws it: `code` is there when the
// answer carried one (PostgREST's always do; a Storage error's does not).
const rest = (message, status, code) =>
  Object.assign(new Error(message), { status, rejected: status >= 400 && status < 500 }, code ? { code } : {})
// An error as supabase-js hands it back from the database.
const db = (message, code) => ({ name: 'PostgrestError', message, details: null, hint: null, code })
// A failure with the name a browser gives it.
const named = (name, message) => Object.assign(new Error(message), { name })

describe('errorText: a refusal is shown as written', () => {
  it('from the public pages, where supabaseRest.js marks it `rejected`', () => {
    expect(errorText(rest('This call has closed.', 400), FALLBACK)).toBe('This call has closed.')
    expect(errorText(rest('Please answer: Why do you want to join', 400), FALLBACK)).toBe('Please answer: Why do you want to join')
  })

  it('from the public pages, by the code the database raised it with', () => {
    expect(errorText(rest('This call has closed.', 400, '22023'), FALLBACK)).toBe('This call has closed.')
    expect(errorText(rest('Please answer: Why do you want to join', 400, '22023'), FALLBACK)).toBe('Please answer: Why do you want to join')
    expect(errorText(rest('Too many orders right now, please retry shortly.', 400, '22023'), FALLBACK)).toBe(
      'Too many orders right now, please retry shortly.',
    )
    // PostgREST answers a 40001 with 500, so only the code says it is a refusal.
    expect(errorText(rest('Someone else saved this while you were editing. Reload to see their version before saving yours.', 500, '40001'), FALLBACK)).toBe(
      'Someone else saved this while you were editing. Reload to see their version before saving yours.',
    )
  })

  it('from the portal, by the codes the database raises its sentences with', () => {
    expect(errorText(db('A task holds up to 20 files. Remove one first.', '22023'), FALLBACK)).toBe('A task holds up to 20 files. Remove one first.')
    expect(errorText(db('"Spring GA" has already been applied. Undo it first, or give this one another name.', 'P0001'), FALLBACK)).toBe(
      '"Spring GA" has already been applied. Undo it first, or give this one another name.',
    )
    expect(errorText(db('The link /events/open-day already belongs to another event.', '23505'), FALLBACK)).toBe(
      'The link /events/open-day already belongs to another event.',
    )
    expect(errorText(db('Someone else saved this while you were editing. Reload to see their version before saving yours.', '40001'), FALLBACK)).toBe(
      'Someone else saved this while you were editing. Reload to see their version before saving yours.',
    )
  })

  it('whoever marked it, so a page can mark a sentence of its own', () => {
    expect(errorText(Object.assign(new Error('Choose an image under 5 MB.'), { rejected: true }), FALLBACK)).toBe('Choose an image under 5 MB.')
  })

  it('without the spaces around it', () => {
    expect(errorText(rest('  This call has closed.\n', 400), FALLBACK)).toBe('This call has closed.')
  })
})

describe('errorText: a request that got no answer', () => {
  it('reads the same in every browser', () => {
    expect(errorText(new TypeError('Failed to fetch'), FALLBACK)).toBe(UNREACHED)
    expect(errorText(new TypeError('NetworkError when attempting to fetch resource.'), FALLBACK)).toBe(UNREACHED)
    expect(errorText(new TypeError('Load failed'), FALLBACK)).toBe(UNREACHED)
    expect(errorText(new TypeError('fetch failed'), FALLBACK)).toBe(UNREACHED)
  })

  it('covers a request that was given up on', () => {
    expect(errorText(named('TimeoutError', 'signal timed out'), FALLBACK)).toBe(UNREACHED)
    expect(errorText(named('AbortError', 'The operation was aborted.'), FALLBACK)).toBe(UNREACHED)
  })

  it('covers what supabase-js makes of both', () => {
    expect(errorText(db('TypeError: Failed to fetch', ''), FALLBACK)).toBe(UNREACHED)
    expect(errorText(db('AbortError: signal is aborted without reason', ''), FALLBACK)).toBe(UNREACHED)
    expect(errorText({ name: 'StorageUnknownError', message: 'Failed to fetch' }, FALLBACK)).toBe(UNREACHED)
    expect(errorText({ name: 'AuthRetryableFetchError', message: 'x', status: 0 }, FALLBACK)).toBe(UNREACHED)
  })

  it('is one plain sentence in the house style', () => {
    expect(UNREACHED).toBe('We couldn’t reach the server. Check your connection and try again.')
  })
})

describe('errorText: no permission', () => {
  it('puts the server’s own words into plain ones', () => {
    expect(errorText(db('permission denied for table profiles', '42501'), FALLBACK)).toBe(NO_PERMISSION)
    expect(errorText(db('new row violates row-level security policy for table "task_files"', '42501'), FALLBACK)).toBe(NO_PERMISSION)
    expect(errorText(db('only the executive board can import the roster', '42501'), FALLBACK)).toBe(NO_PERMISSION)
    expect(errorText(rest('JWT expired', 401), FALLBACK)).toBe(NO_PERMISSION)
    expect(errorText(rest('', 403), FALLBACK)).toBe(NO_PERMISSION)
  })

  it('knows those words under any code or status', () => {
    expect(errorText(rest('new row violates row-level security policy', 400), FALLBACK)).toBe(NO_PERMISSION)
    expect(errorText({ name: 'StorageApiError', message: 'new row violates row-level security policy', status: 400 }, FALLBACK)).toBe(NO_PERMISSION)
    expect(errorText(db('New row violates row-level security policy.', '42501'), FALLBACK)).toBe(NO_PERMISSION)
  })

  it('keeps the database’s sentence when it wrote one', () => {
    expect(errorText(db('Only the Executive Board can roll the society over to a new term.', '42501'), FALLBACK)).toBe(
      'Only the Executive Board can roll the society over to a new term.',
    )
    expect(errorText(rest('Members only.', 401), FALLBACK)).toBe('Members only.')
  })
})

describe('errorText: anything else is the caller’s own words', () => {
  it('for a server fault', () => {
    expect(errorText(rest('Request failed (500)', 500), FALLBACK)).toBe(FALLBACK)
    expect(errorText(rest('profile 3f2a not found', 500), FALLBACK)).toBe(FALLBACK)
  })

  it('for a refusal that came with no sentence', () => {
    expect(errorText(rest('Request failed (404)', 404), FALLBACK)).toBe(FALLBACK)
    expect(errorText(rest('', 400), FALLBACK)).toBe(FALLBACK)
  })

  it('for Postgres’s own words', () => {
    expect(errorText(db('duplicate key value violates unique constraint "positions_committee_id_title_key"', '23505'), FALLBACK)).toBe(FALLBACK)
    expect(errorText(rest('duplicate key value violates unique constraint "signups_email_key"', 409), FALLBACK)).toBe(FALLBACK)
    expect(errorText(db('could not serialize access due to concurrent update', '40001'), FALLBACK)).toBe(FALLBACK)
    expect(errorText(db('null value in column "title" of relation "tasks" violates not-null constraint', '23502'), FALLBACK)).toBe(FALLBACK)
    expect(errorText(db('JSON object requested, multiple (or no) rows returned', 'PGRST116'), FALLBACK)).toBe(FALLBACK)
  })

  it('for PostgREST’s own words on the public pages, though supabaseRest.js marks every 4xx `rejected`', () => {
    expect(
      errorText(rest('Could not find the function public.submit_order(email, items, name) in the schema cache', 404, 'PGRST202'), FALLBACK),
    ).toBe(FALLBACK)
    expect(errorText(rest('null value in column "name" of relation "orders" violates not-null constraint', 400, '23502'), FALLBACK)).toBe(FALLBACK)
    expect(errorText(rest('invalid input syntax for type uuid: "7"', 400, '22P02'), FALLBACK)).toBe(FALLBACK)
    expect(errorText(rest('new row for relation "signups" violates check constraint "signups_kind_check"', 400, '23514'), FALLBACK)).toBe(FALLBACK)
    expect(errorText(rest('JSON object requested, multiple (or no) rows returned', 406, 'PGRST116'), FALLBACK)).toBe(FALLBACK)
    expect(errorText(rest('duplicate key value violates unique constraint "signups_email_key"', 409, '23505'), FALLBACK)).toBe(FALLBACK)
  })

  it('for a code that is no refusal, even on an error a page marked', () => {
    expect(errorText(Object.assign(new Error('unknown edition 7'), { rejected: true, code: 'P0002' }), FALLBACK)).toBe(FALLBACK)
  })

  it('for an error nobody marked, and for no error at all', () => {
    expect(errorText(new Error('Supabase is not configured'), FALLBACK)).toBe(FALLBACK)
    expect(errorText({}, FALLBACK)).toBe(FALLBACK)
    expect(errorText(null, FALLBACK)).toBe(FALLBACK)
    expect(errorText(undefined, FALLBACK)).toBe(FALLBACK)
    expect(errorText('Failed to fetch', FALLBACK)).toBe(FALLBACK)
  })

  it('has words of its own when the caller gives none', () => {
    expect(errorText(new Error('boom'))).toBe(WENT_WRONG)
    expect(WENT_WRONG).toBe('Something went wrong. Please try again.')
  })
})

describe('errorText: every sentence it writes ends with one full stop', () => {
  it('so nothing needs adding after it', () => {
    for (const text of [UNREACHED, NO_PERMISSION, WENT_WRONG]) expect(text).toMatch(/[^.]\.$/)
  })
})
