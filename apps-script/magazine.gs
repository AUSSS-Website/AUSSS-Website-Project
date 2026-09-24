/**
 * RETIRED 2026-09-24 (Phase 5): the counters live in the database (magazine_stats,
 * rpc/magazine_track) and the site no longer calls this web app. Its totals were
 * carried over. Kept for reference only.
 *
 * AUSSS Magazine engagement backend — view + like counters.
 *
 * Deploy (same as the officers script):
 *   1. Create this in a Google Sheet's Apps Script editor
 *      (Extensions → Apps Script) so it's bound to a spreadsheet, OR paste a
 *      spreadsheet id into SHEET_ID below for a standalone script.
 *   2. Deploy → New deployment → Web app → Execute as: Me →
 *      Who has access: Anyone.
 *   3. Copy the /exec URL into src/data/magazineConfig.js.
 *
 * Storage: a sheet named "Engagement" with header row:
 *   id | views | likes | downloads
 * (created automatically on first write; the downloads column is added on the
 * fly to sheets that predate it).
 *
 * All actions are GET so the JSON reply is readable across Apps Script's 302
 * redirect (same approach as officers.gs reads). The client de-dupes likes
 * per browser via localStorage; the server just increments.
 *
 *   ?action=stats               → { ok, stats: { <id>: {views,likes,downloads}, ... } }
 *   ?action=view&id=issue-1     → increments views, returns that id's counts
 *   ?action=like&id=issue-1     → increments likes, returns that id's counts
 *   ?action=download&id=issue-1 → increments downloads, returns that id's counts
 */

var SHEET_NAME = 'Engagement'
var SHEET_ID = '' // optional: spreadsheet id for a standalone (unbound) script

function doGet(e) {
  var p = (e && e.parameter) || {}
  var action = String(p.action || 'stats').toLowerCase()
  try {
    if (action === 'stats') return json_({ ok: true, stats: readAll_() })

    var id = String(p.id || '').trim()
    if (!id) return json_({ ok: false, error: 'Missing id' })

    // Cap total counter writes per rolling minute so a script can't run the
    // numbers (or the Sheets write quota) away. Over the cap we return the
    // current counts without incrementing — the UI still renders fine.
    if (action === 'view' || action === 'like' || action === 'download') {
      if (flooding_()) return json_({ ok: true, id: id, counts: peek_(id), throttled: true })
    }

    if (action === 'view') return json_({ ok: true, id: id, counts: bump_(id, 'views') })
    if (action === 'like') return json_({ ok: true, id: id, counts: bump_(id, 'likes') })
    if (action === 'download') return json_({ ok: true, id: id, counts: bump_(id, 'downloads') })

    return json_({ ok: false, error: 'Unknown action' })
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) })
  }
}

// Adds an "AUSSS Magazine" menu to the bound sheet's toolbar so the counts can
// be reset without opening the Apps Script editor. Runs automatically each time
// the spreadsheet is opened.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AUSSS Magazine')
    .addItem('Reset all counts to 0', 'resetCountsMenu')
    .addItem('Migrate ids (issue-1→vol-6, issue-2→vol-7)', 'relabelIdsMenu')
    .addToUi()
}

// Menu handler: confirm, then zero everything. Shows the result in a dialog.
function resetCountsMenu() {
  var ui = SpreadsheetApp.getUi()
  var res = ui.alert(
    'Reset magazine counts',
    'Set views, likes, and downloads back to 0 for every issue? This cannot be undone.',
    ui.ButtonSet.OK_CANCEL,
  )
  if (res !== ui.Button.OK) return
  ui.alert(resetCounts())
}

// One-off admin helper: zero every counter (views, likes, downloads) for all
// ids, keeping the rows. Run it from the "AUSSS Magazine" sheet menu, or from
// the Apps Script editor (select resetCounts → Run). It is intentionally NOT
// reachable as a web action so the counts can't be wiped via a URL. The
// per-browser "already liked" flags live in visitors' localStorage and are
// unaffected — a returning liker won't be able to re-like, which is expected.
function resetCounts() {
  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var sh = sheet_()
    var last = sh.getLastRow()
    if (last < 2) return 'No rows to reset.'
    // Columns B:D (views, likes, downloads) for every data row.
    sh.getRange(2, COLS.views, last - 1, 3).setValue(0)
    SpreadsheetApp.flush()
    return 'Reset ' + (last - 1) + ' row(s) to 0.'
  } finally {
    lock.releaseLock()
  }
}

// Menu handler for the id migration: confirm, run, show the result.
function relabelIdsMenu() {
  var ui = SpreadsheetApp.getUi()
  var res = ui.alert(
    'Migrate magazine ids',
    'Rename the old rows issue-1 → vol-6 and issue-2 → vol-7 (merging counts if ' +
      'a vol-6/vol-7 row already exists)? Safe to run once.',
    ui.ButtonSet.OK_CANCEL,
  )
  if (res !== ui.Button.OK) return
  ui.alert(relabelIds())
}

// One-off migration: after the site renamed its two generic ids (issue-1→vol-6,
// issue-2→vol-7), carry the historical counts over. If the destination row
// already exists (the live site may have started a fresh vol-6/vol-7 row), the
// old row's counts are ADDED into it and the old row is deleted; otherwise the
// old row is simply renamed. Idempotent — re-running after migration is a no-op.
// Run from the "AUSSS Magazine" sheet menu, or select relabelIds → Run in the
// Apps Script editor (result is written to the execution log).
function relabelIds() {
  var pairs = [['issue-1', 'vol-6'], ['issue-2', 'vol-7']]
  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var sh = sheet_()
    var log = []
    pairs.forEach(function (pair) {
      var oldId = pair[0]
      var newId = pair[1]
      // Re-read each iteration: a prior deleteRow shifts row indices.
      var values = sh.getDataRange().getValues()
      var oldRow = -1
      var newRow = -1
      for (var r = 1; r < values.length; r++) {
        var id = String(values[r][0] || '').trim()
        if (id === oldId) oldRow = r
        else if (id === newId) newRow = r
      }
      if (oldRow === -1) {
        log.push(oldId + ': not found — skipped')
        return
      }
      var o = {
        v: Number(values[oldRow][1] || 0),
        l: Number(values[oldRow][2] || 0),
        d: Number(values[oldRow][3] || 0),
      }
      if (newRow === -1) {
        sh.getRange(oldRow + 1, 1).setValue(newId)
        log.push(oldId + ' → ' + newId + ' renamed (v' + o.v + ' l' + o.l + ' d' + o.d + ')')
      } else {
        var n = {
          v: Number(values[newRow][1] || 0),
          l: Number(values[newRow][2] || 0),
          d: Number(values[newRow][3] || 0),
        }
        sh.getRange(newRow + 1, COLS.views, 1, 3).setValues([[n.v + o.v, n.l + o.l, n.d + o.d]])
        sh.deleteRow(oldRow + 1)
        log.push(
          oldId + ' merged into ' + newId +
            ' (now v' + (n.v + o.v) + ' l' + (n.l + o.l) + ' d' + (n.d + o.d) + ')',
        )
      }
    })
    SpreadsheetApp.flush()
    var msg = log.join('\n')
    Logger.log(msg)
    return msg
  } finally {
    lock.releaseLock()
  }
}

// Global per-minute write cap (Script Properties). ~600 legit hits/min is far
// above real traffic but blunts a scripted flood.
var GLOBAL_MAX_PER_MIN = 600

function flooding_() {
  var props = PropertiesService.getScriptProperties()
  var winKey = 'rate_' + Math.floor(Date.now() / 60000)
  var n = Number(props.getProperty(winKey) || 0)
  if (n >= GLOBAL_MAX_PER_MIN) return true
  props.setProperty(winKey, String(n + 1))
  return false
}

// Read an id's current counts without incrementing (used when throttled).
function peek_(id) {
  var all = readAll_()
  return all[id] || { views: 0, likes: 0, downloads: 0 }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

function ss_() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID)
  // Bound script (created from inside a Sheet): use that sheet.
  var active = SpreadsheetApp.getActiveSpreadsheet()
  if (active) return active
  // Standalone script: create a spreadsheet once and remember its id in
  // Script Properties, so no manual setup is needed.
  var props = PropertiesService.getScriptProperties()
  var savedId = props.getProperty('ENGAGEMENT_SHEET_ID')
  if (savedId) return SpreadsheetApp.openById(savedId)
  var created = SpreadsheetApp.create('AUSSS Magazine Engagement')
  props.setProperty('ENGAGEMENT_SHEET_ID', created.getId())
  return created
}

// 1-based column for each counter.
var COLS = { views: 2, likes: 3, downloads: 4 }

function sheet_() {
  var ss = ss_()
  var sh = ss.getSheetByName(SHEET_NAME)
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME)
    sh.appendRow(['id', 'views', 'likes', 'downloads'])
    return sh
  }
  // Self-heal: add the downloads header to sheets created before it existed.
  if (sh.getLastColumn() < COLS.downloads) {
    sh.getRange(1, COLS.downloads).setValue('downloads')
  }
  return sh
}

function readAll_() {
  var sh = sheet_()
  var values = sh.getDataRange().getValues()
  var out = {}
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][0] || '').trim()
    if (!id) continue
    out[id] = {
      views: Number(values[r][1] || 0),
      likes: Number(values[r][2] || 0),
      downloads: Number(values[r][3] || 0),
    }
  }
  return out
}

// Atomically increment one counter (views | likes | downloads) for an id and
// return the id's resulting { views, likes, downloads }. A script lock avoids
// lost updates under concurrent hits.
function bump_(id, which) {
  var colIndex = COLS[which] || COLS.views
  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var sh = sheet_()
    var values = sh.getDataRange().getValues()
    var rowIndex = -1
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][0] || '').trim() === id) {
        rowIndex = r
        break
      }
    }

    if (rowIndex === -1) {
      var row = {
        views: which === 'views' ? 1 : 0,
        likes: which === 'likes' ? 1 : 0,
        downloads: which === 'downloads' ? 1 : 0,
      }
      sh.appendRow([id, row.views, row.likes, row.downloads])
      return row
    }

    var next = Number(values[rowIndex][colIndex - 1] || 0) + 1
    sh.getRange(rowIndex + 1, colIndex).setValue(next)

    return {
      views: colIndex === COLS.views ? next : Number(values[rowIndex][1] || 0),
      likes: colIndex === COLS.likes ? next : Number(values[rowIndex][2] || 0),
      downloads: colIndex === COLS.downloads ? next : Number(values[rowIndex][3] || 0),
    }
  } finally {
    lock.releaseLock()
  }
}
