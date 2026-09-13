// Generates supabase/migrations/<timestamp>_reference_data.sql from src/data/society.js.
//
// WHY: society.js is the single source of truth for committees, officer titles and
// role mailboxes until Phase 2 moves that content into the database. Instead of
// hand-writing the seed SQL (and letting it drift), this script emits idempotent
// upserts keyed on natural keys (terms.label, committees.slug, positions.key) and
// never hardcodes uuids. Re-running it writes a NEW timestamped migration only
// when the SQL body actually changed; the previous migration stays in history.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { committees, executiveBoard, slugFor } from '../../src/data/society.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')

const CURRENT_TERM = '2026-27'
const TERMS = [
  { label: '2025-26', starts_on: '2025-09-01', ends_on: '2026-08-31', is_current: false },
  { label: CURRENT_TERM, starts_on: '2026-09-01', ends_on: '2027-08-31', is_current: true },
]

const EB_KEYS = {
  President: { key: 'eb.president', short: 'President' },
  'Vice President, Internal Affairs': { key: 'eb.vp-internal', short: 'VPI' },
  'Vice President, External Affairs': { key: 'eb.vp-external', short: 'VPE' },
  'Secretary General': { key: 'eb.secretary-general', short: 'SecGen' },
}

const KIND_BY_GROUP = {
  'Standing Committee': 'standing',
  'Support Division': 'division',
}

// SQL literal helpers. Everything user-visible goes through q() so a stray
// apostrophe in a title never breaks the migration.
const q = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const b = (v) => (v ? 'true' : 'false')
const keyPart = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// One committee may list several officers (SCOPE: LEO-Out + LEO-In). Titles must
// be distinct per committee (unique (committee_id, title)), so multi-officer
// committees get the abbreviation appended to the shared title.
function officersOf(c) {
  if (Array.isArray(c.officers) && c.officers.length) {
    return c.officers.map((o) => ({
      abbr: o.abbr,
      email: o.email,
      title: c.officers.length > 1 ? `${c.officer} (${o.abbr})` : c.officer,
    }))
  }
  return [{ abbr: c.officerAbbr, email: c.email, title: c.officer }]
}

const positions = []
const invites = []

committees.forEach((c, i) => {
  const slug = slugFor(c)
  const kind = KIND_BY_GROUP[c.group]
  if (!kind) throw new Error(`Unknown committee group "${c.group}" for ${c.abbr}`)
  c._slug = slug
  c._kind = kind
  c._sort = i
  officersOf(c).forEach((o, j) => {
    if (!o.abbr || !o.title) throw new Error(`Committee ${c.abbr} is missing officer/officerAbbr`)
    const key = `${slug}.${keyPart(o.abbr)}`
    positions.push({
      key,
      slug,
      title: o.title,
      short_title: o.abbr,
      level: 'officer',
      sort: j,
      can_assign_tasks: true,
    })
    if (o.email) invites.push({ email: o.email, key })
  })
  positions.push({
    key: `${slug}.assistant`,
    slug,
    title: 'Assistant',
    short_title: null,
    level: 'assistant',
    sort: 10,
    can_assign_tasks: false,
  })
  positions.push({
    key: `${slug}.member`,
    slug,
    title: 'Member',
    short_title: null,
    level: 'member',
    sort: 20,
    can_assign_tasks: false,
  })
})

executiveBoard.forEach((m, i) => {
  const eb = EB_KEYS[m.role]
  if (!eb) throw new Error(`Unmapped executive board role "${m.role}"`)
  positions.push({
    key: eb.key,
    slug: null,
    title: m.role,
    short_title: eb.short,
    level: 'eb',
    sort: i,
    can_assign_tasks: false,
  })
  if (m.email) invites.push({ email: m.email, key: eb.key })
})

positions.push({
  key: 'society.webmaster',
  slug: null,
  title: 'Webmaster',
  short_title: 'Webmaster',
  level: 'webmaster',
  sort: 0,
  can_assign_tasks: false,
})

// Guard: the schema also enforces unique (committee_id, title); fail here with a
// readable message instead of at db push time.
const seenTitle = new Set()
for (const p of positions) {
  const k = `${p.slug ?? ''}|${p.title}`
  if (seenTitle.has(k)) {
    throw new Error(`Duplicate position title "${p.title}" in committee ${p.slug ?? '(society)'}`)
  }
  seenTitle.add(k)
}

const out = []
out.push('-- Terms -------------------------------------------------------------------')
out.push('-- is_current is not overwritten on conflict: the EB rolls the term over via')
out.push('-- public.set_current_term(); re-running this migration must not undo that.')
for (const t of TERMS) {
  out.push(
    'insert into public.terms (label, starts_on, ends_on, is_current)',
    `values (${q(t.label)}, ${q(t.starts_on)}, ${q(t.ends_on)}, ${b(t.is_current)})`,
    'on conflict (label) do update set',
    '  starts_on = excluded.starts_on,',
    '  ends_on = excluded.ends_on;',
    '',
  )
}

out.push('-- Committees --------------------------------------------------------------')
out.push('-- page stays {} until Phase 2; content lives in src/data/society.js for now.')
for (const c of committees) {
  out.push(
    'insert into public.committees (slug, name, abbr, kind, color, logo, sort, page)',
    `values (${q(c._slug)}, ${q(c.name)}, ${q(c.abbr)}, ${q(c._kind)}, ${q(c.color)}, ${q(c.logo)}, ${c._sort}, '{}'::jsonb)`,
    'on conflict (slug) do update set',
    '  name = excluded.name,',
    '  abbr = excluded.abbr,',
    '  kind = excluded.kind,',
    '  color = excluded.color,',
    '  logo = excluded.logo,',
    '  sort = excluded.sort;',
    '',
  )
}

out.push('-- Positions ---------------------------------------------------------------')
for (const p of positions) {
  const committeeId = p.slug
    ? `(select id from public.committees where slug = ${q(p.slug)})`
    : 'null'
  out.push(
    'insert into public.positions (key, committee_id, title, short_title, level, sort, can_assign_tasks)',
    `values (${q(p.key)}, ${committeeId}, ${q(p.title)}, ${q(p.short_title)}, ${q(p.level)}, ${p.sort}, ${b(p.can_assign_tasks)})`,
    'on conflict (key) do update set',
    '  committee_id = excluded.committee_id,',
    '  title = excluded.title,',
    '  short_title = excluded.short_title,',
    '  level = excluded.level,',
    '  sort = excluded.sort,',
    '  can_assign_tasks = excluded.can_assign_tasks;',
    '',
  )
}

out.push(`-- Invites for the current term (${CURRENT_TERM}) ----------------------------------`)
out.push('-- Role mailboxes from society.js (already public in this repo). Unique on')
out.push('-- (email_normalized, position_id, term_id), so re-running is a no-op.')
for (const inv of invites) {
  out.push(
    'insert into public.invites (email, position_id, term_id)',
    `select ${q(inv.email)}, p.id, t.id`,
    'from public.positions p, public.terms t',
    `where p.key = ${q(inv.key)} and t.label = ${q(CURRENT_TERM)}`,
    'on conflict do nothing;',
    '',
  )
}

const body = out.join('\n').trimEnd() + '\n'

// Header lines start with "-- gen:" and carry the timestamp, so they are excluded
// from the comparison against the previous generated file.
const stripHeader = (sql) => {
  const lines = sql.split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i].startsWith('-- gen:')) i++
  return lines.slice(i).join('\n').replace(/^\n+/, '')
}

fs.mkdirSync(migrationsDir, { recursive: true })
const previous = fs
  .readdirSync(migrationsDir)
  .filter((f) => /^\d{14}_reference_data\.sql$/.test(f))
  .sort()
  .at(-1)

if (previous) {
  const prevBody = stripHeader(fs.readFileSync(path.join(migrationsDir, previous), 'utf8'))
  if (prevBody === stripHeader(body)) {
    console.log(`Reference data unchanged since ${previous}; nothing written.`)
    process.exit(0)
  }
}

const now = new Date()
const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14)
const file = path.join(migrationsDir, `${stamp}_reference_data.sql`)
const header = [
  `-- gen: generated by scripts/db/gen-reference-data.mjs on ${now.toISOString()}`,
  '-- gen: do not edit by hand; edit src/data/society.js and run `npm run db:gen-reference`.',
  '-- gen: idempotent upserts keyed on terms.label / committees.slug / positions.key.',
  '',
].join('\n')
fs.writeFileSync(file, header + body)
console.log(
  `Wrote ${path.relative(root, file)} (${TERMS.length} terms, ${committees.length} committees, ${positions.length} positions, ${invites.length} invites)`,
)
