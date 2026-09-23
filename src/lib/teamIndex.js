// Maps a membership "Current Position" string → the committee/division or
// Executive-Board metadata, so the special result pages work regardless of
// who currently holds the post. Branding (logo/colour/slug) comes from the
// post; a personal photo is only attached when the looked-up name matches
// the currently-known holder in society.js.

import { executiveBoard, committees, slugFor } from '../data/society.js'
import { normalize as norm, splitPositions } from './text.js'

const compact = (v) => norm(v).replace(/[^a-z0-9]/g, '')

// "President" / "AUSSS President" → true, but NOT "Vice President".
// Multi-position safe, true if any sub-position is a presidential role.
export function isPresidentPosition(pos) {
  return splitPositions(pos).some((part) => {
    const p = norm(part).replace(/^ausss\s+/, '')
    return /\bpresident\b/.test(p) && !/\bvice\b/.test(p)
  })
}

// Heba Ismail, AUSSS President 2024–2025 and current Supervising Council
// member, gets her own welcome card. Matched by typed name (so she's caught
// whether she enters name or email) or by her unique Supervising Council
// position in the current data.
const HEBA_NAME_KEYS = new Set(
  [
    'Heba Ismail',
    'Heba Esmail',
    'Heba Ismaeel',
    'Heba Esmaeel',
    'Heba Ismael',
    'Heba Esmael',
  ].map(norm),
)
export function isHebaIsmail({ position, typedName }) {
  if (typedName && HEBA_NAME_KEYS.has(norm(typedName))) return true
  if (position && /\bsupervising\s+council\b/i.test(position)) return true
  return false
}

const index = new Map()
const addAlias = (alias, entry) => {
  const k = norm(alias)
  if (k && !index.has(k)) index.set(k, entry)
  const c = compact(alias)
  if (c && !index.has(c)) index.set(c, entry)
}

// ── Committees & support divisions ──────────────────────────────────────
for (const c of committees) {
  const meta = {
    kind: 'committee',
    committeeName: c.name,
    abbr: c.abbr,
    color: c.color,
    logo: c.logo,
    slug: slugFor(c),
    group: c.group,
  }
  const people =
    Array.isArray(c.officers) && c.officers.length > 0
      ? c.officers
      : [{ name: c.holder, abbr: c.officerAbbr, photo: c.photo }]

  for (const p of people) {
    const roleLabel = p.abbr
      ? `${c.officer} (${p.abbr})`
      : c.officer || 'Officer'
    const entry = {
      ...meta,
      roleLabel,
      holderName: p.name || '',
      holderPhoto: p.photo || '',
    }
    if (p.abbr) addAlias(p.abbr, entry)
  }

  // Title aliases. Division titles ("Division Director") are shared, so for
  // divisions we only key by abbr + "<ABBR> director"; committees have
  // distinct officer titles and can key by title too.
  const generic = {
    ...meta,
    roleLabel: c.officer || 'Officer',
    holderName:
      Array.isArray(c.officers) && c.officers.length === 1
        ? c.officers[0].name
        : !Array.isArray(c.officers)
          ? c.holder || ''
          : '',
    holderPhoto:
      !Array.isArray(c.officers) && c.photo ? c.photo : '',
  }
  if (/division/i.test(c.group || '')) {
    if (c.officerAbbr) {
      addAlias(`${c.abbr} director`, generic)
      addAlias(`${c.officerAbbr}`, generic)
    }
    addAlias(`${c.name} director`, generic)
  } else if (c.officer) {
    addAlias(c.officer, generic)
  }
}

// The membership sheet sometimes records the Public Health officer with the
// informal abbreviation "LOPH" instead of the official "LPO", alias it to the
// LPO entry so both resolve to the same result.
const lpoEntry = index.get(norm('LPO'))
if (lpoEntry) addAlias('LOPH', lpoEntry)

// ── Executive Board (President handled separately as the sarcastic page) ─
for (const m of executiveBoard) {
  if (m.tier === 'lead') continue // president → isPresidentPosition()
  const entry = {
    kind: 'eb',
    roleLabel: m.role,
    holderName: m.name || '',
    holderPhoto: m.photo || '',
  }
  addAlias(m.role, entry)
  const r = norm(m.role)
  if (r.includes('internal')) {
    ;['vpi', 'vp internal', 'vice president internal affairs',
      'vice president for internal affairs'].forEach((a) => addAlias(a, entry))
  } else if (r.includes('external')) {
    ;['vpe', 'vp external', 'vice president external affairs',
      'vice president for external affairs'].forEach((a) => addAlias(a, entry))
  } else if (r.includes('secretary')) {
    ;['secgen', 'sec gen', 'secretary general', 'secretary-general'].forEach(
      (a) => addAlias(a, entry),
    )
  }
}

const SKIP = new Set(['', 'member', 'general member', 'none', 'n/a', '-'])

// Returns the matched entry or null. Walks each sub-position and returns
// the first hit, so a record like "LEO-OUT\r\nNational CBSD Team- TEDA"
// still resolves to the LEO-Out card.
export function matchPosition(position) {
  for (const part of splitPositions(position)) {
    const p = norm(part)
    if (SKIP.has(p)) continue
    const hit = index.get(p) || index.get(compact(part))
    if (hit) return { entry: hit, matched: part }
  }
  return null
}
