// The parts of scripts/exam-rehearsal.mjs that can be proven with no stack:
// the rule that keeps it on a local address, the token signing against known
// HS256 vectors, and the small helpers. Importing the script does not run it
// (the guard on its last lines); `npm test` picks this file up.
import { describe, expect, it } from 'vitest'
import { dice, hs256, localApi, readSettings, readToken, signToken, spread, tidyId } from './exam-rehearsal.mjs'

// The keys every local Supabase stack hands out by default. CLI 2.117 makes
// them as HS256({alg,typ}, {iss:'supabase-demo', role, exp:1983812996}) under
// the default JWT secret; a signer that reproduces them byte for byte signs
// what that stack accepts.
const LOCAL_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const LOCAL_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
// The hosted project's address, which the script must never accept.
const HOSTED = 'https://wjijkqrdaakiwbtdssio.supabase.co'

const good = { API_URL: 'http://127.0.0.1:54321', JWT_SECRET: LOCAL_SECRET, SERVICE_ROLE_KEY: LOCAL_SERVICE, ANON_KEY: LOCAL_ANON }
// Characters by their code points, so none that cannot be seen is in this file.
const chr = (...codes) => String.fromCodePoint(...codes)

describe('the rule that keeps the rehearsal off the hosted project', () => {
  it('takes 127.0.0.1 and localhost, and gives the origin to call', () => {
    expect(localApi('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321')
    expect(localApi(' http://localhost:54321/ ')).toBe('http://localhost:54321')
    expect(localApi('http://LOCALHOST:54321/rest/v1')).toBe('http://localhost:54321')
    expect(localApi('https://127.0.0.1:54321')).toBe('https://127.0.0.1:54321')
  })

  it.each([
    HOSTED,
    'https://ausss-ainshams.org',
    'http://localhost.evil.example:54321',
    'http://127.0.0.1.evil.example',
    'http://localhost@evil.example',
    'http://127.0.0.1:54321@evil.example/',
    'http://evil.example/?x=http://127.0.0.1',
    'http://evil.example#127.0.0.1',
    'http://192.168.1.10:54321',
    'http://0.0.0.0:54321',
    'http://[::1]:54321',
    'ftp://127.0.0.1',
    'file:///127.0.0.1',
    '127.0.0.1:54321',
    'localhost',
    '',
    undefined,
  ])('refuses %s', (address) => {
    expect(localApi(address)).toBe(null)
  })

  it('judges the address before anything else is read', () => {
    // not local, and no key at all: the refusal is about the address
    expect(() => readSettings({ API_URL: HOSTED })).toThrow(/not a local stack/)
    expect(() => readSettings({ ...good, API_URL: HOSTED })).toThrow(/not a local stack/)
    expect(() => readSettings({})).toThrow(/API_URL is not set/)
    expect(() => readSettings({ API_URL: 'http://localhost:54321' })).toThrow(
      /JWT_SECRET, SERVICE_ROLE_KEY \(or SECRET_KEY\), ANON_KEY \(or PUBLISHABLE_KEY\) are not set/,
    )
    expect(() => readSettings({ ...good, JWT_SECRET: '' })).toThrow(/JWT_SECRET is not set/)
  })
})

describe('the settings', () => {
  it('reads the names supabase status -o env prints, and the newer keys', () => {
    const s = readSettings(good)
    expect(s.api).toBe('http://127.0.0.1:54321')
    expect([s.takers, s.questions, s.concurrency]).toEqual([400, 100, 50])
    const newer = readSettings({
      API_URL: good.API_URL,
      JWT_SECRET: LOCAL_SECRET,
      SECRET_KEY: 'sb_secret_of-the-local-stack',
      PUBLISHABLE_KEY: 'sb_publishable_of-the-local-stack',
    })
    expect(newer.serviceKey).toBe('sb_secret_of-the-local-stack')
    expect(newer.anonKey).toBe('sb_publishable_of-the-local-stack')
    // the signed keys win when both are printed
    expect(readSettings({ ...good, SECRET_KEY: 'sb_secret_x', PUBLISHABLE_KEY: 'sb_publishable_x' }).serviceKey).toBe(LOCAL_SERVICE)
    // blank settings (a workflow input left empty) fall back to the defaults
    expect(readSettings({ ...good, TAKERS: '', QUESTIONS: ' ' }).takers).toBe(400)
    expect(readSettings({ ...good, TAKERS: '25', QUESTIONS: '10', CONCURRENCY: '5', SEED: '7' }).seed).toBe(7)
  })

  it('refuses values that do not belong together', () => {
    expect(() => readSettings({ ...good, JWT_SECRET: 'another-secret-of-at-least-32-characters' })).toThrow(/did not sign SERVICE_ROLE_KEY/)
    expect(() => readSettings({ ...good, SERVICE_ROLE_KEY: LOCAL_ANON })).toThrow(/role anon, not service_role/)
    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const es256 = `${part({ alg: 'ES256', typ: 'JWT', kid: 'k' })}.${part({ role: 'service_role' })}.sig`
    expect(() => readSettings({ ...good, SERVICE_ROLE_KEY: es256 })).toThrow(/signed with ES256, not HS256/)
    expect(() => readSettings({ ...good, TAKERS: '0' })).toThrow(/TAKERS must be a whole number from 1 to 5000/)
    expect(() => readSettings({ ...good, CONCURRENCY: '2.5' })).toThrow(/CONCURRENCY must be a whole number/)
    expect(() => readSettings({ ...good, QUESTIONS: 'many' })).toThrow(/QUESTIONS must be a whole number/)
  })
})

describe('the tokens it signs', () => {
  it('signs as RFC 7515 appendix A.1 does', () => {
    // The header and payload are the RFC's own octets (with its line breaks),
    // so they are signed as given and not rebuilt from JSON.
    const input =
      'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
      '.' +
      'eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ'
    const key = Buffer.from(
      'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
      'base64url',
    )
    expect(hs256(input, key)).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
  })

  it('makes a whole token: the jwt.io example', () => {
    expect(signToken({ sub: '1234567890', name: 'John Doe', iat: 1516239022 }, 'your-256-bit-secret')).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    )
  })

  it('reproduces the local stack’s own default keys', () => {
    expect(signToken({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 }, LOCAL_SECRET)).toBe(LOCAL_ANON)
    expect(signToken({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 }, LOCAL_SECRET)).toBe(LOCAL_SERVICE)
  })

  it('reads a token’s parts and checks who signed it', () => {
    const token = readToken(LOCAL_SERVICE)
    expect(token.header.alg).toBe('HS256')
    expect(token.claims.role).toBe('service_role')
    expect(token.signedBy(LOCAL_SECRET)).toBe(true)
    expect(token.signedBy('another-secret-of-at-least-32-characters')).toBe(false)
    expect(readToken('sb_secret_of-the-local-stack')).toBe(null)
    expect(readToken('a.b.c')).toBe(null)
    expect(readToken(undefined)).toBe(null)
    // a taker's token as the script makes it
    const claims = { sub: 'u1', role: 'authenticated', aud: 'authenticated', email: 'a@b.test', exp: 2 }
    const taker = readToken(signToken(claims, LOCAL_SECRET))
    expect(taker.claims).toEqual(claims)
    expect(taker.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(taker.signedBy(LOCAL_SECRET)).toBe(true)
  })
})

describe('the small helpers', () => {
  it('tidies an ID as app.tidy_student_id does', () => {
    // the cases of the contract: Arabic numerals with a space, and a hyphen
    expect(tidyId(`${chr(0x662, 0x660, 0x662, 0x663)} 1234`)).toBe('20231234')
    expect(tidyId('2023-1234')).toBe('20231234')
    expect(tidyId(`${chr(0x6f2, 0x6f0, 0x6f2, 0x6f3)}/12.34`)).toBe('20231234') // Persian digits
    expect(tidyId(' m_2026\\0001 ')).toBe('M20260001')
    expect(tidyId(`M${chr(0xa0)}20${chr(0x200b)}26${chr(0x200f)}-00${chr(0xfeff)}01`)).toBe('M20260001')
    // pasted from a document: an en dash, a minus sign, full-width digits, direction marks round it
    expect(tidyId(`2023${chr(0x2013)}1234`)).toBe('20231234')
    expect(tidyId(`2023${chr(0x2212)}1234`)).toBe('20231234')
    expect(tidyId(`${chr(0xff12, 0xff10, 0xff12, 0xff13)}1234`)).toBe('20231234')
    expect(tidyId(`${chr(0x202a)}2023${chr(0xad)}12${chr(0x2060)}34${chr(0x202c)}`)).toBe('20231234')
    expect(tidyId(`2023${chr(0x2009)}12${chr(0x3000)}34`)).toBe('20231234')
    expect(tidyId(null)).toBe('')
    expect(tidyId(' - . ')).toBe('')
  })

  it('gives the median, the 95th percentile and the slowest', () => {
    expect(spread([])).toEqual({ count: 0, median: 0, p95: 0, slowest: 0 })
    expect(spread([5])).toEqual({ count: 1, median: 5, p95: 5, slowest: 5 })
    expect(spread([4, 1, 3, 2])).toEqual({ count: 4, median: 2.5, p95: 4, slowest: 4 })
    const hundred = Array.from({ length: 100 }, (_, i) => 100 - i)
    expect(spread(hundred)).toEqual({ count: 100, median: 50.5, p95: 95, slowest: 100 })
  })

  it('plays the same parts again from the same seed', () => {
    const a = dice(42)
    const b = dice(42)
    expect(Array.from({ length: 20 }, () => a.below(1000))).toEqual(Array.from({ length: 20 }, () => b.below(1000)))
    expect(dice(1).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])).not.toEqual(dice(2).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    expect([...dice(9).shuffle([1, 2, 3, 4, 5])].sort()).toEqual([1, 2, 3, 4, 5])
    for (let i = 0; i < 200; i += 1) {
      const n = a.next()
      expect(n >= 0 && n < 1).toBe(true)
    }
  })
})
