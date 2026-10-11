# AUSSS portal runbook

Status: written 2026-09-13 for Phase 0 and Phase 1 (`docs/PORTAL_BACKEND_PLAN.md`).
Every procedure below has been designed for a machine with Node 24 and no
Docker, no psql and no global Supabase CLI: everything goes through `npm run`
scripts that wrap the `supabase` devDependency, or through the Supabase MCP
server / SQL editor. Who owns what is in `docs/HANDOVER.md`.

## 0. Before anything else

- Clone the repository and `npm ci` (do not `npm install`, the lockfile pins
  the CLI version that CI also uses).
- Copy `.env.example` to `.env.local` and fill `VITE_SUPABASE_ANON_KEY` with the
  publishable key. Leave `SUPABASE_SECRET_KEY` blank unless you are about to
  import the roster (section 4). `.env.local` is gitignored; never commit it.
- Every `db:*` script goes through `scripts/db/supa.mjs`, which loads
  `.env.local` into the process environment and then spawns the CLI. The CLI's
  own `env(NAME)` substitution in `supabase/config.toml` reads from that
  environment (or from `supabase/.env`, also gitignored), never from
  `.env.local` directly.
- The npm scripts:

| Script | What it runs |
| --- | --- |
| `npm run db -- <args>` | Raw `supabase <args>` with `.env.local` loaded |
| `npm run db:new -- <name>` | `supabase migration new <name>` (do not use this for the fixed Phase 1 files; they already exist) |
| `npm run db:link` | `supabase link --project-ref wjijkqrdaakiwbtdssio` (asks for the database password) |
| `npm run db:push` | `supabase db push` to the linked hosted project |
| `npm run db:push:dry` | `supabase db push --dry-run`, lists what would be applied |
| `npm run db:list` | `supabase migration list`, local files versus remote history |
| `npm run db:config-push` | `supabase config push`, syncs `supabase/config.toml` auth settings to the hosted project |
| `npm run db:gen-reference` | `node scripts/db/gen-reference-data.mjs`, writes a new `*_reference_data.sql` migration from `src/data/society.js` |
| `npm run db:import-roster:dry` | Parses the roster spreadsheet and reports counts without writing |
| `npm run db:import-roster` | Merges the xlsx into `roster_entries` and links existing profiles (needs `SUPABASE_SECRET_KEY`; the portal's Roster page does the same without it) |

- Two ways to run SQL against the hosted database: the **Supabase MCP server**
  in Claude Code (`execute_sql`, `apply_migration`, `get_advisors`,
  `query_logs`) once authenticated via `/mcp`, or the **SQL editor** in the
  dashboard. Both run as `postgres`, so RLS does not apply; be deliberate.

## 1. Apply migrations

Migrations live in `supabase/migrations/` and are applied in filename order,
one transaction each. Each file must be re-runnable on a fresh database, which
CI (`.github/workflows/db-ci.yml`) verifies on every pull request touching
`supabase/**`.

### 1.1 Through the CLI (normal path)

```sh
npm run db:link          # once per machine; paste the database password
npm run db:list          # see which files are not yet applied remotely
npm run db:push:dry      # read the list; nothing is written
npm run db:push          # applies the pending files in order
npm run db:list          # confirm every local file now shows a remote version
```

`db:list` prints three columns: local timestamp, remote timestamp, name. A file
present locally with an empty remote column is pending. A remote entry with no
local file means someone applied SQL outside the repository; find it and commit
it, or the next fresh-database run in CI will diverge from production.

The `db-deploy` workflow does the same `db push --dry-run` then `db push` on
every push to `main` that touches `supabase/migrations/**`, using the GitHub
secrets in HANDOVER section 5. Pushing by hand is for the first apply and for
emergencies; otherwise merge to `main` and let CI apply.

### 1.2 Through the Supabase MCP server (no database password at hand)

Call `apply_migration` once per file, in filename order, passing the file's
contents as `query` and the filename stem (for example
`20260913100002_core_tables`) as `name`. It records the migration in
`supabase_migrations.schema_migrations` under that name, so `npm run db:list`
afterwards shows it as applied. Do not paste the same SQL through
`execute_sql`; that applies the change but records nothing, and the CLI will
try to re-apply the file later.

### 1.3 Afterwards

- Run MCP `get_advisors` with `type: security` and `type: performance`. The
  expected result is no findings about RLS being disabled, no
  security-definer functions exposed in `public` other than the seven documented
  RPCs (`claim_my_account`, `decide_verification`, `set_membership_status`,
  `set_current_term`, `admin_claim_unlinked`, `save_committee_page`, and
  `submit_application`, the only one anon may execute), and no missing indexes
  on foreign keys.
- New table? Add its grants to the `090-grants.sql` test and check
  `has_table_privilege('anon', ...)` in production: the hosted project used to
  hand anon/authenticated ALL on every new table through default privileges
  (fixed in migration `20260919160004_harden_table_grants`, which also removed
  those defaults; section 12 has the background).
- `select count(*) from public.committees` should be 10; `positions` at least
  26; `terms` exactly 2 with one `is_current`.

## 2. Add a new migration

```sh
npm run db:new -- short_snake_case_name
```

This creates `supabase/migrations/<timestamp>_short_snake_case_name.sql`.
Rules that CI enforces or that bite in production:

- No Postgres enums; use `text` plus a `check` constraint (adding an enum value
  cannot be used in the same transaction, and each migration is one transaction).
- `create ... if not exists` / `create or replace` wherever possible.
- New tables: RLS on, explicit `grant` to `anon`/`authenticated` (the project
  does not auto-expose tables), `app.set_updated_at()` and `app.audit()`
  triggers, policies written `to authenticated` with `(select app.helper())`
  wrapping and never an inline subselect on an RLS-protected table.
- New functions in `app` or security-definer functions anywhere: `set
  search_path = ''`, owned by `postgres`, `revoke execute from public` and
  grant only what is needed.
- Add or extend a pgTAP test in `supabase/tests/`.

Open a pull request; `db-ci` must be green before merge; `db-deploy` applies it.

## 3. Regenerate reference data (committees, positions, terms, officer invites)

`src/data/society.js` is the source of truth for the list of committees,
officer titles and role mailboxes (their editable page content lives in
`committees.page`, section 12). When it changes in a way that affects the
database (a new committee, a renamed officer title, a new term):

```sh
npm run db:gen-reference
```

The generator imports `src/data/society.js`, writes idempotent upserts keyed on
`terms.label`, `committees.slug`, `positions.key`, `invites (email, position,
term)`, and saves them as a new timestamped `supabase/migrations/
<YYYYMMDDHHMMSS>_reference_data.sql`. If the output is identical to the last
generated file it writes nothing and says so. Old generated files stay in place;
they are history, not duplicates.

Then review the diff, commit, and push through section 1. Note that officer
emails in `society.js` are role mailboxes; invites to those mean the successor
inherits the predecessor's profile. Prefer personal-email invites inserted by
hand (section 8) and let the EB end the role-mailbox assignments at rollover.

## 4. The membership roster

`public.roster_entries` is the live membership database. The public status check
(`rpc/check_membership`), the home-page count (`rpc/roster_stats`), sign-in claiming and the
portal's **Roster** page (`/portal/admin/roster`, EB only) all read it. Migration
`20260919200001_live_roster` holds the rules; `apps-script/README.md` explains the sheet sync.

**Day to day (no secret key needed):** the EB searches, edits, adds and removes members on the
Roster page. A row edited there is stamped `portal_edited_at` and belongs to the portal from
then on. A status change on a row whose member has signed in updates their profile too.

**Search.** The Roster page loads the whole roster once and searches it in the browser
(`src/portal/rosterSearch.js`), so the list follows every keystroke. Every typed word must match
(any order) in the name, email or position; transliteration variants (Mohamed/Muhammad,
Abdelrahman/Abd El Rahman, Elsayed/El Sayed) and typos match too, ranked below exact hits. The
same rules exist in SQL (`app.roster_match`, `app.name_skeleton`) for the bulk-update matcher and
`rpc/search_roster`; change both together.

**Bulk updates** (attendance after a GA, a batch of status upgrades): Roster → *Bulk update*.
Paste names and/or emails, name the event, review the matches (*likely* ones are pre-selected,
*pick one* and *not found* need a decision), apply. One event name can be applied once; *Undo*
on the same panel puts the old values back except where somebody edited the row again. Rows
changed this way belong to the portal, so the spreadsheet will not overwrite the new counts.
Log: `select at, action, label, jsonb_array_length(changes) from public.roster_bulk_updates order by at desc`.

**Years spent** is not typed any more: it is the academic year's starting year (a year starts on
1 September, Cairo time) minus the year joined. The database sets it on every save and the daily
job `roster-years-spent` (22:15 UTC) rolls the whole roster over on 1 September. The sheet's own
number is ignored; the field is read-only in the editor. To check or force it:
`select app.academic_year_start(), app.refresh_years_spent();`

**Status upgrades** are proposed, never applied, by the database. When GA counts reach the next
tier (Candidate → Associate at 1 Local or 2 National GAs; Associate → Full at 2 Local and 3
National) the Roster page shows *N members have the attendance for a higher status*. The EB ticks
who also meets the activity score and approves (a logged bulk update, undoable under *Register a
GA*), or presses *Not now*, which hides those members until next September. Either choice is
followed by a line with **Undo**, so a slip is taken back at once. The rule is
`app.next_status`; the list is `rpc/roster_upgrade_candidates`.

**Who is verified at sign-in:** anyone whose email is on the roster (at least `candidate`, even
with a blank status; archived/suspended rows change nothing) and anyone holding an active
assignment, which covers every TO and EB invite (trigger `verify_position_holder`). Everyone
else stays `unverified` and uses the verification queue (section 9).

**Public "did you mean".** `rpc/check_membership` may answer a miss with suggestions: up to three
member names, only when two or more near-complete words were typed, or a masked email hint
(`s•••a@gmail.com`) when exactly one roster address is within two edits. Real addresses are
never returned.

**Bringing the spreadsheet in** (while the Secretary General still edits it), any of:

0. **Nothing (the normal case):** the Edge Function `roster-sheet-sync` pulls the sheet connected
   on the Roster page every hour (pg_cron job `roster-sheet-sync`, authenticated by the Vault
   secret `roster_cron_secret`); *Sync now* on the same page runs it at once. If a run fails, look
   at `select * from cron.job_run_details order by start_time desc limit 5`, at
   `net._http_response`, and at the function's logs; the usual cause is the sheet no longer being
   readable (see the service-account steps in `apps-script/README.md`).
1. Portal → Roster → *Spreadsheet* → *Import an .xlsx or .csv*.
2. The hourly Apps Script on the sheet (`apps-script/roster-sync.gs`), authenticated by the
   token issued on the same panel. While a token is in use, **Issue a new token** (which
   switches the old one off) and **Turn off** each ask for a second click, because either one
   stops the script until a new token is pasted into it. **Disconnect**, for the connected
   sheet, asks twice as well.
3. `npm run db:import-roster` with `SUPABASE_SECRET_KEY=sb_secret_...` in `.env.local` (reads
   `_source/records/membership/updated AUSSS Membership Database.xlsx`; `:dry` parses only).
   Blank the key again afterwards.

All three call the same merge, `app.apply_roster_rows`: new rows are added, changed rows
updated, portal-edited rows kept, rows missing from the file reported and **never deleted**,
then `app.claim_unlinked()` links anyone who signed in earlier. Each run is logged in
`public.roster_sync_runs` (shown on the Roster page as *Recent imports*).

Checks:

```sql
select count(*), count(email_normalized) as with_email, count(profile_id) as signed_in,
       count(portal_edited_at) as portal_owned
from public.roster_entries;
select at, source, batch, result - 'missing_names' from public.roster_sync_runs order by at desc limit 5;
```

The sheet's columns are read by position; see the note in `apps-script/README.md` before anyone
inserts a column. Public lookups are limited to 30 per 10 minutes per address and 300 per minute
overall (`app.membership_lookup_hits`, kept for an hour, never records what was searched).

## 5. Push auth configuration

`supabase/config.toml` holds the auth settings (site URL, redirect allow-list,
magic-link settings, Google provider, custom SMTP). Secrets are referenced as
`env(NAME)` and read from `supabase/.env` (gitignored, template in
`supabase/.env.example`): `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`,
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, `RESEND_API_KEY`.

```sh
npm run db:config-push
```

Read the diff the CLI prints before confirming. Two caveats:

- **Omitted sections revert.** `config push` treats `config.toml` as the whole
  truth for every section it supports. If a section (for example
  `[auth.email.smtp]`) is missing or commented out, the hosted value is reset to
  default, which silently switches auth mail back to Supabase's rate-limited
  SMTP. Keep every section that was ever set in the dashboard present in the
  file. The first push after any dashboard change is done by hand, reading the
  diff, never from CI.
- The redirect allow-list must contain exact patterns:
  `http://localhost:5173/**`, `https://*-ausss-website.vercel.app/**`,
  `https://ausss-ainshams.org/**`, `https://www.ausss-ainshams.org/**` and
  `https://ausss-ainshams.vercel.app/**`. Do not widen to
  `https://*.vercel.app`; that is an open redirect.

Settings not covered by `config.toml` (email templates on the free plan, some
rate limits) are dashboard-only; note them in a comment in the file so the
next person knows they exist.

## 6. Wake a paused project

Free-tier projects pause after seven days without any API traffic. Symptoms: the
portal shows its "not configured / cannot reach" panel, `fetch` to
`*.supabase.co` returns 5xx or a pause page, dashboard shows "Paused".

To wake it: Supabase dashboard, open the project, click **Restore**. It takes a
minute or two. Nothing is lost; data and auth users persist through a pause.

To keep it from pausing: `.github/workflows/keepalive.yml` runs daily
(`17 6 * * *` UTC) and requests one row from `terms` with the publishable key,
using the GitHub secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Two
things stop it silently:

- GitHub disables scheduled workflows in a repository with **no activity for
  60 days**. Any commit re-enables them; a quiet summer will trip it. Check the
  Actions tab at the start of each term (HANDOVER section 6.4) and after any
  long gap. Re-enable from the workflow's page if it shows as disabled.
- A rotated publishable key (section 7) without updating the GitHub secret;
  the run fails with 401 and the project pauses a week later.

If the project keeps pausing anyway, the long-term answer in the plan is the
Pro plan or a Vercel cron; neither has been set up.

## 7. Rotate the Supabase keys

### 7.1 Publishable key (`sb_publishable_...`)

Not a secret, but rotate if it has been abused (unexpected traffic in the logs).
Dashboard: Project Settings, API Keys, create a new publishable key, then update
in this order so nothing goes dark:

1. Vercel: `VITE_SUPABASE_ANON_KEY` for Production and Preview, then redeploy
   (Deployments, Redeploy, or push an empty commit).
2. GitHub secret `SUPABASE_PUBLISHABLE_KEY` (keepalive).
3. `.env.local` on each developer machine.
4. Delete the old key in the dashboard once the new production deploy is live.

### 7.2 Secret key (`sb_secret_...`)

Rotate at every term rollover and whenever it has been seen by anyone who has
left. Dashboard: Project Settings, API Keys, create a new secret key, update
`.env.local` on the webmaster's machine (the only place it may live), delete
the old key. Nothing in Vercel or GitHub uses it; if you find it there, that is
a leak, remove it.

### 7.3 Database password

Dashboard: Project Settings, Database, Reset database password. Then update the
GitHub secret `SUPABASE_DB_PASSWORD` and re-run `npm run db:link` locally with
the new password. Check that the next `db-deploy` run is green.

### 7.4 Personal access tokens

`supabase.com/dashboard/account/tokens`. Revoke tokens belonging to departed
people; create a new one for CI and update the GitHub secret
`SUPABASE_ACCESS_TOKEN`.

## 8. Give someone EB or webmaster (or any position) access

Permissions are assignments in the current term, never a role column. The
cleanest way is an **invite row**: the `app.handle_new_invite()` trigger
assigns immediately if a profile with that email already exists; otherwise the
assignment is created the first time that email signs in (`app.claim_for_profile`).

In the SQL editor or MCP `execute_sql` (runs as `postgres`):

```sql
-- One invite: personal email, position key, current term.
insert into public.invites (email, position_id, term_id)
select 'person@example.com', p.id, app.current_term_id()
from public.positions p
where p.key = 'eb.vp-internal'
on conflict (email_normalized, position_id, term_id) do nothing;
```

Position keys: `eb.president`, `eb.vp-internal`, `eb.vp-external`,
`eb.secretary-general`, `society.webmaster`, officer keys such as `score.lore`
or `scope.leo-out`, and `<committee-slug>.assistant` / `<committee-slug>.member`.
List them with `select key, title, level from public.positions order by sort`.
For an officer's, the board's or the webmaster's position the address must be the
position's work email (`select p.key, w.email from public.position_work_emails w
join public.positions p on p.id = w.position_id`); an invite to any other address
is stored but never taken up.

Check it took effect:

```sql
select i.email, i.accepted_at, a.status
from public.invites i
left join public.assignments a
  on a.position_id = i.position_id and a.term_id = i.term_id
 and a.profile_id = i.accepted_profile_id
where i.email_normalized = app.norm_email('person@example.com');
```

`accepted_at` filled and `status = 'active'` means they already had a profile
and are assigned now. `accepted_at` null means it will happen on their first
sign-in with that exact email (Google account or magic link).

Since Phase 5b the portal does this without SQL: the "Invites" tab of a committee
for its positions, and Roster page > "Executive Board" for the board and the
webmaster (section 23). An officer's, a board member's or the webmaster's
position can only be given to its **work email**: the invite form fills it in,
and the database refuses any other address (section 14). A position on
somebody's roster row gives no such access. The SQL here is
for when nobody who could do it can sign in.

To **remove** access, end the assignment rather than deleting it (history stays):

```sql
update public.assignments
set status = 'ended', ended_on = current_date
where profile_id = '<profile uuid>' and status = 'active'
  and position_id = (select id from public.positions where key = 'eb.vp-internal');
```

## 9. Approve a membership verification

Members who are not on the roster sign in as `unverified` and submit a request
at `/portal/verify`. Two ways to decide:

- **Portal** (preferred): sign in as an EB member, open
  `/portal/admin/verification`, Approve or Decline. The page calls the
  `decide_verification` RPC, which checks `app.is_eb()` inside the database.
  Approve is one click; Decline turns red and asks for a second. A decided
  request stays in the list until the page is left, with what happened written
  in its row ("Approved. … is now an active member."). Nothing on the page
  takes a decision back: `decide_verification` accepts a pending request only.
- **SQL**, as `postgres`, when the portal is unavailable:

  ```sql
  select id, profile_id, message, created_at
  from public.verification_requests
  where status = 'pending' order by created_at;

  -- Approve (new_status defaults to 'active'; pass 'candidate' or 'alumni' if that fits)
  select public.decide_verification('<request uuid>', 'approved', 'active');

  -- Decline
  select public.decide_verification('<request uuid>', 'declined');
  ```

  As `postgres` the `app.is_eb()` check sees no `auth.uid()` and the RPC will
  raise; in that case update directly:

  ```sql
  update public.verification_requests
  set status = 'approved', decided_at = now()
  where id = '<request uuid>';
  update public.profiles
  set membership_status = 'active'
  where id = '<profile uuid>';
  ```

Check the Members Officer agrees before approving anyone you cannot place. The
EB-only RPC `public.set_membership_status(profile_id, status, tier)` changes a
status without a request, for example to mark alumni.

## 10. Term rollover (database part)

Since 2026-10-08 the Executive Board does this in the portal, at **New term**
(the button at the foot of **Site settings**, `/portal/admin/rollover`); section 29 says what the page does and why. The full
checklist, seats and secrets included, is HANDOVER section 6.

Do not switch the term by hand (`set_current_term`, or an `update` of `terms`). Every access
check reads the current term, so a bare switch leaves everyone holding nothing, the person who
ran it included, and then nobody can hand positions out again. The page prepares the new term
first and switches last, in one call.

If the portal cannot be used, the same call runs in the SQL editor on behalf of a board work
account (the function checks that the caller is on the board, so it has to be told who that is
for the length of the transaction):

```sql
begin;
-- The profile id of a board or webmaster work account (Authentication > Users, or
-- select id from public.profiles where email = 'aussswebsite@gmail.com').
select set_config('request.jwt.claims',
  json_build_object('sub', '<profile id>', 'role', 'authenticated')::text, true);

-- 1. Read what it would do (positions, work emails, tasks, albums).
select jsonb_pretty(public.rollover_preview());

-- 2. Switch. The last argument lists the albums to archive (ids from the preview's
--    "albums"); '{}' archives none.
select public.roll_over_term('2027-28', '2027-09-01', '2028-08-31',
  array['<album id>', '<album id>']::uuid[]);
commit;

-- 3. Check.
select label, is_current from public.terms order by starts_on;
select p.level, count(*) from public.assignments a
join public.positions p on p.id = a.position_id
join public.terms t on t.id = a.term_id
where t.is_current and a.status = 'active' group by p.level;
```

The portal, the assignment queries and every `app.*` helper read
`app.current_term_id()`, so the switch is immediate for signed-in users on their
next request.

## 11. Debugging

### Where to look

- **Supabase logs**: dashboard, Logs, pick API (PostgREST), Auth, or Postgres;
  or MCP `query_logs` with `service: api | auth | postgres`. Auth failures
  (redirect not allowed, provider error) are in the Auth log with the exact
  reason; the browser only sees `error_description` in the callback URL. The
  callback card does not print that text, since anyone can write an address:
  it shows a sentence of its own, so read the reason from the address bar or
  the log.
- **Advisors**: MCP `get_advisors` (`security`, `performance`) after every
  migration. Findings about `rls_disabled`, `function_search_path_mutable` or
  `auth_rls_initplan` mean a migration broke a rule in section 2.
- **Vercel**: Deployments, the failed build's log; runtime is static so there
  are no server logs. CSP violations show in the browser console as blocked
  `connect-src`; the CSP in `vercel.json` must list
  `https://wjijkqrdaakiwbtdssio.supabase.co` and `wss://...`.
- **Browser**: DevTools Network filtered on `supabase.co`. Status and body of
  the failing request tell you which case below you are in.

### Common symptoms

| Symptom | Meaning | Fix |
| --- | --- | --- |
| Query returns `[]` or `null` with HTTP 200 | RLS policy denied the row; PostgREST never errors on a select denial | Check the user's assignments in the current term (`select * from app.my_levels()` while impersonating, or compare against the policy in `20260913100005_rls.sql`). Often the invite email differs from the sign-in email by case or alias. |
| HTTP 401/403 with `42501 permission denied for table X` | Missing `grant`, not a policy: the role cannot touch the table at all | Add the grant in a migration; the project does not auto-expose tables. Same code for `permission denied for function`: missing `grant execute`. |
| `42501` on an update of `profiles` | Column-level grant: members may update only `full_name, phone, faculty_year, photo_path, avatar_url, directory_opt_in` | Use `set_membership_status` RPC (EB) or SQL as postgres for the other columns. |
| `PGRST202` function not found | RPC name or argument names differ from the schema, or schema cache is stale | Check `decide_verification(request_id, decision, new_status)`, `claim_my_account()`; `notify pgrst, 'reload schema';` as postgres. |
| `42P17` infinite recursion in policy | A policy queried an RLS-protected table inline | Route through an `app.*` security-definer helper. |
| Sign-in succeeds but user lands on `unverified` despite being on the roster | Email mismatch between roster and account, or roster not imported | `select * from public.roster_entries where email_normalized = app.norm_email('...')`; re-run `select public.claim_my_account()` as that user, or fix the roster and `admin_claim_unlinked()`. |
| Officer signs in and sees no position | Invite email is not the email they signed in with, or the invite is for another term | Section 8 check query; insert a new invite for the right email. |
| Magic link never arrives | Default Supabase SMTP: only project team members, a few per hour | Configure Resend custom SMTP and push config (section 5). Google sign-in works meanwhile. |
| Google button returns `redirect_uri_mismatch` or `access blocked` | OAuth client redirect URI missing, or consent screen back in Testing | Redirect URI `https://wjijkqrdaakiwbtdssio.supabase.co/auth/v1/callback`; publish the consent screen. |
| Callback page times out after 8 s | Redirect URL not in the allow-list, so Auth bounced to the site URL without tokens | Add the exact origin pattern to `additional_redirect_urls`, push config. |
| Everything 5xx or a Supabase pause page | Project paused | Section 6. |
| `db-deploy` fails at `supabase link` | Wrong or rotated `SUPABASE_DB_PASSWORD` / `SUPABASE_ACCESS_TOKEN` | Section 7.3, 7.4. |
| `npm run db:list` shows a remote migration with no local file | Someone used `execute_sql`/SQL editor for schema work | Reconstruct it as a migration file and commit; do not `db push` until reconciled (`supabase migration repair` if needed). |

### Impersonating a user in SQL (as postgres)

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '<profile uuid>', 'role', 'authenticated')::text, true);
set local role authenticated;
select * from app.my_levels();
select id, full_name from public.profiles;   -- what this user can see
rollback;
```

This is the same mechanism `supabase/seed.sql`'s `tests.authenticate_as()`
uses in CI, so a case that fails here is a good candidate for a pgTAP test.

## 12. Officer content: committee pages, Open Calls, site settings (Phase 2)

Since 2026-09-19 the officer editor is the portal, not `apps-script/officers.gs`.
Everything an officer used to do at `/account` is at `/portal/committees/<slug>`
(EB: every committee; officers: the committees where they hold an
officer-level assignment this term, via `app.is_officer_of`). `/login` and
`/account` redirect there.

Where the data lives:

| What | Table / place | Who writes | Public read |
| --- | --- | --- | --- |
| Committee page overrides (tagline, about, what we do, lead photo, members) | `committees.page` (jsonb, `{}` = no override) | `rpc/save_committee_page` (officer of that committee or EB); normalises and caps the document | `GET /rest/v1/committees?select=slug,page` (anon) |
| Officer and member photos | Storage bucket `committee-media`, path `<slug>/<hint>-<timestamp>.jpg`, public | officers of that slug (storage policies) | public URL stored in the page document |
| Open Calls | `calls` (status `draft`/`open`/`closed`; "expired" is derived: open + deadline before today in Africa/Cairo) | officers via the table (RLS); `notify_email` is never readable by anon | view `open_calls` (live calls, public columns only) |
| Applications | `applications` (snapshot of call title + committee; `status` new/shortlisted/accepted/declined, `notes`) | inserted only by `rpc/submit_application` (anon; validates, honeypot, 24h dedupe, 20/min cap); officers update status/notes; EB deletes | none |
| Site settings | `site_settings` (key, jsonb value) | EB at `/portal/admin/settings` | `GET /rest/v1/site_settings` (anon) |

The public site reads all of this over plain REST (`src/lib/supabaseRest.js`)
with the publishable key, caches the last response in `localStorage`, and
falls back to `src/data/society.js` when the env vars are absent. Open Calls
cards are additionally gated by the site setting `openCallsLive` ("Show Open
Calls on the public site" on Site settings; off while the joining flow is
unsettled, and officers can still prepare calls in the portal). See section 27.

The committee editor keeps its place in the address (`useTabParam`, section 24):
the open tab as `?tab=` (`events`, `calls`, `members` or `invites`; the
Committee page tab is the plain address), an open call as `?call=` (`new`, or
the call's id) and its applications as `?view=applications`. A reload, or a
link sent to another officer, opens the same place. A tab stays loaded once it
has been opened, so a half-written call survives a look at another tab, and
Cancel and "Back to calls" ask "Discard changes" once something was typed.

The call form checks a call before the database does (`callProblems` in
`src/portal/officerQueries.js`) and says each problem under its own field: no
title, an open call whose deadline day has passed (an expired call saved
without touching its date or status still goes through), a notification
address that is not an email, a position with text and no title, a "choose
one" question with no choices. The last three the database would otherwise
drop without a word.

Useful SQL (as `postgres`):

```sql
-- Clear one committee's override so the static society.js content shows again.
update public.committees set page = '{}'::jsonb where slug = 'scope';

-- Calls that are open but past their deadline (what visitors no longer see).
select m.slug, c.title, c.deadline from public.calls c
join public.committees m on m.id = c.committee_id
where c.status = 'open' and c.deadline < app.today_cairo();

-- Applications for a committee, newest first (personal data: EB/officers only).
select a.created_at, a.ref, a.call_title, a.name, a.email, a.status
from public.applications a join public.committees m on m.id = a.committee_id
where m.slug = 'score' order by a.created_at desc;
```

Not yet done in Phase 2, by design:

- No email is sent when an application arrives (`officers.gs` used MailApp).
  `calls.notify_email` is stored for the Phase 3 notification digest through
  Resend. Officers see new applications in the portal instead.
- Old officer photos still point at `lh3.googleusercontent.com` (Drive). They
  keep working while the Drive folder stays shared; each committee replaces
  them by uploading through the editor.
- The `Applications` sheet in the old workbook was not imported (it needs an
  export from the Sheet; the two calls that were live on 2026-09-19 were
  copied by hand into `calls`).


## 13. Portal core: tasks, updates, notifications (Phase 3)

Since 2026-09-20 the portal has `/portal/tasks`, `/portal/updates` and
`/portal/notifications`, and the dashboard opens with "Your tasks" and unread
updates. Migrations `20260920200001_tasks_and_notifications` and
`20260920200002_posts_and_reads`; tests in `supabase/tests/130-tasks-and-posts.sql`.

| What | Table | Who sees it | Who writes |
| --- | --- | --- | --- |
| Tasks | `tasks` (committee or null = society-wide, term, status `todo`/`doing`/`blocked`/`done`, priority, `due_on` as a Cairo day) | assignees, the creator, the committee's officers, the EB | create: officers of the committee, positions with `can_assign_tasks`, EB (society-wide: EB only). Edit/delete/assign: officers, EB, or the creator. An assignee changes the **status only**: `app.guard_task()` pins every other column for them. |
| Assignees | `task_assignees` | whoever sees the task | task managers; the person must hold a position in that committee this term (`app.is_assignable`) |
| Timeline | `task_updates` | whoever sees the task | clients insert comments only (column grant on `task_id, body`); `created`, `status`, `edited`, `assigned`, `unassigned` rows come from triggers |
| Notifications | `notifications` (`task_assigned`, `task_status`, `task_comment`) | the recipient | triggers only, never for your own action; the recipient may set `read_at` |
| Updates | `posts` (committee or null = whole society, optional `levels`, `publish_at` null = draft, `expires_at`, `pinned`) | committee officers and EB always; everyone else once it is live and they are in the audience (`app.post_in_audience`) | officers of the committee, EB (society-wide: EB only) |
| Read receipts | `post_reads` | the reader; the post's managers | the reader. `rpc/post_audience` lists who has and has not read a post (managers only). |

`rpc/profile_names(ids)` resolves name + avatar for ids a member already holds,
because `profiles` RLS hides members from each other. `rpc/task_assignable_people`
feeds the assignee picker.

These pages keep their place in the address (`useTabParam`, section 24), so
Back from a task returns to the same filtered list and a link can be sent to a
colleague. Tasks: `?tab=new` (the new-task form), `?show=` (`mine`, `created`
or `all`), `?view=` (`list` or `board`), `?committee=<slug>` and `?done=shown`;
the scope and layout a person last chose are their default and stay out of the
address. A task: `?tab=edit`. Updates: `?tab=new` and `?edit=<id>`. A form
that has been typed in asks "Discard changes" on Cancel, and the update form
refuses a schedule in the past or a take-down before the update goes out
(`postTimeProblems` in `src/portal/workQueries.js`).

To let an assistant position hand out tasks:

```sql
update public.positions set can_assign_tasks = true where key = 'scope.assistant';
```

### The daily email digest

Every day at 15:30 UTC the pg_cron job `email-digest` calls the Edge Function of the
same name (its own Vault secret `digest_cron_secret`, `verify_jwt = false`). The
function asks `rpc/admin_digest_batch` who has something unseen (unread notifications
never emailed, plus live unread updates addressed to them since their last digest),
sends one email each through Resend, then calls `rpc/admin_digest_mark`. People opt
out under Profile (`profiles.email_digest`). Nobody is emailed twice within 20 hours.

Resend's free plan allows 100 emails a day, shared with sign-in links, so a run takes
at most 80 people (longest-waiting first) and stops early on a 429 or quota error;
whoever did not fit is first in line the next day. If `digest_runs.note` keeps saying
"Stopped early", go weekly, pay for Resend Pro, or move to another provider (SMTP
settings plus the one `fetch` in the function).

The function needs the secret `RESEND_API_KEY` (Dashboard > Edge Functions > Secrets).
Without it, it answers `{ skipped }` and sends nothing. Optional secrets: `DIGEST_FROM`,
`PORTAL_URL`.

```sql
-- What the last runs did.
select * from public.digest_runs order by id desc limit 10;
-- Who would be emailed right now (secret-key/postgres only).
select jsonb_array_length(public.admin_digest_batch(80));
-- Did the cron job fire, and what did the function answer?
select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'email-digest') order by start_time desc limit 5;
select id, status_code, content::text from net._http_response order by id desc limit 5;
```

Not done yet: file attachments on tasks, per-assignee completion, an immediate email
on assignment (the plan had one; it would eat the daily allowance).

## 14. Committee rosters (Phase 4, part 1)

Migration `20260921090001_committee_roster`. Every roster row can carry one committee
(`roster_entries.committee_id`, nullable: a member is in exactly one committee or none
yet) and the marker `is_contact_person` (Exchange Contact Person is held alongside the
main position, never as a second committee).

Who sets it: the EB, on `/portal/admin/roster` (the Committee field of a row, the
committee filter, or **Set committees**: paste a committee's members list, review the
matches, apply; logged in `roster_bulk_updates` and undoable like a GA). When a row has
no committee, the database proposes one from the sheet's "Current Position" text if it
names exactly one committee ("SCORA Core Team Member", "LORA"); it never overrides a
choice, and clearing it by hand sticks until the position text changes. Neither column
is a spreadsheet column, so setting them does not make the portal own the row and the
hourly sheet sync keeps updating it.

**SCOPE/SCORE is one choice on the Roster page (since 2026-10-05).** The two exchange
committees run one team and the sheet files its people under "Exchange", so the Committee
field, the committee filter, **Set committees**, the row tag, the export and Position types
offer them as one entry, "SCOPE/SCORE" (`src/portal/rosterUnits.js`). They are still two
committees in the database and on the public site. A member of the unit is filed under
SCOPE, where the shared positions below officer live (Local Member, the assistants, CBDA);
choosing an officer position files them where that position belongs, so LORE puts the
member under SCORE by itself. SCORE's own copies of the shared positions are no longer
offered.

**The exchange officers share that list (migration `20261005112802_exchange_shared_roster`,
test `250-exchange-shared-roster.sql`).** `committees.roster_group` is `exchange` for SCOPE
and SCORE, and for the committees of one group these are shared: the Members tab and the
Invites tab (opened from either committee they show the same people, under the name
SCOPE/SCORE), handing out the positions below officer, the officer notes, and who a task can
be given to (a SCORE task can go to a member filed under SCOPE, and the other way round).
Everything else stays with each committee's own officers: its public page, its open calls
and applications, its updates, and creating or managing its tasks. An officer of one is not
an officer of the other (`app.is_officer_of` is unchanged; the shared parts ask
`app.is_roster_officer_of`). Updates are the gap to know about: an update posted to SCORE
reaches the people who hold a SCORE position, so the shared members, filed under SCOPE, get
SCOPE's updates only. To put another pair of committees on one roster, give both the same
`roster_group` value and add the pair to `MERGED` in `src/portal/rosterUnits.js`.

**Access belongs to the work emails (migration `20261005170001_access_by_work_email_only`,
test `260-board-on-roster.sql`).** The roster lists people under their personal emails. The
society runs its committees and its board from each position's own work account (the role
inboxes of `src/data/society.js`), handed over every term. So a position on a roster row
reaches that email's account **only when it is below officer**: a member or an assistant
gets it, which is what lets them receive tasks. For an officer's, a board member's or the
webmaster's position the row is a record of who holds it and nothing more: no invite, no
assignment, and the member's own account stays a normal member's. The row editor and the
Members tab say "Recorded on the roster only" when such a position is chosen. Access to the
committee editors, the gallery and magazine editors, the submissions and the board's pages
is given in one way: the Executive Board invites the position's work email (a committee's
Invites tab for its officers, Roster page > Executive Board for the board and the
webmaster).

**The work emails are enforced (migration `20261005180001_work_emails_enforced`, test
`270-work-emails.sql`).** Every officer's, board member's and the webmaster's position has
one work email in `public.position_work_emails`, and the database gives that position to the
account of that address and to no other, at each of the three doors: an invite
(`rpc/invite_to_position` answers "This position can only be given to its work email, ...",
and a direct write of an invite is refused by its policy), the taking-up of an invite
(`app.handle_new_invite` and `app.claim_for_profile` leave an offer to any other address
unaccepted, however it got into the table), and a direct write of an assignment. A position
with no work email cannot be given at all. The list was seeded from the role inboxes the
reference data had invited (the `email` of each role in `src/data/society.js`). The
Executive Board reads and changes it under "Work emails", on a committee's Invites tab and
in the Executive Board panel of the Roster page; only the webmaster changes the
webmaster's; officers and visitors cannot read it. **To move a position to a new address**
(a role inbox is replaced): change the work email, Remove the current holder in "Holding a
position", then Invite: the form fills in the new address by itself. Changing the address
alone moves nothing, the old account keeps the position until it is removed.

**The Executive Board on the Roster page (migration `20261005160001_board_on_roster`).** The
Committee field and the committee filter offer "Executive Board" beside the committees. It
is not a committee: the board's positions belong to none, so a member of the board is a
roster row with no committee and one of these positions: President, the two Vice
Presidents, the Secretary General, or an assistant to one of them
(`eb.president-assistant`, `eb.vp-internal-assistant`, `eb.vp-external-assistant`,
`eb.secretary-general-assistant`). An assistant's position is level `assistant`: it reaches
the member's account, where it receives tasks and updates and carries none of the board's
access. A board position on a row is a record only (see above). The position is chosen by
hand: the sheet sync and the "other positions" text never set it, a row that holds one is
not moved into a committee because its text names one, and the webmaster's position cannot
be put on a roster row at all.

**"Other positions"** is the roster's name for the sheet's "Current Position" text since
2026-10-05 (the Roster page editor, its export, and the Members tab): with the committee
position kept in its own field, the free text is for what a member holds beyond it. The
column is still `current_position` and still filled by the sheet sync.

**The public member lookup follows the roster (migration `20261005190001_lookup_follows_roster`,
test `280-lookup-follows-roster.sql`).** `/members` asks `rpc/check_membership`, which reads
the roster row live, so a change on the Roster page or in the sheet shows on the next lookup
with nothing to publish. Status, year joined and GA counts come straight from the row. The
positions are put together by `app.roster_positions_text`, one per line:

1. the position set on the roster: an officer by the short name ("LORE", "LEO-In"), a board
   position or a board assistant's by its title, anything else as committee plus title
   ("SCORA Core Team Member", "SCOPE/SCORE Incomings Assistant");
2. the lines of "Other positions" that do not say the same thing again ("SCORA Core Team",
   "Exchange Incomings Assistant" and "PnSDD" are recognised as repeats of the position);
3. "Exchange Contact Person", when the row is marked as one.

A member with none of these shows as "General Member". If a lookup shows a position twice
in different words, the text names it in a way the comparison does not recognise: delete
that line from "Other positions" on the member's row. The special result cards (officers,
the board) are chosen in the browser from these lines (`src/lib/teamIndex.js`).

What officers get: the **Members** tab of `/portal/committees/<slug>`, fed by
`rpc/committee_roster` (the roster table itself stays EB-only). Membership facts are
read-only there. They can give a member a position below officer level
(`rpc/assign_roster_member`: a standing invite on the roster email, so it works before
the member has signed in; a member holding a position can be given tasks) and keep
notes (`member_notes`). Notes are visible to that committee's officers and the EB,
never to the member they are about (not even if that member is an officer or on the
EB), and they stay with the committee that wrote them when a member moves.

```sql
-- How many members each committee has, and who is still unplaced but has a position text.
select coalesce(c.abbr, '(none)') as committee, count(*)
from public.roster_entries r left join public.committees c on c.id = r.committee_id
group by 1 order by 2 desc;
select full_name, current_position from public.roster_entries
where committee_id is null and current_position is not null order by 2;
```

Not done yet: showing Contact Persons to the exchange officers.

### Positions inside a committee (Phase 4, part 2)

Migration `20260921100001_roster_positions`. Every roster row in a committee holds ONE
position there (`roster_entries.position_id`). Giving a member a committee makes them
its **Local Member**; the Position field that then appears in the row editor offers the
committee's members, assistants and coordinators (and, for the EB, its officers). When
nothing was chosen yet the sheet's "Current Position" text is read first ("SCORA Core
Team Member", "RSD GA", "LORA"). Officers set the same field from the Members tab, for
positions below their own only.

A position below officer reaches the portal by itself (`app.sync_roster_position`): a
standing invite on the roster email, so an assignment at once if the member has an account
and at their first sign-in otherwise. Changing it withdraws the old invite and ends the old
assignment. No email on the roster: the title shows, nothing reaches an account. An
officer's position on a row reaches nothing: it is a record, and the access goes to the
position's work email by invite ("Access belongs to the work emails", above).

The list of positions is data, not code: **Position types** on the Roster page lets the
EB add, rename or remove them per committee (the database makes the `key`). The plus beside
a heading adds a position at that level; the minus beside a position removes it in two
clicks (the first turns it red, the second removes; it goes back to normal after a few
seconds or when you move away). Removing deletes the position: its invites and assignments go with it, and
every member who held it becomes a Local Member of the committee, on the roster and on
their account (the roster's own trigger does that; test `240-position-types.sql`). Local
Member cannot be removed. Before 2026-10-05 a position was "retired" instead (kept on its
holders, no longer offered); the few retired ones show struck through and can be brought
back or removed.

**The order of committees in the portal** (every drop-down and list) is fixed in
`COMMITTEE_ORDER` in `src/portal/officerQueries.js`: SCOPE, SCORE (one entry, SCOPE/SCORE,
on the Roster page), SCORA, SCOPH, SCOME, SCORP, CBSD, PNSD, PSD, RSD. The public site keeps
its own order, the order of `src/data/society.js`, which is also what `committees.sort`
in the database follows.
Assistants and coordinators share the level `assistant`; they receive tasks but do not
assign them unless `positions.can_assign_tasks` is switched on for that position (SQL or
the table editor for now). The seed came from the titles the sheet used on 2026-09-21;
abbreviations nobody could expand (MEA, MEDA, RSDA, PNSDA, PR, ME, CBA, DA, TDA) are
titled as the sheet writes them: rename them under Position types.

```sql
-- Who holds what, per committee.
select c.abbr, p.title, count(*) from public.roster_entries r
join public.positions p on p.id = r.position_id join public.committees c on c.id = r.committee_id
group by 1, 2 order by 1, 3 desc;
```

## 15. Discoverability: pre-rendered pages, sitemap, robots, llms.txt (Phase 4)

The public site is a single-page app, so until 2026-09-23 every URL served the same
empty `index.html` and only crawlers that run JavaScript (Google, slowly) saw any
content. Bing, the AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) and
the link-preview bots of WhatsApp, Facebook and Instagram saw a blank page with the
home-page card. Now `npm run build` runs `vite build` and then `scripts/prerender.mjs`,
which renders every public page to real HTML at build time.

**What the build produces (in `dist/`):**

- `<route>/index.html` for every entry in `src/seo/pages.js` (35 pages on
  2026-09-23: the fixed pages, one per committee, one per gallery album), each with
  the page's own `<title>`, description, canonical link, Open Graph / Twitter card
  and JSON-LD (organisation record on the home page; WebPage + BreadcrumbList
  everywhere; FAQPage on /join; an Organization per committee; ImageGallery per
  album). The home page is `dist/index.html`.
- `spa.html`: the untouched shell. `vercel.json` rewrites every URL without a
  pre-rendered file to it: the portal, the redirect aliases, unknown paths.
  Vercel serves static files before rewrites, so a pre-rendered page always
  wins. An unknown path then shows the site's not-found page ("Addresses that
  name no page", below).
- `sitemap.xml` and `llms.txt`, generated from the same page list. There is no
  `public/sitemap.xml` any more; do not add one back, it would shadow the generated one.

**Adding or changing a public page:** add the route in `src/App.jsx` as before, then add
an entry to `src/seo/pages.js` (path, title, description; optionally an image and the
breadcrumb parent). Keep the title and description identical to what the page passes to
`usePageTitle()`: the table is what crawlers read, the hook is what a visitor sees after
client-side navigation. New committees and albums are picked up by themselves. The
build fails if a listed path is listed twice or renders without a `<main>`. It does not
catch a listed path that `src/App.jsx` has no route for: the layout's own `<main>` is
always there, so such a path is saved as the not-found page. Open a new page's saved
file once (`npm run preview:prerendered`, below) to see that it is the page meant.

**Addresses that name no page.** An address no route knows shows a page of its own,
`src/pages/NotFoundPage.jsx`: "We couldn’t find that page", a button home and links to
the main pages, inside the site's header and footer. A committee address with no such
committee shows the same page. Before, both landed on the home page without a word.
The portal and the exam never reach it: their routes take every address under `/portal`
and `/exam`. A few addresses people may type still go somewhere: `/committees` to the
committees section of the home page, `/index.html` to the home page, and the aliases
listed in `src/App.jsx` (`/quiz`, `/login`, `/social` and the like).

An album or event address that names nothing shows the not-found page too
(`GalleryPage.jsx`, `EventsPage.jsx`), and so does the calendar file address of an unknown
event (`/events/<slug>.ics`), but only once the live list has arrived without it. The list
a page starts from, baked in by the build or kept by the browser, may be older than the
album or event, so until the live answer comes the page waits. Archived albums, past
events and links from before a rename still open. If the live list never comes (the read
fails, or the gallery's comes back with no albums), the page cannot be certain and keeps
its own "Album not found" or "Event not found" message, with no `noindex` tag.

It is a soft 404. The server answers 200, because `vercel.json` hands the shell to every
address without a file, so the page asks search engines to leave it out:
`usePageTitle('Page not found', undefined, { noindex: true })` adds a `robots` tag of
its own while the page is shown and takes it away on leaving. A crawler that runs no
JavaScript sees only the empty shell, without the tag. A true 404 status would need two
changes that have not been made: `vercel.json` rewriting only the routes that live in
the app (the portal, the exam, the checkout, the aliases, and albums and events
published since the last build), and `scripts/prerender.mjs` writing the not-found page
to `dist/404.html`, outside the page list so it stays out of the sitemap.

**Components must survive Node:** the pre-render runs the public pages in Node with no
`window`, `document` or `localStorage`. Effects (`useEffect`) do not run there, so
browser-only work belongs in effects; anything read during render must be guarded
(`typeof window === 'undefined'`), see `src/lib/localCache.js` and `CountUp.jsx` for
the pattern. A render error fails the build with the offending route in the message.

**Checking the output:** `npm run preview:prerendered` serves `dist/` the way Vercel
does (file, then `<dir>/index.html`, then `spa.html`). `vite preview` cannot show the
pre-rendered pages: its SPA fallback answers `/join` with the home page. In production,
`curl -s https://ausss-ainshams.org/join | grep '<title>'` must print "Join us · AUSSS"
and `curl -s https://ausss-ainshams.org/portal | grep '<title>'` the base title.

**robots.txt** (`public/robots.txt`) names every search and AI crawler explicitly and
allows all of them; it disallows the portal, the admin/checkout surfaces and
`/spa.html`. It is one group: every `User-agent` line shares the rules that follow, with
no blank line in between. A crawler obeys only the group that names it most specifically,
so a rule placed under one name binds that crawler alone (until 2026-10-04 the
`Disallow` lines sat under the last name, `CCBot`, and applied to nobody else). **llms.txt** follows https://llmstxt.org: a description of the society and
the annotated page list, for AI assistants that look for it.

**Search Console** (property `ausss-ainshams.org`, owner aussswebsite@gmail.com,
verified through the meta tag in `index.html`, keep that tag): after a deploy that adds
pages, open Sitemaps, resubmit `https://ausss-ainshams.org/sitemap.xml`, and use URL
Inspection > Request indexing on the pages that matter. **Bing Webmaster Tools**
(feeds Bing, Copilot, ChatGPT search and DuckDuckGo): sign in with the same Google
account and import the site from Search Console; it takes the sitemap from there.

**IndexNow** tells Bing which pages changed after every production deploy, with nobody
doing anything. The build hashes each pre-rendered page (title, description and body),
compares the hashes with the ones the live site published at its own build
(`/page-hashes.json`) and writes the difference to `/indexnow-urls.json`. When Vercel
reports the deploy as successful, `.github/workflows/after-deploy.yml` runs
`scripts/indexnow.mjs`, which submits that list. The key is the file
`public/28ef8fbf5f626f384f1d1a3a23725e6d.txt`; it is not a secret (IndexNow checks that
the site serves it). To rotate it, rename the file, put the new key inside and change
`KEY` in the script. To resubmit everything: Actions > after-deploy > Run workflow with
"all" ticked. Content edited in the portal (albums, editions, stories) reaches the pages
only at the next build, so it is reported then.

**Search rank baseline, 2026-10-04** (position of the first `ausss-ainshams.org` result
on the first page; "none" = not on it). Repeat monthly from a signed-out window; the
pages that answer the last three queries arrive with the incomings page in phase 6.

| Query | Google | Bing | DuckDuckGo |
| --- | --- | --- | --- |
| AUSSS | 2 (after the Facebook page) | 1 | none |
| IFMSA Ain Shams | 2 | none | none |
| Ain Shams medical students | none | none | none |
| Ain Shams medicine exchange | none | none | none |
| study medicine at Ain Shams | none | none | none |

Bing already lists the home page without Webmaster Tools; `site:ausss-ainshams.org` there
returned nothing else, so the inner pages are what the sitemap submission and IndexNow are
for. Google lists the IFMSA page as `/IFMSA` (capital letters), an address that is served
by the app shell with the home page's canonical link: worth a redirect to `/ifmsa` when
the routing is next touched.

## 16. Gallery editor (Phase 5)

Since 2026-09-24 the public gallery (`/gallery`, `/gallery/<slug>`) is read from the
database and edited in the portal at `/portal/gallery` by the PNSD officers and the EB
(`app.is_gallery_editor()` = `app.is_officer_of('pnsd')`, which includes the EB). The
static pipeline (`_source/build-gallery.mjs`, `src/data/gallery.js`, `public/assets/gallery`)
and the admin-key takedown page (`/gallery/admin`, `apps-script/gallery.gs`) are retired.
Migration `20260924120001_gallery`, tests `160-gallery.sql` and the gallery block of
`090-grants.sql`.

**Data.** `albums` (slug, title, blurb, cover_photo_id, sort_order, published),
`gallery_photos` (album_id, path, width, height, sort_order, label, featured, hidden,
deleted_at), `album_slugs` (every slug an album has ever had). Files live in the public
Storage bucket `gallery` as `<album id>/<photo id>-thumb.jpg` (600 px) and `-full.jpg`
(1600 px); the row's `path` is the prefix. Both files are made in the officer's browser
(canvas, EXIF orientation applied) before upload, so a full-size phone photo is fine and
no build step exists. Storage image transforms (Pro plan) are not used.

**Rules the database enforces.** The slug comes from the title when left blank, is
normalised (`app.slugify`), and can never be one another album has used; a rename keeps
the old slug in `album_slugs`, and the public page redirects it (`aliases` in the
snapshot). One featured photo per album (the wide banner above the grid). Editors write
content columns only (column grants): ids, paths, authorship and timestamps are set by
triggers. Nobody but editors can read the tables; visitors read `rpc/gallery_public()`,
one JSON document with the published albums that have at least one visible photo.

**The order of the albums.** On `/portal/gallery` each album has a handle at its left
edge (six dots). Drag it up or down with a mouse or a finger and let go: the others make
room, the new order shows at once and is saved (`albums.sort_order`, every row written
together), and the public gallery follows on its next load. Held near the top or bottom
of the window, a dragged album scrolls the page, so a long shelf can be crossed. Without a
pointer, focus the handle and press the up or down arrow key to move the album one place.
If the save fails the albums go back to where they were and the error shows above the
list. A dropped album glides into its place (not under reduced motion), and Escape
during a drag puts it back and saves nothing. The list is `src/portal/SortableList.jsx`,
written to be reused wherever a list is put in order by hand: the magazine shelf, the
merch products and payment methods and the exam's questions use it too.

**Hide, remove, bin.** *Hide* keeps the photo in the album but off the site (the old
takedown list). *Remove* sets `deleted_at`: the photo shows in the album's bin with
Restore and Delete for good; anything older than 30 days is purged (files then row) the
next time an editor opens that album (`purgeExpired` in `src/portal/galleryQueries.js`),
so no scheduled job is involved. Deleting an album removes its files first, then the
rows.

**Public site.** `src/lib/gallery.js` fetches the snapshot and caches it in localStorage
for an instant repeat paint. The prerender (`scripts/prerender.mjs`) fetches the same
snapshot at build time, so every album page and its share card are pre-rendered with the
live photos; without the Supabase env vars it warns and builds no album pages. A new album
is therefore listed in the sitemap and gets its own preview card at the next deploy; the
page itself is live immediately.

**The eight pre-portal albums were imported on 2026-09-24** (258 photos, 58 MB) from the
webmaster's signed-in portal session (the same uploads and inserts the editor makes); the
static data file, the assets and `_source/build-gallery.mjs` are gone. Storage egress on the
free plan is 5 GB/month and the gallery is its largest consumer (about 2 to 3 MB per album
view, cached for a year in the browser), so watch Settings, Usage in the Supabase dashboard
for the first months; the remedies are a Vercel rewrite in front of the bucket or the Pro
plan.

**Checks.** Signed in as an editor: `/portal/gallery` lists the albums; drop a photo on
an album page, it appears in the grid within seconds and on `/gallery/<slug>` on reload.
Anonymous: `curl -s -X POST -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
$URL/rest/v1/rpc/gallery_public` returns `{"albums":[...]}`, and
`$URL/rest/v1/albums` returns a permission error.

## 17. Magazine editor (Phase 5)

Since 2026-09-24 the magazine shelf (`/magazine`) is read from the database and edited in the
portal at `/portal/magazine` by the CBSD officers and the EB (`app.is_magazine_editor()` =
`app.is_officer_of('cbsd')`). `src/data/magazine.js` and the `_source/build-magazine.mjs`
rasterising step are retired. Migration `20260924150001_magazine` (it also seeded the seven
pre-portal editions), tests `170-magazine.sql` and the magazine block of `090-grants.sql`.

**Data.** `magazine_issues`: slug (the permanent id, `vol-7`, also the key of the reads and
likes counters in `apps-script/magazine.gs`), title, switcher_label, date_label, blurb, status
(`draft` not shown, `published`, `missing` = a known back-issue with a placeholder), sort_order
(the switcher order, newest first), pages_base, page_count, hero_page, download_url, canva_url.
Page images are `<pages_base>/NNN.jpg`: the pre-portal editions keep theirs under
`/assets/magazine/<id>/pages` (served by Vercel, 61 MB in the repo); editions uploaded from the
portal put them in the public Storage bucket `magazine`, each upload in a folder of its own,
`<issue id>/pages-<the time it began>/` (an edition uploaded before this was built has its pages
in `<issue id>/pages/`). A published edition reaches the site once it has pages or a Canva link.

**Uploading an edition.** The editor picks the PDF; pdf.js (loaded on demand in the portal
only) renders every page to a 1300 px wide JPEG in the browser and uploads it. Page images can
also be picked directly. The pages go into a new folder, and the edition is pointed at it
(`pages_base`, `page_count`) only when the last page is in. So replacing an edition's pages
never touches the pages on the site until it has finished: an upload that fails, or that the
editor ends with **Stop**, removes its new folder and leaves the edition as it was, and the
message says so. While pages go up the page shows a progress bar and a count, the browser asks
before the tab is closed or reloaded, and "All editions" and Delete are switched off.

The folder an edition has left is kept for seven days (`KEEP_DAYS` in
`src/portal/magazineQueries.js`), because the saved `/magazine` page, its link preview and a
reader half-way through an edition still name it until the site is rebuilt. It is removed the
next time an editor opens that edition (`sweepPages`), so no scheduled job is involved, and an
edition nobody opens again keeps its old copy (7 to 18 MB). The seven days are counted on the
editors' own clocks. Deleting an edition removes all its folders. One case cannot be settled by
the page: if the answer to the last step is lost and the edition cannot be read back either, it
says "The new pages were uploaded, but we couldn’t see whether the edition switched to them."
Reload to find out; the new folder is kept meanwhile.

The **hero page** (the cover in the header, the switcher and the share card) is chosen by
clicking a page; the database clamps it to the page count. The cover and the **status** take
effect at once, without Save; the rest of the edition's form waits for Save and says "Unsaved
changes" until then. The shelf is put in order by dragging an edition by its handle, as the
gallery's albums are (section 16).

**Public site.** `src/lib/magazine.js` fetches `rpc/magazine_public()` and caches it; the
prerender bakes the shelf into `/magazine` and uses the latest edition's hero page as its
Open Graph image. Egress: a full read of an edition is 7 to 18 MB; editions uploaded from the
portal count against Supabase's 5 GB/month (section 16), the pre-portal ones against Vercel.

**Reads, likes, downloads and reading depth** (migration `20260924170001_magazine_engagement`,
test `180-magazine-engagement.sql`): the counters left `apps-script/magazine.gs` on 2026-09-24
(its totals were seeded into `magazine_stats`, the old issue-1/issue-2 rows folded into
vol-6/vol-7). Every visit to an edition is a reading session: the browser makes a random id,
calls `rpc/magazine_track` with `view` (counts the read), then `page` as the flipbook advances
(the furthest page reached, sent after a short pause and again when the tab is hidden or
closed), `like` and `download` once per session. No IP, user agent or account is stored. New
sessions are capped at 60 a minute. The editor's page shows `rpc/magazine_insights`: totals,
the share who read to the end, the median page and a bar per page (Readers panel). The
on-page counter stays hidden until the EB switches it on (the site setting
`magazineCountersVisible`, "Show reads and likes on the magazine" on Site settings; section 27).

**Checks.** Signed in as an editor: `/portal/magazine` lists the editions; upload a small PDF to
a draft, its pages appear and a click on one makes it the cover; set it to Published and it
shows on `/magazine`. Anonymous: `rpc/magazine_public` answers, `/rest/v1/magazine_issues` is
refused. The upload into a new folder and the sweep of old ones were tried against a stand-in
for the bucket only: after the first deploy that carries them, replace the pages of a draft once
for real, and open that edition again more than a week later to see the old folder go (the sweep
relies on how Storage lists folders and on removal under the bucket's policies).

## 18. Submissions: merch orders, exchange stories, the waitlist (Phase 5)

Since 2026-09-25 the last three public forms write to the database instead of Google Apps
Script: the recruitment waitlist on `/join` (`signups`), the exchange story form on
`/exchange/share` (`stories`) and the merch checkout on `/merch/checkout` (`orders`). They are
handled in the portal at `/portal/submissions`: the EB sees all three tabs, the SCOPE and SCORE
officers see Stories (`app.can_triage(kind)`). The open tab is in the address
(`?tab=stories`, `?tab=signups`; a person's first tab is the plain address), which is where
the links in a notification point. `orders.gs`, `signups.gs` and `stories.gs` are
retired; the old Sheets keep their rows as an archive. Migration `20260925090001_submissions`,
tests `190-submissions.sql` and the last block of `090-grants.sql`.

**How a submission arrives.** The site calls one anon RPC per form (`submit_signup`,
`submit_story`, `submit_order`), each with the validation, quiet dedupe and per-minute cap the
script had, plus a honeypot field bots fill in. A refusal (errcode 22023) carries the message
the form shows. Nobody inserts into the tables directly. The story and order references
(`STORY-…`, `AUSSS-…`) are made by the browser and kept by the database, so the success
screen and the row match.

**Orders.** `submit_order` prices every line from `merch_products`, the same rows the shop
shows (section 26). A product that is unknown or hidden is dropped, and a total that differs
from the one the browser sent is written into `price_flag` on the order instead of refusing
it. While the setting `merchOrdersOpen` is off, every order is refused. The buyer's payment screenshot is shrunk in the browser
(1600 px JPEG) and uploaded to the private bucket `receipts` as `<order id>.jpg`; the bucket
policy accepts one file per order placed in the last 30 minutes (`app.receipt_upload_ok`),
then `order_receipt_attached` records it. The portal opens receipts through ten-minute signed
URLs. An order whose upload failed shows "No receipt uploaded" and the buyer was told to send
it. Deleting an order (EB) removes its receipt too.

**Who hears about it.** A new order or story writes a notification for everyone who triages it
(EB, webmaster; the exchange officers for stories), so it appears in the feed and in the daily
email digest (section 13). Sign-ups do not notify (they arrive in bulk); the dashboard panel
and the Waitlist tab show the count.

**Stories on the site.** A story is private until an exchange officer or the EB publishes it;
it then appears under "Exchange stories" on `/exchange/outgoings` and
`/exchange/incomings` (read through `rpc/stories_public()`, published rows and public fields
only, baked into the pre-rendered pages and refreshed live). A story is published from the
"On the exchange page" box on its card, never from the status list ("Published" is not in the
list of a story that is not on the site): **Review and publish** opens the name and the text
the site will show, filled in from what the student sent, with the *Featured* tick, which pins
the story first with a highlight; **Publish on the exchange page** is the last step. The
officer can tidy the name and the text (left as sent = as submitted; the submission itself is
never edited). On a published story the three wait for **Save what the site shows**. Declining
a published story or moving it back to `contacted` in its status list takes it off the site at
once, with an Undo line (the pre-rendered copy updates on the next deploy).

**Triage.** Each row has a status (`orders`: new, contacted, delivered, also set from the Merch page, section 26; `stories`:
new, contacted, published, declined; `signups`: new, contacted, archived) and private notes
(`officer_notes` on orders). Filter chips, a search box and *Export CSV* (the filtered rows,
UTF-8 with BOM, opens in Excel) are on every tab. Only the EB deletes. A status change shows at
once and is saved behind; if the save is refused the status goes back and a sentence says so.
The row then stays where it is, whatever filter is on, with a line such as "Moved to Contacted.
Undo", and leaves the list the next time a filter chip is chosen (the one that is on included).
The Orders panel on the Merch page does the same. Notes say "Unsaved changes" until saved, and
the browser asks before the tab is closed on them.

**Exports.** Every list of collected data in the portal has *Export PDF* and *Export CSV*
buttons (`src/portal/ExportButtons.jsx`, `exportFile.js`): the three Submissions tabs, a call's
applications (Committees > Open calls), the membership roster (EB), a committee's Members tab,
the verification queue, and an edition's Readers panel. They export the rows the filters and
the search pick out. That is what is on screen, with two exceptions: a submission kept in
sight after its status changed is left out once it no longer belongs under the filter, and the
verification queue's file holds only the requests still waiting. The PDF is made in the browser (jsPDF, loaded on demand) with IBM Plex Sans
Arabic embedded (`src/portal/fonts`, OFL, about 480 KB fetched once per session), so names and
text typed in Arabic come out joined and complete. jsPDF shapes Arabic through the Unicode
presentation forms, so any replacement font must carry those glyphs (Plex and Amiri do; Tajawal
and Cairo do not and lose letters).

**Checks.** Anonymous: `rpc/submit_signup` with a valid email answers `{ok: true}`;
`/rest/v1/orders` is refused. Signed in as the webmaster: `/portal/submissions` lists the
three tabs; a test order placed on localhost shows its receipt through *View receipt*; delete
the test rows afterwards (the order's receipt disappears from the bucket with it).

## 19. Role addresses on the domain (email forwarding)

Every role has an address on `ausss-ainshams.org` that forwards to the role's Gmail inbox.
Nothing is stored on the domain: no mailboxes and no passwords, only forwarding rules. It
is the free forwarding that comes with the Squarespace domain (up to 100 rules, one
destination per rule).

| Address | Forwards to |
| --- | --- |
| `president@` | `the.president.ausss@gmail.com` |
| `vpi@` | `vpi.ausss@gmail.com` |
| `vpe@` | `vpe.ausss@gmail.com` |
| `secgen@` | `ausss.secgen@gmail.com` |
| `leo-out@` | `leolore.out.ausss@gmail.com` |
| `leo-in@` | `leolore.in.ausss@gmail.com` |
| `lore@` | `loreausss@gmail.com` |
| `lome@` | `ausss.lome@gmail.com` |
| `lorp@` | `lorpausss@gmail.com` |
| `lpo@` | `lpoausss@gmail.com` |
| `lora@` | `loraausss@gmail.com` |
| `psdd@` | `psddausss@gmail.com` |
| `pnsdd@` | `aussspnsdd@gmail.com` |
| `cbsdd@` | `aussscbsdd@gmail.com` |
| `rsdd@` | `rsddausss@gmail.com` |
| `portal@` | `aussswebsite@gmail.com` (so a reply to a sign-in link or the digest lands somewhere) |

**Where the rules live.** Squarespace > Domains > `ausss-ainshams.org` > Email > Email
forwarding > Add rule ("Forward from" = the alias, "Forward to" = the inbox). Squarespace
emails a verification link to each destination; a rule forwards nothing until its inbox
owner clicks it, and Squarespace allows up to 48 hours after that. It adds its own MX and
TXT records to the DNS when the first rule is created.

**Keep the Resend records.** Sign-in links and the digest leave through Resend, which
depends on the `resend._domainkey` TXT record and the `send` records. After creating the
first rule, check both still answer and that a sign-in link still arrives:

```sh
nslookup -type=MX ausss-ainshams.org 8.8.8.8
nslookup -type=TXT resend._domainkey.ausss-ainshams.org 8.8.8.8
```

**The site.** `src/data/society.js` gives each role an `email` (the Gmail inbox) and an
`alias`; `publicEmail()` in `src/data/emailConfig.js` picks which one a page shows,
following the site setting `domainEmailsLive` ("Show the @ausss-ainshams.org addresses" on
the portal's Site settings, section 27). It stays off until forwarding is proven. To go live:

1. The MX lookup above answers, and every rule shows as verified in Squarespace.
2. Send a message to each address from an account outside the society and confirm it
   arrives in the right inbox.
3. Switch it on in Site settings. Turning it on takes a second click: the first rings the
   switch in red and says "Click the switch again to turn this on. Mail bounces unless
   forwarding is set up." Visitors see the new addresses on their next page load;
   the saved pages follow at the next rebuild, which the change asks for by itself. The
   privacy policy gains its line about forwarding on its own; bump `LAST_UPDATED` in
   `src/pages/PrivacyPage.jsx` with the next code change.

A role whose inbox owner has not verified yet can be held back by removing its `alias`
in `society.js`; it keeps showing the Gmail inbox.

**Limits.** Forwarding is receive-only: a reply leaves from the Gmail address. Portal
sign-in and invites keep using the Gmail inbox (`email`), never the alias, because the
generator (section 3) reads `email` and a sign-in from the alias would create a second
profile.

**At rollover.** The alias stays with the role. If the new holder uses a different inbox,
change the rule's destination in Squarespace (the new inbox verifies again) and the
`email` in `society.js`.

## 20. Backups, the restore rehearsal and failure alerts (Phase 5a)

The free Supabase plan keeps no backups we can reach, so the repository makes its own
every night. Three workflows do the work:

| Workflow | When | What it does |
| --- | --- | --- |
| `backup.yml` | 01:40 UTC every night, or by hand | Dumps the database, mirrors every Storage bucket, encrypts both and stores them for 90 days |
| `backup-restore-test.yml` | Every Sunday 03:10 UTC, or by hand | Decrypts the latest backup and loads it into an empty database on the runner |
| `notify.yml` | Called by the others | Emails the society inbox when a job fails |

**What a backup holds.** `ausss-db-<date>.tar.gz.gpg` has five SQL files: `roles.sql`,
`schema.sql`, `data.sql` (every table's rows, including the accounts in `auth` and the
object records in `storage`), and the migration history (`history_schema.sql`,
`history_data.sql`). `ausss-storage-<date>.tar.gz.gpg` has every file of every bucket as
`storage/<bucket>/<path>` plus `storage/manifest.json` (size, type and version of each
file). Not in a backup, because they live outside the dump: the Vault secrets
(`roster_cron_secret`, `digest_cron_secret`, and `site_deploy_hook` of section 23), the
scheduled jobs (`roster-sheet-sync`, `roster-years-spent`, `email-digest`, and since
Phase 5b `site-rebuild`, `site-rebuild-nightly`, `cron-history-trim`), the Edge Function
and its secrets, and the Auth settings in the dashboard. The migrations recreate the jobs
and the two generated secrets; the deploy hook is saved again by hand (section 23);
section 5 and section 13 cover the rest.

**Where it goes.** The repository is public, so both archives are encrypted on the runner
(AES-256, `gpg --symmetric`) with the repo secret `BACKUP_PASSPHRASE` before anything is
uploaded. They are stored as artifacts of the workflow run (Actions > backup > a run >
Artifacts), kept 90 days. If the repo secret `RCLONE_CONF` exists, the same files are also
copied to the folder "AUSSS backups" in the society Google Drive and removed there after 90
days. **Without the passphrase a backup is unreadable. It is in the society vault; never
change the secret without storing the new value there first, and keep the old value for
90 days, since older backups still need it.**

**Secrets the backup needs** (HANDOVER section 5): `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`BACKUP_PASSPHRASE`; optional `RCLONE_CONF` and `RESEND_API_KEY` (for the alert email). A
missing secret fails the run on purpose: a backup that quietly does nothing is worse than
none.

**Storage egress.** The mirror is cached between runs (`scripts/backup/storage.mjs`
compares each file's version tag), so a normal night downloads only new or changed files.
A full download is about the size of the buckets (56 MB on 2026-10-04) and happens only
when the cache has expired.

**The rehearsal.** It runs by itself every Sunday and emails if it fails; start it by hand
(Actions > backup-restore-test > Run workflow) after any change to `backup.yml`. It
downloads the latest successful backup, decrypts it, starts the local Supabase stack with
no migrations (as empty as a new project) at the hosted project's own Postgres, Auth and
Storage versions, and restores the three SQL files with the command of step 3 below,
nothing edited. Then it checks that accounts, profiles, the roster and the buckets came
back, that every public table still has row-level security, and that the storage archive
holds every file its manifest lists. A green run is the proof that the backups are
usable. First green run: 2026-10-04, every count equal to production.

**When the rehearsal fails.** Run it again with "List every restore error" ticked: it
prints the role file and every error of a tolerant pass, instead of stopping at the first.
Fix the cause where the backup is made (`backup.yml`), never by editing files at restore
time, because a real restore happens on a bad day with nobody to remember the edits. The
three causes found on the first day, for reference:

- *Tables postgres cannot write.* The data dump must leave out
  `storage.buckets_vectors` and `storage.vector_indexes`, as Supabase's backup guide does
  (`-x`): the project's role may read them but not write them. If Supabase adds another
  such table, the rehearsal fails with "permission denied for table"; add it to the `-x`
  list after checking the guide.
- *A scratch database older than the backup.* Without the link step the local Auth and
  Storage are the versions the CLI release shipped with, and miss tables and columns the
  backup holds ("relation does not exist"). The link step makes them match.
- *Statements about the platform's own roles in `roles.sql`.* Only Supabase's superuser
  may run them, on any project, and the CLI (2.117.0 to 2.119.0) lets two kinds through.
  `backup.yml` removes them when the file is made and fails if anything else names a
  platform role. When a newer CLI stops emitting them, that step can go.

**A real restore, into a new Supabase project.** This is for the day the project is lost
or its data is damaged beyond a manual fix.

1. Create a new project (same region). Note its ref, database password and keys.
2. Download the two artifacts of the backup you want and decrypt each one:

   ```sh
   gpg --decrypt ausss-db-2026-10-05.tar.gz.gpg | tar -xz
   gpg --decrypt ausss-storage-2026-10-05.tar.gz.gpg | tar -xz
   ```

3. Restore the database with `psql` (any machine that has it; the connection string is
   under Connect in the dashboard, session pooler):

   ```sh
   psql "$NEW_DB_URL" --single-transaction --variable ON_ERROR_STOP=1 \
     --file db/roles.sql --file db/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file db/data.sql
   psql "$NEW_DB_URL" --file db/history_schema.sql --file db/history_data.sql
   ```

4. Recreate what the dump does not carry: run the `vault.create_secret` and
   `cron.schedule` statements from migrations `20260919210001`, `20260920110001` and
   `20260920210001` in the SQL editor; deploy the `email-digest` function and set its
   secrets (section 13); set the Auth providers, SMTP and redirect URLs (section 5).
5. Upload the files: for each bucket folder under `storage/`, upload its contents to the
   bucket of the same name (the dashboard's Storage page takes a folder drag, or use
   `supabase storage cp -r`). The object rows restored in step 3 are replaced by the
   uploads, so clear `storage.objects` first if the dashboard reports duplicates.
6. Point the site at the new project: the two `VITE_SUPABASE_*` variables in Vercel, the
   repo secrets of HANDOVER section 5, the project host in the Content-Security-Policy of
   `vercel.json` (twice in `connect-src`), then redeploy.
7. Sign in to the portal, open the roster, a committee page and the gallery.

**Alerts.** `notify.yml` sends one email through Resend to the repo variable `ALERT_EMAIL`
(default `aussswebsite@gmail.com`) when the backup fails, when the keep-alive ping fails,
and when a production deploy fails (`after-deploy.yml` listens to the deployment status
Vercel posts to GitHub). It needs the repo secret `RESEND_API_KEY` (a sending-only key is
enough); without it the failed run only shows in the Actions tab. Vercel also emails its
own account owner about failed deployments.

## 21. The page walk (Phase 5a)

`scripts/page-walk.mjs` opens every public page and every portal page at a list of widths
and in both themes, saves a full-page screenshot of each and records what the browser
console and its Issues list print. It is the tool for the console sweep, the design pass,
a smoke test after a deploy and the website guide's screenshots.

```sh
npx playwright install chromium        # once per machine
npm run walk                           # everything, against npm run dev (localhost:5173)
npm run walk -- --public-only --base https://ausss-ainshams.org
npm run walk -- --widths 320,1280 --themes dark --only /gallery
npm run walk -- --no-shots --strict    # console only; exit 1 on a message of our own
npm run walk -- --contrast --no-shots  # text contrast (WCAG AA) on every page
```

- **Widths and themes.** Without `--widths` it walks 320, 375, 768, 1024, 1440 and 1920 px,
  each in dark and in light. One width in one theme takes about two minutes for the public
  pages, so the full set is about twenty-five; split it over two or three terminals with
  `--themes` and `--widths` when in a hurry.
- **What it measures on every visit.** Whether the page scrolls sideways, and which
  elements stick out of the viewport (the innermost one is the one to fix). With
  `--contrast` it also runs axe-core's colour-contrast rule and lists every text below
  WCAG AA with the two colours and the ratio; text over a photo or a gradient cannot be
  measured and is not listed. Both are in `report.json` (`overflow`, `contrast`) and in the
  summary the command prints. The walk runs with reduced motion, so anything that only
  moves (the aurora behind the gallery and the magazine) has to be looked at in a browser.
- **The portal without a sign-in.** `npm run walk:portal-sample`
  (`scripts/portal-sample-walk.mjs`) opens every portal page as a made-up webmaster with
  sample rows, at the same widths and themes, and measures the same two things. It answers
  every database call itself, apart from anonymous reads of two public tables (the
  committees and the site settings), so it cannot write anything and every person in its
  lists is made up. What those two tables hold is real, each committee's own page
  included. It is the quick check for a design change on the portal; long names and titles
  are in the sample on purpose. Arguments are themes, widths and an optional path:
  `npm run walk:portal-sample -- light 320,375 /portal/tasks`. When a portal page gains a
  query, give it a sample row in the script. Since Phase 8 it also walks the exchange exam's
  pages for students (`/exam/…`, with nobody signed in to the portal), and it can tap a button
  on a route before it measures; section 30 lists those screens.
- **What the sample walk covers.** Since the design pass of October 2026 it opens 100
  screens (`ROUTES` in the script): 73 in the portal, 17 of the exam as a student meets it
  and 10 public pages that show the same sample. Besides each portal page as it first
  opens, it covers the roster's panels (the upgrades, Register a GA with the bulk updates
  under it, position types, the Executive Board, a member's row opened), the verification
  queue with requests waiting, the committee editor tab by tab (events, calls, a call's
  form and its applications, members with one opened, invites), the new and edit forms of
  tasks and updates, Submissions with rows in every tab, an album, a magazine edition and
  the notifications panel. A screen that only shows after a tap is a route ending in
  `#name` with an entry in `acts`.
- **Writing a sample row.** A sample row names its committee by `c-<slug>` (`c-scope`).
  The committees are the real ones, and the script hands each to the page under that id,
  since a sample row cannot know the real one. A read that narrows its rows
  (`status=eq.new`, `album_id=eq.al-1`) gets only the rows that fit (`narrowed()` in the
  script), so a new sample row must carry the column it is asked by. Only the filters the
  portal uses are known (`eq`, `neq`, `lt`, `in`, `is.null`, `not.is.null`). Any other
  filter narrows nothing, and neither does a column that no row of the table carries.
- **Pages.** The public list is the sitemap (the base's own, else the one in `dist/`, else
  production's) plus the checkout, the quiz and the sign-in page. The portal list is in the
  script (`PORTAL_FIXED`, `PORTAL_DETAIL`); add a route there when the portal gains one.
- **Portal pages need a session.** `npm run walk -- --login` opens a browser window on the
  sign-in page; sign in there (if Google refuses the automated browser, ask for the email
  link and paste it into that window). The session is saved to `.page-walk/auth.json`.
  That file is a live sign-in: it is gitignored, treat it like a password and delete it
  when the walk is done. Without it the walk covers the public pages and says so.
- **It never writes to the database.** The dev server talks to production data, so the
  script answers every Supabase call that is not a read (a magazine view being counted, a
  notification marked read) itself and lists what it held back. A new read-only RPC must be
  added to `READ_RPCS` or its page shows empty in the walk.
- **Output.** `.page-walk/<run>/<theme>-<width>/<page>.png` and `report.json`. The summary
  sorts each message as ours, an embed's or the browser's; `--strict` fails on ours.
- **In a Git Bash shell on Windows** a value that starts with a slash is rewritten into a
  file path; prefix the command with `MSYS_NO_PATHCONV=1` when using `--only /something`.
- **Checking a header change before it is deployed:** `npm run build`, then
  `npm run preview:prerendered` (it sends the headers of `vercel.json`), then
  `npm run walk -- --base http://localhost:4174 --public-only`.

**Console state on 2026-10-04.** Public pages, both themes, 390 and 1280 px, with the
headers of `vercel.json`: no errors, no warnings and no policy violations of our own. What
remains belongs to others and stays:

| Message | Whose | Why it stays |
| --- | --- | --- |
| `LazyLoadImageIssue` in the Issues list | The browser | A note that images below the fold load lazily, which is intended |
| Third-party cookie notices and errors that name `google.com` or `canva.com` | Google Maps (the map in every page's footer), Canva | Printed by the embed inside its own frame, which our code cannot reach. Loading the map only on request would remove them; that was tried on 2026-10-04 and the webmaster chose to keep the map always visible |

The portal was checked the same day in a signed-in browser against the built site served
with the same headers (`PORT=5173 npm run preview:prerendered`, the port the sign-in
redirect allows): all 18 portal pages rendered with no policy violation, no error and no
broken image, and the pdf.js worker started. Uploads, exports and the receipt viewer were
not exercised. The scripted walk of the portal (screenshots at every width) still needs
the one-time `--login`; Google refuses that automated window, so use the email link.

Since 2026-10-07 both walks also report anything cut off at the screen's edge inside a fixed
bar, such as the header or the cart pill (`scripts/walk-checks.mjs`). The sideways-scroll measure
cannot see this, because content that runs out of a fixed bar never makes the page scroll. That
is how the Members button went missing at 1024 px when Events joined the header. A finding names
the element and where it runs to, for example `"Members" (948 to 1053)` on a 1024 px screen.
The walk has no width between 1440 and 1920 px. The design pass of October 2026 reported the
same button cut off at 1536 px, which no walk had seen; the header was then measured at every
width and retuned (section 28), and the button now reads "Check membership". After a change to
the header, walk it with `--widths 1280,1536,1600,1920` as well.

## 22. Security checklist (Phase 5a)

Repeat this once a term and before the member rollout. Each line says how to check it; a
ticked line passed on 2026-10-04 and again on 2026-10-05, when the list was re-run over what
Phase 5b added (the gate of Phase 5d). The one line that failed that day is marked.

**Response headers** (`vercel.json`; check with `curl -sI https://ausss-ainshams.org/`).

- [x] `Content-Security-Policy` allows scripts only from the site itself (no
      `'unsafe-inline'`; the theme bootstrap is the file `public/theme-init.js` for that
      reason, and JSON-LD blocks are data, not scripts), connections only to the site and
      the Supabase project, frames only from the site, Google Maps and Canva, forms only to
      the site, and no plugins. Inline styles stay allowed: React writes them. A new embed
      or API host must be added here or the browser blocks it; the page walk shows that as
      a message of our own.
- [x] `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
      `X-Frame-Options: SAMEORIGIN` (with `frame-ancestors 'self'`),
      `Referrer-Policy: strict-origin-when-cross-origin`,
      `Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy` that turns off
      camera, microphone, location, payment and USB.
- [x] `/.well-known/security.txt` exists and its `Expires` date is in the future (the
      build stamps it a year ahead; it only goes stale if nothing is deployed for a year).

**Cross-site scripting.**

- [x] No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in `src/`
      (`grep -rn "dangerouslySetInnerHTML\|innerHTML\|eval(" src`). Everything a visitor or
      officer types (stories, applications, task and post bodies, committee pages, album
      and edition text) is rendered by React as text.
- [x] Links made from typed text accept only `http(s)` (`RichText` in
      `src/portal/workUi.jsx`); the magazine's download and Canva links are held to
      `https://` by a table constraint; committee photos are refused as `data:` URIs and
      are only ever used as image sources.

**The anonymous API.**

- [x] Visitors can write only through the `submit_*` functions, `magazine_track` and
      `order_receipt_attached`; each validates its input, carries a honeypot or a cap, and
      is covered by the pgTAP files 080, 180 and 190. `anon` holds `SELECT` on six
      reference tables and views and no write privilege on any table.
- [x] Every table in `public` and `app` has row-level security on, and every
      `SECURITY DEFINER` function pins its `search_path`
      (`supabase/tests/200-security-baseline.sql` fails CI otherwise).
- [x] Storage: `gallery`, `magazine` and `committee-media` are public to read and writable
      only by their editors; `receipts` is private, takes one upload per fresh order and is
      readable by the EB alone. `task-files` is private (10 MB a file, documents and images;
      read and written through the task's own access rules) and `avatars` is public to read
      (1 MB, images; each person writes only their own folder). `content-media` (Phase 6)
      is public to read and writable only by the editors of the block a file belongs to.
      Size and file-type limits
      are set on every bucket (`select id, public, file_size_limit, allowed_mime_types from
      storage.buckets`).
- [x] Supabase security advisors (dashboard > Advisors, or the MCP `get_advisors`): no
      errors. The warnings are expected: the public RPCs are `SECURITY DEFINER` by design
      (each checks its caller itself), six tables have row-level security and no policy on
      purpose (only functions reach them; `app.site_rebuild` joined them in Phase 5b), and
      leaked-password protection does not apply
      (sign-in is Google or an email link, never a password).

**Accounts and settings** (dashboards; not checkable from the repository).

- [ ] Supabase > Authentication > URL configuration: the site URL is
      `https://ausss-ainshams.org` and the redirect list holds only that domain and
      `http://localhost:5173`. **Failed on 2026-10-05:** the site URL is right, but the
      list holds ten addresses, and four of them are wildcards over `vercel.app`
      (`https://*-ausss-website.vercel.app/portal/callback` and the three
      `ausss-ainshams-ausss-website` / `ausss-*-ainshams-ausss-website` lines). Anyone can
      create a Vercel project whose address fits such a pattern (a project named
      `x-ausss-website` gets `x-ausss-website.vercel.app`), and sign-in hands the session to
      whatever allowed address a link names, so a crafted sign-in link could deliver a
      member's session to a stranger's page. Delete those four lines and
      `https://ausss-ainshams.vercel.app/portal/callback` (that address only redirects to
      the domain now). Keep `https://ausss-ainshams.org/portal/callback`, the `www` one,
      and the two `localhost` lines (5173 for `npm run dev`, 4173 for `vite preview`). At
      the same visit add the exchange exam's three exact lines,
      `https://ausss-ainshams.org/exam/callback`, `http://localhost:5173/exam/callback` and
      `http://localhost:4173/exam/callback`, because its sign-in returns there and not to the
      portal (section 30). The cost is that sign-in stops working on Vercel preview
      addresses; test the portal on localhost, as now.
- [x] Supabase > Authentication > Providers: only Google and email are on.
- [x] Google Cloud > Google Auth Platform > Audience: publishing status "In production"
      (HANDOVER 2.4). The "100 user cap" shown there applies only to sensitive scopes; the
      portal asks for name and email alone, so it does not limit sign-ins.
- [ ] Two-step verification is on for the GitHub, Vercel, Supabase, Squarespace, Resend and
      Google accounts of HANDOVER section 2 (Squarespace showed its "set up two-factor"
      banner on 2026-10-04).
- [ ] GitHub > Settings > Code security: secret scanning and push protection are on.

**The repository.**

- [x] No secret in the history: a pattern scan of every commit (Supabase secret keys and
      tokens, Resend and Google keys, JWTs, private keys, database URLs with passwords)
      found none, and only the two `.env.example` templates were ever committed.
- [x] `npm audit --omit=dev` reports nothing. What `npm audit` still lists (7 on
      2026-10-04) sits in the build tools (Vite 5, Tailwind 3 and their file-watching
      helpers), never reaches a visitor, and needs major-version upgrades to clear; do
      those as their own piece of work. `xlsx` is installed from SheetJS's own server
      (`cdn.sheetjs.com`) because the fixed versions are not published to npm.
- [x] `public/robots.txt` keeps the portal and the account pages out of search results
      for every crawler. It is a note to crawlers, not a control: the protection is the
      row-level security above.

## 23. Portal and people (Phase 5b)

Built 2026-10-05. Five migrations (`20261005103501_notifications_clear`,
`20261005103539_task_files`, `20261005103632_invites_screen`, `20261005103724_people`,
`20261005130001_directory_and_stale_notifications`),
tests `210-task-files.sql`, `220-invites-screen.sql`, `230-people.sql`, and new lines in
`090-grants.sql` and `130-tasks-and-posts.sql`.

### The header and the bell

The header reads in the order people work (`src/portal/PortalLayout.jsx`): Dashboard,
Tasks, Updates, Directory; then the editing pages a person's positions give them
(Committees, Gallery, Magazine, Submissions); then the board's pages (Roster,
Verification, Site settings); with the bell, the profile link and Sign out at the side.
A page a person cannot use is not listed, and a group with nothing in it is not drawn.

The bell (`src/portal/NotificationBell.jsx`) shows a red dot while anything is unread.
Its panel lists the eight latest notifications, one line each; opening one marks it read
and goes to its task, story or order. "Mark all as read" sets `read_at`; "Clear all"
deletes the person's own rows (policy `notifications_delete`: `profile_id = auth.uid()`),
after a second click. Clearing touches the notifications and nothing else: the task, order
or story a notification was about stays where it is. The other way round, deleting a task
removes the notifications about it (trigger `drop_task_notifications`), so the feed never
points at a task that is gone. A cleared notification that was never emailed drops out of
the next digest. `/portal/notifications` stays as the full list ("See all").

### Tasks: the date, the repeat warning, files

A new task opens with today's date (the Cairo day); editing keeps the task's own. Before a
task is created, the open tasks of that committee are read and compared in the browser
(`findDuplicateTasks` in `src/portal/workQueries.js`): the same title, ignoring case and
spacing, and exactly the same people. A match shows "This task already exists. Create it
again?" with the existing task linked. It never blocks. The check sees what the person can
see, so an assistant who may assign tasks is warned about their own tasks, an officer about
the committee's.

**Files.** Private Storage bucket `task-files`, 10 MB a file, documents, sheets, slides,
PDFs, images, plain text and zip (no HTML, no SVG). The storage key is
`<task id>/<random id>.<ext>`; the name the person gave the file lives in
`public.task_files`. The browser uploads first, then calls `rpc/attach_task_files`, which
checks every path against Storage and writes ONE timeline row for the batch: a comment when
there is text, a `files` row when there is none (the others on the task then get a
`task_files` notification; a comment notifies as a comment). Up to 5 files a batch and 20 a
task. Who can open a file = who can see the task; a download is a signed link made on the
click, valid two minutes. Whoever attached a file removes it, and so does a manager of the
task. Deleting a task removes its objects first (`deleteTask`), because once the task is
gone the storage policy can no longer tell who managed it.

If an upload succeeds and the link fails, the browser takes the uploads back. If a browser
dies in between, an object is left that no row points to: find them with

```sql
select o.name, o.created_at
from storage.objects o
where o.bucket_id = 'task-files'
  and not exists (select 1 from public.task_files f where f.path = o.name);
```

and remove them in the dashboard (Storage > task-files); deleting from `storage.objects`
in SQL is refused by Storage.

### The invites screen

The "Invites" tab of `/portal/committees/<slug>` (`PositionsPanel.jsx`), and the
"Executive Board" button on the Roster page, which is the same panel for the positions
that belong to no committee (the board, the webmaster).

- **Invite by email.** Address plus position (`rpc/invite_to_position`). If an account
  with that address exists the position is on it at once; otherwise it waits for their
  first sign-in. No email is sent: whoever invites tells the person. Officers hand out
  the positions below their own, the board any.
- **Waiting for a first sign-in.** The invites nobody has accepted. Ones made here have
  "Withdraw" (a delete; policy `invites_delete`). The members list's own invites are
  counted and can be shown, but are changed on the Members tab.
- **Holding a position.** Everyone with an active assignment there this term, with
  "Remove" (`rpc/remove_position`: the assignment ends, its invite goes). Nobody removes
  their own position.

One rule runs through it: a position that the membership roster gave
(`roster_entries.position_id`) is changed on the roster. Withdrawing or removing it here is
refused by the database with a message that says so (`app.position_from_roster`). On the
Members tab, a member's extra positions (an accepted invite on top of their roster
position) are listed under "Also holds" with Remove.

**Changing the Executive Board** is therefore: Roster page > Executive Board > invite the
new holder's address to the position, then Remove the old holder. Section 8's SQL still
works and is only needed when nobody on the board can sign in.

### People: one source of truth

A person's name and photo come from their profile, everywhere.

- **The photo.** Profile page > "Your photo". The browser shrinks it to 512 px and puts it
  in the public bucket `avatars` under `<profile id>/`; `profiles.photo_path` is that
  object and `profiles.avatar_url` its address (without a chosen photo, `avatar_url` is the
  picture of the Google account, and only the portal shows that). A person writes only
  inside their own folder, and a check constraint keeps `photo_path` there.
- **The portal** shows `avatar_url` beside names: the header, task comments and assignees,
  update bylines, the assignee picker, the invites screen, the directory.
- **The public site** asks `rpc/people_public()` who holds each officer and board position
  this term (position key, name, chosen photo; nothing else, nobody below officer) and lays
  that over `src/data/society.js` (`src/lib/people.js`): the board on the home page, the
  committee cards, each committee page and the contact page. The file stays the fallback
  for a position nobody has claimed with an account. When the holder is somebody else than
  the file names, the file's photo and candidature are dropped, so a new officer never
  appears under their predecessor's face; until they choose a photo they show as initials.
  The officer photo set in the committee page editor still applies to the lead officer
  unless they chose one on their profile.
- **The directory** (`/portal/directory`, `rpc/directory()`): every member with an
  account (verified, or holding a position this term), with name, photo and this term's
  positions. Read by the same people; no contact details. There is no switch: an account
  nobody has verified is simply not listed. (`profiles.directory_opt_in` remains from the
  first design and is not read.)

Still read from `society.js` alone: the role inboxes and their blurbs (they belong to the
role), and the position cards of the membership lookup (`src/lib/teamIndex.js`).

### Rebuild on publish

The public pages are pre-rendered at build time (section 15) with the gallery, the
magazine shelf, the published stories and the position holders baked in. A visitor's
browser refreshes all of that live; the rebuild is for search engines and link previews.

`app.site_rebuild` (one row) records when a rebuild was last asked for and last fired.
Triggers ask for one when an album, a photo, a magazine edition, a published story, a
committee page, an officer or board assignment, or such a holder's name or photo changes.
The cron job `site-rebuild` runs `app.fire_site_rebuild()` every five minutes: it calls
the deploy hook only when something asked since the last rebuild, the last change is at
least three minutes old, and the last rebuild is at least twenty minutes old.
`site-rebuild-nightly` fires one regardless at 02:30 UTC. `cron-history-trim` keeps a week
of `cron.job_run_details`. The board sees the state on Site settings ("Public pages").

**One-time set-up (the webmaster).** Until this is done the function answers `no hook` and
nothing else changes.

1. Vercel > the `ausss-ainshams` project > Settings > Git > Deploy Hooks: create one named
   `supabase-publish` on branch `main`. Copy its address. Anyone holding it can start a
   deploy, so it goes nowhere but the next step and the vault.
2. Supabase > SQL editor:

   ```sql
   select vault.create_secret('<the address>', 'site_deploy_hook',
     'Vercel deploy hook called by app.fire_site_rebuild()');
   ```

3. Check: `select app.fire_site_rebuild(true);` answers `fired`, and a deployment named
   "Deploy Hook" appears in Vercel within a minute.

To replace the hook: delete it in Vercel, create a new one, then
`select vault.update_secret((select id from vault.secrets where name = 'site_deploy_hook'), '<new address>');`.
To stop rebuilds: delete the hook in Vercel (the function's calls then go nowhere), or
`select cron.unschedule('site-rebuild'); select cron.unschedule('site-rebuild-nightly');`.

Each rebuild is a production deployment: it runs `after-deploy` (IndexNow, section 15)
and counts against the plan's daily deployments, which is what the twenty-minute spacing
is for (at most 72 a day, in practice a handful).

## 24. Themes, colours and sizing (Phase 5c)

The site and the portal have two themes, dark and light. **Light is the default**: the
site is dark only for a visitor who chose dark with the toggle, and that choice is kept in
`localStorage.theme`. The device's own light or dark setting is not followed (the
webmaster's decision, 2026-10-06; before it, a device set to dark opened the site dark).
The colour of a phone browser's bar follows the theme too (`public/theme-init.js`,
`src/lib/theme.js`). The toggle is in the public navbar and in
the portal header.

**Write a page once: use the theme tokens.** `tailwind.config.js` has a second set of
colour names whose values live in `src/index.css`, under `:root` for light and `.dark`
for dark. A class built on a token follows the theme by itself, so new markup needs no
`dark:` pairs.

| Token | For | Dark | Light |
| --- | --- | --- | --- |
| `page` | the page background | forest-950 | cream |
| `sunk` | inputs, alternate bands | forest-900 | a pale green-grey |
| `card` | panels and cards | forest-800 | white |
| `ink` | headings, strong text | white | forest-900 |
| `soft` | body and muted text (`text-soft/70`) | silver | a dark green-grey |
| `line` | borders, dividers, rings (`border-line/10`) | white | forest |
| `veil` | translucent fills (`bg-veil/10`) | white | forest |
| `accent` | blue text and links | medical-light | a deep blue |
| `leaf`, `leaf-hover` | the green button, with `text-white` | forest | forest-500, a fresher green |
| `solid`, `on-solid`, `solid-hover` | the inverse button | white pill, forest text | the green button |
| `cta`, `on-cta`, `cta-hover` | the blue button | medical blue, dark text | a deep blue, white text |
| `danger`, `warn`, `ok` | status text | red, amber, emerald (pale) | the same hues, dark |

- **Muted text always passes WCAG AA.** The opacity steps of `soft` are remapped in
  `index.css` (`--soft-k`, `--soft-c0`, `--soft-c1`), so `text-soft/40` is still at least
  4.5:1 on a page, a band or a card in both themes. Use the steps for hierarchy without
  checking each one. `line` and `veil` have a strength multiplier per theme for the same
  reason: a 10% white line on dark green and a 10% green line on white do not look alike.
- **A blue button is always the three `cta` tokens together:**
  `bg-cta text-on-cta hover:bg-cta-hover`. On dark that is the medical blue with dark
  text; on light a deep blue with white text (6.4:1), because the medical blue looks
  washed out on cream. Never white text on `bg-medical` (3.5:1). A button filled with a
  committee's own colour takes `text-page`, which is dark on the lightened shade and
  light on the darkened one.
- **A green button** is `bg-leaf text-white hover:bg-leaf-hover` when it is green in both
  themes (Back, back to top, Check membership), or the `solid` tokens when it is the white pill on
  dark. On light both are the same green, `--c-leaf` in `index.css`: change that one value
  to change every green button. White on it is 5.3:1, so keep such a button opaque on
  light (at 90% over cream it drops under 4.5:1).
- **The fixed colours are for things that look the same in both themes:** the thin blue
  rules and dots (`bg-medical`), a photo's scrim, shadows.
- **A block that is dark in both themes** gets the class `dark` on its outer element: the
  text laid over a photo (album covers), the photo and merch
  viewers. Everything inside then resolves the tokens to
  their dark values. A modal's backdrop is a fixed `bg-forest-950/85`. The home hero and
  the footer are not among these: both follow the theme. The hero is a cream stage with
  a dark logo on light, and its moving ECG trace (`ECGBackground.jsx`, a canvas) has a
  palette per theme in `PALETTES`; the footer is a pale band with dark logos. The two
  bespoke member-lookup cards (the President's and Heba Ismail's, `SpecialResult.jsx`)
  follow the theme as well: their pale golds have a deep-gold light variant, and Heba's
  garden, drawn in pastels, is deepened on light by the `.hb-garden` filter.
- **A white logo** (the committee marks, IFMSA, IFMSA-Egypt) gets the class `logo-ink`,
  which inverts it on a light page and keeps a red emblem red. Inside a `dark` block it is
  left white.
- **A colour worked out in JavaScript** (a committee's own colour) goes through
  `readableAccent(hex)` in `src/lib/color.js`, or `chipAccent(hex)` when the text sits on a
  chip tinted with that colour. Both return one CSS value that holds a shade for each theme
  and picks through `--theme-light` and `--theme-dark`, so it works in an inline style and
  inside a `dark` block. Each shade is lightened or darkened until it reaches 4.5:1.
- **The aurora** (`GalleryAurora.jsx`) has a pastel palette for the light theme.

**Sizing.** Every size is in rem and the root font size follows the screen (`html` in
`index.css`): 15px on a 320px phone, 16px from 360px to 1280px, then rising to 18px at
1920px and 20px at 2560px, on top of the reader's own browser setting. So a page built
with the ordinary Tailwind scale needs nothing extra to fill a large monitor. On touch
screens a form field's text is never under 16px, because iOS zooms the page in when a
smaller field takes focus.

**The portal header** is built to the public navbar's dimensions (the 6rem bar, the logo,
the type and the side padding); the links sit on a row of their own below it, on one line
that scrolls sideways on a phone and wraps from a tablet up. The two step up at the same
widths. The public bar was retuned to fit "Check membership" (section 28): its side
padding widens at 1100 px and its larger type, pills and logo start at 1920 px. The
portal header was brought back in step in the third stage of the design pass, so its
padding (the bar's and the row of links') widens at 1100 px and its larger type, sign-out
pill, label and logo start at 1920 px. Between 1024 and 1099 px the header therefore
stands 24 px wider on each side than the page under it, whose padding widens at 1024 px,
as the public bar does. In the portal's row of links the page a person is on is in
semibold ink with a blue bar under it, and the other links are a shade quieter.

**The magazine reader's depth** (`Flipbook.jsx`, the `.flipbook` rules in `index.css`):
the gutter shading and the page edges are CSS on the classes the page-flip library puts
on each page (`--simple`, `--left`, `--right`); the edges grow on the side that has been
read (`--stack-left`, `--stack-right`); the shadow of the lifting page is the library's own
(`maxShadowOpacity`). With reduced motion a page turns at once.

### What the design pass added (October 2026)

The audit of 2026-10-08 (`docs/DESIGN_AUDIT_2026-10.md`; its first section says where each
finding stands) was worked through in three stages on the branch `apple-design-pass`:
the shared pieces, the pages, and then the follow-ups the pages had left for the shared
files. This is what a page written after it has to know. Each item ends with a line of
use.

**Type.**

- **`text-2xs` and `text-3xs`** (`tailwind.config.js`) are 11px and 10px at the usual root
  size, written in rem so they follow the reader's text size. Each is a size only, with no
  line height of its own. Do not write a font size in px (`text-[11px]`); the six that
  remain are in the two bespoke lookup cards (`SpecialResult.jsx`).
  `<span className="text-2xs font-semibold uppercase tracking-[0.2em]">`
- **`.heading-serif`** sets its own letter spacing from the heading's size: tight from
  `text-4xl` up, none from `text-xl` down. A plain `tracking-*` class beside it loses to it.
  `<h2 className="heading-serif text-3xl text-ink">`

**Motion.**

- **A scale or a move goes behind `motion-safe:`**, so a reader who asked for less motion
  gets none. Colour and opacity changes stay for that reader: a cross-fade, not a slide.
  Do not undo a movement with `motion-reduce:transform-none`: it loses to a `hover:` or
  `active:` rule, and it strips a transform that holds something in place.
  `motion-safe:hover:-translate-y-1 motion-safe:active:scale-[0.99]`
- **Animate `transform` and `opacity`**, not `width`, `height`, `max-height`, `top` or
  `left`, and name the properties: no `transition-all` is left in `src`. One exception was
  left as designed: the cart label in the phone row still opens by `max-width`
  (`NavCartButton.jsx`), and only fades under reduced motion.
  `transition-[transform,border-color,box-shadow] duration-300 ease-out`
- **`pressCls`** (`src/lib/motion.js`) is what every button shares: its colours ease over
  150 ms and it sinks to 0.97 while pressed, the sinking only for readers who have not
  asked for less motion. It is already in `<Button>`, `primaryBtnCls`, `outlineBtnCls` and
  `chipBtnCls`; on a hand-typed button it takes the place of `transition-colors`.
  `pressCls` changes no colour by itself. On a phone nothing hovers and under reduced
  motion nothing sinks, so a press there shows only if the button has a pressed colour:
  every `<Button>` variant and the three portal classes carry one, and a hand-typed button
  needs an `active:` colour beside `pressCls`. The portal's classes write theirs as
  `[&:not(:disabled)]:active:`, so a switched-off button keeps its colour and a link
  styled as a button still answers (`enabled:` would never match a link).
  `` className={`rounded-full px-5 py-2 ${pressCls} hover:bg-veil/10 active:bg-veil/20`} ``
- **`.reveal`** (`index.css`, with `useReveal.js`) asks for a layer of its own only while
  it waits to come in: `will-change` goes back to `auto` once `is-visible` is on, and is
  `auto` from the start under reduced motion. Left on, the hint held a layer for every
  revealed element for as long as the page was open. The transform that moves nothing
  stays, so a revealed element is still the box its absolutely placed children are
  measured from.
  `<section className="reveal mx-auto max-w-5xl">`
- **`scrollBehavior()`** (the same file) is the `behavior` of every `scrollTo` and
  `scrollIntoView`: a jump under reduced motion, a smooth scroll otherwise. Do not write
  `behavior: 'smooth'`. `prefersReducedMotion()` beside it is the test itself; both are
  safe in the pre-render.
  `el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })`
- **Things that open over the page** take two plain classes from `index.css`.
  `enter-scrim` goes on the layer that dims the page and fades in over 200 ms.
  `enter-panel` goes on the thing that opens: it fades in over 240 ms while it rises 8px
  and grows from 98% of its size (`cubic-bezier(0.2, 0, 0, 1)`), and only fades under
  reduced motion.
  `<div className="enter-scrim fixed inset-0 bg-forest-950/85"><div className="enter-panel rounded-3xl bg-card p-6">`
  - They are plain CSS, not Tailwind utilities, so they take no variant prefix.
  - Each sets its element's whole `transition`, so a Tailwind transition class or
    `pressCls` on the same element is overridden. Put the entry class on a wrapper.
  - The entry plays for an element that has just been mounted or has just stopped being
    `display: none`. One that is always in the page and shown by swapping classes (the
    cart drawer, the mobile menu) gets nothing from it and has a transition of its own.
  - Only the way in is animated. For a way out the element has to stay mounted while it
    leaves, as the gallery's photo viewer does for 200 ms.
  - A popover that grows out of its button takes a transform origin beside it
    (`origin-top-right`). A panel centred with
    `left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` needs `origin-top-left`, or it
    drifts a few px on the way in; one centred by a flex or grid parent needs nothing.
  - A browser without `@starting-style` shows the thing at once, as it always did.

**Materials, contrast and hover.**

- **A blurred, see-through panel takes a solid fallback** through the variant
  `reduce-transparency:` (`tailwind.config.js`, for a reader whose system asks for fewer
  see-through surfaces): the same token at full strength, and no blur. Where the fill is
  set with `dark:` or a screen prefix, write that prefix first
  (`dark:reduce-transparency:bg-leaf`). A scrim can simply drop its blur. Headless
  Chromium on the build machine reports this setting as on, so its screenshots show the
  solid fallbacks unless the setting is emulated as off.
  `bg-page/70 backdrop-blur-md reduce-transparency:bg-page reduce-transparency:backdrop-filter-none`
- **`prefers-contrast: more` is handled in `index.css`** for the tokens. The strength of
  `line` rises until the usual hairline (`border-line/10`, and `ring-line`, `divide-line`
  and `bg-line` with it) reaches 3:1, and the floor of `soft` rises until every step from
  `text-soft/30` up reaches 7:1. Nothing is written in the markup for those. Tailwind's
  own `contrast-more:` variant is for what the tokens cannot reach: a panel over a photo
  or the aurora repeats its solid pair with it.
  `contrast-more:bg-page contrast-more:backdrop-filter-none`
- **Hover styles apply only where the device can hover** (`future.hoverOnlyWhenSupported`
  in `tailwind.config.js`), so a tap on a phone no longer leaves one stuck on. Two things
  follow: nothing may be reachable by hover alone, and a card or button that should
  answer a finger needs an `active:` style of its own.
  `hover:border-line/30 active:border-line/30`
- **Muted text is not dimmed a second time with an opacity class.** The steps of `soft`
  are worked out to pass 4.5:1 as they stand (the token list above), and `opacity-60` laid
  over one takes it under: the sample walk found an undone bulk update, a retired position
  and a read-only field that way. Say it with a soft step, and with `line-through` where
  the text is struck out; on a field the step needs `!`, because `inputCls` sets
  `text-ink`. The steps are tuned for a page, a band and a card, so on a tinted fill
  (`bg-veil/10`, a row's hover tint) take a stronger one, as the quiet status pill of the
  calls list does (`text-soft/90`). A switched-off button is another matter and keeps its
  `disabled:opacity-40`.
  `` className={`${inputCls} max-w-sm ${position.active ? '' : 'line-through !text-soft/70'}`} ``
- **The keyboard's ring on a button** is the same on every `<Button>` variant, on `Toggle`
  and on `ThemeToggle`: a 2px outline in the theme's blue, set off by a 2px gap so that it
  shows on any fill. A caller need not pass ring classes of its own.
  `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`

**Touch.** Where a finger lands, a control is at least 44px, written in px: the root size
is 15px on a 320px phone, so `h-11` and `min-h-[2.75rem]` are 41px there. Three idioms are
in use. `min-h-[44px]`, where the control may simply be taller. `tapCls`, exported from
`src/portal/portalUi.jsx`, where it should stay a small pill under a mouse: a 44px minimum
height on a touch screen only. And an unseen `::after`, 44px high and centred on the
control, where it must not look any bigger; two such areas may meet and must not overlap.
`relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-full after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']`

`tapCls` is built into `primaryBtnCls`, `outlineBtnCls`, `inputCls`, `chipBtnCls` and
`smallInputCls`, so a page adds it only to a control it styles by hand. It is written
inside `:where()`, which gives the rule no weight, so a height a page sets itself
(`min-h-[7rem]` on a tall textarea) still wins. Many portal pages still define a `tapCls`
of their own in the plain form, `[@media(pointer:coarse)]:min-h-[44px]`, and put it beside
a shared class. Those copies do no harm and can go. Do not copy the plain form for
anything new: beside a taller minimum of the page's own it wins on a phone and takes the
control down to 44px. A few files, among them the dashboard, the directory, the profile
and `PortalLayout.jsx`, give the name `tapCls` to an `::after` reach of their own instead.
`<Button>` sizes `sm` and `md` carry the `::after` reach themselves, so a `<Button>` needs
nothing added.
`` import { tapCls } from '../../portalUi.jsx' `` then `` className={`rounded-full border px-3 py-1 text-xs ${tapCls}`} ``

**Errors people see.** `errorText(err, fallback)` (`src/lib/errorText.js`) turns a caught
error into one whole sentence. Show its result alone, with nothing such as ". Please try
again" after it.

| The error | What comes out |
| --- | --- |
| The request got no answer (offline, a dropped connection, a timeout), or a part of the site's own code that is loaded on demand did not arrive (the module that builds a PDF) | "We couldn’t reach the server. Check your connection and try again." |
| A permission error | the database's own sentence when it wrote one, otherwise "You don’t have permission to do that." |
| A refusal a server answered: a function's `raise` (codes 22023, P0001, 23505, 40001), or a 4xx answer that carries no code | the sentence as written, but only when it opens as a sentence written for people does (a capital, a figure or a quotation mark, or in lower case "a", "an", "the" or "could not find") and carries no row id. Otherwise the fallback: a function speaking of its own call ("decision must be approved or declined") and Postgres's own words under those codes ("duplicate key value") are never shown |
| A sentence the site's own code threw and marked `rejected`, which has neither a code nor a status | the sentence as written, however it opens ("minutes.pdf could not be uploaded.") |
| Anything else | `fallback`, the caller's own words for what failed |

`<ErrorText>{save.error ? errorText(save.error, 'Could not save the photo.') : ''}</ErrorText>`

Two cautions. A sentence the site's own code throws with `new Error('…')` is replaced by
the fallback: mark it `rejected = true` (as `refusal()` in `src/portal/magazineQueries.js`
does), or show `err.message` at that one call site. `src/portal/exportFile.js` marks its
two font sentences the same way, and `ExportButtons.jsx` calls `errorText` directly, with
no patterns of its own.
And whether an error that carries a `code` is a refusal is decided by the code alone
(`src/lib/supabaseRest.js` puts the answer's code on what it throws), so PostgREST's own
4xx words, such as a missing function or a not-null violation, become the fallback.
`lookupMember` in `src/lib/membership.js` returns `errorText`'s sentence as the `message`
of its `{ state: 'error' }` answer, to be shown as it is. `MembersPage.jsx` still passes
that sentence through `lookupErrorText`, a rewording of its own from when the message was
the raw one.

**A read that got no answer is not tried again by the portal's react-query**
(`src/portal/queryClient.js`). supabase-js has by then sent a table read four times
itself, waiting 1, 2 and 4 seconds in between, and a second round took "We couldn’t reach
the server" from about 7 seconds to about 15. Any other failed read is still tried once
more. A read through a database function is a POST, which supabase-js sends once, so with
no answer it fails at once; the directory has a retry rule of its own in
`src/portal/queries.js` and keeps its second try.

**The portal's shared pieces** are in `src/portal/portalUi.jsx` unless another file is
named.

- **`PageLoading`** is a page's own loading state inside the portal layout: the spinner a
  little way under the header, where the content is about to appear. `Centered` is only
  for a whole screen that is one message.
  `if (list.isLoading) return <PageLoading />`
- **A field's label** (`Field`) is plain 14px ink text, and the fields show a focus ring
  (`inputCls`, and `smallInputCls` in `workUi.jsx`). The small blue capitals are a panel's
  title, and **`panelTitleCls`** is that look for a heading that opens a section without
  being a field's label. A `Field` given both a `hint` and an `htmlFor` ties the hint to
  its control, so the hint is read out with the field: the control's `aria-describedby`
  gains the hint's id, after any description the page gave it itself. With no `htmlFor`
  there is nothing to tie the hint to.
  `<p className={panelTitleCls}>Wide designs</p>`
  `<Field label="Title" hint="Shown on the card." htmlFor="p-title"><input id="p-title" className={inputCls} /></Field>`
- **`CheckField`** is a tick box with its label and hint, for a choice that waits for
  Save. A switch (`Toggle`) is only for a setting that takes effect the moment it is
  flipped, so the two never look alike. `onChange` is handed the new true or false, as
  Toggle's is, and the row brings its own 44px, so stacked ones need no margin.
  `<CheckField checked={digest} onChange={setDigest} label="Email me a daily digest" hint="At most one email a day." />`
- **`Toggle`** is 28px tall to the eye and carries an unseen `::after` 44px high, so a
  finger has the full target, the row keeps its height and a page needs no wrapper for
  it. It shows the keyboard's ring, and its knob slides only for a reader who has not
  asked for less motion. `describedBy` takes the id of the line beside the switch that
  says what the setting does, which is then read out with it; no page passes it yet.
  `<Toggle checked={open} onChange={setOpen} label="Taking orders" describedBy="orders-hint" />`
- **`SaveStatus`** is the one line beside a Save button: "Unsaved changes" while the form
  differs from what is stored, otherwise the saved wording, otherwise nothing. `saved` is
  true (for "Saved.", or for `savedText`) or the sentence itself. It is always in the
  page, out of sight when it has nothing to say, so a screen reader hears it change: the
  page must not print a "Saved." of its own beside it, and a wrapper that counted on
  `empty:hidden` will not collapse. The line is `text-xs` unless `className` brings a text
  size (`className="text-sm"`), which then stands in its place.
  `<SaveStatus dirty={dirty} saved={saved} />`
- **`UndoLine`** says what has just happened and offers to take it back. It stands in for
  asking first where a slip costs little (a row that left a list, a removed day). Keep it
  mounted with no children while there is nothing to undo, so it is read out when it
  comes, and give it some padding in a dense list (`className="py-3"`): its Undo button
  reaches 44px through an `::after`. The button leaves the page as it is pressed, so the
  page that uses the line decides where the keyboard goes next. As with `SaveStatus`, a
  text size in `className` takes the place of the line's own `text-xs`, and the button
  follows it.
  `<UndoLine onUndo={() => move(row.id, was)}>{moved ? 'Moved to Contacted.' : null}</UndoLine>`
- **`ConfirmButton`** is every remove, delete and discard: the first click turns it red
  and asks again on the button, the second does it. A second click within 500 ms of the
  first is ignored, so a double-click cannot confirm, and a held Enter counts once. It
  goes back after 5 seconds, on Escape and when the focus leaves it, and the red wording
  is read out. A pill with the default look is as wide as its longest wording from the
  start; a pill with a `className` of its own takes `keepWidth` for the same. It renders
  two sibling nodes (the button, then an unseen live line). The `text` variant turns into
  a red pill about 20px tall. On a touch screen both of its states have an unseen reach of
  their own, so a wrapper is optional: 44px for the idle link while it keeps the default
  look (a `className` of the page's own replaces it), and about 32px for the red pill
  whatever the page passed. The red pill often wraps onto a line of its own under a row's
  other links, where 44px of red would take a press meant for the link above. With a
  mouse there is no reach. A wrapper that sets the button's `::after` itself, as
  `confirmReachCls` in `src/portal/pages/exam/ExamsPage.jsx` does, outranks the shared
  reach and gives the red pill the full 44px, so use one only where the row has the room.
  `<ConfirmButton label="Delete" busyLabel="Deleting…" busy={remove.isPending} onConfirm={() => remove.mutate(row.id)} />`
  `<ConfirmButton variant="text" label="Remove" onConfirm={() => remove.mutate(row.id)} />`
- **`useFocusTrap(active, onClose)`** (`src/hooks/useFocusTrap.js`) holds the keyboard
  inside the cart drawer, the apply dialog, the photo viewer and the merch viewers, and
  closes them on Escape. It keeps `onClose` in a ref, so a caller need not memoise it, and
  a parent that renders again no longer pulls the keyboard back to the dialog's first
  control. It also listens on the document: when the focus has slipped out of the dialog
  (a click on plain text, the removal of the control that held it), Escape still closes
  it and Tab comes back in. With two dialogs open only the one opened last answers. A
  caller therefore needs no Escape listener of its own.
  `const ref = useFocusTrap(open, onClose)`
- **`useLeaveWarning(active)`** (`src/hooks/useLeaveWarning.js`) puts the browser's own
  question before the tab is closed, reloaded or sent to a typed address while `active`
  is truthy. It cannot see a link inside the site: the app uses `BrowserRouter`, which has
  no navigation blocker. Where such a link would lose work, switch it off or make it a
  `ConfirmButton` while there is something to lose (the editors' own back links do), or
  keep the form mounted. The portal's header links are guarded nowhere.
  `useLeaveWarning(dirty || uploading)`
- **`useTabParam(allowed, fallback, name)`** (`src/hooks/useTabParam.js`) keeps the open
  tab in the address as `?tab=`. Choosing a tab replaces the address and adds nothing to
  the history, so Back leaves the page; the other parameters, the `#fragment` and the
  state the page was opened with are kept; the fallback tab is the plain address. The
  third argument names another parameter (`'view'`). Call it before any early return. Its
  tested parts are `tabFromSearch` and `searchForTab`. On a public page `ScrollManager`
  stays put when only the `?query` is replaced; the portal has no scroll handling.
  `const [tab, setTab] = useTabParam(TABS, 'page')`

Four habits the pass settled on, which have no shared helper yet:

- **A control that saves at once moves at once.** A switch or a status picker shows the
  change at the click, sends its writes in the order they were made, dims nothing beside
  it, and goes back with a sentence if the save fails. Copy `useInstantSave` in
  `src/portal/merchQueries.js`, or `shownAtOnce` in `src/portal/galleryQueries.js` for a
  row of a list.
- **A form follows its saved row only while it is clean**, and after a save it takes the
  stored row only if nothing was typed meanwhile. `ProductEditorPage.jsx` is the model.
- **A load error stands in for a page only when nothing was ever read**
  (`q.error && !q.data`). A re-read that fails in the background keeps the page, and what
  is typed in it, on screen.
- **A sheet over a public page locks the scroll through `lockPageScroll()`**
  (`src/components/ScrollManager.jsx`), a counted lock, so two open at once can close in
  either order. The mobile menu and the cart use it; the apply dialog, the photo viewer
  and the merch viewers still put back the value they found.
  `useEffect(() => (open ? lockPageScroll() : undefined), [open])`

**Checking a change to any of this.** `npm run walk -- --contrast` (section 21) must end
with no page scrolling sideways and no low-contrast colour pairs; then look at the
screenshots of the pages touched at 320 and 1920 px in both themes. State on 2026-10-05:
the 37 public pages pass at all six widths in both themes, and so do the 18 portal pages
`npm run walk:portal-sample` had then (it opens 100 screens since the third stage of the
design pass, section 21). A signed-in walk of the portal against the real data
(`npm run walk -- --login` first) has not been done yet. The design pass was checked area
by area with throwaway headless Chromium scripts against made-up sessions and data, and
with `npm test`, which ran 637 tests in 30 files on 2026-10-11 (the shared pieces have
tests beside them: `src/lib/motion.test.js`, `errorText.test.js`, `photoStrip.test.js`,
`supabaseRest.test.js`, `src/hooks/useTabParam.test.js`,
`src/portal/SortableList.test.js`, `officerQueries.test.js`, `workQueries.test.js`,
`magazineQueries.test.js`). `src/lib/photoStrip.js` holds the sums behind the photo
viewer's swipe, moved out of `GalleryPage.jsx` so that they can be tested without a
browser. The three portal query tests stub `../lib/supabase.js` with `vi.mock`, because
the file each one tests builds the database client as it loads; a new test of a file that
imports the client needs the same line. Both walks were run again over the result on
2026-10-11, after the third stage. The portal sample walk opened all 100 screens at 320 and 1440 px and the public walk
opened all 40 pages at 320 and 1920 px (and at 768, 1280 and 1536 px before the last small
fixes), each in both themes with the contrast check: no page scrolled sideways, nothing
was cut off in a fixed bar and no text was under 4.5:1. What the widened sample walk found
on its first run (the Invites tab scrolling sideways at 320 px under a long position title,
and six texts dimmed with an opacity class) was fixed before that last run.
Nothing was tried signed in against the real database or on a real
phone, and only Chromium was used: try the photo viewer's swipe and the exam's buttons on
an iPhone, and Escape and Tab in the cart and the photo viewer in Safari.

## 25. Site content: the editor, its blocks and the audit log (Phase 6, step 1)

Built 2026-10-05. Migrations `20261005210001_content_blocks` and
`20261005220001_incomings_block` (and, 2026-10-06, `20261006183133_outgoings_block`; 2026-10-07, `20261007090001_site_blocks`), pgTAP file `290-content-blocks.sql`, unit tests under `src/**/*.test.js` (`npm test`).

**What it is.** A part of a public page that is plain content (the questions on `/join`
first) is a *block*: one row of `public.content_blocks`, holding a jsonb document. The
portal page **Site content** (`/portal/content`) lists the blocks a person may edit and
opens each in the same form, drawn from the block's field schema.

| Copy | Where | Who sees it |
| --- | --- | --- |
| The shipped copy | `defaults` in the schema file (from `src/data`) | visitors, until something is published |
| The draft | `content_blocks.draft` | the block's editors only |
| The published document | `content_blocks.published` | every visitor, through `rpc/content_public()` |

- **Save draft** keeps the work without changing the site. **Publish** puts what is on
  screen on the site and clears the draft. **Discard draft** throws the draft away.
- Visitors see a published change on their next page load. Search engines and link
  previews follow when the pages are rebuilt, which publishing asks for by itself
  (section 23, "rebuild on publish").
- Two people editing the same block: the second to save is refused with "Someone else
  saved this while you were editing" and reloads to see the other version.
- **A slip costs little.** The line under the buttons says "Unsaved changes" from the first
  edit after a save, and the save's own sentence only while nothing has changed since. A
  removed list row or picture leaves a line with **Undo** where it stood. "Undo my
  changes" asks for a second click, and so does the page's own "All site content" link
  while there are unsaved edits; closing or reloading the tab asks too. "N things need
  fixing above" is a button that goes to the first field with a problem. A picture that
  finishes uploading lands in the row it was chosen for and no longer undoes what was
  typed meanwhile. A failed re-read in the background leaves the editor on screen.
- **The preview** (from 1280 px wide, beside the form) is a box of its own, as tall as the
  window, that scrolls on its own. It follows the form: the part of the preview made from
  the field with the cursor, or from what is a third of the way down the window, is kept
  level with it, and the end of the form brings the end of the preview. Each field and list
  row of the form carries `data-anchor` and is matched with the first preview text after
  the previous match that starts with the same words (`previewFollow.js`,
  `usePreviewFollow.js` in `src/portal/pages/content/`), so a new block needs nothing extra.
  Scrolling the preview by hand (wheel, touch, its scrollbar, the keyboard) stops the
  following until the editor is opened again; "Follow the form again" turns it back on.
  On narrower screens the preview sits under the form and scrolls with the page.
- **Who may edit.** The EB edits every block. `content_blocks.editors` lists committee
  slugs whose officers may edit and publish that one block too (`{scope,score}` for an
  exchange page). The three write functions and the row-level security check it; the
  `editors` list in the schema file only decides who sees the "Site content" link.
- **Nothing typed can inject markup.** Every value is rendered by React as text. Markdown
  fields go through `src/lib/markdown.js`, which builds a tree of plain objects (never
  HTML) and keeps a link only when `safeHref` accepts its address: `http(s)`, `mailto`,
  `tel`, a page of this site, or an anchor. The database holds a document to being a jsonb
  object under 200 kB and knows nothing else about it; the page reads it through
  `resolveDoc`, which drops unknown keys and falls back to the shipped copy when a
  published document fails its own schema.
- **Pictures** in an image field are shrunk in the browser and stored in the public bucket
  `content-media` under `<block key>/`, writable by that block's editors only.

**The blocks so far.**

| Block | Page | Edited by | Holds |
| --- | --- | --- | --- |
| `join.faq` | `/join` | the EB | the questions and answers |
| `exchange.incomings` | `/exchange/incomings` | the exchange officers (SCOPE, SCORE) and the EB | the introduction, the figures under it, "What we give you", the "Why choose us" reasons (heading, text, optional picture), "How you get to us", the "Before you land" tips, which gallery album to show, whether to show the contact cards, the link to the IFMSA-Egypt welcome booklet, the links at the foot |
| `exchange.outgoings` | `/exchange/outgoings` | the exchange officers (SCOPE, SCORE) and the EB | the introduction, the figures under it, "What the exchange gives you", the "Why go" reasons (heading, text, optional picture), "How to apply", the "Before you fly" tips, which gallery album to show, whether to show the contact cards, the links at the foot |
| `site.contact` | the footer of every page, and `/contact` | the EB | the motto and line under the footer logo, the address card and the map pin, the official social channels (network, handle, address, one line), the two introductions on `/contact` (section 27) |
| `home.page` | `/` | the EB | the badge above the logo, the line under the motto, the figures after the live member count, the line under them, and the "About the Society" section: heading, the large text, the paragraphs, the quotation, the three cards (heading, text, optional link and its words) (section 27) |
| `ifmsa.page` | `/ifmsa` | the EB | the introduction, the membership card's text, the figures for IFMSA worldwide and for IFMSA-Egypt, the cards, the links under "Learn more" (section 27) |

**The incomings page is written for a student abroad** who is choosing which local
committee to spend an exchange month with, and it speaks in our own voice: "we", "our",
"us", to "you". Keep new copy that way; what we say to our own members about hosting
belongs on `/exchange/join`. The page has its own file
(`src/pages/ExchangeIncomingsPage.jsx`). The copy it ships with, and its six pictures
(`public/assets/exchange/incomings`), come from our incomings booklet. The two track
cards and the stories section take an `audience="incoming"` setting that words them for
the same reader; the stories shown there are the ones whose destination is Egypt, Cairo or
Ain Shams.

On the incomings page three things are deliberately not in the block. The photos are a
gallery album chosen in the editor, so they are managed in the Gallery editor and nothing
is uploaded twice; the section shows the first eight and links to the album, and
disappears if the album is deleted or empty. The contact cards (the LEO-In and the LORE)
take the name and photo from whoever holds the position (section 23) and the email from
`src/data/society.js`. The page's title and its search description stay in
`src/data/society.js` and `src/seo/pages.js`, because the pre-rendered page and the
browser tab must agree (section 15). The welcome booklet itself is
`src/data/incomingsBooklet.js`.

**The national team's two booklets** (added 2026-10-10) sit under ours in "From the national
team": the IFMSA-Egypt exchange booklet and the IFMSA-Egypt welcome booklet. They are files of
the site, not part of the block: `public/assets/exchange/booklets`, listed with their words in
`src/data/nationalBooklets.js` (a booklet's `jump` is the page "Open at our pages" starts on).
Each opens in place in the site's own reader, as the two documents on `/constitution` do.

**The reader** is `src/components/PdfReader.jsx`, with `DocumentCard.jsx` as the card a document
opens from. It draws the pages with pdf.js, which loads only when a reader is near the screen,
and has a search bar above the pages: a word or a phrase, the count, previous and next, a list of
every place, and the matches marked on the page. The search itself is
`src/lib/pdfSearch.js`, with tests. If pdf.js cannot open a file the browser's own viewer takes
its place in a frame.

To replace a document, put the new PDF over the old one under the same name, and correct its
line of facts (date, pages, size) where it is listed: `src/data/nationalBooklets.js`, or
`src/pages/ConstitutionPage.jsx` for the two on `/constitution`. Two things to know:

- **Every megabyte is in every deployment.** A file in `public/` is copied into each build, and
  Vercel counts every build it keeps. The national exchange booklet is 75 MB as exported, so the site
  carries a 19 MB copy made for the web: each page as a picture, with the words kept invisibly
  on top (so search and selecting still work) and the links kept. A new edition needs the same
  treatment before it goes in; a PDF of a few megabytes goes in as it is.
- **A long file is fetched in pieces.** A card marked `large` makes the reader ask for only the
  pages being read (about 1.4 MB to open the exchange booklet at our pages, the whole file only
  for "Download PDF"). That works on the live site; the dev server sends whole files.

**The outgoings page has the same shape, for our own students** thinking of going abroad
(added 2026-10-06, migration `20261006183133_outgoings_block`). Its file is
`src/pages/ExchangeOutgoingsPage.jsx`; it draws the same section components
(`src/components/IncomingsSections.jsx`) with its own headings (`OUTGOINGS_COPY` there),
and the contact cards are the LEO-Out and the LORE (`OUTGOING_CONTACTS`). The copy it
ships with is in `src/content/schemas/exchangeOutgoings.js`, written only from facts the
site already stated (four weeks, SCOPE or SCORE, lodging and a meal a day, the 80%
certificate, the exam, interview and contract steps, the pre-departure orientation). It
has no switcher to the incomings page; `/exchange` is the hub for both. The stories
section there lists every story whose destination is not Egypt, Cairo or Ain Shams.

**Add an editable block.** Three files and one line:

1. A migration that inserts the row: `insert into public.content_blocks (key, editors)
   values ('exchange.incomings', '{scope,score}') on conflict (key) do nothing;` The key
   is `<page>.<part>` in lower case.
2. A schema file in `src/content/schemas/` (copy `joinFaq.js`). Field types: `text`,
   `textarea`, `markdown`, `url`, `image`, `album`, `toggle`, `select`, `list`
   (`src/content/schema.js` documents each; a `toggle` is drawn as a tick box, because it
   counts only once the block is saved or published). Its `defaults` are what the page shows until
   someone publishes, so move the current copy there.
3. Add it to the list in `src/content/index.js`.
4. In the page, `const doc = useContentBlock(schema)` (`src/lib/content.js`) and render
   `doc`. For a preview in the editor, add an entry to
   `src/portal/pages/content/previews.jsx` that draws the page's own component.

Then `npm test` (a test checks every schema's shipped copy passes its own rules) and
`npm run walk:portal-sample -- dark,light 320,1440 /portal/content`.

**Undo a bad publish.** Open the block, fix it and publish again. For the exact earlier
text, the webmaster opens **Audit log**, filters on "Site content", and copies the
`published` value from the "Before" side of the entry. To go back to the shipped copy,
set the row's `published` to null in the Supabase table editor.

**The audit log** (`/portal/admin/audit`, webmaster only) reads `public.audit_log`, which
a trigger fills on every change to the main tables: who, when, and the row before and
after. Filter by what was changed and by the kind of change; open an entry to see the
fields that differ. It is read-only, and the database returns its rows to the webmaster
alone. Entries for `site_settings` and `content_blocks` carry the row's key as their row
id (they had none before this migration). Drafts are logged too, so the log grows with
every save; there is no trimming yet, which is a job for Phase 7 if the table grows large.

**Tests.** `npm test` runs Vitest once (also on every pull request, workflow `site-ci`).
The files sit beside what they test: `src/lib/markdown.test.js` (what a link may point
at, what the reader understands), `src/content/schema.test.js` (documents are forced into
their schema's shape; a broken published document is never rendered), `src/lib/text.test.js`.

## 26. The merch shop (Phase 6, step 3)

**Where it lives.** The table `public.merch_products` holds each product whole: name, tagline,
description, picture, price, sizes, size chart, designs (and which of them take a full row in
the picker), whether it is on sale, and its place in the shop. It is also the price book
`submit_order` prices against (section 18), so what a buyer sees and what they pay are the
same row. The EB edits it on the portal's **Merch** page (`/portal/merch`); the database
refuses anyone else (row-level security). Pictures go to the public bucket `merch` as
`<product id>/<random>.jpg`, shrunk in the browser to 1400 px. Every change asks for a rebuild
of the public pages (section 23), and the shop reads the live rows on every visit anyway.

**How the site reads it.** `src/lib/merch.js` holds one catalogue for the page: the one the
pre-render baked into `/merch`, else the last one this browser saw, else the copy that ships in
`src/data/merchProducts.js`; then the live rows replace it. The cart (`src/lib/cart.js`) keeps
its lines until the live rows arrive, then drops any whose product was removed or hidden, and
the checkout says how many it dropped. Editing `merchProducts.js` changes nothing once the
database answers; it is only the fallback.

**Day to day (EB).**

- *Open or close orders:* the "Taking orders" switch at the top of the Merch page (also
  on Site settings). Closed, the shop stays up and the checkout says orders are closed; the
  database refuses an order sent anyway.
- *Hide a product:* its switch on the Merch page. It leaves the shop and the carts, and an
  order for it is not taken. Prefer this to removing it.
- *Change a price or the text:* open the product, edit, Save. Orders already placed keep the
  price they were placed at.
- *A new product:* "New product", give a name, price and (optionally) an id. The id is
  permanent: carts and orders use it. It starts hidden; add the picture and description, then
  switch it on.
- *Order:* drag a product by its handle (the arrow keys work on the handle too).
- *Remove:* at the foot of the product's page, with a second click to confirm. Its uploaded
  pictures go too; past orders keep their lines.
- *Pictures and size charts* are an uploaded file (an `https://` address) or a file that ships
  with the site (`/assets/...`). The database refuses anything else, including an address that
  starts `//` or `/\`, which a browser reads as another site (migration
  `20261008150001_merch_picture_paths`). Links typed in markdown and in the site content
  editor follow the same rule (`safeHref` in `src/lib/markdown.js`).

- *Payment methods:* the "Payment methods" panel on the Merch page. Each method has a name,
  a type (payment link, handle or phone number), the link, handle or number itself, a short
  hint and an "On the checkout" tick box (a tick box and not a switch, because nothing here is
  stored until the list is saved). Edit in place, drag to reorder, then "Save payment
  methods"; the panel says "Unsaved changes" until then. The list is the site setting
  `merchPaymentMethods`, and until it is first saved the
  checkout uses the copy in `src/data/merchConfig.js`. A new method's id is made from its name
  when it is saved and is permanent, because every order records it. Take a method off the
  checkout rather than removing it while orders may still name it. Removing a saved method asks
  for a second click; one added since the last save goes in one click, with an Undo line.

**Not editable yet.** The booklet on `/merch` (the page images in `public/assets/merch` and
`src/data/merch.js`) is still a file.

**Tests.** `supabase/tests/300-merch-catalogue.sql` (who may write, the picture and design
checks, hidden products not sold, a closed shop refusing orders, the rebuild request) and
`src/lib/merch.test.js`, and `src/data/merchConfig.test.js` for the payment methods. The portal pages are in the sample walk:
`npm run walk:portal-sample -- dark,light 320,1440 /portal/merch`. In Git Bash, prefix that
with `MSYS_NO_PATHCONV=1`, or the route argument is turned into a Windows path and nothing
is walked.

## 27. Switches, contact details, the home page and the IFMSA page (Phase 6, step 3)

Built 2026-10-07. Migration `20261007090001_site_blocks`, pgTAP file
`310-site-switches.sql`, unit tests `src/data/emailConfig.test.js` and
`src/content/siteContact.test.js`.

**The switches.** Three switches that were constants in config files are site settings now,
on the portal's **Site settings** page (EB only). A missing row means off.

| Setting | Label on Site settings | When on |
| --- | --- | --- |
| `openCallsLive` | Show Open Calls on the public site | the calls officers publish show on their committee pages with an Apply button |
| `magazineCountersVisible` | Show reads and likes on the magazine | the reads count and a Like button show under each edition (reads are recorded either way) |
| `domainEmailsLive` | Show the @ausss-ainshams.org addresses | every page shows a role's address on the domain instead of its Gmail inbox (section 19 says when) |

Each switch saves the moment it is flipped: it moves at once, says "Saving…" and then
"Saved." under itself for about four seconds, and goes back with the reason under it if the
save fails. No switch waits for another. Turning `domainEmailsLive` on takes a second click
on the switch, because mail bounces unless forwarding is set up; turning it off is one click.

`src/hooks/useSiteSettings.js` is the one reader: one fetch serves the whole page and is
repeated at most once a minute, the last answer is kept in the browser, and the build writes
the settings into the saved pages (`scripts/prerender.mjs` fetches them, `src/entry-server.jsx`
bakes them), so the addresses in the HTML, the search-engine data and `llms.txt` follow the
switch. A change to any setting asks for a rebuild (trigger `touch_site` on `site_settings`).
Pages get an address through `usePublicEmail()`, never `publicEmail()` alone, so they follow
the switch.

**The footer and contact details** are the block `site.contact` (section 25), edited by the
EB on **Site content**: the motto and the line under the footer logo, the address card
("Where we are", the address lines), the map pin (the text Google Maps searches for; the map's
host is fixed and the text is encoded, so an edit can only move the pin), the official social
channels and the two introductions on `/contact`. A channel is a network (Instagram, Facebook,
TikTok, LinkedIn, YouTube or X, which picks the icon and the name), the handle, the profile's
address and one line. The channels are also the society's `sameAs` profiles in the search
engine data, with the LinkedIn page always added. Not in the block: the inboxes on `/contact`
(they belong to the positions, `src/data/society.js`), the footer's links, and the IFMSA
logos.

**The home page and the IFMSA page** are the blocks `home.page` and `ifmsa.page`, both the EB's.
On the home page the motto, the logo, the two buttons and the member count stay in the code (the
count is live), and so do the Executive Board and the committees below, which follow the people
who hold the positions. In the two markdown fields of "About the Society", words between
`**double stars**` take the deep colour and words between `*single stars*` the accent colour; in
the line under the figures, `**double stars**` take the accent colour. The three cards keep their
pictures by place (people, globe, document), so there are always three. On `/ifmsa` the logo
chain (IFMSA, IFMSA-Egypt, AUSSS, `ifmsaLineage` in `src/data/society.js`) and the link to the
history timeline stay in the code. The IFMSA figures are approximate, as IFMSA and IFMSA-Egypt
publish them: worth a look once a year, at rollover.

**The society's age follows the term.** Any words edited in Site content may hold two
placeholders, typed with their braces: `{years}` is shown as the number (56) and
`{anniversary}` as the ordinal (56th). The number is the year the current term ends in, less
1971 (`src/lib/anniversary.js`): 2025-26 was the 55th, 2026-27 is the 56th. So
"its **{anniversary} anniversary**" needs no editing again: pressing **New term** (section 29)
makes it the 57th everywhere, on the saved pages after the rebuild the switch asks for and in
the editor's preview. The form keeps the placeholders as typed. The current term is read by
`src/hooks/useCurrentTerm.js` (the `terms` table, which anyone may read; baked into the saved
pages by the pre-render); with the database unreachable the pages count from the date, a term
turning over on 1 September. The gallery's heading ("56 years through your eyes") uses the
same number. A number typed as a number ("56th") stays as typed, so use the placeholder
wherever the figure should keep up.

The exchange hub (`/exchange`, three cards pointing at the two exchange pages and the team page)
keeps its few lines in `src/data/society.js`; the two exchange pages themselves are blocks
(section 25).

**Checks.** `npm run walk:portal-sample -- light,dark 375,1440 /portal/content/site.contact`
and the same for `/portal/content/home.page`, `/portal/content/ifmsa.page` and
`/portal/admin/settings` (with `MSYS_NO_PATHCONV=1` in Git Bash); `npm run walk -- --only
/contact --public-only` and the same for `/ifmsa`.


## 28. Events (Phase 6, step 4)

Built 2026-10-07. Migration `20261007120001_events`, pgTAP file `320-events.sql`, unit tests
`src/lib/eventTime.test.js` and `src/portal/eventSchedule.test.js`.

**What visitors see.** `/events` lists what is coming up, soonest first; `/events/archive`
lists what is over, newest first, under one heading per term; `/events/<link>` is one event,
with its picture, its text, a **Sign up** button when it has a sign-up link, **Add to calendar**
(an `.ics` file) and a Google Calendar link, and the share row. Each committee page shows its
own upcoming events (the section is absent when there are none), and the home page shows the
next three under "Coming up" (also absent when nothing is coming up). "Events" is a link of its
own in the header, beside the Committees menu, and in the footer. Every date and time is Cairo
time, whatever the visitor's own time zone (`src/lib/eventTime.js`; Egypt's summer time comes
from the time zone data, never a fixed offset).

**Three kinds of event.** In the portal an event is **One time** (a start, and an end when
known), **All day** (one or more whole days without times) or **Multiple days** (two to
fourteen days, each with its own start and end; "Add a day" copies the last day's hours onto the
next date). The new-event form opens on One time, starting now. Switching to another kind and
back keeps what was typed under each (every day, each day's hours, an all-day event's last day),
and a removed day leaves a line with **Undo**. On the site a multiple-day event
reads "12–14 Nov 2026 · 3 days" on its card, its page shows one card per day with that day's
hours, and Add to calendar puts every day in the calendar as an entry of its own (the Google
Calendar link, which holds one entry, is left out for it). In the database the days are the
column `days`; the trigger puts them in order, refuses overlaps and a day that ends before it
starts, and takes the event's start and end from the first and last day, so everything that
sorts or archives by those two needs nothing more.

**Over and archived.** An event is over at its end, or at its start when it has none; an
all-day event at the end of its last day; a multiple-day event at the end of its last day's
hours. Nothing changes in the database when that happens: the pages compare the time with the
clock each time they render, and the nightly rebuild (section 23) moves the saved pages along. An
event therefore reaches the archive without anyone moving it, its page and link keep working, and
the term rollover has nothing to do for events. The term an event belongs to
is the `terms` row its start falls in, else the society's year (1 September to 31 August).

**Who edits.** A committee's officers add, edit, publish and remove that committee's events; the
EB does so for every committee and alone adds the society-wide ones. In the portal: **Events**
(`/portal/events`, every event the person may edit, a filter by committee, and the new-event
form with "Whose event") and the **Events** tab on each committee's page (the same list for that
committee alone). A new event is a draft; its page (`/portal/events/<id>`) fills in the end,
the place, the text (markdown: bold, italic, links and lists), the sign-up link, the link on
the site and the picture, and the **Published** switch shows it to visitors. The switch takes
effect at once; the rest of the form waits for Save and says "Unsaved changes" until then. The
side panel shows the event's card as the site will show it, following the form as it is typed
(its caption says when it holds changes not saved yet); it is a picture of the card, not a link.
What is wrong is said under the field it is about, and Save puts the cursor there. Removing the
picture asks for a second click, since it deletes the stored file.

**The data.** Table `events` (row-level security: `app.is_officer_of(committee_id)`, which is
the EB alone for a society-wide event), `event_slugs` (every link an event has had; an old link
redirects to the current one), public bucket `event-media` (`<event id>/<random>.jpg`, written by
the event's editors; the picture is shrunk to 1600 px in the browser). Visitors read
`rpc/events_public()` only: published events with their committee, when each is over and its
term. The link is made from the title and the start's year (`world-health-day-2027`), never
`archive`, never one any event has had. A change to a published event, or publishing or
withdrawing one, asks for a rebuild; a draft does not.

**The build.** `scripts/prerender.mjs` fetches the events once: it pre-renders `/events`,
`/events/archive` and one page per event (with its picture as the share card and schema.org
`Event` data), lists them in `sitemap.xml` and `llms.txt`, and writes each event's calendar
file to `/events/<link>.ics`, which the Add to calendar button opens (a phone then offers to
add it). An event published after the last build has no file yet; its link falls through to
the app, which makes the same file in the browser and downloads it.

**Checks.** `npm test`; `npm run walk:portal-sample -- light,dark 375,1440 /events` (with
`MSYS_NO_PATHCONV=1` in Git Bash), the same for `/portal/events` and `/committees/scoph`; the
sample walk has six sample events (three coming up, one of them over multiple days, an all-day
draft, two over). The header was measured with Events in it at 1024, 1100, 1280, 1366, 1440 and
1920 px. Between 1024 and 1279 px its gaps are narrower and the magazine pill says "Magazine".

**The header since the design pass (October 2026).** The green button reads "Check membership"
(it opens the membership lookup, and as "Members" it read as the way in to the portal), in the
bar, the phone menu and the footer; the page's own title is still "Members". The longer label
needed room, so the steps of the bar moved (`src/components/Navbar.jsx`; the note above
`MAGAZINE_CTA` there says it was measured at every width from 1024 to 2560 px): the magazine
pill says "AUSSS Magazine" from 1280 px and its long wording from 1600 px (it was 1440 px), the
bar keeps the tablet's side padding up to 1099 px, and the larger type, pills and logo start at
1920 px (it was 1536 px). The Magazine and Check membership pills show a blue ring on their own
page. On a phone the menu hangs under the bar and fades in; Escape closes it.

## 29. The term rollover and the gallery archive (Phase 7, step 1)

Built 2026-10-08. Migration `20261008120001_term_rollover`, pgTAP file `330-term-rollover.sql`
(and five lines in `090-grants.sql`), unit tests `src/lib/gallery.test.js` and
`src/portal/rollover.test.js`.

**The page.** **New term** in the portal (`/portal/admin/rollover`, the Executive Board only;
it has no link in the header, since it is used once a year: the way in is the **New term**
button at the foot of **Site settings**) shows, in order, what the switch will do, then does all of it at once with one button, once the new term's name has been typed to confirm:

1. **The new term**: its name and its first and last days, filled in as the year after the
   current term (`2027-28`, 1 September 2027 to 31 August 2028). Any day can be chosen, so an
   early handover in the summer is fine; the switch happens when the button is pressed.
2. **Officers and the board**: every officer's, board and webmaster position stays with its
   work account (section 14, "Access belongs to the work emails"). Nobody is invited on a
   personal email: the incoming officer is handed the work account. The page marks each position
   "Keeps it" (the work account exists), "From its first sign-in" (the address has no account
   yet) or "No work email" (nobody holds it until one is set on the Roster page and the address
   is invited). Change a work email before the switch and the new address is the one carried.
3. **Members and assistants**: the positions the roster lists below officer are given again for
   the new term (the roster says who holds them), to the account the roster row is linked to, or
   to the row's email when it is not linked. Retired positions are skipped. A position given by an invite that the roster
   does not list ends with the old term; the page names each one, and the committee hands it out
   again on its Invites tab if it should continue.
4. **Tasks**: every open task (to do, doing, blocked) moves into the new term as it is; done
   tasks stay with the term they were done in. This is the only time a task's term changes.
5. **Gallery**: the albums still in the gallery, all ticked. Ticked albums move to the gallery
   archive under the term that is ending. The storage used is shown against the free plan's 1 GB.
6. **Switch**: the term changes, the old term's assignments end (dated today, in Cairo), the old
   term's offers of positions that nobody took up are withdrawn (a first sign-in would otherwise
   still turn them into positions of a term that is over), and the public pages are asked to
   rebuild. The society's age on the site moves on with the term (the `{years}` and
   `{anniversary}` placeholders of section 27), with nothing to edit.

**Starting takes three deliberate steps.** The button (**Start 2027-28**) stays off until the
new term's name is typed in the box above it, exactly as part 1 has it and with an ordinary
hyphen (a long dash, which some phones put in, is refused). A line under the button says why it
is off: part 1 is not ready, nobody on the board would keep their access, or the name is not
typed yet or is not the same. The button then asks for a second click ("Click again to start
2027-28 now"), and "This cannot be undone." stands beside it. If the switch gets no answer,
the page says it cannot tell whether the new term started: reload to see which term is current
before trying again.

It refuses to start when nobody would keep the board's access: no board or webmaster position
whose work account exists. Without that check a rollover could leave a society that only the
service key could put right. The page says so and keeps the button off; the fix is to set the
board's work emails and sign in once with one of those accounts.

It leaves alone: membership statuses (the board grants those on the Upgrades panel, never
automatically), posts (expired ones are already hidden), and the seats and secrets of HANDOVER
section 6. Everything happens in one transaction: if any part fails, nothing changes.

**The gallery archive.** An archived album leaves `/gallery` and appears in `/gallery/archive`,
under a heading per term, newest first. Its own page, `/gallery/<link>`, keeps working: it shows
its term above the title and links back to the archive. `/gallery` links to the archive when
there is one, and says so when the new term has no albums yet. In the portal's gallery editor,
archived albums are listed below the shelf by term; **Archive** moves one album there by hand
(filed under the current term) and **Back to the gallery** returns one; a line with **Undo**
follows either move. No photo is shrunk or
moved: archiving is one column, `albums.archived_term_id` (and `archived_at`, set by the
database). `rpc/gallery_public()` returns every published album with its `term` (null while it is
in the gallery). The link `archive` is the archive's own: a new album titled "Archive" gets
`archive-2`, and renaming one to it is refused.

**Storage.** On 2026-10-08 the gallery held 258 photos in 8 albums, 56 MB (each photo is two
files: about 190 KB at 1600 px and 40 KB at 600 px). At that pace the free plan's 1 GB lasts
about nine terms, so the archive keeps the photos as they are. The page turns its storage line
amber past 600 MB; that is the time to build what the roadmap first planned (re-saving archived
photos in a smaller format, and a copy of each term's photos on the society Drive). The nightly
backup already copies the whole bucket (section 20).

**Also in this migration.** `app.slugify` now trims hyphens after cutting a link at 60
characters, so a title cut just after a hyphen no longer makes a link the albums table refuses.

**Checks.** `npm test`; `npm run walk:portal-sample -- light,dark 375,1440 /portal/admin/rollover`
(with `MSYS_NO_PATHCONV=1` in Git Bash), the same for `/gallery` (the index, the archive and an
archived album) and `/portal/gallery`. The sample walk has five gallery albums, three of them
archived over two terms, and a rollover preview with each kind of position.

## 30. The exchange exam (Phase 8)

Built 2026-10-10 and merged on 2026-10-11 (pull request 20); db-deploy applied the two migrations
to the hosted database at the merge. Migrations `20261010120001_exchange_exam` and `20261010120002_exam_rollover`,
pgTAP file `340-exchange-exam.sql` (and new lines in `330-term-rollover.sql` and `090-grants.sql`),
unit tests in `src/exam/` and in `src/portal/examFile.test.js` and `src/portal/examStats.test.js`,
and the scripted rehearsal `scripts/exam-rehearsal.mjs` with its workflow `exam-rehearsal.yml`.

**What it is.** The exchange team's exam, sat on the site. About 400 registered students sit it on
their own phones in a hall. A student opens a hidden address, `/exam/<word>`, signs in with Google
and gives a name, year, phone and student ID. They can start only when that ID is on the list the
officers uploaded and they type the start code that is read out in the hall. The paper is ten
questions a page. Each student gets the questions, and each question's options, in an order of
their own. Each question has a flag, and a review screen lists what is unanswered or flagged before
the hand-in. Every answer is saved the moment it is chosen and is also kept on the phone. The
database marks the papers. A student never sees a grade or which answers were right: after the
hand-in the page says "Your exam was received." and nothing more. The SCOPE and SCORE officers and
the Executive Board (below, "the exam officers") set the exam up and read the results on the
portal's **Exam** page.

**Each student has a clock of their own.** A student has the exam's full length from the moment
they start, on a clock the database keeps. The exam is not sat in step. **Opens** and **Closes**
only say when a student may start: a paper started one minute before closing still runs its full
length, and its answers are saved after the closing time until its own time is up. The plan's first
text said otherwise; the status paragraph of Phase 8 in `docs/PORTAL_BACKEND_PLAN.md` lists where
the build differs from it.

**Where the code lives.**

- `src/exam/`: the students' pages, a tree of their own with no `AuthProvider`, no portal layout
  and no react-query. `ExamRoot.jsx` holds the routes, `ExamDoor.jsx` the whole flow at one
  address, `ExamCallback.jsx` the page that sign-in returns to, and `screens/` one file for each
  screen. `examApi.js` is the only file that calls the database. `examFlow.js` decides which screen
  shows and holds every sentence. `sitting.js` holds the rules of a sitting (pages, answers waiting
  to be sent, the clock, the retry times), `useSitting.js` gives them the network, the phone's
  storage and timers, and `tabLock.js` keeps a sitting to one tab.
- `src/portal/pages/exam/`: the portal's Exam page. `ExamsPage.jsx` is the list of exams,
  `ExamPage.jsx` one exam, and each tab is a panel (`SetupPanel`, `QuestionsPanel`,
  `RegisteredPanel`, `ResultsPanel` with `AttemptSheet`, `OverviewPanel`). Beside them in
  `src/portal/`: `examQueries.js` and `examResultQueries.js` (the reads and writes), `examFile.js`
  (reading a spreadsheet or a pasted list) and `examStats.js` (the arithmetic).
- `src/portal/pages/admin/RolloverPage.jsx`: the Exam part of New term.
- `src/App.jsx` (the route `/exam/*`), `src/main.jsx` (no analytics for `/exam/…`),
  `vercel.json` (the headers for `/exam/(.*)`) and `supabase/config.toml` (the three callback
  addresses, and `enable_confirmations`).

**The data.** Six new tables in `public`, one in `app` and one new column. Row-level security is on
for all of them. On the six exam tables the policies name the exam officers only
(`app.is_exam_officer()`: the EB, which includes the webmaster, and the officers of the committees
`scope` and `score`), so a student's account matches no policy on any of them.

- `profiles.student_id`: the ID as the student typed it. Only `rpc/exam_save_details` writes it;
  the owner of a profile cannot update it directly.
- `exams`: one exam. Its title, `address_word` (the hidden last part of the address), `status`
  (`draft` or `ready`), `opens_at` and `closes_at` (the window in which a student may start),
  `minutes` (the length, 5 to 600, 120 until changed), `start_code`, and the term it was made in.
- `exam_questions`: the questions in the officers' order, each with 2 to 6 options and
  `keep_option_order`.
- `exam_key`: the right option of each question, in a table of its own, so that nothing that reads
  a question can carry the answer along.
- `exam_registrations`: the student IDs that may sit, and the account that holds each
  (`profile_id`, `claimed_at`). `student_key` is the ID tidied, which is what is compared.
- `exam_attempts`: one paper for each student in an exam: when it started, when it was handed in,
  and that student's order of the questions and of each question's options.
- `exam_answers`: one row for each question a student answered or flagged.
- `app.exam_tries`: wrong student IDs and wrong start codes, kept only to limit them. No API role
  reads it.

No grade is stored. A grade is the count of a paper's answers that match the key, counted each time
the officers read it, and a paper is over when it was handed in or its time has passed. So a
corrected right answer or a longer exam needs no re-marking: the next read is different.

A student's account reaches its own rows through five functions and nothing else: `exam_door` (what
to show), `exam_save_details` (the four details, and the check against the list), `exam_start` (the
start code), `exam_paper` (the questions in this student's order, without the key) and `exam_save`
(the answers, the hand-in, and an empty call that only asks how much time is left). The officers
have nine, each refused with "Only the exchange officers and the Executive Board can do this." for
anyone else: `save_exam_question`, `import_exam_questions`, `exam_add_registrations`,
`exam_release_registration`, `exam_registration_list`, `exam_results`, `exam_sheet`,
`exam_question_stats` and `exam_delete_attempt`. A visitor who is not signed in can call none of
the fourteen. The helpers are in the schema `app`: `tidy_student_id`, `is_exam_officer`,
`exam_deadline` (the start plus the length), `exam_by_word` and `clear_exam_rows` (the
rollover's).

**Who may do what.**

- The exam officers read the six exam tables. They write an exam's own row directly (title, word,
  status, times, length, start code), put the questions in order, and remove a question, an ID or
  the whole exam. The wording of a question, its right answer and new IDs go through the
  functions, which check them.
- A student reads and saves their own details, learns whether their own ID is on the list, starts,
  reads their own paper and saves their own answers. Nothing else, and never the key, a grade, the
  list or anyone else's paper.
- Anyone else in the portal who types `/portal/exam` gets a polite refusal, and the database
  returns them no row.
- The audit log records changes to exams, questions and the key. The list, the papers and the
  answers are left out of it on purpose: they are deleted when the term ends, and the log would
  keep the student IDs and the answers after that. Two actions on them still write one slim row
  each, with no student ID and no answer in it: releasing an ID (`RELEASE` on
  `exam_registrations`) and deleting a paper (`DELETE` on `exam_attempts`). The webmaster's
  Audit log page lists them as "Released" under Exam registered IDs and "Removed" under Exam
  papers, each with the exam and the account it was about.

**Setting an exam up.** In the portal, **Exam** in the header (`/portal/exam`), which the exam
officers see.

1. Under **New exam**, type a title and press **Add exam**. The exam starts as a draft, which
   students cannot reach, with a random word of twelve characters in its address. Its page has five
   tabs: Set-up, Questions, Registered list, Results and Overview. The open tab is in the
   address (`?tab=questions`, `list`, `results` or `overview`; Set-up is the plain address), and
   choosing a tab adds nothing to the browser's Back.
2. **Questions.** Add them one at a time (the text, 2 to 6 options, which one is right) or press
   **Import from a spreadsheet**. The file is `.xlsx` or `.csv` with the columns Question, Option A
   to Option F, Answer and Keep order; **Download a template** gives the header and two examples.
   Answer is the right option's letter, its number or its exact text. One file holds at most 500
   questions. Nothing is imported unless every row is good, and a bad row is named with its number
   and the reason. Tick "Keep the options in this order" (in a file, "yes" under Keep order) for a
   question whose last option is "All of the above": its options are then not shuffled. Drag a
   question by its handle to move it. Several questions can be open for editing at once;
   Cancel on a changed one asks "Discard changes", and an option taken out with words in it
   can be brought back with Undo.
3. **Registered list.** Add the student IDs (the next part).
4. **Set-up**, under **The exam**: set **Opens** and **Closes** (Cairo time) and **Length in
   minutes**, then **Save**. The note beside them says when the last paper can end.
5. **Start code.** Type one, or press **Make a code** for six letters and digits with no 0, O, 1 or
   I, then **Save**. Capitals and spaces make no difference. It can wait until the day; without a
   code nobody can start.
6. Switch **Open to students** on. The database refuses this until both times are set. From then on
   the address works: a student can sign in, fill in their details and check their ID. Starting
   still needs the opening time to have come, and the start code.
7. Copy the address from **The address** and send it to the registered students.

The panel **Before students can start** lists what is still missing: questions, IDs on the list,
the two times, the start code, and being open to students. The chip beside the exam's title reads
"Draft", "Open to students", "Closed to new starts" (the closing time has passed and a paper may
still be running) or "Closed".

**The list of student IDs.** Registration happens outside the site. On the **Registered list** tab
the officers paste the IDs (one on each line; commas, semicolons and tabs also separate them) or
press **Add from a file**, which reads the first column of an `.xlsx` or `.csv` (a first cell with
no digit is taken as a heading). One go takes at most 5000 IDs. The page then says what happened,
for example "Added 396. 3 were already on the list. 1 was not an ID." When part of a list does not
look like student IDs (a heading or a column of names pasted along), nothing is added until the
officer chooses **Add the other N** or **Add all N as they are**.

IDs are compared after tidying (`app.tidy_student_id`). Arabic-Indic, Persian and full-width digits
are read as Western ones; spaces, hyphens and dashes, dots, underscores, slashes and characters
that cannot be seen are dropped; letters go to upper case. So `2023-1234`, `2023 1234` and
`٢٠٢٣١٢٣٤` are one ID, and a typing habit locks nobody out.

One account holds each ID. A student holds their ID from the moment they save their details and it
matches, not from the start, so a clash shows before the day. A second account that gives the same
ID is told it is in use, and an account cannot change its ID once it holds one. The list shows who
holds each ID (the name and the Google address) and who has started, with the counts **On the
list**, **Held** and **Started**, a search by ID, name or email, and PDF and CSV exports.
**Remove** takes an ID off the list and **Release** frees it from the account that holds it. Both
ask for a second click, and both are refused once that student has started. No student can read
the list: each learns only whether their own ID is on it.

**The hidden address, and why hiding is not the lock.** The address is
`https://ausss-ainshams.org/exam/<word>`. The word is 6 to 60 lower-case letters, digits or
hyphens, never `callback`, and no two exams share one. It is kept in the database
(`exams.address_word`), because the site's code is public and a word written in the code would not
stay hidden. The officers can change it on the Set-up tab until the first student starts (**Make a
new word**); the old address then stops working. Hidden means: nothing on the site or in the portal
links to it (the Set-up tab shows it as text to copy), it is in no sitemap, `llms.txt` or
pre-rendered page, `ExamRoot.jsx` adds `<meta name="robots" content="noindex, nofollow">` while an
exam page is on screen, `vercel.json` sends `X-Robots-Tag: noindex, nofollow` and
`Cache-Control: no-store` for `/exam/(.*)`, and `src/main.jsx` keeps views of `/exam/…` out of
Vercel Web Analytics, where the word would otherwise be listed as a page. It is left out of
`public/robots.txt` on purpose: a crawler that may not fetch a page cannot read its noindex. A draft, a deleted exam and a mistyped
word all look the same from outside: "There is no exam at this address."

Hiding only keeps passers-by away, and an address sent to 400 students gets passed on. The locks
are the list of student IDs and the start code. The database checks both, no student's account can
read either, and wrong tries are limited. Someone with the address and no listed ID gets as far as
the details form. Someone with a listed ID who is not in the hall has no start code.

**Before the day.** Send the address a few days ahead and ask every student to do three things
then, not in the hall: open it in Chrome or Safari, sign in with the Google account they will use
on the day, and fill in the form (full name, year, phone, student ID) and press **Save and check
my ID**. A student whose ID matches sees "You are on the list." and when the exam opens. There are
two reasons. A mistyped ID shows early, as "That student ID is not on the list for this exam.", and
the hall does not begin with 400 first sign-ins at once.

- A link opened inside Facebook, Messenger or Instagram cannot sign in, because Google refuses
  those built-in browsers. The sign-in card then says "If Google will not open, open this page in
  Chrome or Safari."
- Watch **Held** climb towards **On the list** on the Registered list tab, and read the names and
  addresses of the holders. Any account that has the address and gives a listed ID holds it, so an
  ID held by a name the officers do not know is a student on the wrong account or somebody who
  should not have it. **Release** it.
- "That student ID is already in use by another account." on a student's phone: search the list
  for the ID and see who holds it.
- The webmaster's checklist below comes first. Until the callback address is on the hosted
  redirect list, signing in from the exam's page lands on the home page.

**On the day.**

- **The start code.** Read it out when the hall is ready. A student on the list types it and
  presses **Start the exam**; the line under the field says how many questions and minutes there
  are. The code can be changed at any moment on the Set-up tab, and a student who has already
  started is never asked for it again. Before the opening time the page says when the exam opens
  and looks again by itself every 30 seconds and at the opening time, so the field appears without
  a refresh.
- **A late hall.** Nothing needs changing. The opening time only lets the start code field appear;
  nobody starts until the code is read out, and each student's time runs from their own start. If
  the closing time would pass before everyone has started, move **Closes** later. It can move
  either way at any time, also while papers are running, and it never cuts a paper short.
- **What to tell the hall.** If the connection drops, keep answering and do not refresh. Use one
  tab. The bar at the top of the paper says where things stand: "All answers saved", "Saving…" or
  "No connection: 3 answers waiting. Keep going, they are kept on this phone." Waiting answers go
  out when the connection is back: the page tries again after 2, 5 and 10 seconds, then every 15,
  and at once when the phone says it is online. A refresh loses no answer, but with no connection
  the page itself cannot load again, because it is never served from the phone's cache.
- **A second tab.** A sitting is kept to one tab of a browser. A second tab says "This exam is
  open in another tab" and offers **Use this tab**; the first tab then stops.
- **A student on the wrong account.** Their ID is held by the account they signed in with first,
  and the right account is told the ID is in use. On the Registered list tab find the ID and press
  **Release**, twice. The student presses "Not you? Sign out", signs in with the right account and
  saves their details again. Once the wrong account has started, Release is refused with "This
  student has already started the exam."; delete its paper first (below).
- **A phone that died.** The student opens the address on another phone, or on the same one once
  it is charged, and signs in with the same Google account. The paper opens where it stood, with
  every answer that had reached the database, and no start code is asked. The clock did not stop
  meanwhile. Answers that were still waiting on the dead phone go out if that phone opens the page
  again before the student's time is up. The student should then carry on with one phone only: two
  phones on one account both save, and the later save wins.
- **Deleting a paper.** On the Results tab open the student's row and press **Delete this paper**,
  twice. The paper and its answers are gone for good, and the student can start again with the
  start code, with a fresh order and the full length. Their phone goes back to the start code
  screen by itself within a minute. Starting again needs the closing time not to have passed; move
  **Closes** later if it has.
- **Making the exam longer.** On the Set-up tab raise **Length in minutes** and save. Every paper
  gets the extra time. The phones learn the new end within a minute, since each asks the database
  every 60 seconds, and a phone that already showed "Time is up." gets its paper back, because it
  goes on asking once a minute for half an hour and whenever the student returns to the page.
  After the first start the length can go up and never down.
- **The try limits.** Ten student IDs from one account within an hour that are not on the list or
  are held by someone else, and that account is told "Too many tries. Wait an hour, or tell the
  exchange team."; it is locked until its oldest miss is an hour old. Eight wrong start codes from
  one account within ten minutes, and it is told "Too many wrong tries. Wait ten minutes, or ask
  an invigilator."; it can try again when the oldest of the eight is ten minutes old. Nothing in
  the portal lifts a lock early, and changing the start code does not lift one either.
- **Watching it.** While students can start, the Registered list, the Results and the Overview
  read the database again every 30 seconds, and the last two go on doing so while anyone is still
  sitting. Each has a **Refresh** button.

After the first start the database refuses a change to the opening time, a shorter length, a
return to draft, a new word in the address, and any question added, removed or reworded. The
Set-up tab lists these under **Once the first student starts**.

**After it.**

- **The ranking** is the Results tab: highest grade first, students on the same grade sharing a
  rank ("=3") and listed by name. Each row has the name, student ID, year, grade out of the number
  of questions, how many were answered, the time taken and the state: "Handed in", "Time ran out"
  or "Still sitting". The search takes a name, an ID, an email or a phone number.
- **One person's paper** opens from their row: their details, grade, time and rank, then every
  question in the officers' order with the right option and the one they chose. A filter shows the
  right, the wrong, the unanswered or the flagged ones only.
- **The Overview** has how many started, handed in, ran out of time and are still sitting, the
  average grade and the average time of the finished papers, the spread of grades in ten bands,
  and the questions most people got wrong, each with how often every option was chosen.
- **Downloads.** **Export PDF** and **Export CSV** on the ranking (with each student's email,
  phone and start and finish times), on the question figures, on the Registered list and on the
  questions (that file holds the right answers); **Export PDF** on one person's paper. A file holds
  what the screen shows, a search included. Download the ranking before New term: the papers do
  not survive it. In the ranking's and the list's files a name, year, address or phone number
  that starts with `=`, `+`, `-` or `@` has a single quote put in front of it (`typedCell` in
  `src/portal/examStats.js`), because a spreadsheet program would otherwise run what a student
  typed as a formula. A phone number such as `+20 100 123 4567` is left as it is.
- **Correcting a right answer.** On the Questions tab press **Correct the answer** on the
  question, choose the right option and press **Save the right answer**. It counts at once for
  every paper, handed in or not: the next read of the results is marked against it.

**What New term deletes and what it keeps.** An exam's list, papers and answers are kept for one
term. New term (section 29) gains a part, **Exam**, shown only when there is something to say: it
names each exam with how many registered IDs and papers will be deleted and links to its results.
The switch then deletes the papers with their answers, the registered list and the wrong tries
(`app.clear_exam_rows`), for every exam of the ending term and for any exam of an earlier term that
holds such rows again, and the page says how many went. Download the results first: nothing in the
portal brings them back.

It keeps the exam itself, its questions and its key, so the officers can set the same exam for the
next year's students. A cleared exam has no paper, so its times, its word and its questions can
change again. It still names the term it was made in (`exams.term_id` never changes), and its new
list and papers go at the next rollover all the same. It also keeps the students' accounts and
their profiles, the student ID included, and the rows the audit log already holds for those
profiles (the webmaster reads them at `/portal/admin/audit`). The nightly backups keep their
copies of the deleted rows for 90 days more (section 20).

**What only the webmaster can do.** Three jobs in dashboards and one in the hall. None of them is
in the repository, so merging the branch does none of them.

- [ ] **The callback addresses.** Supabase > Authentication > URL configuration: add
      `https://ausss-ainshams.org/exam/callback`, `http://localhost:5173/exam/callback` and
      `http://localhost:4173/exam/callback` to the redirect list, exactly as written, at the same
      visit that removes the wildcard lines of section 22. Do it before students get the address:
      until then Google sign-in from the exam's page lands on the home page.
      `supabase/config.toml` already holds the three, but do not send them with
      `npm run db:config-push` (section 5) while that file still names the lines section 22
      removes, because the push would put those back. The exam needs no line for
      `www.ausss-ainshams.org` or `ausss-ainshams.vercel.app`: Vercel sends both on to
      `ausss-ainshams.org` before a page loads (a 308, checked on 2026-10-10), so the address an
      officer copies from the Set-up tab is always the domain's own. If either ever serves the
      site itself, it needs its own `/exam/callback` line.
- [ ] **Confirm email.** Supabase > Authentication > Sign In / Providers > Email: switch
      **Confirm email** on (`enable_confirmations = true` in `supabase/config.toml`, changed on
      2026-10-10; the dashboard is what counts until a config push). The site signs nobody up
      with a password, but the API takes such a sign-up from anyone, and with the switch off it
      hands a session at once to an address that does not exist. Any signed-in account that has
      the exam's address can give a student ID and hold it, so a script could take the list's IDs
      with made-up accounts, and each real student would be told the ID is in use until an
      officer released it. With the switch on an address must receive an email before it gets a
      session, and that email is rate-limited. Google sign-in does not change. One thing does: a
      member's first sign-in by email link gets the "Confirm signup" email and not the "Magic
      Link" one; its link signs them in all the same, so read that template once. It does not
      stop somebody with real mailboxes, which is why the officers still read the holders' names
      before the day.
- [ ] **The token refresh limit.** Supabase > Authentication > Rate limits: read the figure for
      token refreshes and write it down. The default is 150 in five minutes from one network
      address (`token_refresh` in `supabase/config.toml`). A sign-in is renewed every hour, so 400
      phones on one hall Wi-Fi that open the exam in the same few minutes would pass it, and some
      would be shown as signed out. Phones on mobile data each have an address of their own and do
      not meet it. Before the day, raise it above the number of students on the list with room to
      spare; after the exam, put the old figure back. A student who is signed out mid-exam sees
      "You were signed out. Sign in again with the same Google account. Your answers are kept on
      this phone." and carries on after signing in.
- [ ] **A sitting in the hall with a test group.** The hall's own network is the part no script
      can show. Make a mock exam of a few questions, put the testers' IDs on its list, and have
      them sit it in the hall on the hall's Wi-Fi, on iPhones and on Android phones. Have some of
      them switch the Wi-Fi off for a minute while answering, refresh the page, close the tab and
      open the address again, and move to a second phone. Watch the Results tab fill, check that
      nobody was signed out, and delete the mock exam after.

**The scripted rehearsal.** `scripts/exam-rehearsal.mjs` plays 400 made-up students through a mock
exam of 100 questions over HTTP, as phones would, and compares the database's marking with its
own. It needs a whole local Supabase stack, so it runs on GitHub: on every pull request that
touches `supabase/**`, the script or its workflow, and by hand before an exam at Actions >
exam-rehearsal > Run workflow, where the number of takers, of questions and of takers playing at
a time can be changed, and a seed plays an earlier run's parts again. It refuses any API address
that is not `127.0.0.1` or `localhost`, the job is given no secret, and it deletes what it made.
On a machine with Docker and Node 22 or newer: `supabase start`, then
`supabase status -o env > stack.env`, then `node --env-file=stack.env scripts/exam-rehearsal.mjs`.

What it does: makes the exam, its questions, key and list as the service role; makes the accounts
and one SCOPE officer; plays every taker through the door, the details, the start code, the paper
and the hand-in, some of them with a wrong ID or a wrong code first, a double tap on Start or a
refresh in the middle; leaves a few sitting and moves a few past their deadline; moves the closing
time into the past while papers are still being sat (a running paper must keep its own deadline
and go on saving, and an account that has not started must be told the exam has closed); tries, as
a taker and as a visitor, every read and call that must be refused; then reads the ranking, the
question figures and some papers as the officer and compares every score, rank, state and count
with its own; and last makes, as the officer, the requests the portal's Exam page makes on its
own account (the exam with its three counts, the questions with their key, a question moved and
moved back, and a second exam made from a title alone, filled through the officers' functions,
emptied and deleted), since the set-up as the service role passes row-level security and the
column grants and so proves nothing about them.

Reading its output, which is also the run's summary page:

- The first lines name the stack, the numbers and `SEED=`, then what was set up and made.
- "Played 400 takers. Started: … Handed in: … Left sitting: …" and "On the way in. …" say what the
  takers did. They are the script's own plan, not a finding.
- "Tried N reads, writes and calls that must be refused" and "Compared N papers with the ranking
  …" are the two checks, the second with how long the officer's reads took. "Read and wrote as
  the portal does, as the officer" says the page's own requests went through.
- The table of timings has a row for each of the five functions: calls, median, 95th percentile
  and slowest, in milliseconds as a phone would see them, then calls a second and how many had to
  be sent again. Timings never fail the run. They are a runner's and not the hosted project's, so
  compare one run with another and not with the hall.
- The last line decides: "Result: everything matched." or "Result: N things did not match.",
  followed by a line for each kind of mismatch that names the taker and what was expected. The
  script ends with 0, with 1, or with 2 when it refused to run. The workflow also fails a run that
  ended with 0 without that line, and after a failure it prints the last 200 log lines of the
  stack's API, sign-in, gateway and database containers.

On 2026-10-10 it had run only against a stand-in for the stack, because the build machine has no
Docker. Its first run on a real stack was pull request 20's, on 2026-10-11, and everything
matched: 400 takers and 100 questions, 7,942 requests in 26 seconds. The takers' calls took 35 to
42 ms at the median and 562 ms at the slowest, with 50 takers at a time, and none had to be sent
again. Those figures are a runner's, with the database beside the script; a hall of phones on one
Wi-Fi is slower, which is what the sitting in the hall is for.

**The sample walk.** `npm run walk:portal-sample` (section 21) knows the exam from both sides,
with every database call answered by the script. On the portal it has three sample exams: this
term's, being sat as the walk runs (`ex-1`: 412 IDs on the list, 395 of them held, 387 papers), a
draft (`ex-2`), and last term's, whose list and papers went with its term (`ex-0`). It walks
`/portal/exam`, the five tabs of `ex-1`, a right answer being corrected, one student's paper, the
draft's forms, New term with its Exam part, and the audit log with the entry of a released ID
open. For the students' pages the word in the address
chooses the screen:

| Address | What it shows |
| --- | --- |
| `/exam/sample-sign-in` | The sign-in card, with nobody signed in |
| `/exam/callback?error=access_denied` | A sign-in that was cancelled |
| `/exam/sample-none` | No exam at this address |
| `/exam/sample-unreached` | The database does not answer |
| `/exam/sample-details`, and with `#not-listed` | The details form; an ID that is not on the list |
| `/exam/sample-waiting` | On the list, before the exam opens |
| `/exam/sample-open`, and with `#wrong-code` | The start code; a wrong one |
| `/exam/sample-closed` | On the list, after the closing time |
| `/exam/sample-sitting`, and with `#review` | A paper of 100 questions, 34 of them reached; the review |
| `/exam/sample-hand-in#review` | A hand-in that got no answer |
| `/exam/sample-elsewhere` | The exam open in another tab |
| `/exam/sample-time-up` | The clock has just run out, and the last save gets no answer |
| `/exam/sample-received`, `/exam/sample-timed-out` | Over: handed in, and out of time |

`npm run walk:portal-sample -- light,dark 320,375 /exam` walks the students' pages alone, and the
same with `/portal/exam` walks the portal's (with `MSYS_NO_PATHCONV=1` in Git Bash). A new screen
needs a word in `doors` in the script, and an entry in `acts` when it only shows after a tap.

**The students' pages with no database.** The sample walk is the way to look at them; its
screenshots are in `.page-walk/portal-sample-<time>/<theme>-<width>/`. The sample words work only
inside the walk's own browser, where the script answers for the database. Typed into an ordinary
browser they reach the real database, which has no such exam. For what a screenshot cannot show
(the order answers are sent in, a connection that drops, a hand-in whose answer is lost, the end
of the time), `src/exam/useSitting.test.js` runs a whole sitting against a scripted database
inside `npm test`, with no browser. A sitting against a real database needs the local Supabase
stack, and so Docker, as the scripted rehearsal does.

**What the tests prove.** `supabase/tests/340-exchange-exam.sql` (170 assertions) proves, as real
accounts: an EB member, a SCOPE officer and a SCORE officer can set an exam up, and a SCOPH
officer, a plain member, a student and a visitor cannot; every guard of an exam and each "has
started" refusal, and that the closing time still moves both ways after a start; that an ID is one
ID however it is typed, belongs to the first account that gives it, cannot change once held, and
locks after ten misses; that starting is refused without a held ID, before opening, after closing,
with a wrong code (which makes no paper) and after eight wrong codes; that a paper holds every
question once and a shown position maps back to the officers' option; that a save more than 30
seconds past the deadline saves nothing, and a hand-in ends the paper; each student's own clock (a
paper started a minute before closing has its full length and still saves after closing); the
marking, the ranks, the states and a corrected key; and that a student's account reads no exam
table, cannot call the officers' functions, and gets from `exam_paper` and `exam_save` no key, no
score and nothing that says which answers were right. `330-term-rollover.sql` gains 11 assertions:
the preview lists the exams with their counts, the rollover deletes the papers, the answers, the
list and the wrong tries and says how many went, the exam, its questions, its key and the
student's `student_id` stay, and an exam set again the year after is cleared again.
`090-grants.sql` gains 39: `anon` holds nothing on the six tables and can execute none of the
fourteen functions, and a signed-in account cannot write the key, the list, a paper, an answer, a
question's wording or a profile's student ID directly. All three passed on the build machine,
which runs Postgres 18; `db-ci` proves them on Postgres 17 when the branch is pushed.

`npm test` runs the unit tests: `src/exam/sitting.test.js` and `examFlow.test.js` (paging, the
answers that wait, the clock, every sentence a student can be shown), `useSitting.test.js` (the
whole queue against a scripted database: dropped connections, a lost hand-in, the end of time, a
longer exam), `tabLock.test.js`, `src/portal/examFile.test.js` (reading questions and IDs from
files), `src/portal/examStats.test.js` (the figures, the ranks, when the pages refresh, what a
student typed made safe for a spreadsheet) and `scripts/exam-rehearsal.test.mjs` (the rule that
keeps the rehearsal on `127.0.0.1` or `localhost`, and the tokens it signs).

**Known gaps on 2026-10-10.**

- An exam officer's account can read the key and every paper, and nothing stops such an account
  from sitting the exam too. A student who holds a SCOPE, SCORE or board position must not sit it
  on that account.
- Any signed-in account that has the address can hold a listed ID, and an account costs nothing
  to make. The functions do not ask that the account came from Google: the try limits, "Confirm
  email" (the webmaster's checklist above) and the officers reading the holders' names are what
  stand against somebody taking IDs that are not theirs. Requiring a Google account inside the
  five functions was considered and left out: it needs a new screen for an account without
  Google and changes to the test helpers and the rehearsal's tokens.
- One officer deleting a whole exam while another removes or rewords one of its questions can get
  "deadlock detected" from the database. Nothing is left half done, and trying again works.
- The students' pages were checked in Chromium at 320 px with touch. They have not met a real
  phone, Safari, Firefox or a screen reader. The sitting in the hall is where real phones, and
  Safari on iPhones, are tried.
