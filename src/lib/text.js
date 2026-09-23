// Small text helpers shared by the public site and the portal. Pure: no env,
// no network, so anything importing this can also run in plain Node.

// Mirror of app.normalize_text in the database: strip diacritics, lower-case,
// collapse whitespace. Used for local comparisons and search, never as the
// matching rule for membership lookups (the database does that).
export function normalize(v) {
  return String(v ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Position cells in the roster sometimes pack several roles separated by a
// line break ("LEO-Out\r\nNational CBSD Team, TEDA"). Split them so the UI can
// show a stacked list and matchers can try each one.
export function splitPositions(raw) {
  return String(raw ?? '')
    .split(/\r\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Up to two initials for an avatar fallback. "Dr." is dropped so a patron
// shows their name's initials rather than "DR".
export function initials(name) {
  return (
    String(name ?? '')
      .replace(/^Dr\.\s*/, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  )
}
