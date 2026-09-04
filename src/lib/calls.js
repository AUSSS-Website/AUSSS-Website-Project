import { OFFICERS_WEBAPP_URL, callsLiveEnabled } from '../data/officersConfig.js'
import { appsScriptGet } from './appsScriptGet.js'
import { appsScriptPostClaim } from './appsScriptPost.js'
import { makeReference } from './reference.js'

// ── Open Calls ─────────────────────────────────────────────────────────────
//
// Officers publish recruitment calls for their committee; visitors apply from
// the committee page. The backend is apps-script/officers.gs (same script, so
// officer tokens validate), see the "Open Calls" block there.
//
// Two transports, chosen by what's in the payload:
//   • The public list is a plain GET (readable across Apps Script's 302).
//   • Everything carrying a token or personal data is POST + claim, so it
//     never lands in a URL. See src/lib/appsScriptPost.js for why.
//
// Every function resolves to { ok: true, … } or { ok: false, error } so call
// sites need one branch, not a try/catch each.

const REFERENCE_PREFIX = 'CALL'

async function post(payload) {
  if (!callsLiveEnabled) return { ok: false, error: 'Open Calls isn’t set up yet.' }
  try {
    return await appsScriptPostClaim(OFFICERS_WEBAPP_URL, payload)
  } catch (err) {
    return { ok: false, error: err.message || 'Something went wrong. Please try again.' }
  }
}

// Apps Script serves GET replies through a cache keyed on the full URL, so an
// unchanging `?action=calls` can hand back a stale list, which would mean a
// call an officer just published doesn't reach visitors. A minute-bucketed
// parameter caps that staleness at 60s while still letting a burst of visitors
// share one response. (Observed live: the same URL returned a pre-deploy reply
// until a distinct parameter was added.)
function freshness() {
  return String(Math.floor(Date.now() / 60000))
}

// Public list, keyed by committee slug. Live calls only, the backend filters
// out drafts, closed calls, and anything past its deadline.
export async function fetchCalls() {
  if (!callsLiveEnabled) return {}
  const data = await appsScriptGet(OFFICERS_WEBAPP_URL, {
    action: 'calls',
    v: freshness(),
  })
  return data.calls && typeof data.calls === 'object' ? data.calls : {}
}

// Cheap availability probe. The public `calls` read is a GET, so a backend
// that predates Open Calls rejects it *readably* and instantly, whereas an
// officer POST to the same backend stores no claim, leaving the client to poll
// until it times out. Officer views check this first so they can say what's
// actually wrong instead of hanging.
export async function callsBackendReady() {
  if (!callsLiveEnabled) return false
  try {
    await appsScriptGet(OFFICERS_WEBAPP_URL, { action: 'calls', v: freshness() })
    return true
  } catch {
    return false
  }
}

export async function submitApplication({ callId, positions, answers, ...applicant }) {
  const ref = makeReference(REFERENCE_PREFIX)
  const res = await post({
    action: 'apply',
    callId,
    ref,
    positions: Array.isArray(positions) ? positions : [],
    answers: answers || {},
    ...applicant,
  })
  // A same-applicant repeat inside 24h is swallowed by the backend and comes
  // back as a success, there's nothing useful to tell the applicant, and
  // "you already applied" would be worse than a quiet confirmation.
  return res.ok ? { ok: true, ref: res.ref || ref } : res
}

// ── Officer side (all token-gated) ─────────────────────────────────────────
export function fetchOfficerCalls(token, slug) {
  return post({ action: 'officercalls', token, slug })
}

export function saveCall(token, { id, slug, status, fields }) {
  return post({ action: 'callsave', token, id, slug, status, fields })
}

export function setCallStatus(token, id, status) {
  return post({ action: 'callstatus', token, id, status })
}

export function deleteCall(token, id) {
  return post({ action: 'calldelete', token, id })
}

export function fetchApplications(token, callId) {
  return post({ action: 'applications', token, callId })
}
