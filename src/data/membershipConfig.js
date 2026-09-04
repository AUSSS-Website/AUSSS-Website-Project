// ─────────────────────────────────────────────────────────────────────────
//  AUSSS membership lookup, data source switch
// ─────────────────────────────────────────────────────────────────────────
//
//  INTERIM (now):  source = 'excel'
//    Lookup runs fully in the browser against a privacy-safe hash table
//    generated from the membership xlsx (no names/emails are shipped).
//    To refresh after the roster changes: re-provide the xlsx and ask to
//    regenerate src/data/members.generated.js.
//
//  LATER (Google account available):
//    1. Deploy the Apps Script Web App (see apps-script/README.md).
//    2. Paste its /exec URL into WEBAPP_URL below.
//    3. Change SOURCE to 'webapp'.
//    Nothing else changes, the page already speaks to both.
//
export const SOURCE = 'excel' // 'excel' | 'webapp'

export const WEBAPP_URL = '' // e.g. 'https://script.google.com/macros/s/AKfy.../exec'
