// Anonymous reads, the anonymous RPCs and the one anonymous upload the PUBLIC
// site makes against Supabase, over plain fetch.
//
// WHY not supabase-js: the public bundle must stay free of it (see
// src/lib/supabase.js, which only src/auth/** and src/portal/** import).
// PostgREST is a plain HTTP API, so the handful of GETs the marketing pages
// need (site settings, committee page overrides, open calls) and the public
// writes (an application, a sign-up, a story, an order and its receipt) fit
// in under a hundred lines. Row-level security does the gatekeeping; the
// publishable key only identifies the project.
//
// Every function throws on transport or API errors so callers keep a single
// catch.
import { timeoutSignal } from './timeoutSignal.js'

const BASE = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// False on a build without the env vars (local without .env.local). Callers
// then fall back to their static defaults.
export const supabaseRestEnabled = Boolean(BASE && KEY)

// `keepalive` lets a small request outlive the page (a last "how far did they
// read" beacon on pagehide); browsers cap such bodies at about 64 KB.
async function request(path, { method = 'GET', body, timeoutMs = 10000, headers = {}, keepalive = false, api = 'rest/v1' } = {}) {
  if (!supabaseRestEnabled) throw new Error('Supabase is not configured')
  const raw = body instanceof Blob
  const res = await fetch(`${BASE}/${api}/${path}`, {
    method,
    keepalive,
    signal: timeoutSignal(timeoutMs),
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
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
    // "The backend said no" (a refusal to show as-is) vs transport trouble.
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

// POST /storage/v1/object/<bucket>/<path> with a Blob body. Only works where a
// Storage policy lets anon insert (the merch receipt, one file per fresh order).
export function restUpload(bucket, path, blob, contentType = 'application/octet-stream') {
  return request(`object/${bucket}/${path}`, {
    method: 'POST',
    api: 'storage/v1',
    body: blob,
    timeoutMs: 30000,
    headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
  })
}
