import { beforeEach, describe, expect, it, vi } from 'vitest'

// membership.js asks the database through supabaseRest.js. Here that file is
// replaced by a script of answers, so nothing reaches the network and each
// check is of what lookupMember makes of one answer.
const rest = vi.hoisted(() => ({ answer: null, sent: [] }))
vi.mock('./supabaseRest.js', () => ({
  supabaseRestEnabled: true,
  restRpc: async (name, args) => {
    rest.sent.push({ name, args })
    if (rest.answer instanceof Error) throw rest.answer
    return rest.answer
  },
}))

import { MEMBERSHIP_ENDED, NOT_A_MEMBER, adviceFor, lookupMember } from './membership.js'

beforeEach(() => {
  rest.answer = null
  rest.sent = []
})

describe('lookupMember: a membership that has ended', () => {
  it('answers with the state and nothing else', async () => {
    rest.answer = { state: 'ended' }
    expect(await lookupMember({ email: 'someone@example.com' })).toEqual({ state: 'ended' })
  })

  it('drops whatever else such an answer carries', async () => {
    // The database sends the state alone. If an answer ever came with more,
    // none of it may reach a page.
    rest.answer = {
      state: 'ended',
      record: { status: 'Dismissed', yearJoined: '2023', currentPosition: 'Core Team Member' },
      reason: 'Something nobody outside the board reads.',
      dismissed_at: '2026-10-12T09:00:00Z',
    }
    const result = await lookupMember({ name: 'Sample Member' })
    expect(result).toEqual({ state: 'ended' })
    expect(Object.keys(result)).toEqual(['state'])
  })

  it('offers no "did you mean" for it, even beside a mistyped domain', async () => {
    rest.answer = { state: 'ended' }
    expect(await lookupMember({ email: 'someone@gmial.com' })).toEqual({ state: 'ended' })
  })
})

describe('MEMBERSHIP_ENDED: what the page says', () => {
  const words = `${MEMBERSHIP_ENDED.title} ${MEMBERSHIP_ENDED.body}`

  it('says that the membership has ended', () => {
    expect(MEMBERSHIP_ENDED.title).toBe('This membership has ended')
    expect(MEMBERSHIP_ENDED.body).toMatch(/^[A-Z].*\.$/)
  })

  it('says nothing of a dismissal, of discipline or of a reason', () => {
    expect(words).not.toMatch(/dismiss|suspend|disciplin|expel|remov|revok|terminat|reason|breach|conduct/i)
  })

  it('cites no section of the Constitution', () => {
    expect(words).not.toMatch(/§|\bsection\b|\bbylaw/i)
  })
})

describe('lookupMember: the answers it had before', () => {
  it('hands a found member their record, with a default for an empty position', async () => {
    rest.answer = {
      state: 'found',
      record: { status: 'Full Member', yearJoined: '2023', yearsSpent: '3', lgas: '>2', ngas: '', currentPosition: '  ' },
    }
    expect(await lookupMember({ name: '  Sample Member ' })).toEqual({
      state: 'found',
      record: { status: 'Full Member', yearJoined: '2023', yearsSpent: '3', lgas: '>2', ngas: '', currentPosition: 'General Member' },
    })
    expect(rest.sent).toEqual([{ name: 'check_membership', args: { name: 'Sample Member', email: '' } }])
  })

  it('passes the role and the confirmed hint on only when they are given', async () => {
    rest.answer = { state: 'not-found' }
    await lookupMember({ email: 'a@example.com', role: 'supervising-council', acceptNear: true })
    expect(rest.sent[0].args).toEqual({ name: '', email: 'a@example.com', role: 'supervising-council', accept_near: true })
  })

  it('says when a name is shared', async () => {
    rest.answer = { state: 'ambiguous' }
    expect(await lookupMember({ name: 'Sample Member' })).toEqual({ state: 'ambiguous' })
  })

  it('keeps the suggestions of a miss, and puts a mistyped domain first', async () => {
    rest.answer = { state: 'not-found', suggestions: { names: ['Sample Member'] } }
    expect(await lookupMember({ name: 'Sampel Member' })).toEqual({
      state: 'not-found',
      suggestions: { names: ['Sample Member'] },
    })
    expect(await lookupMember({ email: 'someone@gmial.com' })).toEqual({
      state: 'not-found',
      suggestions: { fixedEmail: 'someone@gmail.com' },
    })
  })

  it('treats an answer it does not know as a miss', async () => {
    rest.answer = { state: 'something-new' }
    expect(await lookupMember({ name: 'Sample Member' })).toEqual({ state: 'not-found', suggestions: null })
  })

  it('shows the roster’s own refusal as written, and its own words for anything else', async () => {
    rest.answer = Object.assign(new Error('Too many lookups right now, please retry in a few minutes.'), {
      code: '22023',
      rejected: true,
      status: 400,
    })
    expect(await lookupMember({ name: 'Sample Member' })).toEqual({
      state: 'error',
      message: 'Too many lookups right now, please retry in a few minutes.',
    })
    rest.answer = new Error('Request failed (500)')
    expect(await lookupMember({ name: 'Sample Member' })).toEqual({
      state: 'error',
      message: 'We couldn’t check the membership list. Please try again in a moment.',
    })
  })
})

describe('adviceFor', () => {
  it('reads a tier from the status text, and what it takes to reach the next', () => {
    const advice = adviceFor({ status: 'Candidate Member', lgas: '1', ngas: '0' })
    expect(advice.tierLabel).toBe('Candidate Member')
    expect(advice.next).toBe('Associate Member')
    expect(advice.progress.map((p) => [p.label, p.have, p.need])).toEqual([
      ['Local GAs attended', '1', 1],
      ['National GAs attended', '0', 2],
    ])
  })

  it('has steps for somebody who is not a member yet', () => {
    expect(NOT_A_MEMBER.steps.length).toBeGreaterThan(0)
  })
})
