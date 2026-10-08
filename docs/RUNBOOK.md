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
GA*), or presses *Not now*, which hides those members until next September. The rule is
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
   token issued on the same panel.
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
(`/portal/admin/rollover`); section 29 says what the page does and why. The full
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
  reason; the browser only sees `error_description` in the callback URL.
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
  wins.
- `sitemap.xml` and `llms.txt`, generated from the same page list. There is no
  `public/sitemap.xml` any more; do not add one back, it would shadow the generated one.

**Adding or changing a public page:** add the route in `src/App.jsx` as before, then add
an entry to `src/seo/pages.js` (path, title, description; optionally an image and the
breadcrumb parent). Keep the title and description identical to what the page passes to
`usePageTitle()`: the table is what crawlers read, the hook is what a visitor sees after
client-side navigation. New committees and albums are picked up by themselves. The
build fails if a listed path does not render a `<main>` (route missing) or is listed
twice.

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
list. The list is `src/portal/SortableList.jsx`, written to be reused wherever a list is
put in order by hand; the magazine shelf still uses its arrow buttons.

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
portal put them in the public Storage bucket `magazine` under `<issue id>/pages/`. A published
edition reaches the site once it has pages or a Canva link.

**Uploading an edition.** The editor picks the PDF; pdf.js (loaded on demand in the portal
only) renders every page to a 1300 px wide JPEG in the browser and uploads it; pages beyond the
new count are removed, so a re-upload replaces the edition cleanly. Page images can also be
picked directly. The **hero page** (the cover in the header, the switcher and the share card)
is chosen by clicking a page; the database clamps it to the page count.

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
refused.

## 18. Submissions: merch orders, exchange stories, the waitlist (Phase 5)

Since 2026-09-25 the last three public forms write to the database instead of Google Apps
Script: the recruitment waitlist on `/join` (`signups`), the exchange story form on
`/exchange/share` (`stories`) and the merch checkout on `/merch/checkout` (`orders`). They are
handled in the portal at `/portal/submissions`: the EB sees all three tabs, the SCOPE and SCORE
officers see Stories (`app.can_triage(kind)`). `orders.gs`, `signups.gs` and `stories.gs` are
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

**Stories on the site.** A story is private until an exchange officer or the EB sets it to
`published`; it then appears under "Exchange stories" on `/exchange/outgoings` and
`/exchange/incomings` (read through `rpc/stories_public()`, published rows and public fields
only, baked into the pre-rendered pages and refreshed live). The officer can tidy the name and
the text the site shows (blank = as submitted; the submission itself is never edited) and tick
*Featured*, which pins the story first with a highlight. Declining or moving it back to
`contacted` takes it off the site at once (the pre-rendered copy updates on the next deploy).

**Triage.** Each row has a status (`orders`: new, contacted, delivered, also set from the Merch page, section 26; `stories`:
new, contacted, published, declined; `signups`: new, contacted, archived) and private notes
(`officer_notes` on orders). Filter chips, a search box and *Export CSV* (the filtered rows,
UTF-8 with BOM, opens in Excel) are on every tab. Only the EB deletes.

**Exports.** Every list of collected data in the portal has *Export PDF* and *Export CSV*
buttons (`src/portal/ExportButtons.jsx`, `exportFile.js`): the three Submissions tabs, a call's
applications (Committees > Open calls), the membership roster (EB), a committee's Members tab,
the verification queue, and an edition's Readers panel. They export the rows on screen,
filters included. The PDF is made in the browser (jsPDF, loaded on demand) with IBM Plex Sans
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
3. Switch it on in Site settings. Visitors see the new addresses on their next page load;
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
  every database call itself, so it shows no real person and cannot write anything. It is
  the quick check for a design change on the portal; long names and titles are in the
  sample on purpose. Arguments are themes, widths and an optional path:
  `npm run walk:portal-sample -- light 320,375 /portal/tasks`. When a portal page gains a
  query, give it a sample row in the script.
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
      and the two `localhost` lines (5173 for `npm run dev`, 4173 for `vite preview`). The
      cost is that sign-in stops working on Vercel preview addresses; test the portal on
      localhost, as now.
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
  themes (Back, back to top, Members), or the `solid` tokens when it is the white pill on
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

**The portal header** has the public navbar's dimensions (the 6rem bar, the logo, the type
and the side padding); the links sit on a row of their own below it, on one line that
scrolls sideways on a phone and wraps from a tablet up.

**The magazine reader's depth** (`Flipbook.jsx`, the `.flipbook` rules in `index.css`):
the gutter shading and the page edges are CSS on the classes the page-flip library puts
on each page (`--simple`, `--left`, `--right`); the edges grow on the side that has been
read (`--stack-left`, `--stack-right`); the shadow of the lifting page is the library's own
(`maxShadowOpacity`). With reduced motion a page turns at once.

**Checking a change to any of this.** `npm run walk -- --contrast` (section 21) must end
with no page scrolling sideways and no low-contrast colour pairs; then look at the
screenshots of the pages touched at 320 and 1920 px in both themes. State on 2026-10-05:
the 37 public pages pass at all six widths in both themes, and so do the 18 portal pages
of `npm run walk:portal-sample`. A signed-in walk of the portal against the real data
(`npm run walk -- --login` first) has not been done yet.

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
   (`src/content/schema.js` documents each). Its `defaults` are what the page shows until
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
  hint and an "On the checkout" switch. Edit in place, drag to reorder, then "Save payment
  methods"; the list is the site setting `merchPaymentMethods`, and until it is first saved the
  checkout uses the copy in `src/data/merchConfig.js`. A new method's id is made from its name
  when it is saved and is permanent, because every order records it. Switch a method off rather
  than removing it while orders may still name it.

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
next date). The new-event form opens on One time, starting now. On the site a multiple-day event
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
the site and the picture, and the **Published** switch shows it to visitors. The side panel shows
the event's card as the site will show it.

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

## 29. The term rollover and the gallery archive (Phase 7, step 1)

Built 2026-10-08. Migration `20261008120001_term_rollover`, pgTAP file `330-term-rollover.sql`
(and five lines in `090-grants.sql`), unit tests `src/lib/gallery.test.js` and
`src/portal/rollover.test.js`.

**The page.** **New term** in the portal (`/portal/admin/rollover`, the Executive Board only)
shows, in order, what the switch will do, then does all of it at once with one button:

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
   rebuild.

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
(filed under the current term) and **Back to the gallery** returns one. No photo is shrunk or
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
