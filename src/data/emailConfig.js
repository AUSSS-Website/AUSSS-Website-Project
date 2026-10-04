// Role addresses on the society's own domain (president@ausss-ainshams.org and
// the rest).
//
// Every person or committee in society.js that has an inbox carries two
// fields: `email`, the role's Gmail inbox (also the account its holder signs
// in to the portal with, which is why scripts/db/gen-reference-data.mjs keeps
// reading it), and `alias`, the part before the @ of its address on the
// domain. The alias only forwards to the Gmail inbox; the forwarding rules
// live in the Squarespace domain dashboard (docs/RUNBOOK.md section 19).

// Whether the public site shows the domain addresses. Keep this false until
// every forwarding rule is verified and a test message has arrived, otherwise
// mail sent to the address a visitor sees bounces. While it is false the site
// shows the Gmail inboxes. An entry without an `alias` always shows its Gmail
// inbox, so one role can be held back by removing its alias.
export const domainEmailsLive = false

export const EMAIL_DOMAIN = 'ausss-ainshams.org'

// The address to show for a person or committee from society.js.
export const publicEmail = (who) =>
  domainEmailsLive && who?.alias ? `${who.alias}@${EMAIL_DOMAIN}` : who?.email || ''
