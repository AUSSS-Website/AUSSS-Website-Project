// Small shared constants for the member portal. Labels match the contract so
// the badge text is identical everywhere it appears.

// The years of study at the faculty: five, then the two intern years (the
// webmaster, 2026-10-11). The exchange exam's form offers exactly these
// (EXAM_YEARS in src/exam/examFlow.js), and the merch checkout has the same
// years in its own words (src/pages/CheckoutPage.jsx).
export const STUDY_YEARS = [
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5',
  '1st year intern',
  '2nd year intern',
]

// A member's profile: those years, and two more for members who are not
// students.
export const FACULTY_YEARS = [...STUDY_YEARS, 'Graduate', 'Other']

export const MEMBERSHIP_LABELS = {
  unverified: 'Unverified',
  candidate: 'Candidate member',
  active: 'Active member',
  alumni: 'Alumni',
}

// Statuses the roster editor and bulk updates offer. The roster column is free
// text (the spreadsheet may hold others); these are the Constitution's tiers
// plus the two housekeeping states.
export const ROSTER_STATUSES = [
  'Candidate Member',
  'Associate Member',
  'Full Member',
  'Honorary Life Member',
  'Alumni',
  'Suspended',
  'Archived',
]

// The status of a dismissed member. It is not in the list above on purpose:
// nobody types it. Only the President sets it, with "Dismiss member" on the
// Roster page, and the database refuses it from anywhere else (migration
// 20261011130001).
export const DISMISSED_STATUS = 'Dismissed'

// The key of the President's position. Holding it this term is what lets an
// account dismiss and reinstate a member; the database asks the same question
// (app.is_president), so this only decides which controls a page shows.
export const PRESIDENT_KEY = 'eb.president'

// Whether these assignments (useAuth().assignments: this term's active ones)
// include the President's position.
export const holdsPresidency = (assignments) =>
  (assignments || []).some((a) => a?.position?.key === PRESIDENT_KEY)

// A roster row is dismissed exactly while its dismissed_at is set.
export const isDismissed = (row) => Boolean(row?.dismissed_at)

const PORTAL_HOME = '/portal'
export const SIGN_IN_PATH = '/portal/sign-in'
export const CALLBACK_PATH = '/portal/callback'

// Where to send someone after sign-in. Lives in sessionStorage (not the URL)
// because the OAuth round trip through Google/Supabase drops our query string.
const NEXT_KEY = 'ausss-portal-next'

// One path segment: unreserved + sub-delims + percent escapes, nothing else.
// No slashes, backslashes, whitespace or control characters can sneak in.
const SEGMENT = /^[\w.~!$&'()*+,;=:@%-]+$/

// Only ever redirect inside the portal: an attacker-supplied ?next= must not
// be able to bounce a fresh sign-in to another origin or the public site.
// Strict on purpose: "/portal" must be followed by "/", "?", "#" or the end
// (so "/portal-evil" fails), every segment is checked after percent-decoding
// (so "/portal/../x" and "/portal/%2e%2e/x", which the browser would
// normalise to "/x", fail), and empty segments ("/portal//evil.com") fail.
// Sign-in/callback themselves are excluded so we never loop.
export function safeNext(value) {
  if (typeof value !== 'string') return PORTAL_HOME
  const v = value.trim()
  if (/[\s\\]/.test(v)) return PORTAL_HOME
  const m = /^(\/portal(?:\/[^?#]*)?)(?:\?[^#]*)?(?:#.*)?$/.exec(v)
  if (!m) return PORTAL_HOME
  const path = m[1]
  const segments = path.split('/').slice(2) // drop '' and 'portal'
  if (segments.length && segments[segments.length - 1] === '') segments.pop() // trailing slash is fine
  for (const seg of segments) {
    if (!SEGMENT.test(seg)) return PORTAL_HOME
    let decoded
    try {
      decoded = decodeURIComponent(seg)
    } catch {
      return PORTAL_HOME
    }
    if (decoded === '.' || decoded === '..' || /[/\\]/.test(decoded)) return PORTAL_HOME
  }
  if ([SIGN_IN_PATH, CALLBACK_PATH].some((p) => path === p || path.startsWith(p + '/'))) {
    return PORTAL_HOME
  }
  return v
}

export function rememberNext(value) {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNext(value))
  } catch {
    // Private mode / blocked storage: fall back to the portal home later.
  }
}

// Read-and-clear, so a stale target never leaks into a later sign-in.
export function takeNext() {
  try {
    const v = sessionStorage.getItem(NEXT_KEY)
    sessionStorage.removeItem(NEXT_KEY)
    return safeNext(v)
  } catch {
    return PORTAL_HOME
  }
}
