# Supabase (member portal backend)

Everything the hosted project `wjijkqrdaakiwbtdssio` needs lives here: `config.toml`,
imperative migrations in `migrations/`, dev/CI-only fixtures in `seed.sql`, and pgTAP tests
in `tests/`. The design is in `docs/PORTAL_BACKEND_PLAN.md`.

## Local workflow (no Docker)

Nobody on the team runs Docker or psql locally, so the local Supabase stack is never started
here. Migrations are applied straight to the hosted project, in one of two ways:

1. **Supabase MCP server** (preferred in Claude Code): `.mcp.json` points at the project.
   Apply each new file with `apply_migration`, then run `get_advisors` for security and
   performance findings.
2. **CLI `db push`**: needs a personal access token (supabase.com/dashboard/account/tokens)
   and the database password.
   ```sh
   npm run db:link        # once per machine; asks for the DB password
   npm run db:push:dry    # shows which migrations would be applied
   npm run db:push
   npm run db:list        # local vs remote migration status
   ```

All `db:*` scripts run through `scripts/db/supa.mjs`, which loads `.env.local` and
`supabase/.env` into the environment (without overriding variables already set) before
spawning the CLI from `node_modules`. That is what lets `env(NAME)` placeholders in
`config.toml` resolve. Never prefix a database or auth secret with `VITE_`; Vite would ship
it to the browser.

**Every CLI command loads and validates `config.toml` first**, and the CLI refuses an
enabled auth provider with an empty `client_id`. Because `[auth.external.google]` is
enabled via `env(...)`, `npm run db:push`, `db:link`, `db:list` and `db:new` all fail with
`Missing required field in config: auth.external.google.client_id` until
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` are set.
Copy `supabase/.env.example` to `supabase/.env`; any non-empty value works for everything
except `config push`, which is the only command that sends those values to the project.
The GitHub workflows set throwaway placeholders for the same reason.

## Adding a migration

Migration file names are `YYYYMMDDHHMMSS_<snake_case_name>.sql` (14-digit UTC timestamp).
`npm run db:new <name>` creates an empty one; hand-naming is fine too. Rules that keep CI
green:

- Each file runs as **one transaction** on a fresh database, in filename order. Use
  `create ... if not exists` / `create or replace` where possible.
- No `\` psql meta-commands, no enums (`text` + `check` instead; enum values cannot be added
  and used in the same transaction).
- **Grants are explicit, and the only grants.** `auto_expose_new_tables = false` only
  applies to the local stack; the hosted project used to grant `anon`/`authenticated` ALL on
  every new table through default privileges, which made column-level restrictions void.
  Migration `20260919160004_harden_table_grants` removed those defaults and re-issued every
  grant, so a new table gets exactly what its migration says: `grant` what `anon` /
  `authenticated` / `service_role` need, enable RLS, write policies, and add the table to
  `tests/090-grants.sql`. A table without grants is invisible to the Data API.
- Security-definer functions: `set search_path = ''`, owned by `postgres`, execute revoked
  from `public` and granted only to the roles that need it.

## Reference data (terms, committees, positions, invites)

`src/data/society.js` stays the source of truth for the list of committees and officer role
mailboxes (officer-edited page content lives in `committees.page` since Phase 2 and is never
touched by the generator). `scripts/db/gen-reference-data.mjs` turns it into idempotent upserts:

```sh
npm run db:gen-reference
```

It writes a new `migrations/<timestamp>_reference_data.sql` only when the generated SQL
differs from the most recent `*_reference_data.sql` (the timestamped header is ignored in
the comparison). Old generated files stay in history; never edit them by hand. Upsert keys
are `terms.label`, `committees.slug`, `positions.key`, and
`(email_normalized, position_id, term_id)` for invites; uuids are always looked up by
subselect. `committees.page` is seeded as `{}` on purpose.

## Importing the membership roster

The roster comes from `_source/records/membership/updated AUSSS Membership Database.xlsx`
(sheet `Database`). The importer needs the **secret** key (`sb_secret_...`) in `.env.local`
as `SUPABASE_SECRET_KEY`, alongside `VITE_SUPABASE_URL`; it bypasses RLS, so it never goes
anywhere but that gitignored file.

```sh
npm run db:import-roster:dry           # parse only: counts, statuses, duplicate emails
npm run db:import-roster               # upsert roster_entries, then admin_claim_unlinked()
npm run db:import-roster -- --invites  # also create invites from the "Current Position" column
```

`source_key = sha256(normalized name + '|' + normalized email)` with the same `normalize()`
as `src/lib/membership.js`, so re-imports update in place. The status header's
`[As of dd/mm/yyyy]` becomes `import_batch`. After the upsert the script calls
`admin_claim_unlinked()` so members who signed in before the import get linked.

## Tests (pgTAP) and CI

`supabase test db` needs Docker, so pgTAP runs only in GitHub Actions
(`.github/workflows/db-ci.yml`) on every PR or push that touches `supabase/**`:

1. `supabase start -x studio,imgproxy,edge-runtime,logflare,vector` on a fresh runner
   applies every migration in order and then `seed.sql`.
2. `supabase test db --local` runs `tests/*.sql` alphabetically. Each file is
   `begin; select plan(n); ...; select * from finish(); rollback;`.
3. `supabase db lint --local --level error` catches typing errors in functions.

`seed.sql` creates the `pgtap` extension and the `tests` schema of helpers
(`tests.create_user`, `tests.authenticate_as`, `tests.assign`, `tests.roster`,
`tests.invite`, ...). **It is never pushed to the hosted project**: `db push` does not send
seeds unless `--include-seed` is passed, and CI deploys (`db-deploy.yml`) never pass it.

`db-deploy.yml` runs on pushes to `main` that touch `migrations/**`: `link`, `db push
--dry-run`, then `db push`. Require `db-ci` in branch protection so a migration that fails
on a fresh database cannot reach `main`.

`keepalive.yml` reads one row from `terms` daily so the free-tier project is not paused.

## `config push` caveat

`npm run db:config-push` syncs `config.toml` to the hosted project. It **overwrites any
supported setting the file declares**, including template defaults you did not think about,
and running non-interactively skips the confirmation. So:

- keep every section from the `supabase init` template in the file (that is why
  `[auth.email.smtp]` stays present, commented, with the Resend values);
- run `node scripts/db/supa.mjs config diff` first and read it;
- do the first push by hand, in a terminal, and answer the prompts.

Secrets referenced as `env(NAME)` (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`,
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, `RESEND_API_KEY`) go in `supabase/.env`; copy
`supabase/.env.example` to start.

Redirect allow-list: production and localhost are in `additional_redirect_urls`. Vercel
preview URLs match `https://*-ausss-website.vercel.app/portal/callback` (team slug
`ausss-website`); never `https://*.vercel.app/**`, which is an open redirect. Production is
`https://ausss-ainshams.org` (with `www` and the old `ausss-ainshams.vercel.app` also listed).
