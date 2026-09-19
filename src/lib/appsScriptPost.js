// Secure write helper for the Apps Script backends.
//
// Apps Script POST replies aren't readable cross-origin (the 302 → google
// usercontent redirect drops the CORS headers on POST), which is the whole
// reason the older flows smuggled secrets, passwords, the gallery admin key,
// session tokens, through the GET *query string*, where they leak into
// browser history, devtools, and Google's request logs.
//
// This helper fixes that without losing the reply: the secret travels in the
// POST *body* (unlogged), and the backend stashes its JSON result under a
// client-chosen one-time `nonce`. We then read the result with a follow-up
// GET ?action=claim&nonce=…, the only thing in that URL is a single-use,
// ~2-minute-lived random value that is worthless to anyone reading the logs.
//
// Requires the matching `claim` support in the .gs backends (officers.gs /
// gallery.gs). Callers should fall back to the legacy GET path when the
// backend reports an unknown action, so a new client keeps working against an
// not-yet-redeployed backend (see useGalleryRemovals).

const UNKNOWN_ACTION = 'Unknown action'

function randomNonce() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '')
    }
  } catch {
    /* fall through */
  }
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fire a no-cors POST whose JSON reply is retrieved via a follow-up
 * GET ?action=claim&nonce=…. Resolves with the backend's `{ ok: true, … }`
 * payload, or throws. A thrown error carries `.rejected = true` and
 * `.code = <backend error string>` when the backend explicitly said no, which
 * lets callers detect `Unknown action` and fall back to the legacy GET path.
 *
 * @param {string} baseUrl   the /exec endpoint
 * @param {object} payload   POSTed as JSON (the `nonce` is added for you)
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function appsScriptPostClaim(baseUrl, payload, { timeoutMs = 15000 } = {}) {
  const nonce = randomNonce()
  await fetch(baseUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, nonce }),
  })

  const deadline = Date.now() + timeoutMs
  let delay = 600
  let lastTransient
  while (Date.now() < deadline) {
    await sleep(delay)
    try {
      const url = new URL(baseUrl)
      url.searchParams.set('action', 'claim')
      url.searchParams.set('nonce', nonce)
      const res = await fetch(url.toString(), { method: 'GET' })
      if (res.ok) {
        const data = await res.json()
        if (data && data.ok) return data
        // Result not stored yet → the POST is still being processed. Keep
        // polling (Apps Script writes typically settle in 1–3s).
        if (data && data.pending) {
          delay = Math.min(Math.round(delay * 1.4), 2000)
          continue
        }
        // An explicit rejection (bad password/key, or an old backend that
        // doesn't know `claim`). Surface it so the caller can fall back.
        const err = new Error((data && data.error) || 'Request failed')
        err.rejected = true
        err.code = data && data.error
        throw err
      }
    } catch (err) {
      if (err.rejected) throw err
      lastTransient = err // network blip, keep polling until the deadline
    }
    delay = Math.min(Math.round(delay * 1.4), 2000)
  }
  throw lastTransient || new Error('Request timed out')
}

export { UNKNOWN_ACTION }
