> **Retired from production on 2026-09-19 (portal Phase 2).** The site no longer
> calls this web app: committee page overrides, site settings and Open Calls now
> live in Supabase (`committees.page`, `site_settings`, `calls`, `applications`)
> and officers edit them at `/portal/committees/<slug>`. See `docs/RUNBOOK.md`
> section 12. The text below is kept as a record of how the Sheet-backed editor
> worked and how to read the archived `Overrides` / `Calls` / `Applications` tabs.

# Officer self-service editor — setup

`officers.gs` is the backend that lets each Team-of-Officials member log in and
edit **their own committee page** (photo, tagline, bio, "what we do", and an
optional members list). Edits go live for every visitor with no redeploy.

Until `OFFICERS_WEBAPP_URL` is set in `src/data/officersConfig.js`, the feature
is dormant: committee pages show the static `society.js` content and `/login`
reports the editor isn't set up. The site builds and deploys fine either way.

## Quick start — use the ready-made sheet

A pre-filled workbook for the current TO + EB already exists at:

```
_source/officer-setup/AUSSS-officer-accounts.xlsx     ← import this
_source/officer-setup/AUSSS-officer-credentials.csv   ← temp passwords to hand out
```

It already has both tabs, all 16 accounts (committee officers, the 4 EB
members with `all` access, and one `dev` account), and **passwords hashed** —
so you can skip the manual hashing in step 3. To use it:

1. Upload `AUSSS-officer-accounts.xlsx` to Google Drive → **Open with Google
   Sheets** (this keeps both tabs).
2. Do the deploy in step 2 below, binding the script to that sheet.
3. Give each person their **temp password** from the credentials CSV (they log
   in with their email + that password). See "Resetting a password" below to
   change one.

> The CSV holds plaintext temp passwords — share them privately and delete it
> afterwards. Both files live under `_source/` which is git-ignored, so they're
> never committed. Re-run `node _source/officer-setup/gen.mjs` to regenerate.

If you'd rather build the sheet by hand, follow steps 1–3.

## 1. Create the Google Sheet

Make a new Google Sheet with **two tabs**, named exactly:

**`Accounts`** — one row per person. Row 1 is a header row. Columns:

| A: email | B: passwordHash | C: salt | D: slug | E: displayName | F: role | G: scope |
|----------|-----------------|---------|---------|----------------|---------|----------|
| reem@example.com | (step 3) | (step 3) | scope | Reem Serry | LEO-Out | committee |
| president@example.com | (step 3) | (step 3) |  | Amr Hesham | President | all |
| dev@example.com | (step 3) | (step 3) |  | Developer | Developer | dev |

- **slug** — for a committee officer, the last part of their committee URL
  `/committees/<slug>` (e.g. `scope`, `score`, `scome`, `scoph`, `scorp`,
  `scora`, `psd`, `pnsd`, `cbsd`, `rsd`). Lower-case. Leave **blank** for EB/dev.
- **scope** — what the account may edit:
  - `committee` (or blank) → only the committee in column D
  - `all` → every committee (Executive Board)
  - `dev` → everything (developer)

**`Overrides`** — written by the script. Create the tab with a header row only:

| A: slug | B: json | C: updatedBy | D: updatedAt |
|---------|---------|--------------|--------------|

## 2. Add the script & deploy

1. In the Sheet: **Extensions → Apps Script**.
2. Paste the contents of `officers.gs`. Save.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Authorise when prompted (it needs Sheets + Drive to store photos).
5. Copy the **`/exec`** URL into `src/data/officersConfig.js`:
   ```js
   export const OFFICERS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfy.../exec'
   ```
6. Commit + deploy the site.

## 3. Seed an account (set each officer's password)

Passwords are stored **hashed**, never in plain text. For each officer:

1. In the Apps Script editor open `officers.gs` and find `computeHash()`.
2. Set `password` to their password and `salt` to any random string (a
   different one per officer is best).
3. **Run → `computeHash`**, then open **View → Logs**.
4. Copy the logged `salt` into column **C** and `passwordHash` into column
   **B** of that officer's row in the `Accounts` sheet. Fill in their email
   (A), slug (D), display name (E), and role (F).

The officer then signs in at **`/login`** with their email + the password you
chose, and edits their committee at **`/account`**.

### Changing / resetting a password (easiest)

Open the bound Google Sheet — there's an **"AUSSS" menu** → **"Set / reset a
password"**. Type the account's email and the new password; it rewrites the
hash + salt for you. (If the menu isn't there yet, you added the script before
this feature — re-paste `officers.gs`, reload the sheet, and approve the
one-time authorisation.)

Other ways: edit the `email`/`newPassword` vars in `setPassword()` and Run it,
or recompute by hand with `computeHash()`. There's no self-service reset for
officers — an admin sets passwords. A changed password takes effect on the next
login; an already-issued session lasts until it expires (7 days).

## How it works (for reference)

- `GET ?action=overrides` → public map `{ slug: {tagline, about[], whatWeDo[], photo, membersEnabled, members[]} }`, merged over `society.js` by committee pages.
- `GET ?action=login&email=&password=` → `{ ok, token, slug, name }` (token valid 7 days).
- `GET ?action=validate&token=` → re-checks a remembered token.
- `POST {action:'save', token, fields}` (no-cors, `text/plain`) → validates the
  token, uploads any new photos (sent as `data:` URIs) to Drive
  `AUSSS Officer Photos/<slug>/`, caps members at 10, and writes the override.
  The browser can't read a cross-origin POST reply, so the client re-fetches
  `?action=overrides` afterwards to confirm.

## Open Calls (recruitment calls + applications)

Officers publish "calls" — small working groups, campaigns, projects — from the
**Open calls** tab at `/account`. Each one shows in an **Open Calls** section on
their committee page with an **Apply** button, and every application emails the
officer who created it.

This lives in `officers.gs` rather than its own script for one reason: officer
session tokens sit in **this** script project's Script Properties, so no other
deployment can validate them. Adding it here reuses the existing login,
`canEdit_` committee scoping, and Accounts lookup as-is.

### Setup

Nothing to create by hand — the two tabs appear on first use:

- **Calls** — `id · slug · status · json · createdBy · createdByEmail · createdAt · updatedAt`
- **Applications** — `Timestamp · Ref · Call ID · Call · Committee · Name · Email · Phone · Year · Position(s) · Motivation · Extra answers (JSON)`

**Redeploy is required.** Manage deployments → edit the existing web app → *New
version* → Deploy. Keep the same deployment so the `/exec` URL in
`src/data/officersConfig.js` stays valid. Until you do, the Open Calls section
simply never appears on the site and the officer tab says so — nothing else
breaks.

The first application will also prompt a **one-time authorisation** for sending
mail (`MailApp`), since the script didn't need that scope before.

### Notifications

Each application emails the call's creator, plus the optional "also notify"
address the officer typed when creating it. `replyTo` is set to the applicant,
so replying from the inbox reaches them directly. Mail is best-effort — if it
fails (quota), it's logged and the sheet row is still written. Consumer Gmail
allows ~100 recipients/day; Workspace ~1500.

`SITE_URL` at the top of `officers.gs` is the link in that email — update it
when the real domain replaces the `www.ausss.org` placeholder.

**If an application arrives but no email does**, read the **Notified** column on
that row in the `Applications` tab. It records one of three things:

- `sent to …` — mail went out; check spam, and check *which* address (it goes to
  the officer's address in the `Accounts` tab, which may not be the one you read).
- `FAILED — …` — usually a missing authorisation. A new version deployed with
  the `MailApp` scope needs the owner to approve it: open the script editor, Run
  any function once, accept the prompt, then redeploy.
- `NOT SENT — …` — the committee has no officer account in the `Accounts` tab
  and the call has no "also notify" address, so there was nobody to write to.

Recipients are resolved when the application arrives, not when the call was
created: if a call has no stored creator (it was made with a session predating
this feature) the officer account for its committee is used instead, so an old
call still notifies without being edited.

### Deadlines close calls by themselves

A call is live when its status is `open` **and** its deadline hasn't gone by.
That's derived on every read, so there's no trigger to break: an expired call
drops off the site on its own. The deadline day itself still counts, evaluated
in the **script's timezone** (File → Project settings → Time zone — set it to
Africa/Cairo). Leave the deadline blank for an open-ended call. Extending or
clearing the date reopens it; applications are never lost.

Officers can also **Close now** at any time (reversible — the call and its
applications stay) or **Remove** a call outright. Removing deletes the call row
but *deliberately keeps* the `Applications` rows, which carry the call title and
reference and read fine on their own — tidying up a call must never destroy what
people submitted to it.

### Actions

- `GET ?action=calls` → `{ slug: [call, …] }`, live calls only, notify
  addresses stripped. Public, and doubles as the client's availability probe.
- `POST {action:'apply', callId, ref, name, email, phone, year, positions[], motivation, answers{}, nonce}`
  → appends the row and sends the email. Public, but body-carried so the
  applicant's details never appear in a URL; re-checks the deadline server-side
  because a stale page could still have the form open.
- `POST {action:'callsave'|'callstatus'|'calldelete'|'officercalls'|'applications', token, …, nonce}`
  → officer-only, scope-gated by `canEdit_`. All POST + claim: `applications`
  returns personal data, so it is never a GET with a token in the query string.

Abuse guards mirror `signups.gs`: the same applicant on the same call is ignored
for 24h (reported back as a success), a global cap of 20 applications/minute,
plus a honeypot field and hard length caps on every text field.

## Security notes

Appropriate for ~10 officers editing their own bios — **not** bank-grade. A
token only ever lets its holder edit the **one committee** tied to their
account (`token.slug`). There's no email verification or password reset (you
re-seed a hash to reset). For stronger auth, Netlify Identity is the upgrade
path. Keep the Accounts sheet private.
