# Merch orders — Google Apps Script web app

The checkout page on `/merch/checkout` already speaks to this script. Until
the script is deployed and its URL is pasted into the site, submissions
fall through to a console-only stub so the UX still works in dev. This
guide walks the AUSSS team through deploying it for real, **once**.

## What lands where, when an order is placed

1. The frontend POSTs the order to your Apps Script web app URL.
2. The script generates an order reference like `AUSSS-MFXBT042`.
3. The receipt screenshot is uploaded to Google Drive at
   `My Drive → AUSSS Orders Receipts → YYYY-MM/{reference}-{filename}` and
   shared as "Anyone with the link can view."
4. A row is appended to the **Orders** sheet (auto-created on first run).
5. An email goes to the Secretary General with the order summary + receipt
   link.
6. The buyer sees the order reference and a confirmation screen.

## 1. Make the sheet

Create a new Google Sheet — e.g. **"AUSSS Merch Orders 25-26"** — owned by
whichever Google account will deploy this script. (Often the SG's account,
so notifications and Drive uploads live in one place.)

You don't need to add tabs or headers — the script auto-creates an `Orders`
tab with the right columns on first run.

## 2. Open the script editor

In that sheet → **Extensions → Apps Script**. Delete the default
`myFunction`, then paste the entire contents of
[`orders.gs`](./orders.gs).

## 3. Set the team email (and only that)

At the top of the script, confirm:

```js
var TEAM_EMAIL = 'ausss.secgen@gmail.com'
```

Change it if notifications should go elsewhere. Leave `SPREADSHEET_ID = ''`
since the script is bound to the sheet. Leave `SHEET_NAME = 'Orders'` and
`RECEIPTS_FOLDER = 'AUSSS Orders Receipts'` unless you want different
names.

Save the script (`Ctrl + S` / `⌘ + S`).

## 4. Deploy as a Web App

**Deploy → New deployment → ⚙ → Web app**

- **Description:** `AUSSS merch orders v1` (or whatever)
- **Execute as:** `Me` (lets the script write to *your* sheet and Drive)
- **Who has access:** `Anyone` (so the site can POST without users logging
  in)
- Click **Deploy**

## 5. Authorize

First deploy triggers the OAuth prompt → choose the account →
"Google hasn't verified this app" → **Advanced → Go to project → Allow**.
The script needs permission to:
- read/write the bound spreadsheet,
- create files in your Drive (for receipt screenshots),
- send mail as you (for SG notifications).

Nothing more.

## 6. Copy the Web app URL

Looks like `https://script.google.com/macros/s/AKfy…/exec`. Open it in a
browser tab — you should see `{"ok":true,"message":"AUSSS merch orders
endpoint up"}`. That's the health check confirming the deploy is live.

## 7. Wire it into the site

In `src/data/merchConfig.js`:

```js
export const ORDERS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfy…/exec'
```

Commit and push; Vercel deploys it. That's it: `/merch/checkout` now writes to
the sheet, screenshots land in Drive, and the team gets emailed.

## 8. Share access with the rest of the team

Three things are private to whoever deployed the script:

- The **Orders sheet** — share it with the team email(s) directly (View or
  Edit, your call).
- The **AUSSS Orders Receipts** Drive folder — right-click → Share →
  invite the team. Individual receipt files inside are already
  "Anyone-with-the-link can view" so the links in the sheet work for
  anyone the sheet is shared with.
- Email notifications go to whatever `TEAM_EMAIL` is set to. If you want
  multiple inboxes, change `MailApp.sendEmail(TEAM_EMAIL, …)` to a
  comma-separated string.

## Operating the orders sheet

The script writes a `Status` column starting at `new`. Suggested workflow
for the team:

| Status      | Meaning |
|-------------|---------|
| `new`       | Just landed, no one has triaged it yet. |
| `paid`      | Receipt screenshot verified against the Instapay/Telda/Vodafone account. |
| `ready`     | Item is produced and ready for pickup. |
| `fulfilled` | Picked up, handed over, done. |
| `cancelled` | Refunded or cancelled — keep the row for the audit trail. |

Add a Data Validation rule on column **C** with those five values so the
team can pick from a dropdown.

## Editing the script later

Once deployed, you can keep editing `orders.gs` and re-deploy:
**Deploy → Manage deployments → ✎ → Version: New version → Deploy.** The
URL stays the same, so nothing on the site needs touching.

## Notes

- **Why text/plain on the POST?** Apps Script web apps don't handle the
  CORS preflight that `application/json` triggers. Sending the JSON body
  with `Content-Type: text/plain;charset=utf-8` skips the preflight and
  the script parses `e.postData.contents` either way.
- **Quotas:** free. Per-day Apps Script limits (URL fetches, emails sent)
  are well above realistic merch-drop volume.
- **Privacy:** receipt screenshots are stored in *your* Drive, with link
  sharing on. If you ever revoke a link, the team-facing sheet entry will
  go dead — that's by design.
- **If you change `HEADERS`:** delete the existing `Orders` tab so the
  script re-creates it with the new columns. (Or update existing rows
  manually.)
