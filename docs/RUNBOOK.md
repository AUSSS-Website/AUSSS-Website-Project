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

EB members and committee officers can also do this from the portal in a later
phase; in Phase 1 an EB user could insert the invite through the Data API
(RLS `can_manage_position` allows it), but there is no page for it yet.

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

Full checklist including seats and secrets is HANDOVER section 6. The SQL, run
as `postgres` in the SQL editor or via MCP `execute_sql`, in this order:

```sql
-- 1. Create the next term (skip if the reference-data migration already did).
insert into public.terms (label, starts_on, ends_on, is_current)
values ('2027-28', '2027-09-01', '2028-08-31', false)
on conflict (label) do nothing;

-- 2. Switch the current term. Two-step inside the function, so the partial
--    unique index terms_one_current is never violated.
select public.set_current_term((select id from public.terms where label = '2027-28'));
-- As postgres this bypasses the EB check; if it raises because auth.uid() is
-- null, do the two steps by hand:
--   update public.terms set is_current = false where is_current;
--   update public.terms set is_current = true where label = '2027-28';

-- 3. End every active assignment from the old term.
update public.assignments
set status = 'ended', ended_on = current_date
where term_id = (select id from public.terms where label = '2026-27')
  and status = 'active';

-- 4. Invite the incoming officers and EB for the new term (section 8), one
--    row per person and position. app.current_term_id() now returns the new term.
insert into public.invites (email, position_id, term_id)
select v.email, p.id, app.current_term_id()
from (values
  ('president@example.com',  'eb.president'),
  ('webmaster@example.com',  'society.webmaster'),
  ('lore@example.com',       'score.lore')
) as v(email, key)
join public.positions p on p.key = v.key
on conflict (email_normalized, position_id, term_id) do nothing;

-- 5. Verify.
select label, is_current from public.terms order by starts_on;
select count(*) from public.assignments a join public.terms t on t.id = a.term_id
where t.is_current and a.status = 'active';
```

The portal, the assignment queries and every `app.*` helper read
`app.current_term_id()`, so the switch is immediate for signed-in users on their
next request. Until Phase 2, also update `src/data/society.js` and the
`officers.gs` `Accounts` sheet for the public site.

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
  `connect-src`; `vercel.json`, `netlify.toml` and `public/_headers` must all
  list `https://wjijkqrdaakiwbtdssio.supabase.co` and `wss://...`.
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
cards are additionally gated by `callsLiveEnabled` in
`src/data/officersConfig.js` (off while the joining flow is unsettled; officers
can still prepare calls in the portal).

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

The position reaches the portal by itself (`app.sync_roster_position`): a standing
invite on the roster email, so an assignment at once if the member has an account and at
their first sign-in otherwise. Changing it withdraws the old invite and ends the old
assignment. No email on the roster: the title shows, nothing reaches an account.

The list of positions is data, not code: **Position types** on the Roster page lets the
EB add, rename or retire them per committee (the database makes the `key`; a retired
position stays on its holders and stops being offered; Local Member cannot be retired).
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
