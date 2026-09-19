// Pulls the membership Google Sheet into public.roster_entries.
//
// WHY a pull: the push route (apps-script/roster-sync.gs) must be installed by the sheet's
// owner. This function needs nothing from them: it downloads the sheet as .xlsx, reads the
// "Database" tab exactly like src/portal/rosterFile.js does, and hands the rows to
// rpc/admin_import_roster, i.e. the same merge every other route uses (portal edits are kept,
// nobody is deleted, every run is logged in roster_sync_runs).
//
// It takes no input: which sheet to pull is stored in the database (set from the portal's
// Roster page). Two callers are let in, and the function checks them itself (so it is deployed
// with verify_jwt = false): the hourly pg_cron job, which sends a secret kept in Vault, and a
// signed-in EB member pressing "Sync now" in the portal.
//
// Reading the sheet:
//   - normally: the public export link. The society keeps the sheet on "anyone with the link
//     can view";
//   - if the sheet is ever restricted: set the secret
//     GOOGLE_SERVICE_ACCOUNT to a service-account key JSON and have the sheet's owner share
//     the sheet with that account's email as Viewer. Nothing else changes.
import * as XLSX from 'npm:xlsx@0.18.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const FIELDS = [
  'full_name',
  'email',
  'joined_year',
  'years_spent',
  'lgas',
  'ngas',
  'current_position',
  'status',
] as const

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.message || `${fn} failed (${res.status})`)
  return body
}

// The cron job's Vault secret, or a session the database itself recognises as EB (rpc/
// roster_sheet_info refuses everyone else).
async function authorised(req: Request) {
  const secret = req.headers.get('x-cron-secret')
  if (secret) return (await rpc('admin_roster_cron_secret_ok', { secret })) === true
  const auth = req.headers.get('Authorization')
  if (!auth) return false
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/roster_sheet_info`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: auth, 'Content-Type': 'application/json' },
    body: '{}',
  })
  return res.ok
}

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// OAuth2 service-account flow: sign a JWT with the account's private key, trade it for a
// short-lived access token scoped to read-only Drive.
async function serviceAccountToken(keyJson: string) {
  const key = JSON.parse(keyJson)
  const now = Math.floor(Date.now() / 1000)
  const unsigned =
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    b64url(
      JSON.stringify({
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 600,
      }),
    )
  const pem = String(key.private_key).replace(/-----[A-Z ]+-----|\s/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Google refused the service account: ${body.error_description || body.error}`)
  return body.access_token as string
}

async function downloadSheet(sheetId: string) {
  const sa = Deno.env.get('GOOGLE_SERVICE_ACCOUNT')
  const res = sa
    ? await fetch(
        `https://www.googleapis.com/drive/v3/files/${sheetId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`,
        { headers: { Authorization: `Bearer ${await serviceAccountToken(sa)}` } },
      )
    : await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`)
  const type = res.headers.get('content-type') || ''
  // A restricted sheet answers the public link with a sign-in page, not an error status.
  if (!res.ok || !type.includes('spreadsheetml')) {
    throw new Error(
      sa
        ? `Google would not export the sheet (${res.status}). Is it shared with the service account?`
        : `The sheet is not readable by link (${res.status}). Share it with a service account and set GOOGLE_SERVICE_ACCOUNT.`,
    )
  }
  return new Uint8Array(await res.arrayBuffer())
}

function readRoster(file: Uint8Array, tab: string) {
  const wb = XLSX.read(file, { type: 'array' })
  const sheet = wb.Sheets[tab] || wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('The workbook has no sheets.')
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false })
  const hi = grid.findIndex((r) => String(r?.[0] ?? '').trim().toLowerCase() === 'name')
  if (hi === -1) throw new Error(`Header row (first cell "Name") not found in tab "${tab}".`)
  const asOf = String(grid[hi][7] ?? '').match(/\[(.+?)\]/)
  const rows = []
  for (const r of grid.slice(hi + 1)) {
    const cells = FIELDS.map((_, j) => String(r?.[j] ?? '').trim())
    if (!cells[0]) continue
    rows.push(Object.fromEntries(FIELDS.map((f, j) => [f, cells[j]])))
  }
  return { rows, batch: asOf ? asOf[1].replace(/\s+/g, ' ').trim() : null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    if (!(await authorised(req))) return json({ ok: false, error: 'Not allowed.' }, 401)
    const source = await rpc('admin_roster_sheet_source')
    if (!source?.sheet_id) return json({ ok: false, skipped: 'No spreadsheet is connected.' })

    const { rows, batch } = readRoster(await downloadSheet(source.sheet_id), source.tab || 'Database')
    // A half-loaded or wrongly filtered sheet must not look like a mass change.
    if (rows.length < 50) throw new Error(`Only ${rows.length} rows read; refusing to sync.`)

    const result = await rpc('admin_import_roster', { rows, batch, source: 'sheet' })
    // Names stay in the database (roster_sync_runs); the caller only needs the counts.
    delete result.missing_names
    return json({ ok: true, result })
  } catch (e) {
    console.error('roster-sheet-sync:', e)
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
