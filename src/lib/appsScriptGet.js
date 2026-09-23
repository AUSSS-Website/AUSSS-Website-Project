import { timeoutSignal } from './timeoutSignal.js'

// Shared GET helper for the Apps Script backends (gallery, magazine). Builds
// the query URL, enforces a request timeout, and turns transport errors
// (non-2xx) and payload errors ({ok:false}) into thrown Errors so callers need
// one catch. GET replies are readable across Apps Script's 302 redirect,
// unlike POSTs (see appsScriptPost.js).
export async function appsScriptGet(baseUrl, params, { timeoutMs = 10000 } = {}) {
  const url = new URL(baseUrl)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), {
    method: 'GET',
    signal: timeoutSignal(timeoutMs),
  })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  const data = await res.json()
  if (!data.ok) {
    // `rejected` lets callers tell "the backend said no" apart from transport
    // trouble (offline, timeout) caught above.
    const err = new Error(data.error || 'Request failed')
    err.rejected = true
    throw err
  }
  return data
}
