/**
 * AUSSS membership roster: Google Sheet -> Supabase sync
 * ---------------------------------------------------------------------------
 * Bound to the membership spreadsheet ("[SHARED] AUSSS Membership Database",
 * owned by the Secretary General's account). Every hour it sends the
 * "Database" tab to rpc/sync_roster_from_sheet, which merges it into
 * public.roster_entries (supabase/migrations/20260919200001_live_roster.sql).
 *
 * The website never reads this sheet: the public membership check and the
 * portal read Supabase. So the sheet can (and should) be shared with named
 * people only, not "anyone with the link".
 *
 * What the merge does with a row is decided in the database, not here:
 *   - new name+email            -> added
 *   - changed in the sheet      -> updated
 *   - edited in the portal      -> left alone (the portal owns that row)
 *   - gone from the sheet       -> reported, never deleted
 *
 * SETUP (once, signed in as the sheet's owner)
 *   1. Sheet -> Extensions -> Apps Script, paste this file, save.
 *   2. Project Settings -> Script properties, add:
 *        SUPABASE_URL   https://wjijkqrdaakiwbtdssio.supabase.co
 *        SUPABASE_KEY   the publishable key (sb_publishable_..., same value as
 *                       VITE_SUPABASE_ANON_KEY; it only identifies the project)
 *        SYNC_TOKEN     from the portal: Roster -> Spreadsheet -> issue a token
 *   3. Run syncRoster once from the editor (authorise when asked) and read the
 *      log; then run installTrigger once.
 * To stop: run removeTrigger, or press "Turn off" in the portal (the token
 * stops working at once).
 */

var SHEET_NAME = 'Database'

// Column positions, the same in src/portal/rosterFile.js and
// scripts/db/import-roster.mjs. Addressed by position because the header cells
// have been blank or reworded before.
var FIELDS = [
  'full_name',
  'email',
  'joined_year',
  'years_spent',
  'lgas',
  'ngas',
  'current_position',
  'status',
]

function readRoster_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0]
  // Display values: a GA count typed as ">2" and a year shown as 2025 both
  // arrive as the text the Secretary General sees.
  var values = sheet.getDataRange().getDisplayValues()
  var hi = -1
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]).trim().toLowerCase() === 'name') {
      hi = r
      break
    }
  }
  if (hi === -1) throw new Error('Header row (first cell "Name") not found in ' + sheet.getName())

  var asOf = String(values[hi][7] || '').match(/\[(.+?)\]/)
  var rows = []
  for (var i = hi + 1; i < values.length; i++) {
    var name = String(values[i][0] || '').trim()
    if (!name) continue
    var row = {}
    for (var j = 0; j < FIELDS.length; j++) row[FIELDS[j]] = String(values[i][j] || '').trim()
    rows.push(row)
  }
  return { rows: rows, batch: asOf ? asOf[1].replace(/\s+/g, ' ').trim() : null }
}

function syncRoster() {
  var props = PropertiesService.getScriptProperties()
  var url = (props.getProperty('SUPABASE_URL') || '').replace(/\/$/, '')
  var key = props.getProperty('SUPABASE_KEY')
  var token = props.getProperty('SYNC_TOKEN')
  if (!url || !key || !token) {
    throw new Error('Set SUPABASE_URL, SUPABASE_KEY and SYNC_TOKEN in Script properties first.')
  }

  var roster = readRoster_()
  // A half-loaded or wrongly filtered sheet must not look like a mass change.
  if (roster.rows.length < 50) {
    throw new Error('Only ' + roster.rows.length + ' rows read; refusing to sync. Check the ' + SHEET_NAME + ' tab.')
  }

  var res = UrlFetchApp.fetch(url + '/rest/v1/rpc/sync_roster_from_sheet', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ token: token, rows: roster.rows, batch: roster.batch }),
    muteHttpExceptions: true,
  })
  var code = res.getResponseCode()
  var body = res.getContentText()
  if (code < 200 || code >= 300) {
    // Apps Script emails the owner about failed triggers, so a revoked token
    // or a changed layout does not fail silently.
    throw new Error('Supabase refused the sync (' + code + '): ' + body)
  }
  var result = JSON.parse(body)
  delete result.missing_names
  Logger.log('Roster sync ok: ' + JSON.stringify(result))
  return result
}

function installTrigger() {
  removeTrigger()
  ScriptApp.newTrigger('syncRoster').timeBased().everyHours(1).create()
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncRoster') ScriptApp.deleteTrigger(t)
  })
}
