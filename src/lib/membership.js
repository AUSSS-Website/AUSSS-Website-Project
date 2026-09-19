import { restRpc, supabaseRestEnabled } from './supabaseRest.js'

// The membership check reads the live roster in Supabase through
// rpc/check_membership (supabase/migrations/20260919200001_live_roster.sql).
// The matching (email first, then an exact normalised name) happens in the
// database, which answers with one person's membership facts and never a name
// or an email, so nothing about the roster ships in the bundle any more.

// Mirror of app.normalize_text in the database; only used for local text
// comparisons (classify below), never for matching.
export function normalize(v) {
  return String(v ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const mapRecord = (raw) => ({
  status: raw.status,
  yearJoined: raw.yearJoined,
  yearsSpent: raw.yearsSpent,
  lgas: raw.lgas, // raw string, may be ">2", "2+", "" …
  ngas: raw.ngas,
  currentPosition: (raw.currentPosition || '').trim() || 'General Member',
})

// Position cells in the roster sometimes pack multiple roles separated
// by a line break (e.g. "Supervising Council\r\nInternational TEDA"). Splits
// the raw value into individual positions so the UI can render them as a
// stacked list instead of one squashed string.
export function splitPositions(raw) {
  return String(raw ?? '')
    .split(/\r\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// The mail domains members actually use, and the slips seen for them. Purely
// about what was typed: "gmial.com" is wrong whoever you are.
const DOMAIN_FIXES = {
  'gmail.com': ['gmial.com', 'gmai.com', 'gmal.com', 'gamil.com', 'gnail.com', 'gmail.co', 'gmail.con', 'gmail.cm', 'gmaill.com', 'gmail.comm', 'gmail.om'],
  'yahoo.com': ['yaho.com', 'yahooo.com', 'yahoo.co', 'yahoo.con', 'yhoo.com'],
  'hotmail.com': ['hotmial.com', 'hotmal.com', 'hotmai.com', 'hotmail.co', 'hotmail.con'],
  'outlook.com': ['outlok.com', 'outloo.com', 'outlook.co', 'outlook.con'],
  'icloud.com': ['iclod.com', 'icloud.co', 'icloud.con'],
}

export function fixEmailDomain(email) {
  const at = String(email ?? '').trim().lastIndexOf('@')
  if (at < 1) return null
  const local = email.trim().slice(0, at)
  const domain = email.trim().slice(at + 1).toLowerCase()
  for (const [good, bad] of Object.entries(DOMAIN_FIXES)) {
    if (bad.includes(domain)) return `${local}@${good}`
  }
  return null
}

// ── Lookup (by name OR email) ────────────────────────────────────────────
// Returns one of:
//   { state: 'found', record }
//   { state: 'ambiguous' }           name given matches >1 member
//   { state: 'not-found', suggestions? }   suggestions: { names: [...] } when
//        the name is a near-spelling of up to three members' names,
//        { email: 's•••a@gmail.com' } (masked, never the real address) when
//        one roster email is a typo away, or { fixedEmail } when the domain
//        itself looks mistyped (computed here, no roster involved)
//   { state: 'not-connected' }       build without the Supabase env vars
//   { state: 'error', message }
// `role` is the one fixed value the RPC accepts ('supervising-council'), for
// the holder whose name is spelt too many ways to match by name.
// acceptNear: the visitor confirmed the masked email hint.
export async function lookupMember({ name = '', email = '', role = null, acceptNear = false }) {
  if (!supabaseRestEnabled) return { state: 'not-connected' }
  try {
    const args = { name: name.trim(), email: email.trim() }
    if (role) args.role = role
    if (acceptNear) args.accept_near = true
    const d = await restRpc('check_membership', args)
    if (d?.state === 'found' && d.record) {
      return { state: 'found', record: mapRecord(d.record) }
    }
    if (d?.state === 'ambiguous') return { state: 'ambiguous' }
    const fixedEmail = fixEmailDomain(email)
    const suggestions = fixedEmail ? { fixedEmail } : d?.suggestions || null
    return { state: 'not-found', suggestions }
  } catch (e) {
    return { state: 'error', message: e.message }
  }
}

// ── Bylaw-driven advancement guidance (Constitution & Bylaws §2) ─────────
const TIERS = {
  candidate: {
    label: 'Candidate Member',
    rank: 1,
    rights: 'Speaking rights at the Local GA (no proposing, voting, or candidature).',
    next: 'Associate Member',
    needLga: 1,
    needNga: 2,
    steps: [
      'Attend at least 1 Local GA or 2 National GAs (§2.5.1).',
      'Reach the minimum activity score on the Membership Evaluation Sheet (Annex 1).',
      'Associate status is then granted by the Executive Board before a General Assembly (§2.3.1).',
    ],
  },
  associate: {
    label: 'Associate Member',
    rank: 2,
    rights: 'Speaking & proposing rights; may apply for a Team of Officials position (no voting).',
    next: 'Full Member',
    needLga: 2,
    needNga: 3,
    steps: [
      'Attend 2 Local GAs including their plenaries (§2.6.1a).',
      'Attend 3 National GAs (§2.6.1b).',
      'Maintain the minimum activity score on the Evaluation Sheet (Annex 1).',
      'Full status is then granted by the Executive Board (§2.6.1).',
    ],
  },
  full: {
    label: 'Full Member',
    rank: 3,
    rights: 'Speaking, proposing, voting and candidature rights at the Local GA (§2.6.2).',
    next: null,
    steps: [
      'You hold the highest membership status, maintain it each term by contributing: a local team, an SWG/Taskforce/OC, or by giving local sessions/workshops (§2.9.1).',
      'Failing to contribute within a term downgrades your status (§2.9.2).',
      'You may run for any Team of Officials or Executive Board position.',
    ],
  },
  honorary: {
    label: 'Honorary Life Member',
    rank: 4,
    rights: 'Attend events & GAs with speaking and proposing rights (no voting) (§2.7.3).',
    next: null,
    steps: [
      'Granted by the General Assembly to alumni who greatly contributed to AUSSS (§2.7).',
      'Thank you for your continued contribution to the society.',
    ],
  },
  suspended: {
    label: 'Suspended',
    rank: 0,
    rights: 'Membership rights are currently withheld (§2.10).',
    next: null,
    steps: [
      'Suspension is a disciplinary status decided with the Supervising Council (§2.10.1).',
      'Contact the Executive Board / Secretary General to discuss reinstatement.',
    ],
  },
  observer: {
    label: 'Observer / Volunteer',
    rank: 0.5,
    rights: 'May join local workshops and physical campaigns (§2.2.4).',
    next: 'Candidate Member',
    steps: [
      'Apply during a recruitment campaign (online or hard copy) (§2.2.2.2a).',
      'Attend at least 50% of an orientation session (§2.2.2.2b).',
      'Pay the membership fees per the set regulations (§2.2.2.2c).',
    ],
  },
}

export function classify(statusText) {
  const s = normalize(statusText)
  if (!s) return null
  if (s.includes('suspend')) return 'suspended'
  if (s.includes('honor')) return 'honorary'
  if (s.includes('full')) return 'full'
  if (s.includes('associate')) return 'associate'
  if (s.includes('candidate')) return 'candidate'
  if (s.includes('observer') || s.includes('volunteer')) return 'observer'
  if (s.includes('alumni')) return 'honorary'
  return 'candidate' // safe default for unknown active labels
}

export function adviceFor(record) {
  const key = classify(record?.status)
  const tier = TIERS[key] || TIERS.candidate
  const progress = []
  if (tier.needLga != null) {
    progress.push({
      label: 'Local GAs attended',
      have: record.lgas, // raw string; parsed safely in the UI
      need: tier.needLga,
    })
  }
  if (tier.needNga != null) {
    progress.push({
      label: 'National GAs attended',
      have: record.ngas,
      need: tier.needNga,
    })
  }
  return {
    tierLabel: tier.label,
    rights: tier.rights,
    next: tier.next,
    steps: tier.steps,
    progress,
  }
}

// Guidance for someone not in the database at all.
export const NOT_A_MEMBER = {
  tierLabel: 'Not yet a member',
  steps: [
    'Apply during the next AUSSS recruitment campaign (online or hard copy) (§2.2.2.2a).',
    'Attend at least 50% of an orientation session (§2.2.2.2b).',
    'Pay the membership fees per the set regulations (§2.2.2.2c), you’ll then be a Candidate Member.',
  ],
}
