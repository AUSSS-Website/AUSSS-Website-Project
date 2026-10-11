import { describe, expect, it, vi } from 'vitest'

// rosterQueries.js builds the portal's database client as it loads. The checks
// here are of what it and constants.js work out by themselves, so the client
// is left out.
vi.mock('../lib/supabase.js', () => ({ supabase: null, supabaseEnabled: false }))

import { dismissedLine, reinstatedLine } from './rosterQueries.js'
import { DISMISSED_STATUS, PRESIDENT_KEY, ROSTER_STATUSES, holdsPresidency, isDismissed } from './constants.js'

const holding = (key, level) => ({ id: `a-${key}`, status: 'active', position: { key, level } })

describe('holdsPresidency: who is shown Dismiss member and Reinstate', () => {
  it('is true for the account that holds the President’s position', () => {
    expect(PRESIDENT_KEY).toBe('eb.president')
    expect(holdsPresidency([holding('eb.president', 'eb')])).toBe(true)
  })

  it('is false for the rest of the Executive Board and for the webmaster', () => {
    expect(holdsPresidency([holding('eb.vp-internal', 'eb')])).toBe(false)
    expect(holdsPresidency([holding('eb.secretary-general', 'eb'), holding('eb.president-assistant', 'assistant')])).toBe(false)
    expect(holdsPresidency([holding('society.webmaster', 'webmaster')])).toBe(false)
  })

  it('is false for an officer, for a member and with nothing to go on', () => {
    expect(holdsPresidency([holding('scope.leo-in', 'officer')])).toBe(false)
    expect(holdsPresidency([])).toBe(false)
    expect(holdsPresidency(undefined)).toBe(false)
    expect(holdsPresidency([{ id: 'a', position: null }, null])).toBe(false)
  })
})

describe('isDismissed', () => {
  it('goes by the date of the dismissal, not by the status text', () => {
    expect(isDismissed({ status: DISMISSED_STATUS, dismissed_at: '2026-10-12T09:00:00Z' })).toBe(true)
    expect(isDismissed({ status: DISMISSED_STATUS, dismissed_at: null })).toBe(false)
    expect(isDismissed({ status: 'Full Member' })).toBe(false)
    expect(isDismissed(null)).toBe(false)
  })
})

describe('the statuses the board can choose', () => {
  it('do not include Dismissed', () => {
    expect(ROSTER_STATUSES).not.toContain(DISMISSED_STATUS)
    expect(ROSTER_STATUSES.some((s) => /dismiss/i.test(s))).toBe(false)
  })
})

describe('dismissedLine: what the row says once a member is dismissed', () => {
  it('says so when no portal account belonged to the row', () => {
    expect(dismissedLine({ accounts: 0, positions_ended: 0 })).toBe('Dismissed. No portal account belongs to this row.')
  })

  it('names the account, and the positions that ended with it', () => {
    expect(dismissedLine({ accounts: 1, positions_ended: 0 })).toBe('Dismissed. Their portal account is unverified again.')
    expect(dismissedLine({ accounts: 1, positions_ended: 1 })).toBe(
      'Dismissed. Their portal account is unverified again and 1 position has ended.',
    )
    expect(dismissedLine({ accounts: 1, positions_ended: 3 })).toBe(
      'Dismissed. Their portal account is unverified again and 3 positions have ended.',
    )
  })

  it('still says Dismissed when the answer holds no counts', () => {
    expect(dismissedLine(null)).toBe('Dismissed. No portal account belongs to this row.')
    expect(dismissedLine({})).toBe('Dismissed. No portal account belongs to this row.')
  })
})

describe('reinstatedLine: what the row says once a member is reinstated', () => {
  it('names the status that came back, and says what did not', () => {
    expect(reinstatedLine({ status: 'Full Member' })).toBe(
      'Reinstated as Full Member. Portal access and positions are not given back.',
    )
  })

  it('leaves the status out when the row had none', () => {
    expect(reinstatedLine({ status: null })).toBe('Reinstated. Portal access and positions are not given back.')
    expect(reinstatedLine(undefined)).toBe('Reinstated. Portal access and positions are not given back.')
  })
})
