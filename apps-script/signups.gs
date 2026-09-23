/**
 * AUSSS sign-ups, the recruitment waitlist (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Companion to orders.gs / stories.gs. Captures lightweight email sign-ups in
 * one sheet with a `kind` column. The site now only sends 'waitlist'; the
 * 'newsletter' kind is kept so old rows and any future use still work.
 *
 *   Deploy → New deployment → Web app
 *     Execute as:     Me
 *     Who has access: Anyone
 *   Copy the /exec URL into src/data/signupsConfig.js (SIGNUPS_WEBAPP_URL).
 *
 * Request — POST, content-type "text/plain;charset=utf-8" (bypasses CORS
 * preflight); body is JSON: { kind, name, email, phone, submittedAt }.
 */

var SPREADSHEET_ID = '' // leave '' if this script is bound to the sheet
var SHEET_NAME = 'Signups'
var TEAM_EMAIL = 'aussswebsite@gmail.com' // '' to disable email notifications

var HEADERS = ['Timestamp', 'Kind', 'Name', 'Email', 'Phone', 'Submitted At (client)']

// ── Abuse guards (Apps Script can't see client IP) ──────────────────────────
var DEDUPE_TTL_MS = 86400000 // ignore the same email for a kind within 24h
var GLOBAL_MAX_PER_MIN = 30

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

function sha1_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2) })
    .join('')
}

function abuseCheck_(payload) {
  var props = PropertiesService.getScriptProperties()
  var now = Date.now()
  var fp = sha1_([payload.kind, String(payload.email).toLowerCase()].join('|'))
  var seen = props.getProperty('seen_' + fp)
  if (seen && now - Number(seen) < DEDUPE_TTL_MS) return 'dup'

  var winKey = 'rate_' + Math.floor(now / 60000)
  var n = Number(props.getProperty(winKey) || 0)
  if (n >= GLOBAL_MAX_PER_MIN) return 'flood'

  props.setProperty('seen_' + fp, String(now))
  props.setProperty(winKey, String(n + 1))
  return ''
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
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#06402B').setFontColor('#ffffff')
  }
  return sheet
}

function doGet(e) {
  return json_({ ok: true, message: 'AUSSS signups endpoint up' })
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents
    if (!raw) return json_({ ok: false, error: 'Empty body' })
    var payload = JSON.parse(raw)
    if (!payload || !payload.email) {
      return json_({ ok: false, error: 'Missing email' })
    }
    var kind = String(payload.kind || 'newsletter').toLowerCase()
    if (kind !== 'waitlist' && kind !== 'newsletter') kind = 'newsletter'

    var abuse = abuseCheck_(payload)
    if (abuse === 'dup') return json_({ ok: true, duplicate: true })
    if (abuse === 'flood') return json_({ ok: false, error: 'Too many sign-ups right now — retry shortly' })

    getSheet_().appendRow([
      new Date(),
      kind,
      payload.name || '',
      payload.email || '',
      payload.phone || '',
      payload.submittedAt || '',
    ])

    if (TEAM_EMAIL) {
      try {
        MailApp.sendEmail(
          TEAM_EMAIL,
          '[AUSSS] New ' + kind + ' sign-up',
          ['Kind:  ' + kind, 'Name:  ' + (payload.name || '—'), 'Email: ' + payload.email, 'Phone: ' + (payload.phone || '—')].join('\n'),
        )
      } catch (mailErr) {
        Logger.log('email failed: ' + mailErr)
      }
    }

    return json_({ ok: true })
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) })
  }
}
