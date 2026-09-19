// In-browser roster search, so the list follows every keystroke. The roster is
// a few hundred rows: the Roster page loads it once and this ranks it locally
// in about a millisecond, where a request per keystroke took a few hundred.
//
// The rules are the database's (app.roster_match in
// supabase/migrations/20260920090001_roster_search.sql, which still serves the
// bulk-update matcher): every typed word must match somewhere, in any order;
// per word, best first:
//   6 a whole word of the name      5 the start of a word     4 inside the name
//   4 inside the email              3 inside the position
//   2 same consonant skeleton (Mohamed/Muhammad, Abdelrahman/Abd El Rahman)
//   1 a typo away from a word of the name
// so exact hits come first and spelling neighbours follow.
// Keep skeleton() in step with app.name_skeleton if either changes.

// Same as normalize() in src/lib/membership.js and app.normalize_text: strip
// diacritics, lower-case, collapse whitespace. Local so this module stays pure
// (no env, no network) and can be exercised from Node.
const normalize = (v) =>
  String(v ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const FOLD = { j: 'g', q: 'k', c: 'k', z: 's' }
const fold = (s) => s.replace(/[jqcz]/g, (ch) => FOLD[ch])

export function skeleton(text) {
  const prepared = normalize(text)
    .replace(/-/g, ' ')
    .replace(/ph/g, 'f')
    .replace(/(.)\1+/g, '$1')
    .replace(/\babd ?(el|ul|al|ol)/g, 'abd ')
    .replace(/\b(el|al)( |(?=[a-z]{4}))/g, '')
  return prepared
    .split(/\s+/)
    .filter((w) => /^[a-z0-9]/.test(w))
    .map((w) => (/[aeiou]/.test(w[0]) ? 'a' : fold(w[0])) + fold(w.slice(1).replace(/[^a-z0-9]|[aeiouyhw]/g, '')))
    .join(' ')
}

// Edit distance, giving up as soon as it must exceed `max`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

function likeness(tok, words) {
  let best = 0
  for (const w of words) {
    const len = Math.max(tok.length, w.length)
    const sim = 1 - editDistance(tok, w, len) / len
    if (sim > best) best = sim
  }
  return best
}

// Done once per roster load, not per keystroke.
export function prepareRoster(rows) {
  return rows.map((row) => {
    const name = normalize(row.full_name)
    return {
      row,
      name,
      words: name.split(' ').filter(Boolean),
      padded: ` ${name} `,
      skel: ` ${skeleton(name)} `,
      email: (row.email || '').trim().toLowerCase(),
      position: (row.current_position || '').toLowerCase(),
    }
  })
}

function scoreToken(entry, tok, tokSkel) {
  if (entry.padded.includes(` ${tok} `)) return 6
  if (entry.padded.includes(` ${tok}`)) return 5
  if (entry.name.includes(tok) || (entry.email && entry.email.includes(tok))) return 4
  if (entry.position.includes(tok)) return 3
  // A skeleton of 3+ letters may start a run of the name's; a 2-letter one (from a
  // real word: "elsayed" -> "sd") is too loose for that and must equal a whole part.
  const skelLen = tokSkel.replace(/ /g, '').length
  if (skelLen >= 3 && entry.skel.includes(` ${tokSkel}`)) return 2
  if (skelLen === 2 && tok.length >= 5 && entry.skel.includes(` ${tokSkel} `)) return 2
  if (tok.length >= 4) {
    const max = tok.length >= 8 ? 2 : 1
    if (entry.words.some((w) => editDistance(tok, w, max) <= max)) return 1
  }
  return 0
}

function statusPasses(row, status) {
  if (!status) return true
  if (status === 'none') return !row.status
  if (status === 'portal') return Boolean(row.portal_edited_at)
  return (row.status || '').toLowerCase().includes(status)
}

// prepared: prepareRoster(rows). Returns the matching rows, best first;
// with nothing typed, the roster in name order.
export function searchRoster(prepared, q, status = '') {
  const query = normalize(q)
  const tokens = query.split(' ').filter(Boolean).slice(0, 8)
  const skels = tokens.map(skeleton)
  const hits = []
  for (const entry of prepared) {
    if (!statusPasses(entry.row, status)) continue
    let total = 0
    let ok = true
    for (let i = 0; i < tokens.length; i++) {
      const s = scoreToken(entry, tokens[i], skels[i])
      if (s === 0) {
        ok = false
        break
      }
      // how much the word looks like its nearest name-word (0..1): only ever breaks
      // ties inside a tier, e.g. "muhammad" between skeleton twins mohamed and mahmoud
      total += s + likeness(tokens[i], entry.words)
    }
    if (!ok) continue
    if (query && entry.name === query) total += 20
    else if (query && entry.name.startsWith(query)) total += 8
    hits.push({ entry, total })
  }
  hits.sort(
    (a, b) =>
      b.total - a.total ||
      // among equals the tighter match first; with nothing typed, plain name order
      (tokens.length ? a.entry.name.length - b.entry.name.length : 0) ||
      a.entry.row.full_name.localeCompare(b.entry.row.full_name),
  )
  return hits.map((h) => h.entry.row)
}
