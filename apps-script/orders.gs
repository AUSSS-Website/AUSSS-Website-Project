/**
 * AUSSS merch orders — Google Apps Script Web App
 * ---------------------------------------------------------------------------
 * Bind this to a Google Sheet (Extensions → Apps Script), or use a
 * standalone script and set SPREADSHEET_ID below. Deployment:
 *
 *     Deploy → New deployment → Web app
 *       Execute as:        Me
 *       Who has access:    Anyone
 *
 * Copy the /exec URL into src/data/merchConfig.js (ORDERS_WEBAPP_URL).
 *
 * Request — POST with content-type "text/plain;charset=utf-8" (avoids the
 *           CORS preflight that text/plain bypasses, the body is JSON):
 *   {
 *     contact: { name, email, phone, isMember, year, notes },
 *     items: [{ productId, size, design, qty }],
 *     subtotal: number,
 *     paymentMethod: 'instapay' | 'telda' | 'vodafone',
 *     itemsSummary: string,         // already-formatted by the frontend
 *     screenshotBase64?: string,    // base64 string, no data: prefix
 *     screenshotFilename?: string,
 *     submittedAt: string,          // ISO from the browser
 *   }
 *
 * Response:
 *   { ok: true,  reference: 'AUSSS-XXXXX' }
 *   { ok: false, error: '...' }
 *
 * Sheet columns are listed in HEADERS below and auto-created on first run.
 * Screenshots land in Drive at
 *     /AUSSS Orders Receipts/YYYY-MM/{reference}-{filename}
 * and the row stores the public view link.
 */

// ── Config — edit these once after pasting the script ────────────────────

// Sheet ID. Leave '' if this script is bound to the sheet directly.
var SPREADSHEET_ID = ''

// Tab name. Auto-created with headers if absent.
var SHEET_NAME = 'Orders'

// Drive folder for receipt screenshots. Auto-created if missing. Inside it
// the script keeps a monthly sub-folder (YYYY-MM).
var RECEIPTS_FOLDER = 'AUSSS Orders Receipts'

// Where order-notification emails go. Set to '' to disable email sending
// (the order still lands in the sheet).
var TEAM_EMAIL = 'aussswebsite@gmail.com'

// ── Column layout — change here and re-add headers if you reshape it ─────
var HEADERS = [
  'Timestamp',
  'Reference',
  'Status',
  'Name',
  'Email',
  'Phone',
  'AUSSS Member',
  'LC (if non-member)',
  'Year / Status',
  'Payment Method',
  'Subtotal (EGP)',
  'Items',
  'Items (JSON)',
  'Receipt',
  'Notes',
  'Submitted At (client)',
]

// ── Server-side price book ───────────────────────────────────────────────
// The subtotal is RECOMPUTED here from these prices — never trusted from the
// client. Keep in sync with src/data/merchProducts.js. Unknown product IDs
// count as 0 and flag the order for manual review.
var PRICES = {
  'tshirt-55': 300,
  jacket: 650,
  'bucket-hat': 150,
  notebook: 40,
}
var MAX_LINE_QTY = 20

function computeSubtotal_(items) {
  var total = 0
  var unknown = false
  ;(items || []).forEach(function (it) {
    var price = PRICES[String(it && it.productId)]
    if (typeof price !== 'number') {
      unknown = true
      return
    }
    var qty = Math.max(0, Math.min(MAX_LINE_QTY, Number(it.qty) || 0))
    total += price * qty
  })
  return { total: total, unknown: unknown }
}

// ── Abuse guards ───────────────────────────────────────────────────────────
// Apps Script doesn't expose the client IP, so we can't rate-limit per user.
// Instead: (1) drop exact-duplicate submissions inside a short window (stops
// accidental double-clicks and naive replay), and (2) cap total submissions
// per rolling minute so a flood can't run the sheet/quota away.
var DEDUPE_TTL_MS = 90000
var GLOBAL_MAX_PER_MIN = 20

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

// Returns 'dup', 'flood', or '' (ok). Best-effort via Script Properties.
function abuseCheck_(payload) {
  var props = PropertiesService.getScriptProperties()
  var now = Date.now()
  var c = payload.contact || {}
  var fp = sha1_([c.email, c.phone, payload.itemsSummary].join('|'))
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
  return 'AUSSS-' + t + r
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

function getOrCreateFolder_(parent, name) {
  var iter = parent.getFoldersByName(name)
  return iter.hasNext() ? iter.next() : parent.createFolder(name)
}

function getReceiptsFolder_() {
  var root = DriveApp.getRootFolder()
  var parent = getOrCreateFolder_(root, RECEIPTS_FOLDER)
  var ym = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM',
  )
  return getOrCreateFolder_(parent, ym)
}

function inferMime_(filename) {
  var ext = String(filename || '').toLowerCase().split('.').pop()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

function uploadReceipt_(base64, filename, reference) {
  if (!base64) return ''
  try {
    var bytes = Utilities.base64Decode(base64)
    var name = reference + '-' + (filename || 'receipt.jpg')
    var blob = Utilities.newBlob(bytes, inferMime_(filename), name)
    var file = getReceiptsFolder_().createFile(blob)
    file.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW,
    )
    return file.getUrl()
  } catch (e) {
    return 'UPLOAD_FAILED: ' + (e && e.message ? e.message : e)
  }
}

function sendNotification_(reference, payload, receiptUrl) {
  if (!TEAM_EMAIL) return
  try {
    var c = payload.contact || {}
    var subject =
      '[AUSSS Merch] New pre-order — ' +
      reference +
      ' (' +
      (payload.subtotal || 0) +
      ' EGP)'
    var lines = [
      'Reference:  ' + reference,
      'Submitted:  ' + (payload.submittedAt || new Date().toISOString()),
      '',
      'Customer:',
      '  Name:    ' + (c.name || '—'),
      '  Email:   ' + (c.email || '—'),
      '  Phone:   ' + (c.phone || '—'),
      '  Member:  ' + (c.isMember || '—') + (c.isMember === 'No' && c.lc ? ' (LC: ' + c.lc + ')' : ''),
      '  Year:    ' + (c.year || '—'),
      '',
      'Payment:    ' + (payload.paymentMethod || '—'),
      'Receipt:    ' + (receiptUrl || '—'),
      '',
      'Items:',
      payload.itemsSummary || '(none)',
      '',
      'Subtotal:   ' + (payload.subtotal || 0) + ' EGP',
    ]
    if (c.notes) {
      lines.push('', 'Notes:', c.notes)
    }
    MailApp.sendEmail(TEAM_EMAIL, subject, lines.join('\n'))
  } catch (e) {
    // Email failure must never block an order. Logger output is visible in
    // Apps Script → Executions.
    Logger.log('email failed: ' + (e && e.message ? e.message : e))
  }
}

// ── Web app entrypoints ─────────────────────────────────────────────────

function doGet(e) {
  // Health check, useful for confirming the deploy URL works in a browser.
  return json_({
    ok: true,
    message: 'AUSSS merch orders endpoint up',
  })
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

    var contact = payload.contact || {}
    if (!contact.name || !contact.email || !contact.phone) {
      return json_({ ok: false, error: 'Missing required contact fields' })
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return json_({ ok: false, error: 'Cart is empty' })
    }

    var abuse = abuseCheck_(payload)
    if (abuse === 'dup') {
      // Treat a duplicate as success so the buyer doesn't re-submit again.
      return json_({ ok: true, reference: payload.reference || '', duplicate: true })
    }
    if (abuse === 'flood') {
      return json_({ ok: false, error: 'Too many orders right now — please retry shortly' })
    }

    // Recompute the price server-side; never trust payload.subtotal.
    var priced = computeSubtotal_(payload.items)
    var clientSubtotal = Number(payload.subtotal || 0)
    var priceFlag =
      priced.unknown || priced.total !== clientSubtotal
        ? '⚠ price mismatch (client said ' + clientSubtotal + ', server ' + priced.total + ')'
        : ''

    // Prefer the client-supplied reference so the buyer's success page,
    // the sheet row, the email, and the receipt filename all match. Fall
    // back to a server-generated one if the client didn't send one.
    var reference =
      (payload.reference && /^AUSSS-[A-Z0-9]{1,12}$/.test(payload.reference))
        ? payload.reference
        : generateReference_()
    var receiptUrl = uploadReceipt_(
      payload.screenshotBase64,
      payload.screenshotFilename,
      reference,
    )

    var sheet = getSheet_()
    sheet.appendRow([
      new Date(),
      reference,
      'new',
      contact.name || '',
      contact.email || '',
      contact.phone || '',
      contact.isMember || '',
      contact.isMember === 'No' ? contact.lc || '' : '',
      contact.year || '',
      payload.paymentMethod || '',
      priced.total,
      payload.itemsSummary || '',
      JSON.stringify(payload.items || []),
      receiptUrl,
      (priceFlag ? priceFlag + ' — ' : '') + (contact.notes || ''),
      payload.submittedAt || '',
    ])

    // Email the authoritative (server) subtotal, flagging any mismatch.
    payload.subtotal = priced.total
    payload.priceFlag = priceFlag
    sendNotification_(reference, payload, receiptUrl)

    return json_({ ok: true, reference: reference })
  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    })
  }
}
