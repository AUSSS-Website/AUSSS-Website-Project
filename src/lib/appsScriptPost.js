// Writes to the Apps Script backends.
//
// Apps Script answers a POST with a 302 to googleusercontent.com, and that
// second hop carries no CORS headers, so the browser can never read a POST's
// reply. Two helpers work around that:
//
//   appsScriptPost       fire-and-forget. The script runs (the sheet row and
//                        the email arrive); we just cannot read the reply.
//                        Orders, stories and sign-ups use this, and generate
//                        their reference on the client so the success screen,
//                        the sheet and the email all quote the same code.
//
//   appsScriptPostClaim  when the reply matters (the gallery admin key). The
//                        secret travels in the POST body, never the URL, and
//                        the backend stashes its JSON result under a one-time
//                        `nonce`. A follow-up GET ?action=claim&nonce=… reads
//                        it back; the only thing in that URL is a single-use,
//                        short-lived random value.

export async function appsScriptPost(url, payload) {
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  })
}

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

// Resolves with the backend's `{ ok: true, … }` payload, or throws. A thrown
// error carries `.rejected = true` when the backend explicitly said no (bad
// key), as opposed to a timeout or a network failure.
export async function appsScriptPostClaim(baseUrl, payload, { timeoutMs = 15000 } = {}) {
  const nonce = randomNonce()
  await appsScriptPost(baseUrl, { ...payload, nonce })

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
        // Not stored yet: the POST is still being processed (Apps Script
        // writes usually settle in 1 to 3 seconds). Keep polling.
        if (data && data.pending) {
          delay = Math.min(Math.round(delay * 1.4), 2000)
          continue
        }
        const err = new Error((data && data.error) || 'Request failed')
        err.rejected = true
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
