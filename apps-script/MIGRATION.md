# Migrating the website's Google assets to `aussswebsite@gmail.com`

> ## Status — 2026-08-31
>
> Steps 1 and 2 have been **executed** from `loreausss@gmail.com`. What remains
> is Step 3 onward, which must be done **signed in as `aussswebsite@gmail.com`**.
>
> **Done — shared as Editor, then ownership transfer started:**
>
> | Asset | State |
> |---|---|
> | `Website Sign Up's` (standalone script) | ✅ owner is now `aussswebsite` |
> | `Gallery take down` (standalone script) | ✅ owner is now `aussswebsite` |
> | `Exchange Stories` (standalone script) | ✅ owner is now `aussswebsite` |
> | `AUSSS Magazine` (standalone script, the older Jun-3 duplicate) | ✅ owner is now `aussswebsite` |
> | `AUSSS-officer-accounts` (Sheet + bound `Officers Accounts` script) | ⏳ pending owner |
> | `AUSSS Merch Website Orders` (Sheet + bound `Merch Orders` script) | ⏳ pending owner |
> | `AUSSS Magazine Engagement` (Sheet + bound `AUSSS Magazine` script) | ⏳ pending owner |
> | `Exchange Stories Submissions` (Sheet) | ⏳ pending owner |
> | `AUSSS Website Project` folder | ⏳ pending owner |
> | `AUSSS Officer Photos` folder (**two** exist) | ⏳ pending owner |
> | `AUSSS Orders Receipts` folder | ⏳ pending owner |
>
> **Deliberately left with `loreausss@gmail.com`:** the four magazine PDFs
> (`AUSSS MAGAZINE Volume 1`, `VOL. 03`, `Vol 5`, `vol. 6`). They are shared
> anyone-with-link, so the `download:` links in `src/data/magazine.js` keep
> working from where they are.
>
> **Your next action:** sign in to `aussswebsite@gmail.com` and **accept** each
> pending ownership transfer, then do Step 3 (redeploy) below.
>
> **2026-09-19:** `officers.gs` is retired from production (portal Phase 2, see
> `docs/RUNBOOK.md` section 12). Still accept the `AUSSS-officer-accounts`
> transfer so the archive is society-owned, but do **not** redeploy it; keep the
> `AUSSS Officer Photos` folder shared anyone-with-link until every committee has
> re-uploaded its photos through the portal.
>
> ### Discovered en route: the signups endpoint is dead
>
> `Website Sign Up's` is a **standalone** script whose live code still has
> `var SPREADSHEET_ID = ''`. In a standalone script
> `SpreadsheetApp.getActiveSpreadsheet()` returns `null`, so `getSheet_()` throws
> on every POST — the recruitment-waitlist and newsletter forms have been
> silently failing. (Compare `Exchange Stories`, which correctly sets
> `SPREADSHEET_ID = '1D0bin-JW8G2VnVk0OenhoeszF_vxLO8slPN5qiOyMBQ'`.)
>
> Fix while you are redeploying it: either paste a real sheet id into
> `SPREADSHEET_ID`, or copy the self-healing `ss_()` pattern from `magazine.gs`
> (create a sheet once, remember its id in `ENGAGEMENT_SHEET_ID`-style Script
> Properties). This is a pre-existing bug, unrelated to the migration.

**Why:** every backend the site depends on — six Apps Script web apps, their
Google Sheets, the officer-photo Drive folder, the magazine PDFs — currently
lives in **`loreausss@gmail.com`**, a *role* account that changes hands with
the LORE officer every term. When that handover happens badly the entire site
loses its data layer. Moving it all into a dedicated, permanent
**`aussswebsite@gmail.com`** makes the infrastructure outlive any one officer.

---

## The one rule: TRANSFER, never COPY

Copying a script into the new account looks easier. It is not — it breaks four
things at once:

| What breaks on a copy | What survives on an ownership transfer |
|---|---|
| The `/macros/s/AKfy…/exec` URL changes → every `*Config.js` needs editing + a site redeploy | URL is tied to the script project, which moves intact |
| **Script Properties are not copied** — you lose gallery's hidden-photo list (`GALLERY_REMOVALS`), officers' `SITE_SETTINGS`, every live officer session token, `ADMIN_KEY`, `ENGAGEMENT_SHEET_ID` | Properties move with the project |
| Sheet data (officer accounts, orders, signups, stories, engagement counters) has to be re-imported | Sheet *is* the thing being transferred |
| Drive file IDs of officer photos change → every `lh3.googleusercontent.com/d/<id>` URL stored in the Overrides sheet 404s | File IDs never change |

So: **Drive → right-click the file → Share → change the collaborator's role to
"Owner" → Make owner.** Do it for the containers listed below.

---

## Inventory — what has to move

### A. Apps Script web apps (the critical five)

All are deployed and live. Sheet-bound ones move by transferring **the Sheet**
(the script rides along inside it); the standalone one moves as its own file.

| # | Script | Bound to | Live URL in repo | Also carries |
|---|--------|----------|------------------|--------------|
| 1 | `officers.gs` (**retired 2026-09-19**, archive only) | Sheet with tabs `Accounts`, `Overrides`, `Calls`, `Applications` | none since Phase 2 (was `…AKfycbwmoWZHnubjubeIHAF1GV-eR8AiI2CR8brMO1E2v1V2U08m71NMdguG1sLnDNF9Q36ZXw/exec`) | Script Properties: officer session tokens (`tok_*`), `SITE_SETTINGS`, login-throttle counters. Drive folder **"AUSSS Officer Photos"** |
| 2 | `gallery.gs` | **standalone** (no sheet) | `src/data/galleryConfig.js` → `…AKfycbwep4pLHw6O9EqNmvQDYZmpldgKioWbUm2Er4geJPTiuC36SRNZNXfvTpxENTcNX5dXPg/exec` | Script Properties: `ADMIN_KEY`, `GALLERY_REMOVALS` (**the live hidden-photo list — irreplaceable on a copy**) |
| 3 | `orders.gs` | Sheet tab `Orders` | `src/data/merchConfig.js` → `…AKfycbygftItgPl5_dOdQFlOllM8XzATj3SEgBoy4bVc1OIflJWmeBImzbWc5WkTDwEqmVJE/exec` | Drive folder **"AUSSS Orders Receipts"** |
| 4 | `signups.gs` | Sheet tab `Signups` | `src/data/signupsConfig.js` → `…AKfycbyd738Fo_JZ_wd58Lx9jDhObYQ_HFvTZO-rokpfaO01FwLU6wTWG1r5ZYUQRUZ5X9BHvA/exec` | — |
| 5 | `stories.gs` | Sheet tab `Exchange Stories` | `src/data/storiesConfig.js` → `…AKfycbz-s7xWbh-UrPAWr_dRRJ0bRVsPecbcVFxeRmW7K51Ilp0EucthKaWSl5lPror3m5co_Q/exec` | — |
| 6 | `magazine.gs` | bound **or** standalone — check | `src/data/magazineConfig.js` → `…AKfycbymoTD2Y6N6Z9XmmQKz2MZ_O41pcRCfczE8l6GQmrJCt3XXbT1IBJCT19QeSEd7iIN0/exec` | If standalone, Script Property `ENGAGEMENT_SHEET_ID` points at a separate "AUSSS Magazine Engagement" sheet that must move too |

`Code.gs` (membership) is **not deployed** — `src/data/membershipConfig.js` has
an empty `WEBAPP_URL`. Nothing to migrate; it is dormant source.

### B. Drive files and folders

| Asset | Owner today | Note |
|---|---|---|
| "AUSSS Officer Photos" folder (+ per-committee subfolders) | `loreausss@gmail.com` | Created at Drive **root** by `officers.gs:309`. Files are shared *anyone-with-link*; URLs are `lh3.googleusercontent.com/d/<id>` and are stored inside the `Overrides` sheet JSON |
| "AUSSS Orders Receipts" folder | `loreausss@gmail.com` | Payment receipts uploaded by merch buyers |
| Magazine PDFs (`src/data/magazine.js` `download:` links) | `loreausss@gmail.com` | **Staying put by decision.** Four exist in Drive (Volume 1, VOL. 03, Vol 5, vol. 6); `magazine.js` carries five links, so one is owned elsewhere or named differently. All are anyone-with-link, so the links keep resolving |

> ⚠️ **Consumer-Drive gotcha:** transferring ownership of a *folder* between two
> `@gmail.com` accounts does **not** transfer the files inside it. Each file
> keeps its old owner. See "Handling the photo backlog" below — you do not have
> to hand-transfer hundreds of images.

### C. Other Google surfaces

| Asset | Where referenced | Status |
|---|---|---|
| Membership Google Form `1FAIpQLSeU1QhHkuLpJtiUFGbD_Kdbqhzs8GMAuR3x63HMnm4XzeBAYQ` | `src/pages/MembersPage.jsx:22` | Owner unverified. Transfer it and its response sheet, or the responses become unreachable |
| Public Google Calendar | `src/data/society.js:625` `calendarId: ''` | **Not configured yet** — nothing to migrate. Create it in the new account when you do |

### D. Notification recipients — **already changed in the repo**

`TEAM_EMAIL` in `orders.gs:50`, `signups.gs:18`, `stories.gs:41` has been
repointed from `loreausss@gmail.com` to **`aussswebsite@gmail.com`**, along
with the three documentation mirrors in `src/data/merchConfig.js:22`,
`signupsConfig.js:19` and `storiesConfig.js:19`.

These edits only take effect when each script is **redeployed** (Step 3), so
they land as part of the migration rather than needing a separate rollout.

Two consequences to plan for:

- **Someone must actually watch that inbox.** Merch orders and exchange-story
  submissions need a human. Either set up forwarding from
  `aussswebsite@gmail.com` to whoever is on duty, or agree that LORE checks it.
- After the transfer these mails are also *sent from* `aussswebsite@gmail.com`
  (MailApp sends as the script owner) and count against that account's daily
  quota — so the account is now both sender and recipient.

`officers.gs` needs no change: open-call application notices are addressed to
the officers who own the call, resolved from the `Accounts` sheet at send time.

### E. Not Google (out of scope, listed so nothing is forgotten)

- GitHub: `origin` → `Optimalgeoduck/AUSSS-Website-Project`, plus an
  `omarbelo23/AUSSS` remote
- Hosting: Vercel (`vercel.json`) and a Netlify site id
  `c6566a41-930b-45ea-97b2-6eb2c0b265e7` (`.netlify/state.json`)
- The `ausss-ainshams.org` domain / DNS (Squarespace, bought 2026-09-15)

---

## Runbook

### Step 0 — Secure the destination account (do this first)

1. Sign in to `aussswebsite@gmail.com`.
2. Turn on 2-Step Verification; save the backup codes somewhere the *society*
   controls, not one person's phone.
3. Set a recovery email/phone owned by the society, not an individual.
4. Record in the handover doc: this account owns the site's data layer and must
   never be handed to a single rotating officer.

### Step 1 — Grant access before transferring

From `loreausss@gmail.com`, share each item in section A and B with
`aussswebsite@gmail.com` as **Editor** first. (Drive only offers "Make owner"
for someone who is already a collaborator.)

### Step 2 — Transfer ownership

For each of the 5 sheets + the standalone `gallery` script project + the 2
folders + the 5 magazine PDFs:

> Share → find `aussswebsite@gmail.com` → role dropdown → **Owner** → *Make
> owner* → confirm.

Then sign in as `aussswebsite@gmail.com` and **accept** each pending transfer
(Drive shows a banner / sends a mail). Ownership is not final until accepted.

### Step 3 — Re-deploy each web app under the new owner, keeping the URL

This is the step that preserves every URL in `src/data/*Config.js`. As
`aussswebsite@gmail.com`:

1. Open the Sheet → **Extensions → Apps Script** (or open the standalone
   gallery project).
2. **Deploy → Manage deployments**.
3. Select the **existing** deployment (do *not* click "New deployment").
4. Pencil ✏️ → **Version: New version** → **Deploy**.
5. Authorise when prompted (this is the new account granting the script its
   Drive/Gmail/Sheets scopes). Confirm **Execute as: Me**, **Who has access:
   Anyone**.
6. Copy the `/exec` URL it shows and check it still matches the table in
   section A.

**If the URL changed, or step 3 refuses:** fall back to a new deployment, then
paste the new URL into the matching `src/data/*Config.js` and redeploy the
site. Only these seven lines ever need editing:

```
src/data/officersConfig.js:14   OFFICERS_WEBAPP_URL
src/data/galleryConfig.js:11    GALLERY_WEBAPP_URL
src/data/merchConfig.js:16      ORDERS_WEBAPP_URL
src/data/signupsConfig.js:15    SIGNUPS_WEBAPP_URL
src/data/storiesConfig.js:14    STORIES_WEBAPP_URL
src/data/magazineConfig.js:8    MAGAZINE_WEBAPP_URL
src/data/membershipConfig.js:19 WEBAPP_URL   (currently empty — dormant)
```

Under the fallback you must also re-create Script Properties by hand:
`ADMIN_KEY` (gallery), `GALLERY_REMOVALS`, `SITE_SETTINGS` (officers),
`ENGAGEMENT_SHEET_ID` (magazine). Officer session tokens are disposable —
everyone simply logs in again.

### Step 4 — Handling the photo backlog

Officer photos already in `loreausss`' Drive keep working: they are
anyone-with-link and their IDs never change. So:

- **Do not delete or lock `loreausss@gmail.com`** until the photos are gone.
- Once `officers.gs` runs under the new owner, *every new upload* lands in
  `aussswebsite@gmail.com`'s Drive automatically (`DriveApp.getRootFolder()` is
  now the new account's root). The backlog drains naturally as officers
  re-upload each term.
- To force it: ask each committee officer to re-upload their photo from
  `/login` once. That is ~10 people, ~2 minutes each, and no ID rewriting.

### Step 5 — Verify (do all of these before declaring done)

- `/committees/<any-slug>` — live overrides still render, photos still load
- `/login` — an officer can sign in and save an edit (proves Accounts sheet +
  Script Properties survived)
- `/committees/<slug>` — an open call still lists, and Apply writes a row to
  `Applications`
- `/gallery` — previously hidden photos are **still hidden** (proves
  `GALLERY_REMOVALS` survived)
- `/gallery/admin` — the old `ADMIN_KEY` still unlocks it
- `/merch` — place a test order; row appears in `Orders`, receipt lands in the
  new account's Drive, notification mail arrives at `TEAM_EMAIL`
- `/magazine` — open an edition; the view counter increments; the Vol 1
  download link still resolves
- Membership form and its responses open from the new account

### Step 6 — Close out

- Update the officer handover doc with the new account's role.
- Leave `loreausss@gmail.com` as an **Editor** on everything (not owner) so LORE
  can still read submissions.
- Only after Step 5 passes and the photo backlog has drained, remove
  `loreausss`' editor access if desired.

---

## Rollback

Ownership transfer is reversible: the new owner can hand each file back the
same way. Nothing is destroyed at any point in this runbook, and no URL or file
ID changes — which is exactly why the transfer path is preferred over copying.
