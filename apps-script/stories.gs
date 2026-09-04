/**
 * AUSSS exchange stories — Google Apps Script Web App
 * ---------------------------------------------------------------------------
 * Companion to orders.gs. Bind this to a Google Sheet (Extensions → Apps
 * Script) or use a standalone script and set SPREADSHEET_ID below.
 * Deployment:
 *
 *     Deploy → New deployment → Web app
 *       Execute as:        Me
 *       Who has access:    Anyone
 *
 * Copy the /exec URL into src/data/storiesConfig.js (STORIES_WEBAPP_URL).
 *
 * Request — POST with content-type "text/plain;charset=utf-8" (avoids the
 *           CORS preflight; the body is JSON):
 *   {
 *     name, email, phone,
 *     destination, programme, year,   // optional
 *     story,                          // the story text
 *     reference: 'STORY-XXXXX',       // generated client-side
 *     submittedAt: string,            // ISO from the browser
 *   }
 *
 * Response:
 *   { ok: true,  reference: 'STORY-XXXXX' }
 *   { ok: false, error: '...' }
 *
 * Sheet columns are listed in HEADERS below and auto-created on first run.
 */

// ── Config — edit these once after pasting the script ────────────────────

// Sheet ID. Leave '' if this script is bound to the sheet directly.
var SPREADSHEET_ID = ''

// Tab name. Auto-created with headers if absent.
var SHEET_NAME = 'Exchange Stories'

// Where story-notification emails go. Set to '' to disable email sending
// (the story still lands in the sheet).
var TEAM_EMAIL = 'aussswebsite@gmail.com'

// ── Column layout — change here and re-add headers if you reshape it ─────
var HEADERS = [
  'Timestamp',
  'Reference',
  'Status',
  'Name',
  'Email',
  'Phone',
  'Destination',
  'Programme',
  'Year',
  'Story',
  'Submitted At (client)',
]

// ── Abuse guards ───────────────────────────────────────────────────────────
// Apps Script can't see the client IP, so we drop exact-duplicate submissions
// in a short window and cap total submissions per rolling minute.
var DEDUPE_TTL_MS = 90000
var GLOBAL_MAX_PER_MIN = 15

function sha1_(s) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    String(s),
    Utilities.Charset.UTF_8,
  )
    .map(function (b) {
      return ('0' + (b & 0xff).toString(16)).slice(-2)
    })
    .join('')
}

// Returns 'dup', 'flood', or '' (ok).
function abuseCheck_(payload) {
  var props = PropertiesService.getScriptProperties()
  var now = Date.now()
  var fp = sha1_([payload.email, payload.phone, payload.story].join('|'))
  var seen = props.getProperty('seen_' + fp)
  if (seen && now - Number(seen) < DEDUPE_TTL_MS) return 'dup'

  var winKey = 'rate_' + Math.floor(now / 60000)
  var n = Number(props.getProperty(winKey) || 0)
  if (n >= GLOBAL_MAX_PER_MIN) return 'flood'

  props.setProperty('seen_' + fp, String(now))
  props.setProperty(winKey, String(n + 1))
  return ''
}

// ── Helpers ──────────────────────────────────────────────────────────────

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

function generateReference_() {
  var t = Date.now().toString(36).toUpperCase().slice(-5)
  var r = Math.floor(Math.random() * 1000).toString()
  while (r.length < 3) r = '0' + r
  return 'STORY-' + t + r
}

function getSheet_() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet()
  var sheet = ss.getSheetByName(SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME)
    sheet.appendRow(HEADERS)
    sheet.setFrozenRows(1)
    sheet
      .getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#06402B')
      .setFontColor('#ffffff')
  }
  return sheet
}

function sendNotification_(reference, payload) {
  if (!TEAM_EMAIL) return
  try {
    var subject = '[AUSSS] New exchange story — ' + reference
    var lines = [
      'Reference:    ' + reference,
      'Submitted:    ' + (payload.submittedAt || new Date().toISOString()),
      '',
      'From:',
      '  Name:       ' + (payload.name || '—'),
      '  Email:      ' + (payload.email || '—'),
      '  Phone:      ' + (payload.phone || '—'),
      '',
      'Exchange:',
      '  Destination: ' + (payload.destination || '—'),
      '  Programme:   ' + (payload.programme || '—'),
      '  Year:        ' + (payload.year || '—'),
      '',
      'Story:',
      payload.story || '(none)',
    ]
    MailApp.sendEmail(TEAM_EMAIL, subject, lines.join('\n'))
  } catch (e) {
    // Email failure must never block a submission. Logger output is visible
    // in Apps Script → Executions.
    Logger.log('email failed: ' + (e && e.message ? e.message : e))
  }
}

// ── Web app entrypoints ─────────────────────────────────────────────────

function doGet(e) {
  // Health check, useful for confirming the deploy URL works in a browser.
  return json_({ ok: true, message: 'AUSSS exchange stories endpoint up' })
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents
    if (!raw) return json_({ ok: false, error: 'Empty body' })

    var payload
    try {
      payload = JSON.parse(raw)
    } catch (parseErr) {
      return json_({ ok: false, error: 'Invalid JSON body' })
    }
    if (!payload || typeof payload !== 'object') {
      return json_({ ok: false, error: 'Empty payload' })
    }

    if (!payload.name || !payload.email || !payload.phone) {
      return json_({ ok: false, error: 'Missing required contact fields' })
    }
    if (!payload.story) {
      return json_({ ok: false, error: 'Story is empty' })
    }

    var abuse = abuseCheck_(payload)
    if (abuse === 'dup') {
      return json_({ ok: true, reference: payload.reference || '', duplicate: true })
    }
    if (abuse === 'flood') {
      return json_({ ok: false, error: 'Too many submissions right now — please retry shortly' })
    }

    // Prefer the client-supplied reference so the success page, sheet row,
    // and email all match. Fall back to a server-generated one.
    var reference =
      payload.reference && /^STORY-[A-Z0-9]{1,12}$/.test(payload.reference)
        ? payload.reference
        : generateReference_()

    var sheet = getSheet_()
    sheet.appendRow([
      new Date(),
      reference,
      'new',
      payload.name || '',
      payload.email || '',
      payload.phone || '',
      payload.destination || '',
      payload.programme || '',
      payload.year || '',
      payload.story || '',
      payload.submittedAt || '',
    ])

    sendNotification_(reference, payload)

    return json_({ ok: true, reference: reference })
  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    })
  }
}
