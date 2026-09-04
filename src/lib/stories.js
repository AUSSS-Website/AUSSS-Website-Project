import { STORIES_WEBAPP_URL } from '../data/storiesConfig.js'
import { makeReference } from './reference.js'

// ── Exchange-story submission ──────────────────────────────────────────────
//
// Two paths (same design as src/lib/orders.js):
//   • Live: POSTs JSON to the deployed Apps Script web app.
//   • Stub (no URL yet): logs the payload to the console and returns a fake
//     reference so the UX can be reviewed in dev without a backend.
//
// Returns: { ok: true, reference }  on success
//          { ok: false, error }    on failure

const REFERENCE_PREFIX = 'STORY'

export async function submitStory(payload) {
  // payload shape:
  //   { name, email, phone, destination, programme, year, story }

  // The reference is generated client-side and shipped *to* the script, for
  // the same reason as orders.js: Apps Script's POST → 302 redirect strips
  // CORS headers, so the browser can't read the response across the hop.
  // Generating it here keeps the success page, sheet row, and email aligned.
  const reference = makeReference(REFERENCE_PREFIX)

  const enriched = {
    ...payload,
    reference,
    submittedAt: new Date().toISOString(),
  }

  if (!STORIES_WEBAPP_URL) {
    // Stub path, used in dev when STORIES_WEBAPP_URL is empty.
    // eslint-disable-next-line no-console
    console.info('[stories] stub submit', enriched)
    await new Promise((r) => setTimeout(r, 700)) // mimic network latency
    return { ok: true, reference, stub: true }
  }

  try {
    // mode: 'no-cors' = fire-and-forget. The script runs (the email arrives);
    // the browser just can't read the JSON response across the redirect. The
    // opaque response is fine, we already know the reference.
    await fetch(STORIES_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(enriched),
    })
    return { ok: true, reference }
  } catch (err) {
    // Only thrown on true network-level failures (DNS, offline, etc.).
    return { ok: false, error: err.message || 'Network error' }
  }
}
