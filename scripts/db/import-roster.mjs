// Imports the interim membership xlsx into public.roster_entries.
//
// WHY: the portal verifies members against the society's roster. Until membership
// moves fully into the database, the spreadsheet in _source/records/membership is
// one way in, so this script hands its rows to rpc/admin_import_roster, the same
// merge the portal upload and the sheet's Apps Script use. Day to day the portal
// (Roster -> Spreadsheet) does this without a secret key; keep this for bulk or
// scripted loads.
//
// Usage (secret key comes from .env.local via node --env-file, never from git):
//   npm run db:import-roster:dry             parse only, print counts, no network
//   npm run db:import-roster                 merge + claim unlinked profiles
//   npm run db:import-roster -- --invites    also create invites from "Current Position"
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const XLSX_PATH = path.join(
  root,
  '_source',
  'records',
  'membership',
  'updated AUSSS Membership Database.xlsx',
)

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const withInvites = args.has('--invites')

// MUST stay byte-identical to normalize() in src/lib/membership.js
const normalize = (v) =>
  String(v ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const toInt = (v) => (/^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : null)
const splitPositions = (raw) =>
  String(raw ?? '')
    .split(/\r\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean)

// "Current Position" text -> positions.key. Compared after upper-casing and
// removing spaces/hyphens/underscores, so "LEO-IN", "LEO In" and "leo_in" match.
const POSITION_KEYS = {
  LEOIN: 'scope.leo-in',
  LEOOUT: 'scope.leo-out',
  LORE: 'score.lore',
  LOME: 'scome.lome',
  LORP: 'scorp.lorp',
  LPO: 'scoph.lpo',
  LOPH: 'scoph.lpo', // spelling used in the roster
  LORA: 'scora.lora',
  PSDD: 'psd.psdd',
  PNSDD: 'pnsd.pnsdd',
  CBSDD: 'cbsd.cbsdd',
  RSDD: 'rsd.rsdd',
  PRESIDENT: 'eb.president',
  VPI: 'eb.vp-internal',
  VPINTERNAL: 'eb.vp-internal',
  VICEPRESIDENTINTERNALAFFAIRS: 'eb.vp-internal',
  VICEPRESIDENTFORINTERNALAFFAIRS: 'eb.vp-internal', // roster spelling
  VPE: 'eb.vp-external',
  VPEXTERNAL: 'eb.vp-external',
  VICEPRESIDENTEXTERNALAFFAIRS: 'eb.vp-external',
  VICEPRESIDENTFOREXTERNALAFFAIRS: 'eb.vp-external', // roster spelling
  SECGEN: 'eb.secretary-general',
  SECRETARYGENERAL: 'eb.secretary-general',
  WEBMASTER: 'society.webmaster',
}
const positionKeyFor = (text) =>
  POSITION_KEYS[String(text).toUpperCase().replace(/[\s\-_]+/g, '')] ?? null

// ── Parse ────────────────────────────────────────────────────────────────
// Columns are addressed by index (the "Year joined" header cell is blank in the
// sheet), exactly like _source/gen-members.mjs.
function parseSheet(file) {
  const wb = XLSX.readFile(file)
  const sheet = wb.Sheets['Database']
  if (!sheet) throw new Error(`Sheet "Database" not found in ${file}`)
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  const hi = rows.findIndex((r) => String(r[0]).trim() === 'Name')
  if (hi === -1) throw new Error('Header row (col 0 === "Name") not found')
  const statusHeader = String(rows[hi][7] || '')
  const m = statusHeader.match(/\[(.+?)\]/)
  const importBatch = m
    ? m[1].replace(/\s+/g, ' ').trim()
    : new Date().toISOString().slice(0, 10)

  const entries = []
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]
    const cell = (j) => String(r[j] ?? '').trim()
    const name = cell(0)
    if (!name) continue
    const email = cell(1)
    const nameNorm = normalize(name)
    const emailNorm = normalize(email)
    entries.push({
      source_key: sha256(nameNorm + '|' + emailNorm),
      full_name: name,
      name_normalized: nameNorm,
      email: email || null,
      status: cell(7) || null,
      joined_year: toInt(cell(2)),
      years_spent: toInt(cell(3)),
      lgas: cell(4) || null,
      ngas: cell(5) || null,
      current_position: cell(6) || null,
      import_batch: importBatch,
      imported_at: new Date().toISOString(),
      _email_norm: emailNorm,
    })
  }
  return { entries, importBatch }
}

const countBy = (list, fn) => {
  const m = new Map()
  for (const x of list) {
    const k = fn(x)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const { entries, importBatch } = parseSheet(XLSX_PATH)

// Same name+email twice would make one upsert statement touch a row twice, which
// Postgres rejects; keep the last occurrence.
const bySourceKey = new Map()
for (const e of entries) bySourceKey.set(e.source_key, e)
const unique = [...bySourceKey.values()]
const dupSourceKeys = entries.length - unique.length

const withEmail = unique.filter((e) => e._email_norm)
const emailDupes = countBy(withEmail, (e) => e._email_norm).filter(([, n]) => n > 1)
const statuses = countBy(unique, (e) => e.status ?? '(blank)')
const positionsSeen = countBy(
  unique.flatMap((e) => splitPositions(e.current_position)),
  (p) => p,
)

console.log(`Source: ${path.relative(root, XLSX_PATH)}`)
console.log(`Import batch: ${importBatch}`)
console.log(
  `Rows: ${entries.length} (unique source_key: ${unique.length}, exact duplicates dropped: ${dupSourceKeys})`,
)
console.log(`With email: ${withEmail.length}`)
console.log(`Emails used by more than one row: ${emailDupes.length}`)
for (const [email, n] of emailDupes) console.log(`  ${n}x ${email}`)
console.log('Distinct statuses:')
for (const [s, n] of statuses) console.log(`  ${String(n).padStart(4)}  ${s}`)
console.log('Current position values:')
for (const [p, n] of positionsSeen) {
  console.log(`  ${String(n).padStart(4)}  ${p}  -> ${positionKeyFor(p) ?? '(no position key)'}`)
}

if (dryRun) {
  console.log('\nDry run: nothing sent.')
  process.exit(0)
}

// ── Upload ───────────────────────────────────────────────────────────────
const url = process.env.VITE_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret) {
  console.error(
    '\nMissing VITE_SUPABASE_URL and/or SUPABASE_SECRET_KEY.\n' +
      'Put both in .env.local (the secret key is sb_secret_..., never commit it) and run\n' +
      '  npm run db:import-roster\n' +
      'which loads .env.local into the environment (node --env-file-if-exists).',
  )
  process.exit(1)
}
if (secret.startsWith('sb_publishable_')) {
  console.error(
    '\nSUPABASE_SECRET_KEY holds a publishable key; the import needs the secret (service-role) key.',
  )
  process.exit(1)
}

const supabase = createClient(url, secret, { auth: { persistSession: false } })

// One merge routine for every route in (this script, the portal upload, the sheet's Apps
// Script): app.apply_roster_rows. It keeps rows the EB edited in the portal, never deletes,
// and links already-signed-in profiles at the end.
const rowsToSend = unique.map((e) => ({
  full_name: e.full_name,
  email: e.email ?? '',
  status: e.status ?? '',
  joined_year: e.joined_year == null ? '' : String(e.joined_year),
  years_spent: e.years_spent == null ? '' : String(e.years_spent),
  lgas: e.lgas ?? '',
  ngas: e.ngas ?? '',
  current_position: e.current_position ?? '',
}))
const { data: result, error: importErr } = await supabase.rpc('admin_import_roster', {
  rows: rowsToSend,
  batch: importBatch,
})
if (importErr) {
  console.error(`
admin_import_roster failed: ${importErr.message}`)
  if (importErr.details) console.error(importErr.details)
  process.exit(1)
}
const { missing_names: missingNames = [], ...counts } = result
console.log('Merged:', counts)
if (missingNames.length) {
  console.log(`On the roster but not in this file (kept): ${missingNames.join(', ')}`)
}

// ── Invites (opt-in) ─────────────────────────────────────────────────────
if (withInvites) {
  const wanted = []
  const unknown = new Map()
  for (const e of withEmail) {
    for (const p of splitPositions(e.current_position)) {
      const key = positionKeyFor(p)
      if (key) wanted.push({ email: e.email, key })
      else unknown.set(p, (unknown.get(p) ?? 0) + 1)
    }
  }
  if (unknown.size) {
    console.log('Skipped position values with no key:')
    for (const [p, n] of [...unknown.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${p}`)
    }
  }
  if (!wanted.length) {
    console.log('No roster rows map to a position key; no invites created.')
  } else {
    const keys = [...new Set(wanted.map((w) => w.key))]
    const [{ data: positions, error: pErr }, { data: terms, error: tErr }] = await Promise.all([
      supabase.from('positions').select('id, key').in('key', keys),
      supabase.from('terms').select('id').eq('is_current', true).limit(1),
    ])
    if (pErr || tErr) {
      console.error(`\nLookup failed: ${(pErr ?? tErr).message}`)
      process.exit(1)
    }
    if (!terms?.length) {
      console.error('\nNo current term (terms.is_current = true); apply the reference-data migration first.')
      process.exit(1)
    }
    const idByKey = new Map(positions.map((p) => [p.key, p.id]))
    const missing = keys.filter((k) => !idByKey.has(k))
    if (missing.length) console.log(`Positions not in the database (skipped): ${missing.join(', ')}`)
    const inviteRows = wanted
      .filter((w) => idByKey.has(w.key))
      .map((w) => ({ email: w.email, position_id: idByKey.get(w.key), term_id: terms[0].id }))
    const { error } = await supabase
      .from('invites')
      .upsert(inviteRows, { onConflict: 'email_normalized,position_id,term_id', ignoreDuplicates: true })
    if (error) {
      console.error(`\nInvite insert failed: ${error.message}`)
      process.exit(1)
    }
    console.log(`Invites sent to the database: ${inviteRows.length} (existing ones untouched)`)
  }
}
