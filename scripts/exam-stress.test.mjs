import { describe, expect, it } from 'vitest'
import { REALM, codeFor, emailOf, fakeProvider } from './exam-fake-provider.mjs'
import { signToken } from './exam-rehearsal.mjs'
import { failureKind, marksOf, readSettings, retryDelay, spreadOf } from './exam-stress.mjs'

// The parts of the stress test that need no stack: where it may run, how it
// reads a failed call, how it marks a paper, and the stand-in for Google.

const REF = 'abcdefghijklmnopqrst'
const liveEnv = {
  VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_SECRET_KEY: 'sb_secret_made_up',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_made_up',
}
const localEnv = {
  API_URL: 'http://127.0.0.1:54321',
  JWT_SECRET: 'a-secret-of-at-least-thirty-two-characters',
  SERVICE_ROLE_KEY: 'service',
  ANON_KEY: 'anon',
}

describe('where the stress test may run', () => {
  it('takes a local stack from the values the stack prints', () => {
    const cfg = readSettings([], localEnv)
    expect(cfg).toMatchObject({ live: false, api: 'http://127.0.0.1:54321', takers: 400, minutes: 5, lead: 75, spikeRounds: 10, provider: '', onlySignIn: false })
  })

  it('refuses an address that is not a local stack unless it is told to go to the live project', () => {
    expect(() => readSettings([], { ...localEnv, API_URL: `https://${REF}.supabase.co` })).toThrow(/not a local stack/)
    expect(() => readSettings([], {})).toThrow(/API_URL is not set/)
    expect(() => readSettings([], { ...localEnv, JWT_SECRET: '' })).toThrow(/must be set/)
  })

  it('goes to the live project only with its ref typed out, the same ref in the environment, and --yes', () => {
    expect(readSettings(['--live', REF, '--yes'], liveEnv)).toMatchObject({ live: true, ref: REF, api: `https://${REF}.supabase.co`, minutes: 20, lead: 150 })
    expect(() => readSettings(['--live', REF], liveEnv)).toThrow(/also takes --yes/)
    expect(() => readSettings(['--live'], liveEnv)).toThrow(/project ref, typed out/)
    expect(() => readSettings(['--live', 'not-a-ref', '--yes'], liveEnv)).toThrow(/project ref, typed out/)
    // the ref typed is not the project the environment holds
    expect(() => readSettings(['--live', 'zzzzzzzzzzzzzzzzzzzz', '--yes'], liveEnv)).toThrow(/is not that project's: nothing was sent/)
    expect(() => readSettings(['--live', REF, '--yes'], {})).toThrow(/nothing was sent/)
  })

  it('cleans up on the live project without --yes, since it only removes what stress runs left', () => {
    expect(readSettings(['--live', REF, '--clean'], liveEnv)).toMatchObject({ live: true, clean: true })
  })

  it('refuses a publishable key where the secret key belongs', () => {
    expect(() => readSettings(['--live', REF, '--yes'], { ...liveEnv, SUPABASE_SECRET_KEY: 'sb_publishable_made_up' })).toThrow(/publishable key/)
    const anon = signToken({ role: 'anon' }, 'whatever')
    expect(() => readSettings(['--live', REF, '--yes'], { ...liveEnv, SUPABASE_SECRET_KEY: anon })).toThrow(/publishable key/)
    expect(() => readSettings(['--live', REF, '--yes'], { ...liveEnv, VITE_SUPABASE_ANON_KEY: '' })).toThrow(/must both be set/)
  })

  it('never uses a stand-in for Google on the live project', () => {
    expect(() => readSettings(['--live', REF, '--yes'], { ...liveEnv, PROVIDER: 'keycloak' })).toThrow(/throwaway stack only/)
    expect(readSettings([], { ...localEnv, PROVIDER: 'keycloak', ONLY_SIGN_IN: '1' })).toMatchObject({ provider: 'keycloak', onlySignIn: true })
    expect(() => readSettings([], { ...localEnv, PROVIDER: 'key cloak' })).toThrow(/provider's name/)
  })

  it('reads its numbers and refuses ones that make no exam', () => {
    expect(readSettings([], { ...localEnv, TAKERS: '30', EXAM_MINUTES: '8', SPIKE_ROUNDS: '0', LEAD_SECONDS: '40', SEED: '7' })).toMatchObject({
      takers: 30,
      minutes: 8,
      spikeRounds: 0,
      lead: 40,
      seed: 7,
    })
    // an exam is at least five minutes long
    expect(() => readSettings([], { ...localEnv, EXAM_MINUTES: '2' })).toThrow(/EXAM_MINUTES must be a whole number from 5/)
    expect(() => readSettings([], { ...localEnv, TAKERS: 'many' })).toThrow(/TAKERS/)
    expect(() => readSettings([], { ...localEnv, TAKERS: '5000' })).toThrow(/TAKERS/)
    expect(() => readSettings([], { ...localEnv, SITE: 'ausss-ainshams.org' })).toThrow(/SITE/)
  })
})

describe('a failed call', () => {
  it('is read as the page reads it', () => {
    expect(failureKind('22023', 400)).toBe('refused')
    expect(failureKind('23505', 409)).toBe('refused')
    expect(failureKind('42501', 403)).toBe('signed_out')
    expect(failureKind(undefined, 401)).toBe('signed_out')
    expect(failureKind('PGRST301', 401)).toBe('signed_out')
    expect(failureKind(undefined, 500)).toBe('offline')
    expect(failureKind('PGRST202', 404)).toBe('offline')
  })

  it('is tried again after 2, 5 and 10 seconds, then every 15', () => {
    expect([1, 2, 3, 4, 9].map(retryDelay)).toEqual([2000, 5000, 10000, 15000, 15000])
    expect(retryDelay(0)).toBe(2000)
  })
})

describe('the timings', () => {
  it('give the median, the 95th and 99th percentiles and the slowest', () => {
    const list = Array.from({ length: 200 }, (_, i) => i + 1)
    expect(spreadOf(list)).toEqual({ count: 200, median: 100.5, p95: 190, p99: 198, slowest: 200 })
    expect(spreadOf([7])).toEqual({ count: 1, median: 7, p95: 7, p99: 7, slowest: 7 })
    expect(spreadOf([])).toEqual({ count: 0, median: 0, p95: 0, p99: 0, slowest: 0 })
  })
})

describe('marking a paper', () => {
  const questions = new Map([
    ['s1', { section: 'shared', correct: 0 }],
    ['s2', { section: 'shared', correct: 1 }],
    ['p1', { section: 'scope', correct: 2 }],
    ['r1', { section: 'score', correct: 3 }],
  ])
  // both shared right, the professional one right, the research one wrong
  const answers = new Map([['s1', 0], ['s2', 1], ['p1', 2], ['r1', 0]])

  it('gives a mark for the shared questions and for each block the paper sits', () => {
    expect(marksOf(answers, questions, { scope: true, score: true })).toEqual({ shared: 2, answered: 4, scope: 1, score: 0, totalScope: 3, totalScore: 2 })
  })

  it('counts nothing of a block the paper does not sit, though the answer is there', () => {
    expect(marksOf(answers, questions, { scope: true, score: false })).toEqual({ shared: 2, answered: 3, scope: 1, score: null, totalScope: 3, totalScore: null })
    expect(marksOf(answers, questions, { scope: false, score: true })).toEqual({ shared: 2, answered: 3, scope: null, score: 0, totalScope: null, totalScore: 2 })
  })

  it('takes a cleared answer and an answer to no question of the exam as nothing', () => {
    const more = new Map([['s1', null], ['s2', 1], ['zz', 0]])
    expect(marksOf(more, questions, { scope: true, score: true })).toEqual({ shared: 1, answered: 1, scope: 0, score: 0, totalScope: 1, totalScore: 1 })
  })

  it('marks an exam with no blocks as one grade', () => {
    const plain = new Map([['s1', { section: 'shared', correct: 0 }]])
    expect(marksOf(new Map([['s1', 0]]), plain, { scope: false, score: false })).toEqual({ shared: 1, answered: 1, scope: null, score: null, totalScope: null, totalScore: null })
  })
})

describe('the stand-in for Google', () => {
  it('turns an address into a code and back, and takes nothing else for a code', () => {
    const email = 'stress-taker-0001.abcd1234@exam-stress.test'
    expect(emailOf(codeFor(email))).toBe(email)
    expect(emailOf('')).toBe('')
    expect(emailOf(codeFor('not an address'))).toBe('')
    expect(emailOf(undefined)).toBe('')
  })

  it('answers the three parts of the exchange the sign-in service uses', async () => {
    const { server, seen } = fakeProvider()
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
    const at = `http://127.0.0.1:${server.address().port}${REALM}/protocol/openid-connect`
    try {
      const email = 'someone@exam-stress.test'
      // the phone is sent back with the code of the account it said it was
      const out = await fetch(`${at}/auth?redirect_uri=${encodeURIComponent('http://127.0.0.1:54321/auth/v1/callback')}&state=abc&login_hint=${encodeURIComponent(email)}`, { redirect: 'manual' })
      const back = new URL(out.headers.get('location'))
      expect(out.status).toBe(302)
      expect(back.pathname).toBe('/auth/v1/callback')
      expect(back.searchParams.get('state')).toBe('abc')
      expect(emailOf(back.searchParams.get('code'))).toBe(email)
      // the code for a token
      const token = await (await fetch(`${at}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: codeFor(email) }) })).json()
      expect(token).toMatchObject({ access_token: codeFor(email), token_type: 'Bearer' })
      expect((await fetch(`${at}/token`, { method: 'POST', body: new URLSearchParams({ code: 'nonsense' }) })).status).toBe(400)
      // the token for who it is
      const who = await (await fetch(`${at}/userinfo`, { headers: { authorization: `Bearer ${token.access_token}` } })).json()
      expect(who).toMatchObject({ email, email_verified: true })
      expect(who.sub).toBeTruthy()
      expect((await fetch(`${at}/userinfo`)).status).toBe(401)
      expect(seen).toEqual({ token: 1, userinfo: 1 })
    } finally {
      server.close()
    }
  })
})
