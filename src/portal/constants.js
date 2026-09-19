// Small shared constants for the member portal. Labels match the contract so
// the badge text is identical everywhere it appears.

export const FACULTY_YEARS = [
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5',
  'Year 6',
  'Intern',
  'Graduate',
  'Other',
]

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

export const PORTAL_HOME = '/portal'
export const SIGN_IN_PATH = '/portal/sign-in'
export const CALLBACK_PATH = '/portal/callback'

// Where to send someone after sign-in. Lives in sessionStorage (not the URL)
// because the OAuth round trip through Google/Supabase drops our query string.
export const NEXT_KEY = 'ausss-portal-next'

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
