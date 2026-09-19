import { callsLiveEnabled } from '../data/officersConfig.js'
import { restRpc, restSelect } from './supabaseRest.js'
import { makeReference } from './reference.js'

// ── Open Calls (public side) ───────────────────────────────────────────────
//
// Officers publish recruitment calls for their committee in the portal;
// visitors apply from the committee page. Both read and write go straight to
// Supabase over REST: the `open_calls` view only ever returns live calls
// (open + deadline not passed, Cairo days) with the private columns left
// out, and `submit_application` is the single, validated insert path. The
// officer side lives in src/portal/officerQueries.js.
//
// Every function resolves to { ok: true, … } or { ok: false, error } so call
// sites need one branch, not a try/catch each.

const REFERENCE_PREFIX = 'CALL'

// Public list, keyed by committee slug. Live calls only, soonest deadline
// first, undated ones last (the view orders them).
export async function fetchCalls() {
  if (!callsLiveEnabled) return {}
  const rows = await restSelect('open_calls', {
    select: 'id,slug,title,kind,summary,description,commitment,deadline,positions,questions',
  })
  const map = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.slug !== 'string') continue
    ;(map[row.slug] ||= []).push({ ...row, deadline: row.deadline || '' })
  }
  return map
}

export async function submitApplication({ callId, positions, answers, ...applicant }) {
  if (!callsLiveEnabled) return { ok: false, error: 'Open Calls isn’t set up yet.' }
  const ref = makeReference(REFERENCE_PREFIX)
  try {
    const res = await restRpc('submit_application', {
      call_id: callId,
      ref,
      name: applicant.name || '',
      email: applicant.email || '',
      phone: applicant.phone || '',
      year: applicant.year || '',
      positions: Array.isArray(positions) ? positions : [],
      motivation: applicant.motivation || '',
      answers: answers || {},
      website: applicant.website || '',
    })
    // A same-applicant repeat inside 24h is swallowed by the backend and
    // comes back as a success: "you already applied" would be worse than a
    // quiet confirmation.
    return { ok: true, ref: res?.ref || ref }
  } catch (err) {
    // 22023 from the function carries the message to show verbatim
    // ("This call has closed.", "Please answer: …"); anything else is
    // transport trouble.
    return {
      ok: false,
      error: err?.rejected && err.message
        ? err.message
        : 'Something went wrong. Please try again.',
    }
  }
}
