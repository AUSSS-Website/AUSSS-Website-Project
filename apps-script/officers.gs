/**
 * AUSSS officer self-service editor — Google Apps Script Web App
 * ---------------------------------------------------------------------------
 * Lets each Team-of-Officials member log in and edit THEIR OWN committee page
 * (photo, tagline, bio, "what we do", and an optional members list) — changes
 * go live for every visitor without a redeploy.
 *
 * Bind this to a NEW Google Sheet (Extensions → Apps Script) with two tabs:
 *
 *   Accounts   (one row per officer; you seed these — see officers.README.md)
 *     A: email        B: passwordHash   C: salt
 *     D: slug         E: displayName    F: role        G: scope
 *
 *   scope decides what the account may edit:
 *     'committee' (or blank) → only the committee in column D (slug)
 *     'all'                  → every committee (Executive Board)
 *     'dev'                  → everything (developer; superset of 'all')
 *
 *   Overrides  (written by this script; create the tab with just the header)
 *     A: slug         B: json           C: updatedBy      D: updatedAt
 *
 * Deploy → New deployment → Web app:  Execute as Me · Who has access: Anyone.
 * Copy the /exec URL into src/data/officersConfig.js (OFFICERS_WEBAPP_URL).
 *
 * Cross-origin note (same as gallery.gs / orders.gs): GET responses are
 * readable across Apps Script's 302 redirect, so login / validate / overrides
 * are GET. The save is a no-cors POST (large base64 photos); the browser can't
 * read its reply, so the client re-fetches ?action=overrides to confirm.
 */

// ── Config ────────────────────────────────────────────────────────────────
var SPREADSHEET_ID = '' // leave '' if this script is bound to the sheet
var ACCOUNTS_SHEET = 'Accounts'
var OVERRIDES_SHEET = 'Overrides'
var PHOTOS_FOLDER = 'AUSSS Officer Photos'
var TOKEN_TTL_DAYS = 7
var MAX_MEMBERS = 10
var MAX_ACTIVITIES = 6

// Open Calls (see the "Calls" block further down)
var CALLS_SHEET = 'Calls'
var APPLICATIONS_SHEET = 'Applications'
var MAX_POSITIONS = 8
var MAX_QUESTIONS = 6
// Where the notification email points officers to review applications.
var SITE_URL = 'https://www.ausss.org'

// Bumped whenever this file changes in a way worth confirming reached the
// deployment. `GET ?action=version` echoes it, so "is the deployed code the
// code I have?" is one request rather than guesswork.
var SCRIPT_VERSION = '2026-08-31-calls-4'

// ── Small helpers ───────────────────────────────────────────────────────────
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

function norm_(v) {
  return String(v == null ? '' : v).toLowerCase().trim()
}

function sha256_(s) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(s),
    Utilities.Charset.UTF_8,
  )
  return bytes
    .map(function (b) {
      return ('0' + (b & 0xff).toString(16)).slice(-2)
    })
    .join('')
}

function ss_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet()
}

function sheet_(name) {
  var s = ss_().getSheetByName(name)
  if (!s) throw new Error('Missing sheet tab: ' + name)
  return s
}

// ── Accounts ────────────────────────────────────────────────────────────────
// Returns { email, passwordHash, salt, slug, displayName, role, scope } or null.
function findAccount_(email) {
  var values = sheet_(ACCOUNTS_SHEET).getDataRange().getValues()
  var target = norm_(email)
  for (var r = 1; r < values.length; r++) {
    if (norm_(values[r][0]) === target) {
      return {
        email: norm_(values[r][0]),
        passwordHash: String(values[r][1] || '').trim(),
        salt: String(values[r][2] || ''),
        slug: String(values[r][3] || '').trim().toLowerCase(),
        displayName: String(values[r][4] || '').trim(),
        role: String(values[r][5] || '').trim(),
        scope: norm_(values[r][6]) || 'committee',
      }
    }
  }
  return null
}

// Whether a token's scope lets it edit `target` (a committee slug).
function canEdit_(scope, tokenSlug, target) {
  if (!target) return false
  if (scope === 'all' || scope === 'dev') return true
  return target === tokenSlug
}

// ── Tokens (Script Properties) ───────────────────────────────────────────────
function issueToken_(account) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '')
  var exp = Date.now() + TOKEN_TTL_DAYS * 86400000
  PropertiesService.getScriptProperties().setProperty(
    'tok_' + token,
    JSON.stringify({
      scope: account.scope,
      slug: account.slug,
      name: account.displayName,
      // Carried so an Open Call can notify whoever created it without a
      // second Accounts lookup on every application.
      email: account.email,
      exp: exp,
    }),
  )
  return token
}

// Returns { scope, slug, name, email } for a valid, unexpired token, else null.
function readToken_(token) {
  if (!token) return null
  var raw = PropertiesService.getScriptProperties().getProperty('tok_' + token)
  if (!raw) return null
  try {
    var t = JSON.parse(raw)
    if (!t || !t.exp || Date.now() > t.exp) return null
    return {
      scope: t.scope || 'committee',
      slug: t.slug,
      name: t.name,
      // Absent on tokens issued before Open Calls shipped; tokenEmail_ falls
      // back to the Accounts sheet for those (they expire within 7 days).
      email: t.email || '',
    }
  } catch (e) {
    return null
  }
}

// ── Claim store (keeps secrets out of the request URL) ──────────────────────
// The client POSTs credentials (in the body), we stash the JSON reply under
// the client-chosen one-time nonce, and the client reads it back via
// GET ?action=claim&nonce=…. See src/lib/appsScriptPost.js.
var CLAIM_TTL_MS = 120000

function putClaim_(nonce, result) {
  if (!nonce) return
  PropertiesService.getScriptProperties().setProperty(
    'claim_' + nonce,
    JSON.stringify({ result: result, exp: Date.now() + CLAIM_TTL_MS }),
  )
}

// Returns the stored result once (then deletes it), { ok:false, pending:true }
// if the POST hasn't been processed yet, or an expiry error.
function readClaim_(nonce) {
  if (!nonce) return { ok: false, error: 'Missing nonce' }
  var props = PropertiesService.getScriptProperties()
  var raw = props.getProperty('claim_' + nonce)
  if (!raw) return { ok: false, pending: true }
  props.deleteProperty('claim_' + nonce)
  try {
    var c = JSON.parse(raw)
    if (!c || !c.exp || Date.now() > c.exp) return { ok: false, error: 'Expired' }
    return c.result
  } catch (e) {
    return { ok: false, error: 'Bad claim' }
  }
}

// ── Brute-force throttle ────────────────────────────────────────────────────
// Counts failed logins per email in a rolling window; locks the account out
// for a cool-off once the limit is hit. Best-effort (Script Properties).
var LOGIN_MAX_FAILS = 6
var LOGIN_WINDOW_MS = 600000 // 10 minutes

function loginThrottle_(email) {
  var key = 'fail_' + sha256_(norm_(email))
  var props = PropertiesService.getScriptProperties()
  var raw = props.getProperty(key)
  var rec = { n: 0, first: Date.now() }
  if (raw) {
    try {
      rec = JSON.parse(raw)
    } catch (e) {
      /* reset */
    }
  }
  if (Date.now() - rec.first > LOGIN_WINDOW_MS) rec = { n: 0, first: Date.now() }
  return {
    locked: rec.n >= LOGIN_MAX_FAILS,
    fail: function () {
      rec.n += 1
      props.setProperty(key, JSON.stringify(rec))
    },
    clear: function () {
      props.deleteProperty(key)
    },
  }
}

// ── Site settings (global toggles in Script Properties) ─────────────────────
// A tiny global KV any dev/EB account can flip; read publicly by the site.
// Currently just `magazineInHeader` (show the Magazine CTA in the navbar).
var SETTINGS_KEY = 'SITE_SETTINGS'

function readSettings_() {
  var out = { magazineInHeader: true }
  var raw = PropertiesService.getScriptProperties().getProperty(SETTINGS_KEY)
  if (raw) {
    try {
      var parsed = JSON.parse(raw)
      if (parsed && typeof parsed.magazineInHeader === 'boolean') {
        out.magazineInHeader = parsed.magazineInHeader
      }
    } catch (e) {
      /* keep defaults */
    }
  }
  return out
}

function writeSettings_(patch) {
  var current = readSettings_()
  if (patch && typeof patch.magazineInHeader === 'boolean') {
    current.magazineInHeader = patch.magazineInHeader
  }
  PropertiesService.getScriptProperties().setProperty(
    SETTINGS_KEY,
    JSON.stringify(current),
  )
  return current
}

// ── Overrides ────────────────────────────────────────────────────────────────
function readOverrides_() {
  var values = sheet_(OVERRIDES_SHEET).getDataRange().getValues()
  var map = {}
  for (var r = 1; r < values.length; r++) {
    var slug = String(values[r][0] || '').trim().toLowerCase()
    if (!slug) continue
    try {
      map[slug] = JSON.parse(values[r][1] || '{}')
    } catch (e) {
      /* skip malformed row */
    }
  }
  return map
}

function writeOverride_(slug, obj, updatedBy) {
  var sheet = sheet_(OVERRIDES_SHEET)
  var values = sheet.getDataRange().getValues()
  var json = JSON.stringify(obj)
  var now = new Date()
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0] || '').trim().toLowerCase() === slug) {
      sheet.getRange(r + 1, 1, 1, 4).setValues([[slug, json, updatedBy || '', now]])
      return
    }
  }
  sheet.appendRow([slug, json, updatedBy || '', now])
}

// ── Photo upload (base64 data URI → Drive public URL) ────────────────────────
function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name)
  return it.hasNext() ? it.next() : parent.createFolder(name)
}

// The lh3.googleusercontent host serves Drive images reliably inside an <img>
// (the older drive.google.com/uc?export=view links are flaky when hotlinked).
function driveEmbed_(id) {
  return 'https://lh3.googleusercontent.com/d/' + id + '=w1000'
}

function driveId_(url) {
  var m = String(url).match(/(?:\/d\/|[?&]id=|\/file\/d\/)([A-Za-z0-9_-]{20,})/)
  return m ? m[1] : ''
}

// A value is either a "data:image/...;base64,...." string (uploaded to Drive),
// an existing Drive URL (normalised to the reliable embed form), or any other
// URL / empty string (kept as-is).
function resolvePhoto_(value, slug, hint) {
  var v = String(value || '')
  if (v.indexOf('data:') === 0) {
    var comma = v.indexOf(',')
    var mime = v.substring(5, comma).split(';')[0] || 'image/jpeg'
    var ext = mime.split('/')[1] || 'jpg'
    var bytes = Utilities.base64Decode(v.substring(comma + 1))
    var root = DriveApp.getRootFolder()
    var folder = getOrCreateFolder_(getOrCreateFolder_(root, PHOTOS_FOLDER), slug)
    var name = slug + '-' + hint + '-' + Date.now() + '.' + ext
    var file = folder.createFile(Utilities.newBlob(bytes, mime, name))
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
    return driveEmbed_(file.getId())
  }
  if (/drive\.google\.com|googleusercontent/.test(v)) {
    var id = driveId_(v)
    if (id) return driveEmbed_(id)
  }
  return v
}

// ── Open Calls ──────────────────────────────────────────────────────────────
// Officers publish recruitment "calls" (small working groups, campaigns, …)
// for their own committee; visitors apply from the committee page.
//
// This lives here rather than in its own script because officer session
// tokens are kept in THIS project's Script Properties — a separate deployment
// could not validate them without a UrlFetchApp round-trip. Hosting the
// actions here reuses readToken_ / canEdit_ / findAccount_ untouched.
//
//   Calls         A id  B slug  C status  D json
//                 E createdBy  F createdByEmail  G createdAt  H updatedAt
//   Applications  A timestamp  B ref  C callId  D call  E committee
//                 F name  G email  H phone  I year  J positions
//                 K motivation  L answers (JSON)
//
// Both tabs are created on first use, so there is nothing to set up by hand.

var CALLS_HEADERS = [
  'id', 'slug', 'status', 'json', 'createdBy', 'createdByEmail', 'createdAt', 'updatedAt',
]
var APPLICATIONS_HEADERS = [
  'Timestamp', 'Ref', 'Call ID', 'Call', 'Committee', 'Name', 'Email',
  'Phone', 'Year', 'Position(s)', 'Motivation', 'Extra answers (JSON)',
  // Why an officer did or didn't get told about this one. Mail is
  // best-effort (the row must survive a quota or auth failure), so without
  // this the failure is invisible and looks like "nothing happened".
  'Notified',
]

var MAX_TEXT = 4000
var MAX_ANSWER = 2000
var APPLY_DEDUPE_TTL_MS = 86400000 // same applicant + call ignored for 24h
var APPLY_MAX_PER_MIN = 20

function getOrCreateSheet_(name, headers) {
  var ss = ss_()
  var sheet = ss.getSheetByName(name)
  if (!sheet) {
    sheet = ss.insertSheet(name)
    sheet.appendRow(headers)
    sheet.setFrozenRows(1)
    styleHeader_(sheet, headers.length)
    return sheet
  }
  // A tab created by an earlier version keeps its data but picks up any
  // column added since, so old and new rows stay aligned.
  if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    styleHeader_(sheet, headers.length)
  }
  return sheet
}

function styleHeader_(sheet, n) {
  sheet
    .getRange(1, 1, 1, n)
    .setFontWeight('bold')
    .setBackground('#06402B')
    .setFontColor('#ffffff')
}

function str_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 300)
}

function isEmail_(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ''))
}

// ── Deadline / lifecycle ────────────────────────────────────────────────────
// A call is live when its status is 'open' AND its deadline (if any) hasn't
// gone by. That's derived on every read, so there is no trigger to fall out
// of sync — an expired call drops off the site by itself.
//
// Dates are plain 'YYYY-MM-DD' strings compared lexicographically against
// today in the SCRIPT's timezone, which sidesteps offset/DST arithmetic
// entirely. The deadline day itself still counts (inclusive).
function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

function deadlinePassed_(deadline) {
  var d = str_(deadline, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  return todayStr_() > d
}

function effectiveStatus_(status, deadline) {
  var s = norm_(status) || 'draft'
  if (s === 'open' && deadlinePassed_(deadline)) return 'expired'
  return s
}

// ── Reading ─────────────────────────────────────────────────────────────────
function readCalls_() {
  var values = getOrCreateSheet_(CALLS_SHEET, CALLS_HEADERS).getDataRange().getValues()
  var out = []
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][0] || '').trim()
    if (!id) continue
    var data
    try {
      data = JSON.parse(values[r][3] || '{}')
    } catch (e) {
      continue // skip a malformed row rather than failing the whole read
    }
    out.push({
      row: r + 1,
      id: id,
      slug: norm_(values[r][1]),
      status: norm_(values[r][2]) || 'draft',
      data: data || {},
      createdBy: String(values[r][4] || ''),
      createdByEmail: String(values[r][5] || ''),
      createdAt: values[r][6] || '',
      updatedAt: values[r][7] || '',
    })
  }
  return out
}

function findCall_(id) {
  if (!id) return null
  var calls = readCalls_()
  for (var i = 0; i < calls.length; i++) {
    if (calls[i].id === id) return calls[i]
  }
  return null
}

// What visitors are allowed to see: no notifyEmail, no createdByEmail.
function publicCall_(c) {
  var d = c.data || {}
  return {
    id: c.id,
    slug: c.slug,
    title: d.title || '',
    kind: d.kind || '',
    summary: d.summary || '',
    description: d.description || '',
    commitment: d.commitment || '',
    deadline: d.deadline || '',
    positions: Array.isArray(d.positions) ? d.positions : [],
    questions: Array.isArray(d.questions) ? d.questions : [],
  }
}

// { slug: [call, …] } of live calls only, soonest deadline first.
function readPublicCalls_() {
  var map = {}
  readCalls_().forEach(function (c) {
    if (effectiveStatus_(c.status, c.data.deadline) !== 'open') return
    if (!map[c.slug]) map[c.slug] = []
    map[c.slug].push(publicCall_(c))
  })
  Object.keys(map).forEach(function (slug) {
    map[slug].sort(function (a, b) {
      // Dated calls first (soonest first), undated ones after.
      if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : 1
      if (a.deadline) return -1
      if (b.deadline) return 1
      return 0
    })
  })
  return map
}

function applicationCounts_() {
  var values = getOrCreateSheet_(APPLICATIONS_SHEET, APPLICATIONS_HEADERS)
    .getDataRange()
    .getValues()
  var counts = {}
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][2] || '').trim()
    if (id) counts[id] = (counts[id] || 0) + 1
  }
  return counts
}

function iso_(v) {
  if (!v) return ''
  try {
    return new Date(v).toISOString()
  } catch (e) {
    return ''
  }
}

// ── Writing ─────────────────────────────────────────────────────────────────
// Trim and clamp everything an officer submits; never trust the client shape.
function sanitizeCall_(f) {
  f = f || {}

  var positions = (Array.isArray(f.positions) ? f.positions : [])
    .slice(0, MAX_POSITIONS)
    .map(function (p, i) {
      return {
        id: str_(p && p.id, 60) || 'p' + i,
        title: str_(p && p.title, 120),
        blurb: str_(p && p.blurb, 400),
        slots: str_(p && p.slots, 40),
      }
    })
    .filter(function (p) {
      return p.title
    })

  var questions = (Array.isArray(f.questions) ? f.questions : [])
    .slice(0, MAX_QUESTIONS)
    .map(function (q, i) {
      var type = str_(q && q.type, 20)
      if (type !== 'long' && type !== 'select') type = 'short'
      var options = (Array.isArray(q && q.options) ? q.options : [])
        .slice(0, 12)
        .map(function (o) {
          return str_(o, 120)
        })
        .filter(Boolean)
      // A dropdown with nothing to choose from is just a text box.
      if (type === 'select' && options.length === 0) type = 'short'
      return {
        id: str_(q && q.id, 60) || 'q' + i,
        label: str_(q && q.label, 200),
        type: type,
        options: options,
        required: Boolean(q && q.required),
      }
    })
    .filter(function (q) {
      return q.label
    })

  var deadline = str_(f.deadline, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) deadline = ''

  var notifyEmail = str_(f.notifyEmail, 200)
  if (notifyEmail && !isEmail_(notifyEmail)) notifyEmail = ''

  return {
    title: str_(f.title, 140),
    kind: str_(f.kind, 60),
    summary: str_(f.summary, 300),
    description: str_(f.description, MAX_TEXT),
    commitment: str_(f.commitment, 140),
    deadline: deadline,
    notifyEmail: notifyEmail,
    positions: positions,
    questions: questions,
  }
}

// The address to notify for a call this officer is creating. Tokens issued
// before Open Calls shipped carry no email — fall back to their Accounts row.
function tokenEmail_(t) {
  if (t && t.email) return t.email
  if (!t || !t.slug) return ''
  var values = sheet_(ACCOUNTS_SHEET).getDataRange().getValues()
  for (var r = 1; r < values.length; r++) {
    if (norm_(values[r][3]) === norm_(t.slug)) return norm_(values[r][0])
  }
  return ''
}

function writeCall_(payload, t) {
  var fields = sanitizeCall_(payload.fields)
  if (!fields.title) return { ok: false, error: 'A call needs a title.' }

  var status = norm_(payload.status)
  if (status !== 'open' && status !== 'closed' && status !== 'draft') status = 'open'

  var sheet = getOrCreateSheet_(CALLS_SHEET, CALLS_HEADERS)
  var now = new Date()
  var id = String(payload.id || '').trim()

  // Update: the existing row's committee decides who may touch it, and the
  // original creator (and their notify address) is preserved.
  if (id) {
    var existing = findCall_(id)
    if (!existing) return { ok: false, error: 'That call no longer exists.' }
    if (!canEdit_(t.scope, t.slug, existing.slug)) {
      return { ok: false, error: 'Not allowed to edit that call' }
    }
    sheet
      .getRange(existing.row, 1, 1, CALLS_HEADERS.length)
      .setValues([[
        id,
        existing.slug,
        status,
        JSON.stringify(fields),
        existing.createdBy || t.name || '',
        // Backfill: a call created with an older token stored no creator
        // address, which would leave it permanently unable to notify.
        existing.createdByEmail || tokenEmail_(t),
        existing.createdAt,
        now,
      ]])
    return { ok: true, id: id }
  }

  var slug = norm_(payload.slug || t.slug)
  if (!canEdit_(t.scope, t.slug, slug)) {
    return { ok: false, error: 'Not allowed to post calls for ' + slug }
  }
  id = Utilities.getUuid().replace(/-/g, '').slice(0, 16)
  sheet.appendRow([
    id, slug, status, JSON.stringify(fields),
    t.name || '', tokenEmail_(t), now, now,
  ])
  return { ok: true, id: id }
}

// Close / reopen. Reversible, and applications are untouched either way.
function setCallStatus_(id, status, t) {
  var call = findCall_(id)
  if (!call) return { ok: false, error: 'That call no longer exists.' }
  if (!canEdit_(t.scope, t.slug, call.slug)) {
    return { ok: false, error: 'Not allowed' }
  }
  var next = norm_(status)
  if (next !== 'open' && next !== 'closed' && next !== 'draft') {
    return { ok: false, error: 'Unknown status' }
  }
  var sheet = getOrCreateSheet_(CALLS_SHEET, CALLS_HEADERS)
  sheet.getRange(call.row, 3).setValue(next)
  sheet.getRange(call.row, 8).setValue(new Date())
  return { ok: true, id: id, status: next }
}

// Removes the call itself. The Applications rows are DELIBERATELY kept — they
// carry the call title and reference, so they stay readable on their own, and
// tidying up a call must never destroy what people submitted to it.
function deleteCall_(id, t) {
  var call = findCall_(id)
  if (!call) return { ok: true, id: id } // already gone; nothing to undo
  if (!canEdit_(t.scope, t.slug, call.slug)) {
    return { ok: false, error: 'Not allowed' }
  }
  getOrCreateSheet_(CALLS_SHEET, CALLS_HEADERS).deleteRow(call.row)
  return { ok: true, id: id }
}

// Everything for one committee, drafts and closed calls included.
function officerCalls_(slug, t) {
  if (!canEdit_(t.scope, t.slug, slug)) return { ok: false, error: 'Not allowed' }
  var counts = applicationCounts_()
  var calls = readCalls_()
    .filter(function (c) {
      return c.slug === slug
    })
    .map(function (c) {
      var out = publicCall_(c)
      out.status = c.status
      out.effectiveStatus = effectiveStatus_(c.status, c.data.deadline)
      out.notifyEmail = c.data.notifyEmail || ''
      out.createdBy = c.createdBy
      out.applications = counts[c.id] || 0
      out.updatedAt = iso_(c.updatedAt)
      return out
    })
  calls.reverse() // newest first
  return { ok: true, calls: calls }
}

// Applications carry personal data, so this is POST-only (token in the body).
function applications_(callId, t) {
  var call = findCall_(callId)
  if (!call) return { ok: false, error: 'That call no longer exists.' }
  if (!canEdit_(t.scope, t.slug, call.slug)) return { ok: false, error: 'Not allowed' }

  var values = getOrCreateSheet_(APPLICATIONS_SHEET, APPLICATIONS_HEADERS)
    .getDataRange()
    .getValues()
  var out = []
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][2] || '').trim() !== callId) continue
    var answers = {}
    try {
      answers = JSON.parse(values[r][11] || '{}') || {}
    } catch (e) {
      answers = {}
    }
    out.push({
      at: iso_(values[r][0]),
      ref: String(values[r][1] || ''),
      name: String(values[r][5] || ''),
      email: String(values[r][6] || ''),
      phone: String(values[r][7] || ''),
      year: String(values[r][8] || ''),
      positions: String(values[r][9] || ''),
      motivation: String(values[r][10] || ''),
      answers: answers,
    })
  }
  out.reverse() // newest first
  return { ok: true, applications: out }
}

// ── Applying ────────────────────────────────────────────────────────────────
// Apps Script can't see the client IP, so guard the way signups.gs does:
// ignore a repeat from the same applicant on the same call, and cap the rate.
function applyGuard_(callId, email) {
  var props = PropertiesService.getScriptProperties()
  var now = Date.now()
  var fp = sha256_('apply|' + callId + '|' + norm_(email)).slice(0, 32)
  var seen = props.getProperty('appl_' + fp)
  if (seen && now - Number(seen) < APPLY_DEDUPE_TTL_MS) return 'dup'

  var winKey = 'applrate_' + Math.floor(now / 60000)
  var n = Number(props.getProperty(winKey) || 0)
  if (n >= APPLY_MAX_PER_MIN) return 'flood'

  props.setProperty('appl_' + fp, String(now))
  props.setProperty(winKey, String(n + 1))
  return ''
}

// Every officer account attached to a committee. Used as the fallback when a
// call has no stored creator — better to tell the whole committee than nobody.
function committeeEmails_(slug) {
  var out = []
  if (!slug) return out
  var values = sheet_(ACCOUNTS_SHEET).getDataRange().getValues()
  for (var r = 1; r < values.length; r++) {
    if (norm_(values[r][3]) !== norm_(slug)) continue
    var email = norm_(values[r][0])
    if (email && out.indexOf(email) === -1) out.push(email)
  }
  return out
}

// Who to tell about an application, resolved at SEND time rather than trusted
// from what was stored when the call was created — a call made with a session
// that predated the token `email` field has no creator on it, and would
// otherwise be permanently unable to notify anyone.
function recipientsFor_(call) {
  var to = []
  var add = function (email) {
    var e = norm_(email)
    if (e && to.indexOf(e) === -1) to.push(e)
  }
  add(call.createdByEmail)
  if (to.length === 0) committeeEmails_(call.slug).forEach(add)
  add(call.data.notifyEmail)
  return to
}

// Returns a short human-readable outcome, stored on the application row.
function notifyApplication_(call, row) {
  var to = recipientsFor_(call)
  if (to.length === 0) {
    // Only reachable when the committee has no officer account at all and no
    // "also notify" address was set on the call.
    return 'NOT SENT — no officer account for ' + call.slug + ' and no notify address'
  }

  var lines = [
    'Reference:   ' + row.ref,
    'Call:        ' + (call.data.title || '(untitled)'),
    'Committee:   ' + call.slug,
    '',
    'Name:        ' + row.name,
    'Email:       ' + row.email,
    'Phone:       ' + (row.phone || '—'),
    'Year:        ' + (row.year || '—'),
    'Position(s): ' + (row.positions || '—'),
    '',
    'Why they want to join:',
    row.motivation,
  ]
  Object.keys(row.answers).forEach(function (label) {
    lines.push('', label + ':', row.answers[label])
  })
  lines.push('', 'Review every application: ' + SITE_URL + '/account')

  try {
    MailApp.sendEmail({
      to: to.join(','),
      subject: '[AUSSS] New application — ' + (call.data.title || 'Open call'),
      body: lines.join('\n'),
      replyTo: row.email, // officers can answer straight from the notification
      name: 'AUSSS Open Calls',
    })
    return 'sent to ' + to.join(', ')
  } catch (mailErr) {
    // Never lose the row over a mail quota or a missing authorisation — but
    // say so on the row, or the application looks like it vanished.
    Logger.log('application email failed: ' + mailErr)
    return 'FAILED — ' + (mailErr && mailErr.message ? mailErr.message : mailErr)
  }
}

function apply_(payload) {
  var call = findCall_(String(payload.callId || '').trim())
  if (!call) return { ok: false, error: 'That call is no longer available.' }

  // Re-checked here, not just on the public read: someone sitting on a stale
  // page (or a cached calls map) could still have the form open past the
  // deadline, and a client-side filter alone would let that through.
  if (effectiveStatus_(call.status, call.data.deadline) !== 'open') {
    return { ok: false, error: 'This call has closed.' }
  }

  var ref = str_(payload.ref, 40)
  // Honeypot: bots fill hidden fields. Look successful, write nothing.
  if (str_(payload.website, 100)) return { ok: true, ref: ref }

  var name = str_(payload.name, 140)
  var email = str_(payload.email, 200)
  if (!name || !isEmail_(email)) {
    return { ok: false, error: 'Please enter your name and a valid email address.' }
  }
  var motivation = str_(payload.motivation, MAX_TEXT)
  if (!motivation) return { ok: false, error: 'Please tell us why you want to join.' }

  // Positions are resolved through the call's own list — a client can't
  // invent one, and the sheet stores readable titles rather than ids.
  var titles = {}
  var defined = Array.isArray(call.data.positions) ? call.data.positions : []
  defined.forEach(function (p) {
    titles[String(p.id)] = p.title
  })
  var chosen = (Array.isArray(payload.positions) ? payload.positions : [])
    .slice(0, MAX_POSITIONS)
    .map(function (pid) {
      return titles[String(pid)] || ''
    })
    .filter(Boolean)
  if (defined.length > 0 && chosen.length === 0) {
    return { ok: false, error: 'Please choose at least one position.' }
  }

  var answers = {}
  var missing = ''
  var questions = Array.isArray(call.data.questions) ? call.data.questions : []
  questions.forEach(function (q) {
    var v = str_((payload.answers || {})[q.id], MAX_ANSWER)
    if (q.type === 'select' && v && (q.options || []).indexOf(v) === -1) v = ''
    if (q.required && !v && !missing) missing = q.label
    if (v) answers[q.label] = v
  })
  if (missing) return { ok: false, error: 'Please answer: ' + missing }

  var guard = applyGuard_(call.id, email)
  if (guard === 'dup') return { ok: true, duplicate: true, ref: ref }
  if (guard === 'flood') {
    return { ok: false, error: 'Too many applications right now — please retry shortly.' }
  }

  var row = {
    ref: ref,
    name: name,
    email: email,
    phone: str_(payload.phone, 60),
    year: str_(payload.year, 60),
    positions: chosen.join(', '),
    motivation: motivation,
    answers: answers,
  }

  var sheet = getOrCreateSheet_(APPLICATIONS_SHEET, APPLICATIONS_HEADERS)
  sheet.appendRow([
    new Date(),
    row.ref,
    call.id,
    call.data.title || '',
    call.slug,
    row.name,
    row.email,
    row.phone,
    row.year,
    row.positions,
    row.motivation,
    JSON.stringify(row.answers),
    '', // filled in below
  ])

  // The row is saved before we try to mail, so a mail problem can never cost
  // an application. The outcome then goes back onto that row.
  var outcome = notifyApplication_(call, row)
  sheet.getRange(sheet.getLastRow(), APPLICATIONS_HEADERS.length).setValue(outcome)
  return { ok: true, ref: row.ref }
}

// ── Web app entrypoints ───────────────────────────────────────────────────
function doGet(e) {
  var p = (e && e.parameter) || {}
  var action = String(p.action || 'overrides').toLowerCase()
  try {
    if (action === 'overrides') {
      return json_({ ok: true, overrides: readOverrides_() })
    }

    // Public read of the live Open Calls, grouped by committee slug. Only
    // calls that are open AND still inside their deadline come back, and the
    // notify addresses are stripped. Same rhythm as `overrides` above.
    if (action === 'calls') {
      return json_({ ok: true, calls: readPublicCalls_() })
    }

    // Which build is live. No data, no auth — just the marker above.
    if (action === 'version') {
      return json_({ ok: true, version: SCRIPT_VERSION })
    }

    // Read back the result of a POSTed login/setsettings (see doPost).
    if (action === 'claim') {
      return json_(readClaim_(p.nonce))
    }

    // Public read of the global site settings (e.g. magazineInHeader).
    if (action === 'settings') {
      return json_({ ok: true, settings: readSettings_() })
    }

    // Dev/EB write of a site setting. GET (not POST) so the reply — the saved
    // settings — is readable across Apps Script's 302 redirect, letting the
    // toggle confirm immediately. Requires an 'all' or 'dev' scoped token.
    if (action === 'setsettings') {
      var st = readToken_(p.token)
      if (!st) return json_({ ok: false, error: 'Session expired' })
      if (st.scope !== 'all' && st.scope !== 'dev') {
        return json_({ ok: false, error: 'Not allowed' })
      }
      var patch = {}
      if (typeof p.magazineInHeader !== 'undefined') {
        patch.magazineInHeader = String(p.magazineInHeader) === 'true'
      }
      return json_({ ok: true, settings: writeSettings_(patch) })
    }

    if (action === 'login') {
      var acct = findAccount_(p.email)
      if (!acct || !acct.passwordHash) {
        return json_({ ok: false, error: 'Invalid email or password' })
      }
      if (sha256_(acct.salt + String(p.password || '')) !== acct.passwordHash) {
        return json_({ ok: false, error: 'Invalid email or password' })
      }
      return json_({
        ok: true,
        token: issueToken_(acct),
        scope: acct.scope,
        slug: acct.slug,
        name: acct.displayName,
      })
    }

    if (action === 'validate') {
      var t = readToken_(p.token)
      if (!t) return json_({ ok: false, error: 'Session expired' })
      return json_({ ok: true, scope: t.scope, slug: t.slug, name: t.name })
    }

    return json_({ ok: false, error: 'Unknown action' })
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) })
  }
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents
    var payload = raw ? JSON.parse(raw) : {}
    var action = String(payload.action || '').toLowerCase()

    // Login over POST so the password never appears in a URL. The reply is
    // stashed for the client's follow-up ?action=claim&nonce=… (see helpers).
    if (action === 'login') {
      var throttle = loginThrottle_(payload.email)
      var result
      if (throttle.locked) {
        result = { ok: false, error: 'Too many attempts — try again later' }
      } else {
        var acct = findAccount_(payload.email)
        var good =
          acct &&
          acct.passwordHash &&
          sha256_(acct.salt + String(payload.password || '')) === acct.passwordHash
        if (!good) {
          throttle.fail()
          result = { ok: false, error: 'Invalid email or password' }
        } else {
          throttle.clear()
          result = {
            ok: true,
            token: issueToken_(acct),
            scope: acct.scope,
            slug: acct.slug,
            name: acct.displayName,
          }
        }
      }
      putClaim_(payload.nonce, result)
      return json_({ ok: true })
    }

    // Dev/EB site-settings write over POST (token in the body, not the URL).
    // The client re-reads ?action=settings to confirm, so no claim is needed.
    if (action === 'setsettings') {
      var st = readToken_(payload.token)
      if (st && (st.scope === 'all' || st.scope === 'dev')) {
        var patch = {}
        if (typeof payload.magazineInHeader !== 'undefined') {
          patch.magazineInHeader = Boolean(payload.magazineInHeader)
        }
        writeSettings_(patch)
      }
      return json_({ ok: true })
    }

    // ── Open Calls ────────────────────────────────────────────────────────
    // A visitor's application. Public (no token), but body-carried so their
    // details never reach a URL; the client claims the reply by nonce.
    if (action === 'apply') {
      putClaim_(payload.nonce, apply_(payload))
      return json_({ ok: true })
    }

    // Officer-side call management. Every one of these carries a token and,
    // for `applications`, personal data — so they are POST + claim, never a
    // GET with the token in the query string.
    if (
      action === 'callsave' ||
      action === 'callstatus' ||
      action === 'calldelete' ||
      action === 'officercalls' ||
      action === 'applications'
    ) {
      var ct = readToken_(payload.token)
      var result
      if (!ct) {
        result = { ok: false, error: 'Session expired' }
      } else if (action === 'callsave') {
        result = writeCall_(payload, ct)
      } else if (action === 'callstatus') {
        result = setCallStatus_(String(payload.id || ''), payload.status, ct)
      } else if (action === 'calldelete') {
        result = deleteCall_(String(payload.id || ''), ct)
      } else if (action === 'officercalls') {
        result = officerCalls_(norm_(payload.slug || ct.slug), ct)
      } else {
        result = applications_(String(payload.callId || '').trim(), ct)
      }
      putClaim_(payload.nonce, result)
      return json_({ ok: true })
    }

    if (action !== 'save') return json_({ ok: false, error: 'Unknown action' })

    var t = readToken_(payload.token)
    if (!t) return json_({ ok: false, error: 'Session expired' })

    // Target committee: officers may only edit their own; EB/dev edit any.
    var slug = String(payload.slug || t.slug || '').trim().toLowerCase()
    if (!canEdit_(t.scope, t.slug, slug)) {
      return json_({ ok: false, error: 'Not allowed to edit ' + slug })
    }
    var f = payload.fields || {}

    // Build the resolved override, uploading any freshly-picked photos.
    var members = Array.isArray(f.members) ? f.members.slice(0, MAX_MEMBERS) : []
    var resolvedMembers = members.map(function (m, i) {
      return {
        id: String(m.id || 'm' + i),
        name: String(m.name || '').trim(),
        title: String(m.title || '').trim(),
        photo: resolvePhoto_(m.photo, slug, 'member-' + (m.id || i)),
      }
    })

    // "What we run" cards — scope must be AUSSS or IFMSA-Egypt; cap at 6.
    var activities = Array.isArray(f.activities)
      ? f.activities.slice(0, MAX_ACTIVITIES)
      : []
    var resolvedActivities = activities
      .map(function (a) {
        var scope = String((a && a.scope) || '')
        if (scope !== 'AUSSS' && scope !== 'IFMSA-Egypt') scope = 'AUSSS'
        return {
          title: String((a && a.title) || '').trim(),
          blurb: String((a && a.blurb) || '').trim(),
          type: String((a && a.type) || '').trim(),
          scope: scope,
        }
      })
      .filter(function (a) {
        return a.title || a.blurb
      })

    var override = {
      tagline: String(f.tagline || '').trim(),
      about: Array.isArray(f.about)
        ? f.about.map(function (x) { return String(x).trim() }).filter(Boolean)
        : [],
      whatWeDo: Array.isArray(f.whatWeDo)
        ? f.whatWeDo.map(function (x) { return String(x).trim() }).filter(Boolean)
        : [],
      // "What we do" is opt-in (off by default) — officers toggle it on.
      whatWeDoEnabled: Boolean(f.whatWeDoEnabled),
      photo: resolvePhoto_(f.photo, slug, 'officer'),
      membersEnabled: Boolean(f.membersEnabled),
      members: resolvedMembers,
      activities: resolvedActivities,
    }

    writeOverride_(slug, override, t.name)
    return json_({ ok: true, slug: slug })
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) })
  }
}

// ── Password helpers ─────────────────────────────────────────────────────────

// Writes a fresh salt + hash for one account directly into the Accounts sheet.
// Returns true if the email was found. Used by both the menu and setPassword().
function writePassword_(email, newPassword) {
  var sheet = sheet_(ACCOUNTS_SHEET)
  var values = sheet.getDataRange().getValues()
  var target = norm_(email)
  for (var r = 1; r < values.length; r++) {
    if (norm_(values[r][0]) === target) {
      var salt = Utilities.getUuid().replace(/-/g, '')
      sheet.getRange(r + 1, 2).setValue(sha256_(salt + String(newPassword))) // B
      sheet.getRange(r + 1, 3).setValue(salt) // C
      return true
    }
  }
  return false
}

// EASIEST: open the bound Google Sheet → "AUSSS" menu → "Set / reset a
// password" → type the email and the new password. No code editing.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AUSSS')
    .addItem('Set / reset a password', 'promptSetPassword')
    .addToUi()
}

function promptSetPassword() {
  var ui = SpreadsheetApp.getUi()
  var e = ui.prompt('Reset password', 'Account email:', ui.ButtonSet.OK_CANCEL)
  if (e.getSelectedButton() !== ui.Button.OK) return
  var p = ui.prompt('Reset password', 'New password:', ui.ButtonSet.OK_CANCEL)
  if (p.getSelectedButton() !== ui.Button.OK) return
  var ok = writePassword_(e.getResponseText().trim(), p.getResponseText())
  ui.alert(ok ? 'Password updated.' : 'No account found for that email.')
}

// Alternative (no menu): set the two vars, then Run → setPassword.
function setPassword() {
  var email = 'someone@example.com'
  var newPassword = 'CHANGE_ME'
  Logger.log(
    writePassword_(email, newPassword)
      ? 'Updated password for ' + email
      : 'No account found for ' + email,
  )
}

// Run this ONCE from the editor (pick it in the Run dropdown, click Run) after
// pasting a version that sends mail.
//
// Application notifications need the script.send_mail scope, and Apps Script
// only asks for scopes the SAVED code actually uses — so running a function
// that touches no mail (computeHash, say) never triggers the prompt, and the
// web app then fails at runtime with "You do not have permission to call
// MailApp.sendEmail". This function calls MailApp directly, so the prompt is
// unavoidable, and a successful run proves delivery by mailing you.
//
// Safe to re-run. Redeploy a new version afterwards so the web app picks the
// new authorisation up.
function authorizeMail() {
  var me = Session.getEffectiveUser().getEmail()
  MailApp.sendEmail({
    to: me,
    subject: '[AUSSS] Open Calls — mail is now authorised',
    body: [
      'If you are reading this, officers.gs can send application notifications.',
      '',
      'Script version:        ' + SCRIPT_VERSION,
      'Emails left today:     ' + MailApp.getRemainingDailyQuota(),
      '',
      'Next: Deploy > Manage deployments > pencil > New version > Deploy.',
    ].join('\n'),
    name: 'AUSSS Open Calls',
  })
  Logger.log('Test email sent to ' + me + ' (version ' + SCRIPT_VERSION + ')')
}

// Seeding helper kept for reference: logs a hash+salt you paste in by hand.
function computeHash() {
  var password = 'CHANGE_ME'
  var salt = 'CHANGE_ME_TO_SOMETHING_RANDOM'
  Logger.log('salt:        ' + salt)
  Logger.log('passwordHash: ' + sha256_(salt + password))
}
