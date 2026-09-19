# Membership roster — syncing the Google Sheet into Supabase

The membership database lives in Supabase (`public.roster_entries`). The public
"Check your membership" page, the home-page member count, sign-in claiming and
the portal's **Roster** page all read it there. Nothing on the website reads
the Google Sheet.

While the Secretary General still edits the sheet
(`[SHARED] AUSSS Membership Database`, tab `Database`), its changes reach
Supabase one of two ways:

| Route | Who | How |
|---|---|---|
| File upload | any EB member | Portal → **Roster** → *Spreadsheet* → *Import an .xlsx or .csv* (in the sheet: File → Download → Microsoft Excel) |
| Automatic, hourly | the sheet's owner, once | [`roster-sync.gs`](./roster-sync.gs), below |

Both end in the same merge (`app.apply_roster_rows`):

- a new name + email is **added**; a row that changed in the sheet is **updated**;
- a row the EB edited in the portal is **kept** (the portal owns it from then
  on; *Follow the spreadsheet again* in the row's editor hands it back);
- a row that disappeared from the sheet is **reported, never deleted**;
- people who already signed in are linked to their roster row at the end.

## Setting up the hourly sync

Signed in as the sheet's owner (`ausss.secgen@gmail.com`):

1. Sheet → **Extensions → Apps Script**. Replace the default code with the
   whole of `roster-sync.gs`. Save.
2. Portal → **Roster** → *Spreadsheet* → **Turn on: issue a token**. Copy the
   token (it is shown once).
3. Apps Script → **Project Settings → Script properties**:
   - `SUPABASE_URL` = `https://wjijkqrdaakiwbtdssio.supabase.co`
   - `SUPABASE_KEY` = the publishable key (`sb_publishable_…`, the same value
     as `VITE_SUPABASE_ANON_KEY`; it identifies the project, it is not a secret)
   - `SYNC_TOKEN` = the token from step 2
4. Run `syncRoster` once from the editor, authorise when asked
   ("Google hasn't verified this app" → Advanced → Go to project → Allow), and
   read the execution log: it prints the added / updated / kept counts.
5. Run `installTrigger` once. The portal's *Recent imports* list shows each run.

Then set the sheet's sharing to **Restricted** (named people only). The script
runs as the owner, so it keeps working; "anyone with the link" exposes every
member's email address to whoever has the URL.

## Turning it off

When the portal becomes the only place the roster is edited: press **Turn off**
in the portal (the token dies at once) and run `removeTrigger` in the script.
A failed run emails the sheet's owner, so a forgotten trigger is noisy, not
silent.

## Notes

- The columns are read **by position** (name, email, year joined, years spent,
  LGAs, NGAs, current position, status), from the row under the one whose first
  cell is `Name`. Insert a column in the middle of the sheet and the three
  readers (`roster-sync.gs`, `src/portal/rosterFile.js`,
  `scripts/db/import-roster.mjs`) must change together.
- The script refuses to send fewer than 50 rows, so a filtered or half-loaded
  sheet cannot look like a mass change.
- Lost token: issue a new one in the portal and replace `SYNC_TOKEN`. Only a
  hash is stored, so it cannot be recovered.
