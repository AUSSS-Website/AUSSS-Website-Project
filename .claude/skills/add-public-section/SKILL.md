---
name: add-public-section
description: Checklist for adding a new kind of content to the AUSSS site that officers or the EB edit in the portal and visitors see on public pages (a table with row-level security, a public RPC, pre-rendered pages, a portal editor). Use when building one, such as events, the gallery, the magazine or merch were built, or when reviewing one for gaps.
---

# Add a section edited in the portal and shown on the site

The site has gained one of these five times (gallery, magazine, merch, content blocks, events).
Each time the same pieces were needed, and each time one was easy to forget. Events (phase 6,
step 4) is the fullest worked example; its files are named below. Decide first whether the
content is one document (use a content block, RUNBOOK section 25, no new table) or many dated or
ordered records (a table, as below).

## Database (one migration, then /ship-migration)

- [ ] Table with `id`, the content columns, `published`, `created_by`, `created_at`,
      `updated_at`; `check` constraints instead of enums; indexes on every foreign key.
      Example: `supabase/migrations/20261007120001_events.sql`.
- [ ] A `normalize_*` before-trigger (security definer, `search_path = ''`) that trims text,
      makes the slug, pins `created_by` and refuses bad input with `errcode 22023` and a
      sentence the portal can show. If there is a public link, keep its history in a
      `*_slugs` table so old links redirect, and never re-make an untouched slug on edit.
- [ ] `set_updated_at` and `audit` triggers.
- [ ] Rebuild trigger: `app.touch_site()` per statement, or `app.touch_site_row()` with
      `WHEN (new.published ...)` triggers when drafts must not rebuild.
- [ ] Row-level security for `authenticated` only, with `(select app.helper(...))`:
      `app.is_officer_of(committee_id)` (EB alone when null), `app.is_eb()`, or a helper of
      its own. `revoke all ... from anon, authenticated`, then column grants for insert and
      update; `grant all` to `service_role`.
- [ ] Public bucket (if there are pictures): `'<row id>/<random>.jpg'`, insert/delete/select
      policies through a security-definer helper that reads the row by the folder name.
- [ ] Public read: one security-definer `rpc/*_public()` returning a jsonb document of the
      published rows with only what the pages need; `grant execute` to `anon, authenticated`.
- [ ] Ownership, `revoke execute ... from public` and grants for every new function.
- [ ] pgTAP: a new `supabase/tests/NNN-*.sql` (who may and may not write, what anon reads,
      the trigger's refusals, the rebuild) and lines in `090-grants.sql` (bump its plan).
      `200-security-baseline.sql` checks RLS and search paths for you.
- [ ] Ask the `ausss-db-reviewer` agent to review the migration and test before CI.

## Public site

- [ ] Reader `src/lib/<thing>.js`: `fetch*()`, `setBaked*()`, a hook that starts from the baked
      copy, else the browser's cached copy, then the live answer (one shared fetch). Example:
      `src/lib/events.js`.
- [ ] `src/entry-server.jsx`: call `setBaked*()`; `scripts/prerender.mjs`: a `load*()` that
      falls back to an empty list with a warning when the RPC is missing.
- [ ] Pages and routes in `src/App.jsx` (lazy); titles and descriptions shared between the page
      (`usePageTitle`) and `src/seo/pages.js` (one entry per page, JSON-LD, sitemap). Copy follows
      the site's style: sentence case, British spelling, no em dashes.
- [ ] Header and footer links if it is a section of its own; measure the header at 1024, 1280
      and 1440 px (the walks now report anything cut off in a fixed bar).
- [ ] Time, if any, in Cairo time through `src/lib/eventTime.js`.
- [ ] Unit tests for any pure logic (`src/**/*.test.js`, Vitest).

## Portal

- [ ] `src/portal/<thing>Queries.js` (react-query; picture upload with `resizeImage`).
- [ ] List page, editor page, routes in `src/portal/PortalRoot.jsx`, nav link in
      `src/portal/PortalLayout.jsx` for the people who may edit; a tab on the committee editor
      when it belongs to committees. A polite refusal for anyone else; the database decides.
- [ ] Removals go through `ConfirmButton`; a removed row's files are deleted before the row.

## Checking and recording

- [ ] Sample rows in `scripts/portal-sample-walk.mjs` (tables and the public RPC) and the new
      routes in its list; walk light and dark at 320, 375, 1024 and 1440 px
      (`MSYS_NO_PATHCONV=1` in Git Bash for route arguments).
- [ ] `npm test`; `npm run build` (the pre-render must fall back cleanly before the migration is
      live).
- [ ] RUNBOOK section of its own; plan status line; HANDOVER only if rollover or ownership
      changes; a line in the website guide's log (memory).
- [ ] Commit locally; push only at /wrap-up.
