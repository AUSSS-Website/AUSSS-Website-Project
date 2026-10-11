import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorText } from './errorText.js'

// supabaseRest.js against a fetch that answers from a script: what it throws
// when the backend says no, which is what errorText.js then reads. Nothing
// here reaches the network.

const FALLBACK = 'Could not send it.'

// One answer as fetch gives it. A `body` that is not an object is sent as it
// is, for an error page that is not JSON.
function answer(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(status === 204 ? null : text, { status })
}

let rest
let calls

async function load(reply) {
  calls = []
  vi.stubGlobal('fetch', async (url, options) => {
    calls.push({ url, options })
    return reply()
  })
  rest = await import('./supabaseRest.js')
}

// What a call threw, or undefined when it did not.
async function thrownBy(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  return undefined
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://db.example.test/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'publishable-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('supabaseRest: a call that works', () => {
  it('posts an RPC’s arguments and hands back the answer', async () => {
    await load(() => answer(200, { ref: 'CALL-1' }))
    expect(await rest.restRpc('submit_application', { ref: 'CALL-1' })).toEqual({ ref: 'CALL-1' })
    expect(calls[0].url).toBe('https://db.example.test/rest/v1/rpc/submit_application')
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].options.body).toBe('{"ref":"CALL-1"}')
  })

  it('gives null for an answer with nothing in it', async () => {
    await load(() => answer(204))
    expect(await rest.restRpc('magazine_track', {})).toBeNull()
  })
})

describe('supabaseRest: the backend said no', () => {
  it('carries the sentence, the status and the database’s code', async () => {
    await load(() => answer(400, { code: '22023', details: null, hint: null, message: 'This call has closed.' }))
    const err = await thrownBy(rest.restRpc('submit_application', {}))
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('This call has closed.')
    expect(err.status).toBe(400)
    expect(err.rejected).toBe(true)
    expect(err.code).toBe('22023')
    expect(errorText(err, FALLBACK)).toBe('This call has closed.')
  })

  it('carries PostgREST’s own code, so its own words are not shown as a refusal', async () => {
    await load(() =>
      answer(404, {
        code: 'PGRST202',
        details: 'Searched for the function public.submit_order with parameter ref',
        hint: null,
        message: 'Could not find the function public.submit_order(ref) in the schema cache',
      }),
    )
    const err = await thrownBy(rest.restRpc('submit_order', { ref: 'AUSSS-1' }))
    expect(err.rejected).toBe(true)
    expect(err.code).toBe('PGRST202')
    expect(errorText(err, FALLBACK)).toBe(FALLBACK)
  })

  it('carries the code of a fault as well, though a fault is no refusal', async () => {
    await load(() => answer(500, { code: 'P0002', details: null, hint: null, message: 'unknown edition 7' }))
    const err = await thrownBy(rest.restRpc('magazine_track', {}))
    expect(err.status).toBe(500)
    expect(err.rejected).toBe(false)
    expect(err.code).toBe('P0002')
    expect(errorText(err, FALLBACK)).toBe(FALLBACK)
  })

  it('has no code when the answer gave none', async () => {
    await load(() => answer(400, { statusCode: '400', error: 'Duplicate', message: 'The resource already exists' }))
    const err = await thrownBy(rest.restUpload('receipts', 'orders/1/receipt.jpg', new Blob(['x'])))
    expect(err.message).toBe('The resource already exists')
    expect(err.rejected).toBe(true)
    expect('code' in err).toBe(false)
  })

  it('has its own stand-in words, and no code, for an answer that is not JSON', async () => {
    await load(() => answer(502, '<html>Bad gateway</html>'))
    const err = await thrownBy(rest.restSelect('site_settings', { select: 'key,value' }))
    expect(err.message).toBe('Request failed (502)')
    expect(err.status).toBe(502)
    expect(err.rejected).toBe(false)
    expect('code' in err).toBe(false)
    expect(errorText(err, FALLBACK)).toBe(FALLBACK)
  })

  it('ignores a code that is not text', async () => {
    await load(() => answer(400, { code: 400, message: 'Bad request' }))
    const err = await thrownBy(rest.restRpc('submit_signup', {}))
    expect('code' in err).toBe(false)
  })
})

describe('supabaseRest: a build without the env vars', () => {
  it('says so before asking anything', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    await load(() => answer(200, {}))
    expect(rest.supabaseRestEnabled).toBe(false)
    const err = await thrownBy(rest.restSelect('site_settings'))
    expect(err.message).toBe('Supabase is not configured')
    expect(calls).toEqual([])
  })
})
