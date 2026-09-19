// Anonymous reads (and the one anonymous RPC) the PUBLIC site makes against
// Supabase, over plain fetch.
//
// WHY not supabase-js: the public bundle must stay free of it (see
// src/lib/supabase.js, which only src/auth/** and src/portal/** import).
// PostgREST is a plain HTTP API, so the handful of GETs the marketing pages
// need (site settings, committee page overrides, open calls) and the one
// public write (submitting an application) fit in ~50 lines. Row-level
// security does the gatekeeping; the publishable key only identifies the
// project.
//
// Every function throws on transport or API errors so callers keep the same
// single-catch shape they had with appsScriptGet.

const BASE = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// False on a build without the env vars (local without .env.local). Callers
// then fall back to their static defaults, exactly as when officers.gs was
// unconfigured.
export const supabaseRestEnabled = Boolean(BASE && KEY)

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(ms)
  }
  if (typeof AbortController !== 'undefined') {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), ms)
    return ctrl.signal
  }
  return undefined
}

async function request(path, { method = 'GET', body, timeoutMs = 10000, headers = {} } = {}) {
  if (!supabaseRestEnabled) throw new Error('Supabase is not configured')
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    signal: timeoutSignal(timeoutMs),
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const err = await res.json()
      // PostgREST: {message, details, hint, code}; raised exceptions land in message.
      if (err && typeof err.message === 'string' && err.message) message = err.message
    } catch {
      /* non-JSON error body */
    }
    const error = new Error(message)
    error.status = res.status
    // Same flag appsScriptGet sets: "the backend said no" vs transport trouble.
    error.rejected = res.status >= 400 && res.status < 500
    throw error
  }
  if (res.status === 204) return null
  return res.json()
}

// GET /rest/v1/<table>?<query>. `query` is a plain object of PostgREST params
// (select, order, filters like `status: 'eq.open'`).
export function restSelect(table, query = {}, opts) {
  const qs = new URLSearchParams(query).toString()
  return request(`${table}${qs ? `?${qs}` : ''}`, opts)
}

// POST /rest/v1/rpc/<fn> with named arguments. Returns the function result.
export function restRpc(fn, args = {}, opts) {
  return request(`rpc/${fn}`, { method: 'POST', body: args, ...opts })
}
