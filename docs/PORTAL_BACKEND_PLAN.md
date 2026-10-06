# AUSSS Member Portal: long-term backend plan

Status: approved 2026-09-04, decisions recorded in section 13. Phase 0 and Phase 1 implemented 2026-09-13 (schema in `supabase/migrations`, portal at `/portal`; operations in `docs/RUNBOOK.md`, ownership in `docs/HANDOVER.md`). Phase 2 implemented 2026-09-19: site settings, committee page editor and Open Calls run on Supabase, `officers.gs` is no longer called by production (RUNBOOK section 12). Phase 5 completed 2026-09-25: gallery and magazine editors, magazine counters, and the last three public forms (sign-ups, stories, orders) on Supabase; no Apps Script web app is called by production (RUNBOOK sections 16 to 18). The remaining work was reordered on 2026-10-04, when fifteen requests from the webmaster joined it: phases 5a to 5d, then 6 and 7, in build order in section 12.2, with section 12.4 showing where each task moved. Companion documents: `apps-script/MIGRATION.md`
(the current backend and its account move) and `apps-script/officers.README.md`
(the officer editor as it exists today).

## 1. The recommendation in one paragraph

Adopt **Supabase** (managed Postgres, auth, row-level security, file storage,
edge functions) as the single system of record, keep the site a static Vite
SPA on Vercel, and retire the six Google Apps Script web apps one at a time
behind config switches. Sign-in is **Google or email magic link, never
passwords**. Every piece of content that today lives in `src/data/*.js` or a
Google Sheet becomes a table with an editing screen inside the site under
`/portal`, gated by roles that derive from a person's *position in a term*.
The public site keeps a build-time snapshot of published content so it never
goes blank if the backend is paused or down. Ownership of every account moves
to society-held credentials with two named owners, and a term-rollover wizard
makes the annual handover a button, not a rebuild.

## 2. Where we are, and why it cannot carry a portal

The current backend works for what it was built for: a few officers editing
their committee page, and forms that land in Sheets. It was never designed for
hundreds of members with their own accounts.

| Constraint today | Why it blocks the portal |
| --- | --- |
| Six separate Apps Script deployments, each with its own `/exec` URL and Script Properties | Sessions only validate inside the script that issued them, so every feature that needs login has to be crammed into `officers.gs` (already 1,220 lines, and the home of Open Calls for exactly this reason). |
| Google Sheets as the database | No transactions, joins or indexes, a 10M-cell cap, `LockService` contention. Per-member tasks and read receipts would be full-sheet scans on every request. |
| Cross-origin POST replies are unreadable, so writes use a nonce plus polling `?action=claim` | Every write costs 2 to 4 round trips and 1 to 3 seconds. Fine for one officer, painful for a task board. |
| Sessions and settings live in Script Properties (9 KB per value, 500 KB total) | Cannot hold sessions for 600 people. |
| Passwords hashed with plain SHA-256 plus salt, set by an admin, no self-service reset | Not acceptable for a member-facing login with personal data behind it. |
| Mail via `MailApp` on a consumer Gmail account: about 100 recipients per day | A single announcement to the roster exhausts the day's quota. |
| Roster shipped to the browser as a hashed lookup table (`members.generated.js`) | Only answers "am I on the list", never accounts, positions, or history. |
| Everything owned by a rotating role account | The account migration in `MIGRATION.md` is still mid-flight. The same handover risk applies to any new platform unless ownership is designed in from the start. |

None of these are bugs to fix. They are the shape of the tool.

## 3. Options considered

| Option | Cost at our scale | Auth and permissions | Ops burden | Verdict |
| --- | --- | --- | --- | --- |
| **Supabase** (Postgres, Auth, RLS, Storage, Edge Functions) | Free tier: 500 MB database, 1 GB storage, 50k monthly active users, 500k function calls. Pro is $25/mo. | Built in. Google and magic-link sign-in. Permissions are SQL policies that live next to the data. | Low. No server. Schema lives in git as migrations. Open source and self-hostable if ever needed. | **Recommended.** |
| Firebase (Firestore, Auth, Functions) | Spark is free for Firestore and Auth. Since February 2026, Storage needs a linked billing account. | Built in, but rules are a separate language and NoSQL makes "tasks for position X in term Y" awkward. | Low. | Good second choice. The portal's data is relational, and there is no self-host exit. |
| PocketBase on a small VPS | About $5/mo. | Built in, single binary with an admin UI. | Medium: someone must own a server, patch it, and back it up. | Wrong fit for a society whose people rotate yearly. |
| Extend Apps Script and Sheets | $0 | Hand-rolled, and stays hand-rolled. | Low per deploy, high per feature. | No. See section 2. |
| Custom Node API plus Postgres | Hosting from about $7/mo. | Everything written by us. | Highest. | No. |

The deciding factor is sustainability: the next webmaster should inherit a
schema in git, a hosted dashboard, and a stack that is widely documented. That
narrows it to Supabase or Firebase, and the portal's data is relational.

Two caveats with Supabase, both manageable:

- **Free projects pause after 7 days without database activity.** Daily public
  visitors reading content through the API normally keep it alive, and a
  scheduled ping from GitHub Actions makes it certain. The honest long-term
  answer is the $25/mo Pro plan once the portal is in daily use, treated like
  any other society subscription. The static snapshot (section 6) means a
  pause could never blank the public site either way.
- **No point-in-time recovery on the free tier.** We take our own nightly
  dumps (section 10).

## 4. Target architecture

```
Browser (React SPA on Vercel, static)
  |  supabase-js over HTTPS, JWT issued by Supabase Auth
  v
Supabase project (owned by the society)
  Postgres ........ tables, views, RLS policies, pg_cron schedules
  Auth ............ Google OAuth + magic link, no passwords
  Storage ......... buckets: public media, private receipts and task files
  Edge Functions .. send-email (Resend), roster-import, digest, term-rollover
  |
  +--> Resend (transactional email, 3,000/mo and 100/day free)
  +--> GitHub Actions: nightly backup, content snapshot, keep-alive ping
  +--> Vercel deploy hook, fired when public content is published
```

Google Sheets can stay in officers' lives if they ask: a scheduled export can
write read-only Sheets for orders, applications and signups. Decision 6 defers
this until someone needs it; every portal list gets a spreadsheet download
instead. If a mirror is built, the Sheet is a mirror, never the source.

### What stays exactly as it is

Vite, React 18, Tailwind, the design system, react-router, Vercel hosting,
the SPA fallback and the security headers. The Content-Security-Policy gains
the Supabase project host in `connect-src` and `img-src`, and drops
`script.google.com` once the last Apps Script is retired.

### What is added to the front end

- `src/lib/supabase.js`: the single client, configured from `VITE_SUPABASE_URL`
  and `VITE_SUPABASE_ANON_KEY` (Vercel environment variables, never committed).
- `src/auth/AuthProvider.jsx`: session context, replacing `useOfficerAuth`.
- `@tanstack/react-query` for data hooks with caching and optimistic updates.
  It replaces the hand-written cache in `src/lib/localCache.js`.
- A `src/portal/` route tree (section 8) and a generic record editor (section 9).

## 5. Data model

Everything is scoped by **term** (the academic year), so a handover is a data
change, not a code change. A person holds **positions** through
**assignments**, and permissions derive from those assignments.

### Core

| Table | Purpose | Key columns |
| --- | --- | --- |
| `terms` | Academic years | `label` ("2026-27"), `starts_on`, `ends_on`, `is_current` |
| `committees` | The 6 standing committees, 4 support divisions, and the exchange tracks | `slug`, `name`, `kind`, `sort`, `active`, `page` (jsonb: tagline, about, what we do, photo path) |
| `positions` | Named roles, per committee or society-wide | `committee_id` (null for EB), `title` ("LEO-Out"), `level` (`eb`, `officer`, `assistant`, `member`), `sort` |
| `profiles` | One row per signed-in person, keyed to `auth.users.id` | `full_name`, `email`, `phone`, `faculty_year`, `photo_path`, `membership_status` (`candidate`, `active`, `alumni`, `unverified`), `joined_year` |
| `assignments` | Person holds position in term | `profile_id`, `position_id`, `term_id`, `status`, `started_on`, `ended_on` |
| `roster_entries` | Imported membership roll (the current xlsx), pre-account | normalised name and email, status, year joined, and the `profile_id` once claimed |

### Portal

| Table | Purpose | Key columns |
| --- | --- | --- |
| `tasks` | Work an officer hands out | `committee_id`, `term_id`, `title`, `body` (markdown), `status` (`todo`, `doing`, `blocked`, `done`), `priority`, `due_at`, `created_by` |
| `task_assignees` | Who owns a task | `task_id`, `profile_id`, `state`, `completed_at` |
| `task_updates` | Comments, status changes, attachments | `task_id`, `author_id`, `kind`, `body`, `file_path` |
| `posts` | Announcements, news, resources | `kind`, `title`, `body`, `audience` (jsonb: committees, levels, positions), `pinned`, `publish_at`, `expires_at`, `author_id` |
| `post_reads` | Read receipts, so an officer can see who has seen an update | `post_id`, `profile_id`, `read_at` |
| `notifications` | In-app feed and email queue | `profile_id`, `kind`, `payload`, `read_at`, `emailed_at` |
| `invites` | Officer-issued invitations with a position pre-set | `email`, `position_id`, `term_id`, `token`, `expires_at` |

### Migrated from Apps Script and Sheets

`calls`, `applications`, `exchange_stories`, `orders` and `order_items`,
`signups` (newsletter and waitlist), `gallery_removals`, `magazine_engagement`.
Each gets the columns its Sheet has today, plus proper types and foreign keys.

### Content

| Table | Purpose |
| --- | --- |
| `site_settings` | Key and jsonb value. Replaces the `SITE_SETTINGS` Script Property. Starts with `magazineInHeader`, grows to hero text, calendar id, contact details, socials. |
| `content_blocks` | Editable page sections that are static today: home sections, executive board, FAQ, exchange copy, IFMSA pages. Columns `page`, `slot`, `data` (jsonb), `status` (`draft`, `published`), `version`. |
| `magazine_issues` | Replaces `magazine.js`. |
| `merch_products` | Replaces `merchProducts.js`. |
| `events` | Replaces the unconfigured Google Calendar embed (removed 2026-09-24). Title, committee (or none), start and end, place, text, picture, sign-up link, published. Built in phase 6, step 4. |
| `audit_log` | Written by a trigger on every content and roster table: who, what, before, after. |

### Storage buckets

Public: `committee-media`, `merch`, `magazine`, `gallery`, `avatars`.
Private with policy checks: `receipts`, `task-files`, `roster-imports`.
Officer photos move here from Drive over time. The old Drive URLs keep working
until each photo is re-uploaded.

## 6. The public site stays static-first

The public pages should never depend on the backend being awake. The rule:
**the build ships a snapshot, the client overlays live data.**

1. A GitHub Action (nightly, and on a Vercel deploy hook fired by a database
   webhook when something is published) runs `scripts/snapshot-content.mjs`,
   which pulls published rows from the public tables into
   `src/data/generated/*.json` and commits them.
2. Pages render from the snapshot immediately, then fetch live and reconcile.
   This is how `useOfficerOverrides` already behaves over `society.js`, made
   systematic.
3. If Supabase is paused or unreachable, visitors see content at most a day
   old, and the portal shows a clear "the portal is asleep, an admin has been
   emailed" screen.

## 7. Identity, sign-in, and permissions

### Sign-in

- **Google** first. Students already live in Google, and the society's own
  account is a Google account. **Email magic link** as the fallback for anyone
  without a Google address. No passwords, so no reset flow to support and
  nothing for officers to hand out.
- Sessions are Supabase JWTs refreshed by the client. The `sessionStorage`
  token juggling and the claim-nonce mechanism go away.

### Account claiming

1. A person signs in for the first time. A `profiles` row is created with
   `membership_status = 'unverified'`.
2. If their email matches a `roster_entries` row, the profile is linked and
   verified automatically. This covers the existing 581 members.
3. If not, they land on a "Request verification" screen. The request appears
   in the Members Officer's queue in the portal, where it is approved or
   declined with one click.
4. Officers can also **invite** by email with a position pre-set. Accepting
   the invite creates the assignment.

### Roles

Nobody has a role column. A person's rights are the union of their active
assignments in the current term:

| Level | Can |
| --- | --- |
| `member` | See their committee's posts and the tasks assigned to them, update those tasks, comment, edit their own profile, apply to calls. |
| `assistant` | Everything a member can, plus create and assign tasks within their committee when the officer grants it (a flag on the position). |
| `officer` | Manage their committee: members, positions below officer, tasks, posts, calls and applications, the committee page and its media. |
| `eb` | All committees, site settings, content blocks, the verification queue, term rollover, exports. |
| `webmaster` | Everything the EB can, plus feature flags and the audit log. Held by at least two people. |

These are enforced in **row-level security policies in Postgres**, not in the
React code. Helper SQL functions (`is_officer_of(committee_id)`, `is_eb()`,
`current_term_id()`) keep policies short and testable. The front end only
decides what to *show*. The database decides what is *allowed*.

Task visibility by default: the assignees, the task's creator, and that
committee's officers. Whether other committee members can see each other's
tasks is a per-committee setting, off by default (open decision 5 in
section 13).

### Privacy

Personal fields (phone, email) are readable by the person, their committee's
officers, and the EB. The public directory shows name, position and photo only
for people who opted in. The current `/members` verification page becomes a
single-record lookup function with a rate limit, and disappears once most
members have accounts.

## 8. Portal features

Route tree under `/portal`, all behind sign-in:

- **Dashboard**: my open tasks by due date, unread updates, my positions this
  term, quick links to my committee.
- **Tasks**: list and board views, filters by committee, assignee, status and
  due date. Officers create, assign to one or more people, set priority and a
  due date, attach files. Assignees change status and comment. Every change
  writes a `task_update` and a notification.
- **Updates**: posts targeted by audience (whole society, a committee, a level,
  or specific positions). Pinned items stay on top, expiring items vanish.
  Officers see read counts and who has not read.
- **My committee**: members and positions, the committee page editor (today's
  "page" tab at `/account`), open calls and applications (today's "calls" tab).
- **Committee roster** (Phase 4, requested 2026-09-20): each officer gets a
  roster of just their own committee's members, not the society-wide roster
  the EB has. From it they can assign members (to committee positions, and to
  tasks) and keep private officer notes on each member. It is read-only for
  the membership record itself: an officer cannot change a member's status,
  joined year, LGA/NGA counts or any other roster field; those stay with the
  EB and the Secretary General's sheet. Notes live in their own table, visible
  to that committee's officers and the EB only, never to the member.
  Prerequisite (decided 2026-09-20): the roster gets an explicit link from
  each member to their committee (`roster_entries` has none today; only
  `assignments` know a committee, and most members have no account yet). The
  EB sets it on the Roster page, including through a bulk update, so "their
  members" means the rows linked to that officer's committee, whether or not
  the member has signed in. A member belongs to exactly one committee, so the
  link is a single nullable `committee_id` column on `roster_entries`. The one
  exception is **Contact Person**, an exchange position a member can hold
  alongside their main position whatever their committee: it is modelled as an
  extra marker on the member (and, for members with accounts, a second
  assignment), never as a second committee.
  **Built 2026-09-21** (migration `20260921090001_committee_roster`, the
  Members tab of `/portal/committees/:slug`, and the committee field, filter
  and "Set committees" bulk update on the Roster page); see RUNBOOK section 14.
- **Gallery editor** (requested 2026-09-22): the gallery becomes fully
  editable from the portal by the PNSD officers and the EB, replacing today's
  static pipeline (`_source/build-gallery.mjs` writing `src/data/gallery.js`
  and `/assets/gallery`) and the admin-key takedown page. They can add and
  remove photos, create and delete albums, set each album's title, blurb and
  hero (cover) photo, and rearrange album order, all live without a redeploy.
  Adding photos is a drag-and-drop zone on the album page (drop files from the
  desktop straight onto the site) plus a plain file picker; the upload goes to
  the `gallery` Storage bucket and a thumbnail/full pair is produced
  server-side (Storage image transforms or an edge function), so no local
  build step remains. Data: `albums` (slug, title, blurb, cover_photo_id,
  sort_order) and `gallery_photos` (album_id, storage path, width/height,
  sort_order, label, featured, hidden). Writes are role-checked
  (`app.is_officer_of('pnsd')` or `app.is_eb()`), reads stay anon and cached by
  the public site. Deleting keeps the file for 30 days before the bucket rule
  purges it, so a mistaken removal can be undone.
  Every album keeps its own shareable link, `/gallery/<slug>` (the route
  exists today): the editor shows a copy-link / Share button per album, the
  slug is set from the title and editable, renaming keeps the old slug as a
  redirect so shared links never break, and the album page carries its own
  title, description and hero photo in the Open Graph tags so a pasted link
  previews that album (not the generic site card) in WhatsApp, Facebook and
  Instagram. This needs per-route pre-rendered HTML, the same work as the
  discoverability item in Phase 4.
  **Build note (2026-09-24):** the thumbnail/full pair is made in the
  officer's browser (canvas, 600 px and 1600 px JPEGs, EXIF orientation
  applied) rather than server-side: Storage image transforms need the Pro
  plan, and an edge function cannot decode a 12 MP phone photo inside its
  CPU budget. The outcome is the same: no local build step, no developer.
  **Built 2026-09-24** (migration `20260924120001_gallery`, `/portal/gallery`,
  the eight albums imported into Storage; RUNBOOK section 16).
- **Magazine editor** (requested 2026-09-24): the magazine shelf becomes
  editable from the portal by the CBSD officers and the EB, replacing
  `src/data/magazine.js` and the `_source/build-magazine.mjs` rasterising
  step. They can add a new edition (title, volume label, blurb, download and
  Canva links), upload its PDF from the portal (the pages are rasterised in
  the browser with pdf.js and uploaded to the `magazine` bucket as
  `<issue>/pages/NNN.jpg`, so no developer step remains), pick the hero page
  (the page shown as the edition's cover in the header, the switcher and the
  share card; page 1 by default), reorder the shelf, mark a back-issue as
  missing, and unpublish. Data: `magazine_issues` (slug, title,
  switcher_label, date_label, blurb, sort_order, status
  `draft | published | missing`, page_count, hero_page, download_url,
  canva_url). Writes are role-checked (`app.is_officer_of('cbsd')` or
  `app.is_eb()`), reads stay anon; the public /magazine page and its
  pre-rendered card read the same snapshot the gallery uses. Follows the
  gallery editor in the Phase 5 order.
  **Built 2026-09-24** (migration `20260924150001_magazine`, `/portal/magazine`;
  RUNBOOK section 17). Pre-portal editions keep their page images under
  `/assets/magazine`; only new uploads go to Storage.
- **Directory**: opted-in members with positions, searchable.
- **Notifications**: an in-app feed, and a daily email digest of anything
  unread (per-person opt-out), sent by an edge function on a `pg_cron`
  schedule through Resend. A direct task assignment emails immediately.
- **Admin** (EB and webmaster): roster and verification queue, terms and
  rollover, site settings, content blocks, magazine, merch, events, gallery
  takedowns, exports, audit log.

## 9. Managing the site from the site

The ask is that as much as possible is editable without a developer. The
approach that stays maintainable is one generic editor, not one form per
feature.

- Each editable table has a **field schema** in `src/admin/schemas/`: a small
  JS object listing fields, their types (text, markdown, image, list, select,
  reference), validation, and which roles may edit.
- A single `RecordEditor` component renders a form from the schema, with draft
  and published states, image upload straight to Storage, and a live preview
  that uses the real public component.
- Adding a new editable thing is one migration, one schema file, and one line
  in the admin menu.
- **Markdown** for long text, rendered with a small sanitising renderer.
  Rich-text editors are heavier and age badly. Markdown fields survive any
  future rewrite.
- Supabase Studio remains the escape hatch for anything the editor cannot do,
  and the audit log records changes made either way.

What becomes editable, in order of value: site settings, committee pages
(already), executive board, open calls (already), FAQ, magazine issues, merch
catalogue and availability, events, home page sections, exchange and IFMSA
copy, footer and contact details, feature flags.

## 10. Sustainability

### Ownership

- A **Supabase organisation** owned by `aussswebsite@gmail.com`, with the
  President's and the webmaster's own accounts as additional owners. Never a
  single owner.
- The repository is **transferred** (never imported, so history and the old
  URL's redirect survive) to the society's existing GitHub account,
  `AUSSS-Website`. That is a regular user account, not an organisation, so it
  cannot have two owners; the two-owner rule is met by keeping its login and
  recovery codes in the shared vault, with the webmaster as a collaborator
  with admin rights. Vercel's Git connection is re-pointed at the new repository location after
  the transfer (the Vercel GitHub app must be installed on `AUSSS-Website`). Resend and the domain registrar follow the same vault rule.
- All credentials in a society-owned password manager vault (Bitwarden's free
  organisation tier is enough), with the vault's recovery keys held by two EB
  members.
- `docs/HANDOVER.md` lists every account, who owns it, and how to transfer it.
  It is reviewed at every term rollover.

### Term rollover

An EB-only wizard: create the next term, end all current assignments, invite
the incoming officers by email with their positions pre-set, mark outgoing
officers as members or alumni, archive open tasks and expired posts. The
public committee pages update themselves from the assignments. The wizard also
archives the term's gallery albums so the new term starts with an empty
gallery (added 2026-10-04; section 12.3, phase 7, request 12).

### Backups

- Nightly database dump and a Storage bucket sync via GitHub Actions. The
  repository is public, so each backup is encrypted with a passphrase from the
  vault before it is stored as a workflow artifact, and optionally copied to
  the society Google Drive. Kept for 90 days.
- A restore is rehearsed once per term, by a workflow that loads the latest
  backup into an empty database on the runner. The steps for a real restore
  live in `docs/RUNBOOK.md` section 20.
- Built 2026-10-04 (phase 5a, section 12.2), brought forward from the last
  phase because production has held real data since 2026-09-25. It starts
  running once the repository secrets are set.

### Testing and CI

- RLS policies are the security boundary, so they get tests. `supabase test
  db` (pgTAP) asserts that member A cannot read member B's tasks, that an
  officer cannot write outside their committee, and so on. These run on every
  pull request.
- Vitest for `src/lib` and the schema-driven editor. Playwright smoke tests on
  Vercel preview deployments: sign in, see the dashboard, create a task, publish
  an update.
- CI applies migrations to a fresh shadow database, so a broken migration
  never reaches production.

### Monitoring

Supabase's built-in logs, plus the daily keep-alive ping doubling as an uptime
check. Failures email the society inbox. Vercel deploy failures too.

### Cost

| Item | Now | Portal at launch | If usage grows |
| --- | --- | --- | --- |
| Vercel (Hobby) | $0 | $0 | $0, or $20/mo Pro if the society ever needs team seats |
| Supabase | none | $0 (with keep-alive) | $25/mo Pro, recommended once daily use is real |
| Resend | none | $0 (3,000/mo, 100/day) | $20/mo if digests exceed the daily cap |
| Domain | existing | existing | existing |

The 100 emails per day cap is the one to watch: a society-wide announcement
should be one digest per person per day, never one email per post.

### Documentation

`docs/ARCHITECTURE.md` (this plan, kept current), `docs/RUNBOOK.md` (deploy,
backup, restore, rotate keys, wake a paused project), `docs/HANDOVER.md`, and
`supabase/README.md` on local development (`supabase start`, seeding, writing
a migration).

## 11. Migration from Apps Script

Strangler pattern: each feature gets a source switch in its existing config
file, exactly like `membershipConfig.js` already has (`SOURCE = 'excel' |
'webapp'`). Build the Supabase side, flip the switch, watch it for a week, then
retire the script. Nothing is big-bang.

Order, chosen so each step unblocks the next and nothing loses data:

1. **Auth and site settings.** Replaces the login, token, settings and claim
   machinery in `officers.gs`. Officers sign in with Google for the first time.
2. **Committee page overrides.** `Overrides` sheet rows imported into
   `committees.page`. Officer photos re-uploaded to Storage lazily on the next
   edit.
3. **Open calls and applications.** Import both sheets. This removes the only
   reason Open Calls had to live in `officers.gs`.
4. **Signups.** Built 2026-09-25 (`signups`, `rpc/submit_signup`; the EB reads
   the waitlist under Submissions and exports it as CSV).
5. **Exchange stories.** Built 2026-09-25 (`stories`, `rpc/submit_story`; the
   exchange officers and the EB triage them under Submissions, and each new
   story reaches them through the notifications feed and the digest).
6. **Merch orders.** Built 2026-09-25 (`orders` priced from `merch_products`,
   `rpc/submit_order`, the receipt in the private `receipts` bucket; the EB
   works the orders under Submissions: status, notes, receipt, CSV).
7. **Gallery**, replacing the admin-key takedown page and the static photo
   pipeline with the portal gallery editor (section 8).
8. **Magazine engagement counters.** Built 2026-09-24 (migration
   `20260924170001_magazine_engagement`): totals plus reading depth per session,
   shown to the CBSD officers on the edition page (RUNBOOK section 17).

All eight are flipped (2026-09-25): the retired scripts stay in `apps-script/`
with a RETIRED header (the folder also holds the live `roster-sync.gs`), the
Sheets can be marked read-only archives, and the CSP no longer allows
`script.google.com`. The in-flight account migration should still be finished
first. It costs nothing and keeps the current site healthy during the build.

## 12. Phased roadmap

Estimates assume one part-time developer. Each phase ends with something in
use, not a demo.

### 12.1 Shipped: phases 0 to 5

| Phase | Weeks | Delivers | Done when |
| --- | --- | --- | --- |
| **0. Foundations** | 1 | Supabase org and project, GitHub org, Vercel env vars, a `supabase/` folder with CLI config, CI running migrations on a shadow database, first draft of `HANDOVER.md` | A teammate can clone, run `supabase start`, and see the seeded committees. |
| **1. Identity** | 2 | Google and magic-link sign-in, `profiles`, `terms`, `committees`, `positions`, `assignments`, RLS helpers and their tests, roster import and account claiming | All current officers signed in with Google and holding their positions for 2026-27. |
| **2. Officer parity** | 2 | Site settings, committee page editor, open calls and applications on Supabase (migration steps 1 to 3) | `officers.gs` is no longer called by production. |
| **3. Portal core** | 3 | Dashboard, tasks, updates, read receipts, notifications feed, email digest | One committee runs a real month of work through it. |
| **4. Everyone in** | 2 | Invites, verification queue, directory, profile, member-facing rollout to the roster, per-committee officer roster (assign members, officer notes, membership fields read-only); **discoverability** (added 2026-09-22): make the site show up in normal Google searches and in AI answers (Google AI Overviews, ChatGPT, Perplexity, Claude): check indexing and submit the sitemap in Search Console, register with Bing Webmaster Tools (feeds ChatGPT and Copilot), per-route titles/descriptions and pre-rendered HTML for the public pages (one SPA `index.html` today), richer JSON-LD (committees, events, contact), `llms.txt`, robots.txt explicitly allowing the AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended), and backlinks from IFMSA/IFMSA-Egypt and the faculty site. **Built 2026-09-23:** every public page (35 URLs incl. committees and albums) is pre-rendered HTML at build time with its own title, description, canonical, Open Graph card and JSON-LD; sitemap.xml and llms.txt are generated from the same list; robots.txt names the AI crawlers; `spa.html` is the fallback shell (RUNBOOK section 15). Left: Search Console sitemap resubmission + indexing requests, Bing Webmaster Tools, backlinks | 100 members with accounts, verification backlog under a day; searching "AUSSS" or "Ain Shams medical students society" returns the site on page one in Google and in an AI answer. |
| **5. Retire the rest** | 3 | Signups, stories, orders, gallery, magazine on Supabase; Sheets mirrors; `apps-script/` retired; **gallery editor** for PNSD + EB (added 2026-09-22: add/remove photos by drag-and-drop or file picker, add/remove/reorder albums with title, blurb and hero photo; each album has its own shareable link with its own preview card; see section 8); **magazine editor** for CBSD + EB (added 2026-09-24: add an edition from a PDF, pick its hero page, write its blurb, reorder the shelf; see section 8). **Built 2026-09-25:** sign-ups, stories and orders on Supabase (migration `20260925090001_submissions`), triaged in the portal under Submissions, receipts in the private `receipts` bucket, `apps-script/` retired except the roster sync (RUNBOOK section 18) | No Apps Script URL left in `src/data`; a PNSD officer publishes a new album with photos from the portal without a developer. |

A few pieces of these phases are still open. None is lost: each is scheduled
in section 12.2, and the table in 12.4 says where.

- **Phase 3:** file attachments on tasks, and the pilot its "done when" asks
  for (one committee running a real month of work through the portal).
- **Phase 4:** the invites screen, the directory, the member-facing rollout,
  and the search follow-ups (Bing Webmaster Tools, indexing requests,
  backlinks).
- **Phase 5:** Sheets mirrors, which decision 6 keeps for the day someone
  asks (section 12.5).

### 12.2 What is left, in build order

The order was reworked on 2026-10-04, when fifteen requests from the
webmaster joined the leftovers above and the old phases 6 and 7. Nothing was
dropped; similar tasks were merged. Four rules decided the order:

1. **Start the clocks first.** Work that only takes effect days or weeks
   later (search engines crawling, a pilot month, a step that waits on a
   person) starts as early as it can and runs in the background.
2. **Protect the data before changing more.** Production has held real
   orders, receipts, stories and the roster since 2026-09-25, on a plan with
   no point-in-time recovery, so backups move from the last phase to the
   first.
3. **Touch each file once.** Requests that change the same screen or the same
   file are merged and built together.
4. **Audit before adding.** The passes that walk every page (console,
   security, sizing, light mode) come before new pages are built, so each new
   page is made to the finished rules and nothing is audited twice.

| Phase | Weeks | Delivers | Done when |
| --- | --- | --- | --- |
| **5a. Stabilise and secure** | 2 | Search engines told about the site (Bing, and through it DuckDuckGo); nightly backups with one rehearsed restore, and failure alerts; the two quick bugs (gallery loading blank, the Google logo); a page-walk script that opens every page; the console clean-up and the security review done as one job | A backup has been restored into a scratch project; the gallery opens on ten cold loads in a row; the console shows none of our own errors on any page; the security checklist is in the RUNBOOK with every line passed; Bing Webmaster Tools shows the sitemap processed. |
| **5b. Portal and people** | 3 | The portal header redone once (notifications bell and new order); tasks finished (date default, duplicate warning, file attachments); the invites screen; one source of truth for people (profile name and photo everywhere, the executive board, the directory) with a rebuild whenever something is published | An officer attaches a file to a new task and is warned about a repeat; the bell shows and clears unread notifications; an officer changes their photo in the portal and the public pages show it with no developer involved. |
| **5c. One design pass** | 3 | Fluid sizing and light mode done together in one walk of every page, then the deeper magazine page-flip | The page-walk screenshots show every public and portal page reading well from a 320 px phone to a wide desktop, in both themes. |
| **5d. Pilot and rollout** | 1 of work, across about 6 weeks | A pre-rollout gate (security checklist re-run, backups healthy, DuckDuckGo check); one committee piloting for a month; the member-facing rollout to the roster; the Pro plan decision | One committee has run a real month of work through the portal; 100 members have accounts and the verification backlog is under a day; the Pro plan decision is recorded in section 13. |
| **6. Site management** | 5, then ongoing | The schema-driven editor; the incomings exchange page as the first page built on it; then FAQ, merch, home sections, exchange and IFMSA copy, footer and contact details, and feature flags editable; then the events page (`/events`, committee pages, the home page), published by officers | An officer publishes a change to the FAQ, an event and the incomings page with no developer involved; the LC's link in the exchange portal points at `/exchange/incomings`. |
| **7. Sustain** | 2, then ongoing | The term-rollover wizard with the gallery archive as one of its steps; the checks repeated every term (restore rehearsal, security checklist, handover review); documentation; the website guide | The first rollover to 2027-28 is done by the EB alone, and it leaves an empty gallery with last term's albums still reachable. |

Roughly 14 weeks of part-time work remain to the end of phase 6. Phase 5d is
mostly waiting on people, so it overlaps phase 6. Phase 7 has one fixed
deadline: the wizard must exist before the 2026-27 term ends.

### 12.3 The phases in detail

Steps are listed in the order they are built. A number in bold followed by
"request" (for example **request 4**) is the webmaster's own numbering of the
fifteen requests of 2026-10-04.

#### Phase 5a. Stabilise and secure

**Status, 2026-10-04: built and deployed (commit 5c98481); backups running
and a restore rehearsed; two things wait on the webmaster.** The repo secrets
were set the same day, the first backups ran, and the rehearsal restored one
into an empty database with every count equal to production, after three
causes of failure were fixed where the backup is made (RUNBOOK section 20).
On that deploy the new headers were confirmed live, db-ci
passed with the security baseline test, and `after-deploy` made its first
IndexNow submission. Built: `robots.txt` as one group, IndexNow
(build-time change list, `after-deploy.yml`), the search rank baseline (RUNBOOK
section 15); the nightly backup, the restore rehearsal and the failure alerts
(`backup.yml`, `backup-restore-test.yml`, `notify.yml`, RUNBOOK section 20); the
gallery fix (the cause was the scroll-reveal hook, which never saw cards that
mounted after the first paint; fixed in `useReveal.js` for every page) and the
Google mark; the page walk (`scripts/page-walk.mjs`, RUNBOOK section 21); the
console sweep and the security review (script-src without `'unsafe-inline'`,
dependency fixes, a pgTAP baseline, the
checklist in RUNBOOK section 22). Waiting: (1) Bing Webmaster Tools (sign in and import from
Search Console) and the Search Console indexing requests; (2) the four
dashboard lines of the security checklist. The portal was checked under the
new headers in a signed-in browser the same day (RUNBOOK section 21); its
scripted walk with screenshots waits for a `--login` and is needed for 5c. The backlinks stay with the
President and the VPE (section 12.5).

1. **Start the search clocks (request 2, the Phase 4 search follow-ups, and
   the `robots.txt` part of request 7).** The site does not appear on
   DuckDuckGo. DuckDuckGo takes most of its results from Bing, and
   registering with Bing Webmaster Tools is the step left open in Phase 4, so
   it goes first of all: crawling takes days to weeks, and that wait should
   run while everything else is built. Verify the domain there (import from
   Search Console), submit the sitemap, add IndexNow so each deploy tells
   Bing which pages changed, make the Search Console indexing requests, and
   ask for the backlinks (IFMSA-Egypt, the faculty site, the society's social
   profiles). The same step fixes `public/robots.txt`, since the crawlers
   are about to read it: the `Disallow` lines for `/portal`, `/login`,
   `/account` and `/merch/checkout` sit under the last named crawler, so they
   bind that crawler alone. They move under `User-agent: *` (and are repeated
   for the named groups). The file is a note to crawlers, never a security
   control; the protection is the row-level security behind the portal.
   For fun, the site then competes with the main Ain Shams University site
   for searches a medical student would make ("Ain Shams medical students",
   "Ain Shams medicine exchange", "study medicine at Ain Shams"): a short
   list of queries has its rank on Google, Bing and DuckDuckGo noted now as
   the baseline and once a month after that. The pages that answer those
   questions arrive with the incomings page in phase 6.
2. **Backups and alerts (from Phase 7).** The nightly `pg_dump` and Storage
   bucket sync of section 10, one restore rehearsed into a scratch project
   with the steps written into the RUNBOOK, and failure emails to the society
   inbox for the backup, the keep-alive ping and Vercel deploys. It comes
   before any further change to production data.
3. **The two quick bugs.**
   - **Request 4, gallery loads blank.** `/gallery` often opens as an empty
     page and only appears after a refresh. Reproduce it first (cold cache,
     throttled network, a direct visit and a visit through the header), then
     fix the cause in the snapshot, cache and live read of
     `src/lib/gallery.js` instead of adding a retry on top.
   - **Request 11, Google logo.** The portal sign-in button uses Google's
     current "G" mark, drawn to Google's sign-in branding guidelines
     (`src/portal/pages/SignInPage.jsx`).
4. **The page-walk script (the Playwright smoke test of section 10, brought
   forward).** One script that opens every public page and every portal page
   at a list of widths and in both themes, saves a screenshot of each and
   records what the console prints. It is built once and used four times: for
   the console sweep in the next step, for the design pass in 5c, as the
   smoke test on every deploy from then on, and later for the screenshots of
   the website guide (section 12.5).
5. **Console and security, one job (requests 5 and 7).** The two are merged
   because they share their evidence and their fixes: most console errors
   are the Content-Security-Policy reporting something, and both are settled
   in the headers of `vercel.json`.
   - **Request 5, console errors.** The console shows cookie warnings and a
     few security errors. Using the page-walk output, sort each message into
     ours, an embed's or the browser's, and fix all of ours (a policy
     violation is fixed at its cause, never by loosening the policy further
     than the page needs). Anything left that belongs to a third-party embed
     is listed in the RUNBOOK with the reason it stays.
   - **Request 7, security overhaul.** A review against the common attacks,
     written up as a checklist in the RUNBOOK so the next webmaster can
     repeat it each term: response headers (the CSP, HSTS, frame, referrer
     and permissions headers, tightened where the console sweep allows),
     cross-site scripting through anything a visitor or officer can type
     (stories, applications, task and post bodies, committee pages), the anon
     RPCs (validation, rate caps, honeypots), Storage bucket policies,
     Supabase Auth settings and its redirect list, the Supabase security
     advisors, `npm audit`, a scan of the repository history for secrets,
     and a pgTAP check that every table still has row-level security on. A
     `/.well-known/security.txt` with a contact address is added alongside.

#### Phase 5b. Portal and people

**Status, 2026-10-05: built; RUNBOOK section 23 describes every part.** Five
migrations (`20261005103501` to `20261005130001`) and three new test files.
Decisions made while building, each of them the simpler of two options:
attachments arrive as one timeline row per batch (a comment with files, or a
"files" row), up to 5 a batch, 20 a task, 10 MB each; the duplicate check runs
in the browser over the tasks the person can see; the invites screen is a tab
of the committee editor, and the same panel on the Roster page hands out the
board's positions, which is the whole of "executive board editable"; an invite
sends no email (the inviter tells the person); a position the roster gave is
changed on the roster and nowhere else; the public pages take a holder's name
always and their photo only when they chose one on their profile, never the
picture of their sign-in account; the directory lists every member with an
account and has no switch (the webmaster's call, 2026-10-05); a deleted task
takes its notifications with it; the rebuild trigger is a Vercel deploy hook
kept in Vault and called by a scheduled database job. One thing waits on the
webmaster: creating that deploy hook and saving it (RUNBOOK section 23,
"One-time set-up"); until then pages are rebuilt on each code release only.

**Decided 2026-10-05, after 5b shipped: access belongs to the work emails.** A
position on a member's roster row (their personal email) gives that account
nothing when it is an officer's, a board member's or the webmaster's; it is a
record of who holds the position. Only an invite to the position's work email
opens the committee editors and the board's pages, and the database refuses
to give such a position to any other address (`position_work_emails`).
Positions below officer still reach the member's account. This narrows request 10: an officer's name and
photo on the public pages come from the profile of the work account that holds
the position (RUNBOOK section 14).

Everything the portal itself still needs, finished before members are invited
into it.

1. **The header, changed once (requests 13 and 14).** Both requests change
   `src/portal/PortalLayout.jsx`, so they are one piece of work.
   - **Request 13, notifications bell.** Notifications leave the row of page
     links and become a button of their own at the side of the header, with
     a red dot while anything is unread. Clicking it opens a panel with a
     one-line summary of each notification (click one to go to its task,
     story or order), a "Mark all as read" action and a "Clear all" action.
     The full `/portal/notifications` page stays, reached from "See all" in
     the panel.
   - **Request 14, header order.** The header is regrouped so it reads in
     the order people work: Dashboard, Tasks, Updates; then the editing pages
     a person's positions give them (Committees, Gallery, Magazine,
     Submissions); then the EB's admin pages (Roster, Verification, Site
     settings); with the bell, Profile and Sign out together at the side.
2. **Tasks, finished (requests 3 and 9, and the Phase 3 attachments).** All
   three change `TaskEditor.jsx`.
   - **Request 3, date defaults to today.** A new task opens with today's
     date (the Cairo day) in the date field, which starts empty today.
     Editing an existing task keeps its own date.
   - **Request 9, duplicate-task warning.** Before a task is saved, the
     portal checks the open tasks of that committee for one with the same
     title and the same assignees, and asks "This task already exists, create
     it again?" with the existing task linked. It warns and never blocks,
     since a repeat can be deliberate. The save button also locks while a
     save is in flight, which stops the double-click duplicate.
   - **File attachments (Phase 3).** Officers attach files when creating a
     task and assignees attach them to an update, stored in the private
     `task-files` bucket and readable by the people who can see the task.
3. **The invites screen (Phase 4).** Officers invite by email with a position
   pre-set (section 7), see the invites still pending, withdraw one, and
   remove a position from the Members tab.
4. **People, one source of truth (request 10, the executive board from old
   phase 6, the directory from Phase 4, and the rebuild trigger of the
   content snapshot pipeline).** These are merged because they are one
   change seen from four sides: the site showing people from their profiles
   and positions, not from a file.
   - **Request 10, profile name and photo everywhere.** When an officer
     changes their name or photo in the portal, every place that shows them
     follows: the committee page, the executive board, the exchange team,
     task and update bylines. Today the public pages read officer names and
     photos from `src/data/society.js` and the committee page overrides, so
     the profile is not their source. The fix is one source of truth: the
     profile of whoever holds the position this term, with the static entry
     as the fallback for a position nobody has claimed. Photos live in the
     `avatars` bucket, which also ends the dependence on Drive-hosted officer
     photos.
   - **Executive board editable.** With the board drawn from this term's
     assignments, changing it is assigning a position, and no separate editor
     is needed. The term-rollover wizard in phase 7 relies on the same thing.
   - **Directory.** Every member with an account, with their positions,
     searchable, built on the same read. (Planned as opt-in; changed on
     2026-10-05 so that everyone is listed.)
   - **Rebuild on publish.** A deploy hook fired when published content
     changes, plus a nightly rebuild (section 6), so the pre-rendered pages
     follow a profile change, a new album or a published story without a
     developer. The pre-render already bakes the gallery, the magazine shelf
     and the published stories at build time; this adds the trigger.

#### Phase 5c. One design pass

It comes after 5b so the new header, bell and directory are audited in their
final form, and before phase 6 so every new page is built to the finished
sizing and colour rules.

**Status, 2026-10-05: built and live (PR #7, main at 20925f5); RUNBOOK
section 24 has the rules.** The whole site and the portal moved from dark-only colours to theme
tokens, so light mode is a real theme and the dark theme is unchanged (proved
by comparing screenshots before and after). The 37 public pages pass the page
walk at 320, 375, 768, 1024, 1440 and 1920 px in both themes: none scrolls
sideways and no text is below WCAG AA (341 texts were below it in dark and 352
in light before). Sizing follows the screen through the root font size. The
portal header has the navbar's dimensions and a theme toggle. After the
webmaster's first look: the home hero, the footer and the two bespoke
member-lookup cards follow the theme too, every blue button is a deep
blue with white text on the light theme, and every green button a fresher
green there. The magazine
reader has its depth. The 18 portal pages pass the same two measurements at
the six widths in both themes when walked with sample data
(`npm run walk:portal-sample`, which needs no sign-in); that walk found and
fixed two phone overflows, on the dashboard's task panel and in the directory.
Still to do: a signed-in look at the portal with the real data in both
themes, which needs the webmaster to sign in once
(`npm run walk -- --login`).

0. **The portal header at the public site's size (noted 2026-10-05).** The
   portal header is to be expanded so that its dimensions (height, logo, type
   and spacing) are similar to the public site's navbar. It belongs to this
   pass because the sizing work below touches the same file.
1. **Sizing and light mode together (requests 6 and 15).** Both mean walking
   every page of the public site and the portal, so the walk is done once,
   with the page-walk script producing each page at 320, 375, 768, 1024, 1440
   and 1920 px in both themes.
   - **Request 6, fluid sizing.** Every page adapts to the screen it is on:
     type and spacing that scale with the viewport (`clamp()` instead of
     fixed steps), no horizontal scrolling at 320 px, content that neither
     stretches into long lines nor sits in a narrow strip on a wide monitor,
     and portal tables that turn into cards on a phone.
   - **Request 15, light mode.** Light mode is reworked across the whole
     site and the portal: a light palette with proper contrast (WCAG AA for
     text), and fixes for whatever was designed only for the dark theme
     (white text on pale cards, borders that vanish, images and logos that
     need a light variant, the flipbook and the gallery viewer).
2. **Request 8, magazine flip.** The page-flip gets more depth: a shadow
   along the spine, a shadow cast by the lifting page that follows the fold,
   a soft shadow under the open book, and visible page edges so the stack
   looks thick. It follows the light-mode work because the shadows have to
   be tuned against both themes. The incomings booklet uses the same reader
   (`Flipbook.jsx`) and gains it too. It keeps respecting reduced-motion
   settings and must stay smooth on a mid-range phone.

#### Phase 5d. Pilot and rollout

Little development, mostly people and calendar time, so it runs alongside
phase 6. It finishes what Phases 3 and 4 set as their goals.

**Status, 2026-10-05: the gate of step 1 was run; one line failed and waits
on the webmaster.** The security checklist passed again over what 5b added
(headers, no unsafe HTML, the two new buckets, row-level security on every
table, no advisor errors, no vulnerable dependency). The nightly backup has
run on its own once since the secrets were set (2026-10-05, green). The
Google consent screen is "In production". The site is the first result on
DuckDuckGo for "AUSSS". **Failed:** the sign-in redirect list on Supabase
holds wildcard `vercel.app` addresses that a stranger's project could match;
RUNBOOK section 22 says which lines to delete. Nobody should be invited
before that is done. Three dashboard lines of the checklist (two-step
verification on every account, GitHub secret scanning) are still the
webmaster's to tick.

1. **Gate before inviting anyone.** Re-run the security checklist over what
   5b added (attachments, invites, the directory), confirm the nightly backup
   has run every night since 5a, confirm the Google consent screen is still
   "In production" (HANDOVER), and check that the site now appears on
   DuckDuckGo for "AUSSS"; if it does not, look into it here.
2. **Pilot (Phase 3).** One committee that wants it runs a real month of
   work through tasks, updates and the digest. What it trips over is fixed
   before the rollout.
3. **Member-facing rollout (Phase 4).** The roster is invited in. Target: 100
   members with accounts and a verification backlog under a day.
4. **The Pro plan decision (from Phase 7).** Made here, on real usage
   figures (database size, Storage, egress, Resend's daily count), since
   section 3 ties it to the portal being in daily use.
5. **The storage limit on Vercel (noted by the webmaster, 2026-10-05).** The
   site is passing, or about to pass, a storage limit on Vercel's Hobby
   plan. To do: read the Usage page of the `ausss-ainshams` project to see
   which limit it is and what is filling it, then bring it back under (or
   decide to pay), and write the figure and the fix into RUNBOOK. It sits
   beside the Pro plan decision because both are read off the same usage
   figures.

#### Phase 6. Site management

**Status, 2026-10-05: steps 1 and 2 are built and live (pull request 8,
main at 0ffabda); RUNBOOK section 25 has the rules.** The table `content_blocks` holds each edited
part of a page as a document with a draft and a published copy. The portal
has a "Site content" page that lists the blocks a person may edit and opens
each in one form drawn from its field schema, with a live preview made of
the page's own component, and "Save draft", "Publish" and "Discard draft".
Long text is markdown, read by a small renderer that never produces HTML.
The webmaster has an "Audit log" page. Vitest runs on every pull request.
The questions on `/join` are the first block, so the step ends with
something in use: the EB can change the FAQ with no developer. Where the
build differs from section 9: the schemas live in `src/content/schemas`
(not `src/admin/schemas`) because the public pages read their documents
through the same files; and a block's row is created by a migration, with
its editors named in the row, so the database decides who may publish.
Step 2: `/exchange/incomings` reads the block `exchange.incomings`, edited
by the exchange officers and the EB. On the webmaster's instruction
(2026-10-05) the page was rebuilt from the ground up for one reader, a
student abroad choosing where to go, and written in the first person: who
we are, what we give you, why choose us (six reasons with pictures), two
ways to come to us, how you get to us, the welcome booklet, before you
land, write to us (the LEO-In's and the LORE's cards, name and photo from
their profiles), and stories from students we hosted. Its facts and its
pictures come from our incomings booklet. Two things are left for the
exchange officers: choosing or making the gallery album for the photo
strip, and pasting the address of the national booklet. Two things in the
shipped copy do not come from the booklet and are theirs to confirm: the
four steps of "How you get to us" (the standard IFMSA procedure) and "at
least one meal a day" (the standard IFMSA exchange condition). The two exchange pages are titled "Incomings" and
"Outgoings" (the webmaster's choice, 2026-10-05; the titles live in
`src/data/society.js`, and `src/seo/pages.js` reads them from there). The
reminder of step 2 below stands for when the pull
request is merged.

1. **The editor foundation.** Field schemas, the `RecordEditor`,
   `content_blocks` with draft and published states, the sanitising markdown
   renderer (section 9), Vitest for the editor and `src/lib`, and the audit
   log screen for the webmaster.
2. **Request 1, the incomings exchange page, as the first page built on the
   editor.** Building it here, and not earlier as a static page, means it is
   built once. `/exchange/incomings` grows from today's short page with the
   welcome booklet into a proper page for students thinking of coming to Ain
   Shams: a pitch for the LC (the hospitals, the departments, the social
   programme, Cairo), the LEO-In's and the LORE's contact details (drawn
   from their profiles, 5b step 4), photos of our work with incomings, the
   incomings welcome booklet embedded in the reader (it is there today,
   collapsed behind a cover card), and a link to the AUSSS page of the
   national IFMSA-Egypt exchange welcome booklet. The photos are a gallery
   album shown on the page, so they are managed with the gallery editor that
   already exists and no second upload tool is built. The exchange officers
   edit the copy themselves. This page is also the content half of request
   2: it is the page that answers "Ain Shams medicine exchange".
   **Reminder when it goes live:** change the LC's website link in the
   exchange portal so it points straight at
   `https://ausss-ainshams.org/exchange/incomings` and not at the home page.
3. **The remaining editors, in order of value:** FAQ (done in step 1), the
   merch catalogue and availability (**built 2026-10-06**: the EB's Merch page
   edits `merch_products` whole, with pictures in the bucket `merch`; the shop,
   cart and checkout read the table, the orders RPC no longer sells a hidden
   product, and `ORDERS_OPEN` became the site setting `merchOrdersOpen`;
   RUNBOOK section 26. The booklet and the payment methods stay files), home page sections, exchange and IFMSA copy,
   footer and contact details, and feature flags (**both built 2026-10-07**,
   RUNBOOK section 27: the footer, the address, the map pin and the official
   social channels are the block `site.contact`, edited by the EB; the three
   switches that were constants in config files became the site settings
   `openCallsLive`, `magazineCountersVisible` and `domainEmailsLive`, written
   into the saved pages by the build, with a rebuild on every change).
   Home page sections and the IFMSA copy were **built the same day**: the
   blocks `home.page` (the hero's lines and figures and the "About the
   Society" section) and `ifmsa.page` (the IFMSA page's words and figures),
   both the EB's. The exchange copy was already editable through the two
   exchange pages (step 2 and its outgoings twin); the short hub at
   `/exchange` stays in the code.
   Magazine issues, the first aim of this phase when the plan was written,
   have been editable since Phase 5. Events were on this list too; they are
   step 4, because they are a new page and not an editor for one that exists.
   Step 3 is built on pull requests 11, 12 and 13 (not merged on 2026-10-07).
4. **The events page (the webmaster, 2026-10-07).** The site has had no list
   of events since the unconfigured Google Calendar embed was removed in the
   clean-up of 2026-09-24. Events are many dated records that officers add
   one at a time and the pages sort and split by date, so they get a table of
   their own and not a content block.
   - **Data:** `events` (section 5): title, the committee it belongs to (none
     for a society-wide event), start and optional end (Cairo time), place, a
     short text (markdown), a picture (public bucket `event-media`), a sign-up
     link, and whether it is published. The committee's officers and the EB
     add, edit and remove; visitors read the published ones through one RPC;
     a change asks for a rebuild of the public pages (section 23, "rebuild on
     publish").
   - **Public pages:** `/events` lists the upcoming events; each committee
     page shows its own upcoming events; the home page shows the next three.
     Read like the gallery (what the build baked in, then the browser's last
     copy, then the live answer), listed in the sitemap, and each event
     carries schema.org `Event` data so search engines can show it.
   - **Header (decided by the webmaster, 2026-10-07):** "Events" gets its
     own place in the public header, as a link of its own beside the
     Committees menu. The header was tight at 1024 px before (pull request
     12), so the fit is checked again at 1024, 1280 and 1440 px.
   - **Archive (decided by the webmaster, 2026-10-07):** old events move to
     an archive and leave the main list. My reading, to confirm when the step
     starts: an event moves on its own once it has ended (no button, no
     rollover step needed), to `/events/archive`, grouped by term, and any
     link to it keeps working.
   - **Portal:** an Events tab on each committee's page in the portal, with
     the same editor for the EB's society-wide events.
   - **Still to settle with the webmaster:** how much the first build holds.
     Answers 1 and 2 rule out the smallest version (a list on the home page
     alone), since the header link and the archive both need the page. The
     open part is whether the first build also takes the upcoming events on
     each committee page and on the home page, one page per event with its
     own link and preview card for sharing, and an "Add to calendar" button,
     or whether those follow later.
   - **Why here:** it is the last piece of this phase's "done when" (an
     officer publishes an event with no developer), it reuses what the phase
     built (the editor patterns, the rebuild, the committee pages and the
     home page just made editable), and building it before the 5d pilot
     invites start lets the piloting committee publish its events through
     the portal during its month.

#### Phase 7. Sustain

1. **The term-rollover wizard, with the gallery archive as one of its steps
   (request 12).** The wizard of section 10: create the next term, end the
   current assignments, invite the incoming officers, archive open tasks and
   expired posts. **Request 12, gallery archive per term:** at the end of a
   term, all the gallery's albums are archived in one action so the new term
   starts with an empty gallery. Albums gain a term and an archived state;
   archived albums leave the main gallery and move to an archive grouped by
   term, and their `/gallery/<slug>` links keep working. Storage is the
   constraint (1 GB on the free plan, and each photo is stored twice, as a
   thumbnail and a full-size copy), so archiving re-encodes the full-size
   copies to a smaller modern format and exports the term's originals as one
   bundle to the society Drive, alongside the backups. The exact format and
   sizes are decided at build time from the real figures for 2026-27. The
   wizard must be ready before the 2026-27 term ends.
2. **Every term:** a restore rehearsal, the security checklist, the
   `HANDOVER.md` review, and the monthly search ranks of request 2 looked at
   as a trend.
3. **Documentation:** `docs/ARCHITECTURE.md` and the RUNBOOK kept current
   (each phase above adds its own RUNBOOK section as it ships).
4. **The website guide**, once development has ended (section 12.5).

### 12.4 Where everything went

Every open task, where it sat before the reorder of 2026-10-04 and where it
sits now.

| Task | Was in | Now in |
| --- | --- | --- |
| Request 1, incomings exchange page | New, 2026-10-04 | Phase 6, step 2 |
| Request 2, DuckDuckGo and the race with the university | New, 2026-10-04 | 5a step 1 (registration, baseline ranks), 6 step 2 (the content), 7 step 2 (the trend) |
| Request 3, task date defaults to today | New, 2026-10-04 | 5b step 2, merged with request 9 and attachments |
| Request 4, gallery loads blank | New, 2026-10-04 | 5a step 3 |
| Request 5, console errors | New, 2026-10-04 | 5a step 5, merged with request 7 |
| Request 6, fluid sizing | New, 2026-10-04 | 5c step 1, merged with request 15 |
| Request 7, security overhaul and `robots.txt` | New, 2026-10-04 | 5a step 5 (the review), 5a step 1 (`robots.txt`), re-run in 5d and every term |
| Request 8, magazine flip | New, 2026-10-04 | 5c step 2 |
| Request 9, duplicate-task warning | New, 2026-10-04 | 5b step 2 |
| Request 10, profile name and photo everywhere | New, 2026-10-04 | 5b step 4, merged with the executive board and the directory |
| Request 11, Google logo | New, 2026-10-04 | 5a step 3 |
| Request 12, gallery archive per term | New, 2026-10-04 | 7 step 1, merged into the rollover wizard |
| Request 13, notifications bell | New, 2026-10-04 | 5b step 1, merged with request 14 |
| Request 14, header order | New, 2026-10-04 | 5b step 1 |
| Request 15, light mode | New, 2026-10-04 | 5c step 1 |
| Task file attachments | Phase 3, not built | 5b step 2 |
| One-committee pilot month | Phase 3, "done when" | 5d step 2 |
| Invites screen | Phase 4, not built | 5b step 3 |
| Directory | Phase 4, not built | 5b step 4 |
| Member-facing rollout | Phase 4, not started | 5d step 3 |
| Bing Webmaster Tools, indexing requests, backlinks | Phase 4, left over | 5a step 1, merged with request 2 |
| Sheets mirrors | Phase 5, deferred by decision 6 | 12.5, on request |
| Schema-driven editor | Phase 6 | 6 step 1 |
| Executive board editable | Phase 6 | 5b step 4 |
| FAQ, merch, events and home sections editable | Phase 6 | 6 step 3 (events: 6 step 4) |
| Events page (`/events`, committee pages, the home page) | New, 2026-10-07 | Phase 6, step 4 |
| Magazine editable | Phase 6 | Shipped in Phase 5 |
| Content snapshot pipeline | Phase 6 | 5b step 4 (the rebuild trigger; the build-time snapshot shipped with the pre-render) |
| Backups and a restore rehearsal | Phase 7 | 5a step 2, rehearsal repeated in 7 step 2 |
| Monitoring | Phase 7 | 5a step 2 |
| The Pro plan decision | Phase 7 | 5d step 4 |
| Term-rollover wizard | Phase 7 | 7 step 1 |
| Runbook | Phase 7 | Every phase, kept current in 7 step 3 |
| Playwright smoke tests | Section 10, unscheduled | 5a step 4 |
| Vitest | Section 10, unscheduled | 6 step 1 |

### 12.5 Waiting on people, and parked

These do not block the build order above. The parked ideas were noted in
earlier sessions and are listed so the roadmap is whole; none is scheduled.

Waiting on people:

- **Backlinks** from IFMSA-Egypt's LC list (requested by the President or
  the VPE) and the faculty site (5a step 1).
- **Role addresses on the domain:** built behind the site setting `domainEmailsLive`, waiting
  on the forwarding rules at the registrar and each inbox owner's
  verification (RUNBOOK section 19).
- **The exchange portal link:** changed by the exchange officers when the
  incomings page goes live (phase 6, step 2).

Parked:

- **The portal inside the site:** staying signed in while browsing the public
  pages and applying to Open Calls as a member, together with turning the
  public Open Calls cards on (the site setting `openCallsLive`). Its earliest sensible
  place is after 5d, when members have accounts.
- **The website guide:** one PDF with screenshots of every page and portal
  feature, parked until development ends (phase 7, step 4). The page-walk
  script of 5a is its screenshot tool.
- **IFMSA calls from email to the calendar,** and **the walking mascot:**
  backburner ideas, not designed.
- **Sheets mirrors** (decision 6) and **a shared task board per committee**
  (decision 5): built when someone asks.

## 13. Risks and open decisions

Risks:

- **Adoption.** A portal nobody opens is worse than Sheets. Mitigation: phase 3
  pilots with one committee that wants it, and the email digest reaches people
  who never open the site.
- **Free-tier pause.** Mitigated by keep-alive and the static snapshot,
  resolved by Pro.
- **Email cap.** Digest, never per-event mail. Watch Resend's daily count.
- **Officer photos on Drive** owned by whichever account uploaded them.
  Mitigation: re-upload to Storage on the next edit, and a one-off script for
  the rest.
- **Security regressions** while both backends run. Mitigation: RLS tests in
  CI from phase 1, and no secret ever in a URL again.

Decisions made on 2026-09-04:

| # | Question | Decision | Consequence |
| --- | --- | --- | --- |
| 1 | Platform | **Supabase** | Phase 0 creates the project under `aussswebsite@gmail.com`. |
| 2 | Budget | **Free tier** with a keep-alive ping | The GitHub Actions ping and the static snapshot (section 6) are non-optional. Revisit Pro when the portal is in daily use. |
| 3 | Sign-in | **Google and magic link** | Both providers enabled in Supabase Auth. Magic-link mail counts against Resend's daily cap. |
| 4 | Ownership | **Transfer** the repository to the existing `AUSSS-Website` GitHub account (a regular user account) | **Done 2026-09-04**: now at `github.com/AUSSS-Website/AUSSS-Website-Project`. Login and recovery codes in the shared vault; webmaster as admin collaborator; Vercel's Git connection re-pointed after the transfer. The older copy under a second personal account is left alone. |
| 5 | Task visibility default | **Private**: assignees, creator, and the committee's officers | Per-committee switch to open a shared board later. |
| 6 | Sheets mirrors | **Later**, only if asked | Every portal list gets a "Download as spreadsheet" button instead. |

## Sources

Platform limits quoted above were checked on 2026-09-04:

- Supabase pricing and pausing: https://supabase.com/pricing and
  https://supabase.com/docs/guides/platform/free-project-pausing
- Firebase pricing: https://firebase.google.com/pricing
- Resend pricing: https://resend.com/pricing
