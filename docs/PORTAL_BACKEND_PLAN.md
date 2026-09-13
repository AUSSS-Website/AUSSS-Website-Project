# AUSSS Member Portal: long-term backend plan

Status: approved 2026-09-04, decisions recorded in section 13. Phase 0 and Phase 1 implemented 2026-09-13 (schema in `supabase/migrations`, portal at `/portal`; operations in `docs/RUNBOOK.md`, ownership in `docs/HANDOVER.md`); Phases 2 and later pending. Companion documents: `apps-script/MIGRATION.md`
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
| `events` | Replaces the unconfigured Google Calendar embed. |
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
public committee pages update themselves from the assignments.

### Backups

- Nightly `pg_dump` and a Storage bucket sync via GitHub Actions, written to a
  private repository release and to the society Google Drive. Kept for 90
  days.
- A restore is rehearsed once per term into a scratch project. The steps live
  in `docs/RUNBOOK.md`.

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
4. **Signups** (currently broken in production per `MIGRATION.md`; this is the
   fix).
5. **Exchange stories**, with the moderation queue moving into the portal.
6. **Merch orders**, receipts to the private bucket, a fulfilment board for the
   merch officer.
7. **Gallery takedowns**, replacing the admin-key page with a role check.
8. **Magazine engagement counters.**

When all eight are flipped, `apps-script/` moves to `apps-script/_retired/`
with a README, the Sheets are marked read-only archives, and the CSP loses
`script.google.com`. The in-flight account migration should still be finished
first. It costs nothing and keeps the current site healthy during the build.

## 12. Phased roadmap

Estimates assume one part-time developer. Each phase ends with something in
use, not a demo.

| Phase | Weeks | Delivers | Done when |
| --- | --- | --- | --- |
| **0. Foundations** | 1 | Supabase org and project, GitHub org, Vercel env vars, a `supabase/` folder with CLI config, CI running migrations on a shadow database, first draft of `HANDOVER.md` | A teammate can clone, run `supabase start`, and see the seeded committees. |
| **1. Identity** | 2 | Google and magic-link sign-in, `profiles`, `terms`, `committees`, `positions`, `assignments`, RLS helpers and their tests, roster import and account claiming | All current officers signed in with Google and holding their positions for 2026-27. |
| **2. Officer parity** | 2 | Site settings, committee page editor, open calls and applications on Supabase (migration steps 1 to 3) | `officers.gs` is no longer called by production. |
| **3. Portal core** | 3 | Dashboard, tasks, updates, read receipts, notifications feed, email digest | One committee runs a real month of work through it. |
| **4. Everyone in** | 2 | Invites, verification queue, directory, profile, member-facing rollout to the roster | 100 members with accounts, verification backlog under a day. |
| **5. Retire the rest** | 3 | Signups, stories, orders, gallery, magazine on Supabase; Sheets mirrors; `apps-script/` retired | No Apps Script URL left in `src/data`. |
| **6. Site management** | 4, then ongoing | Schema-driven editor; EB, FAQ, magazine, merch, events and home sections editable; content snapshot pipeline | An officer publishes a magazine issue with no developer involved. |
| **7. Sustain** | ongoing | Term-rollover wizard, backups and a restore rehearsal, runbook, monitoring, the Pro plan decision | The first rollover to 2027-28 is done by the EB alone. |

Roughly 17 weeks of part-time work to the end of phase 6, with visible value
from the end of phase 2.

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
