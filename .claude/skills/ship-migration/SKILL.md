---
name: ship-migration
description: Ship a Supabase migration for the AUSSS site end to end. Write it, cover it with pgTAP, get db-ci green, apply it to the live database through the Supabase MCP when the user wants it live before merge, rename the file to the version the database recorded, and check the advisors. Run only when the user types /ship-migration.
disable-model-invocation: true
argument-hint: <snake_case_name> <what the change should do>
---

# Ship a migration

Arguments: $ARGUMENTS

This pulls together `docs/RUNBOOK.md` sections 1 and 2, `supabase/README.md` and lessons learnt
on this project. If anything here disagrees with the runbook, the runbook wins: say so to the
user so this file gets fixed.

## 0. Before writing anything

- Never work on `main`. If the current branch belongs to an open PR about something else, ask
  whether the migration rides along or gets its own branch.
- Read the latest migrations that touch the same tables (`grep -l <table> supabase/migrations/*`)
  and the pgTAP file that covers them, and follow what is there.
- Load the `supabase-postgres-best-practices` skill.

## 1. Write it

- `npm run db:new -- <name>` creates `supabase/migrations/<timestamp>_<name>.sql`. Naming by hand
  is fine too: 14-digit UTC timestamp, then `_snake_case_name.sql`.
- Open with a comment in plain English: what it adds or changes, why, and what the site or the
  portal does differently. Recent files show the style.
- Rules that CI enforces or that bite in production:
  - Each file is one transaction on a fresh database, run in filename order, and must re-run
    cleanly: `create ... if not exists`, `create or replace`, `drop ... if exists` before `create`.
  - No enums (`text` plus a `check` constraint). No psql `\` meta-commands.
  - New table: RLS on; explicit `grant`s to `anon` / `authenticated` / `service_role`, which are
    the only grants it gets; `app.set_updated_at()` and `app.audit()` triggers; policies written
    `to authenticated` with `(select app.helper())`, never an inline subselect on an
    RLS-protected table. Add the table to `supabase/tests/090-grants.sql`.
  - New function in `app`, or any security-definer function: `set search_path = ''`, owned by
    `postgres`, `revoke execute ... from public`, then grant only what is needed.
  - Access: officer, Executive Board and webmaster positions reach the portal through their one
    work email (`position_work_emails`). Roster rows are titles and grant nothing.
- Never edit a migration that is on `main` or already applied; write a new one. The
  `guard-migrations` hook refuses edits to files on `main` and asks the user before an edit to a
  committed one.

## 2. Test it

- Add or extend `supabase/tests/NNN-<topic>.sql`, taking the next free number in steps of 10.
  Shape: `begin; select plan(n); ... select * from finish(); rollback;`. Use the helpers
  `tests.create_user`, `tests.assign`, `tests.authenticate_as` and `tests.clear_auth`
  (`310-site-switches.sql` is a short example).
- Cover who may and may not read or write (a plain member, the role that should, `anon`) and any
  side effect of a trigger.
- If JavaScript changed too, run `npm test`.
- This machine has no Docker, so pgTAP and `supabase db lint` run only in `db-ci`.

## 3. Get db-ci green

- Commit, push, and open or update the PR with `gh` (in Git Bash, first
  `export PATH="$PATH:/c/Program Files/GitHub CLI"`).
- Find and watch the run: `gh run list --workflow db-ci.yml --branch <branch> --limit 1 --json databaseId`,
  then `gh run watch <id> --exit-status`.
- Failed with steps: read `gh run view <id> --log-failed`, fix the file (it is not applied yet,
  so the edit is fine; the hook asks the user), push again.
- Failed after about 15 minutes with zero steps and no runner: a GitHub runner outage, not the
  migration. Prove it (`gh api repos/AUSSS-Website/AUSSS-Website-Project/actions/runs/<id>/jobs --jq '.jobs[0] | .conclusion, (.steps|length), .runner_name'`)
  and `gh run rerun <id>`. Never apply or merge on a `db-ci` that did not run.

## 4. Ask the user how it goes live

- **At merge (the default):** the user merges the PR, and `db-deploy` runs `supabase db push`.
  Go to step 8.
- **Now, through the Supabase MCP:** when the user wants it live before merge, for example to
  try the portal against it. Carry on with step 5.

## 5. Apply through the Supabase MCP

- First tell the user in plain words what the migration adds or replaces, and that a
  confirmation prompt will appear. If the SQL has `drop ... if exists` lines, say what each one
  removes; usually nothing yet, since they are there to make the file re-runnable.
- Call `apply_migration` once per file, in filename order: `name` is the part after the
  timestamp (`site_blocks`, not `20261007090001_site_blocks`), and `query` is the file's exact
  contents. Never send the SQL through `execute_sql`: that applies it but records nothing, and
  `db push` would run it again later.
- Check it in a separate, read-only call:
  `select version, name from supabase_migrations.schema_migrations order by version desc limit 5;`
  then spot-check the objects it made (`pg_proc.prosrc`, `pg_policies`, `information_schema`).
- Smoke tests go in a call of their own, never in the same call as DDL. A multi-statement
  `execute_sql` is one transaction, and a `raise` used to report results rolls back everything
  before it. Plain selects are best.
- Never update `supabase_migrations.schema_migrations` by hand.

## 6. Rename the file to the recorded version

- The history row carries the apply time as its version, not the filename's. Rename with
  `git mv supabase/migrations/<old>.sql supabase/migrations/<recorded version>_<name>.sql`.
  Use `git mv` rather than `mv`: it stages the new name, so the guard hook protects it.
- Search for the old file name and version (`grep -rn <old version> docs supabase src scripts`)
  and update every mention.
- Commit, for example "<name> migration carries the version the hosted database recorded", and
  push. `db-ci` runs again.
- Any later fix to this migration goes in a new file, applied by `db-deploy` at merge.

## 7. Check the database

- Run MCP `get_advisors` with `type: security`, then `type: performance`, and compare with
  `docs/RUNBOOK.md` section 1.3: no table with RLS off, no security-definer function exposed in
  `public` beyond the documented RPCs, and no unindexed foreign keys. Fix anything this migration
  caused in a new migration.
- For a new table, confirm `has_table_privilege('anon', 'public.<table>', 'select')` (and for
  `authenticated`) is what was intended.

## 8. After the merge

- `db-deploy` runs on the push to `main`: `gh run list --workflow db-deploy.yml --limit 1 --json databaseId`,
  then `gh run watch <id> --exit-status`. After the MCP path it should find nothing to apply.
- Bring the docs up to date: `docs/RUNBOOK.md` if a procedure changed, the status in
  `docs/PORTAL_BACKEND_PLAN.md`, and the "applied live" line in the portal-backend-plan memory.

## Report back

Tell the user, in plain words: the final file name, what it changes, the test file, the
`db-ci` result with its link, whether it is live and how (MCP now or `db-deploy` at merge),
and what the advisors said.
