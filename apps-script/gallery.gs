/**
 * RETIRED 2026-09-24 (Phase 5): the gallery is edited in the members portal and read
 * from Supabase; the site no longer calls this web app. Kept for reference only.
 *
 * AUSSS gallery — photo takedown endpoint (Google Apps Script web app)
 *
 * Stores a list of "removed" gallery photo paths. The public gallery reads
 * this list at page load and hides anything in it; the admin page
 * (/gallery/admin) adds/removes entries. No spreadsheet needed — the list
 * lives in Script Properties.
 *
 * All actions are GET requests so the browser can read the JSON response
 * across Apps Script's 302 → googleusercontent.com redirect (POST responses
 * aren't readable cross-origin; GET ones are). Mutating via GET is fine here:
 * the data is low-stakes and a shared admin key guards writes.
 *
 *   GET ?action=list                          → { ok, removed: [paths] }   (public)
 *   GET ?action=check&key=KEY                 → { ok }                      (validate key)
 *   GET ?action=add&path=PATH&key=KEY         → { ok, removed: [paths] }
 *   GET ?action=remove&path=PATH&key=KEY      → { ok, removed: [paths] }
 *
 * Deploy: see gallery.README.md.
 */

// The admin key lives in Script Properties, NOT in this file — so it's never
// committed to git or shipped in the bundle. Set it once:
//   Apps Script editor → Project Settings → Script Properties →
//   add  ADMIN_KEY = <a long random string>
// (or run setAdminKey() below once). If the property is unset the endpoint
// refuses every write rather than falling back to a guessable default.
var PROP_ADMIN_KEY = 'ADMIN_KEY';
var PROP_KEY = 'GALLERY_REMOVALS';

function adminKey_() {
  return String(
    PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_KEY) || '',
  );
}

// One-time setup helper: edit the value, Run → setAdminKey, then delete it.
function setAdminKey() {
  PropertiesService.getScriptProperties().setProperty(
    PROP_ADMIN_KEY,
    'CHANGE_ME_TO_A_LONG_RANDOM_STRING',
  );
}

// ── Claim store (keeps the admin key out of request URLs) ───────────────────
var CLAIM_TTL_MS = 120000;

function putClaim_(nonce, result) {
  if (!nonce) return;
  PropertiesService.getScriptProperties().setProperty(
    'claim_' + nonce,
    JSON.stringify({ result: result, exp: Date.now() + CLAIM_TTL_MS }),
  );
}

function readClaim_(nonce) {
  if (!nonce) return { ok: false, error: 'Missing nonce' };
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('claim_' + nonce);
  if (!raw) return { ok: false, pending: true };
  props.deleteProperty('claim_' + nonce);
  try {
    var c = JSON.parse(raw);
    if (!c || !c.exp || Date.now() > c.exp) return { ok: false, error: 'Expired' };
    return c.result;
  } catch (e) {
    return { ok: false, error: 'Bad claim' };
  }
}

// Apply an add/remove and return the new list. Shared by GET (legacy) + POST.
function applyChange_(action, path) {
  var list = getList();
  if (action === 'add') {
    if (list.indexOf(path) === -1) list.push(path);
  } else {
    list = list.filter(function (x) { return x !== path; });
  }
  setList(list);
  return list;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || 'list').toLowerCase();

  try {
    if (action === 'list') {
      return json({ ok: true, removed: getList() });
    }

    // Read back the result of a POSTed check/add/remove (see doPost).
    if (action === 'claim') {
      return json(readClaim_(p.nonce));
    }

    if (action === 'check') {
      return json({ ok: keyOk(p.key) });
    }

    if (action === 'add' || action === 'remove') {
      if (!keyOk(p.key)) return json({ ok: false, error: 'Wrong admin key' });
      var path = String(p.path || '').trim();
      if (!path) return json({ ok: false, error: 'Missing path' });
      return json({ ok: true, removed: applyChange_(action, path) });
    }

    return json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Writes (and the key check) go through POST so the admin key travels in the
// body, never the URL. The reply is stashed for the client's ?action=claim.
function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    var payload = raw ? JSON.parse(raw) : {};
    var action = String(payload.action || '').toLowerCase();
    var result;

    if (action === 'check') {
      result = { ok: keyOk(payload.key) };
    } else if (action === 'add' || action === 'remove') {
      if (!keyOk(payload.key)) {
        result = { ok: false, error: 'Wrong admin key' };
      } else {
        var path = String(payload.path || '').trim();
        result = path
          ? { ok: true, removed: applyChange_(action, path) }
          : { ok: false, error: 'Missing path' };
      }
    } else {
      result = { ok: false, error: 'Unknown action' };
    }

    putClaim_(payload.nonce, result);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Constant-time-ish equality on the configured key. Refuses if unconfigured.
function keyOk(key) {
  var expected = adminKey_();
  return expected.length > 0 && String(key || '') === expected;
}

function getList() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function setList(list) {
  PropertiesService.getScriptProperties().setProperty(
    PROP_KEY,
    JSON.stringify(list)
  );
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
