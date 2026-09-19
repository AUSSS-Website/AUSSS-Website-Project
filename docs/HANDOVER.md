# AUSSS website and portal: technical handover

Status: first version written 2026-09-13 alongside Phase 0 and Phase 1 of
`docs/PORTAL_BACKEND_PLAN.md`; updated 2026-09-19 for Phase 2 (officer editor on
Supabase, `officers.gs` retired from production). Reviewed at every term rollover (section 6 below).
Items marked TODO are facts the webmaster must confirm and fill in; they were
not invented.

Who this is for: the incoming President, the incoming webmaster, and anyone on
the Executive Board who has to recover the site when the people who built it are
gone. Read it once when you take office and again when you hand over.

Companion documents:

- `docs/PORTAL_BACKEND_PLAN.md`: why the estate looks like this and what is
  still to come (Phases 3 and later).
- `docs/RUNBOOK.md`: exact commands for the routine operations named here.
- `apps-script/MIGRATION.md`: the Google-side assets and how they were moved to
  the society account.
- `supabase/README.md`: developer workflow for the database folder.

## 1. The one rule: two named owners, always

Every account below must have at least two named people who can sign in and
recover it: the **President** and the **webmaster** of the current term. Where a
service only allows one owner (a plain GitHub user account, a Gmail account),
the rule is met by keeping that account's password and recovery codes in the
society vault (section 4) rather than in one person's head.

Nothing in this list may be owned by a personal account or by a rotating role
mailbox such as `loreausss@gmail.com`. That is how the site lost its data layer
before; `apps-script/MIGRATION.md` records the recovery.

## 2. The estate: every account, what it holds, who holds it

### 2.1 GitHub: source code and CI

| Item | Value |
| --- | --- |
| Account | `AUSSS-Website` (a regular user account, not an organisation) |
| Repository | `github.com/AUSSS-Website/AUSSS-Website-Project` |
| Login and recovery codes | Society vault |
| Second person | Webmaster, added as a collaborator with admin rights |
| Holds | All source, `supabase/migrations`, GitHub Actions (`db-ci`, `db-deploy`, `keepalive`), the repository secrets in section 5 |
| Transfer at rollover | Add the new webmaster as admin collaborator, remove the old one; rotate the vault entry |

Because it is a user account it cannot have two owners. Do not convert it to an
organisation without reading the Vercel and Actions consequences first; the
plan's decision 4 (section 13) chose to keep it as is.

### 2.2 Vercel: hosting (team `ausss-website`, project `ausss-ainshams`)

| Item | Value |
| --- | --- |
| Deploys from | The GitHub repository above through the Vercel GitHub integration (no `.vercel/` folder locally, no manual deploys) |
| Live config | `vercel.json` (headers, CSP, redirects). `netlify.toml` and the Netlify site are leftovers, not production |
| Environment variables | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, set for **Production and Preview** |
| Account or team that owns the project | TODO for the webmaster: record the Vercel account email and team slug, and confirm the President has access |
| Production URL | `https://ausss-ainshams.org` (custom domain attached 2026-09-15). `www` and the old `https://ausss-ainshams.vercel.app` both redirect (308) to it; the redirects are set on the project's Domains page in Vercel |
| Preview URL pattern | `https://*-ausss-website.vercel.app`; this is what the Supabase redirect allow-list matches |

### 2.3 Supabase: database, auth, storage for the portal

| Item | Value |
| --- | --- |
| Project ref | `wjijkqrdaakiwbtdssio` |
| API URL | `https://wjijkqrdaakiwbtdssio.supabase.co` |
| Region and Postgres version | TODO region; Postgres 17 (matches `[db] major_version = 17` in `supabase/config.toml`) |
| Organisation owner | `aussswebsite@gmail.com` |
| Additional owners | President and webmaster, invited to the organisation as **Owner**. Never fewer than two owners in the members list |
| Plan | Free tier (plan decision 2). Projects pause after a week without traffic; the `keepalive` workflow pings it daily. See RUNBOOK section 6 |
| Holds | Schema `public` (terms, committees, positions, profiles, roster_entries, invites, assignments, verification_requests, audit_log), private schema `app` (helpers), Auth users, the auth config pushed from `supabase/config.toml` |
| Keys | Publishable key `sb_publishable_...` (safe in the browser, RLS gatekeeps); secret key `sb_secret_...` (bypasses RLS; scripts only, never in the browser or the repo); database password; personal access tokens for the CLI |

Transfer at rollover: invite the new President and webmaster as organisation
owners before removing the old ones. Rotate the secret key and the database
password (section 6).

### 2.4 Google Cloud: the OAuth client for "Sign in with Google"

| Item | Value |
| --- | --- |
| Google account | `aussswebsite@gmail.com` |
| Project name and id | TODO for the webmaster |
| Credential | One OAuth 2.0 **Web application** client |
| Authorised redirect URI | `https://wjijkqrdaakiwbtdssio.supabase.co/auth/v1/callback` |
| Authorised JavaScript origins | None needed: the browser only ever talks to Supabase's callback URL above. The consent screen's authorised domains must list `ausss-ainshams.org` (Branding) |
| OAuth consent screen | Published ("In production"), external user type. If it drops back to "Testing", only listed test users can sign in and the portal appears broken for everyone else |
| Where the client id and secret live | Supabase Auth provider settings (or `supabase/.env` for `npm run db:config-push`); the vault |

The client secret is a secret. Rotating it means updating Supabase Auth and
`supabase/.env`, then pushing config.

### 2.5 Resend: transactional email (magic links)

| Item | Value |
| --- | --- |
| Account | TODO: which login owns it; should be `aussswebsite@gmail.com` or a vault-held login |
| Verified sending domain | `ausss-ainshams.org` (DNS records at the registrar, section 2.6); not set up as of 2026-09-19 |
| API key | Used as the SMTP password for Supabase Auth custom SMTP (`smtp.resend.com`, port 465, user `resend`); also in `supabase/.env` as `RESEND_API_KEY` |
| Why it exists | Supabase's default SMTP sends only to project team members, a couple of mails per hour, and cannot customise templates on the free plan. Without Resend, magic-link sign-in does not work for members; Google sign-in still does |
| Limits | Free plan daily send cap (TODO: record the current figure). Plan risk "Email cap" in section 13 |

### 2.6 Domain registrar and DNS for `ausss-ainshams.org`

| Item | Value |
| --- | --- |
| Registrar | Squarespace Domains (nameservers `nsb1..4.squarespacedns.com`), bought 2026-09-15 by `aussswebsite@gmail.com` |
| Registrant account login | Society vault |
| Renewal date and payment method | TODO. Set a calendar reminder two months ahead; an expired domain takes the site, the email domain and the OAuth redirect down together |
| DNS records that matter | apex `A 76.76.21.21` and `www CNAME cname.vercel-dns.com` (Vercel); later the Resend domain-verification and DKIM/SPF records; anything the Google Form or Calendar needs |

### 2.7 The `aussswebsite@gmail.com` Google account

This account is the root of trust for the Google-side estate. It owns the Drive
folders, the Sheets, the Apps Script projects, the Google Cloud project and the
Supabase organisation. Requirements, from `apps-script/MIGRATION.md` step 0:

- 2-Step Verification on, backup codes in the vault, recovery email and phone
  owned by the society, not an individual.
- Someone on duty watches the inbox: merch orders and story submissions notify
  it, and it receives Supabase, Vercel and Google Cloud service mail.
- It is never handed to a single rotating officer. The password changes at every
  rollover and lands in the vault.

### 2.8 Apps Script web apps (five still live until Phase 5)

Five Google Apps Script web apps and their Sheets (`gallery.gs`, `orders.gs`,
`signups.gs`, `stories.gs`, `magazine.gs`) still serve the public site. Their
URLs are hard-coded in `src/data/*Config.js`; the inventory, Script Properties
and Drive folders are in `apps-script/MIGRATION.md` section A and B. Ownership
is moving to `aussswebsite@gmail.com`; check that document for what is still
"pending owner".

`officers.gs` (officer login, committee page overrides, site settings, Open
Calls) was retired from production on 2026-09-19 (Phase 2): the site no longer
calls its URL, officers sign in at `/portal` and the data lives in the
`site_settings`, `committees.page`, `calls` and `applications` tables. Its Sheet
(`AUSSS-officer-accounts`) is an archive: keep it read-only for a term in case
an old application or override needs to be looked up, then delete it. The
`AUSSS Officer Photos` Drive folder must stay shared anyone-with-link until every
committee has re-uploaded its photos through the portal (old `lh3` URLs are still
referenced from `committees.page`). Phase 5 retires the remaining five.

### 2.9 Other

- Netlify site `ausss-ainshams` under a personal login: not production, safe
  to delete once `netlify.toml` is retired.
- Membership Google Form and its response sheet: owner TODO (see
  `apps-script/MIGRATION.md` section C).
- Membership database: lives in Supabase (`public.roster_entries`, edited at
  `/portal/admin/roster`). The Secretary General's Google Sheet
  `[SHARED] AUSSS Membership Database` (owner `ausss.secgen@gmail.com`) feeds it
  through `apps-script/roster-sync.gs` or a file upload until the EB retires the
  sheet (RUNBOOK section 4). It holds personal data: keep its sharing on
  Restricted, never "anyone with the link". The xlsx under
  `_source/records/membership/` is an old export, not a source.

## 3. Access matrix

| Who | GitHub | Vercel | Supabase | Google Cloud | Resend | Registrar | Gmail account | Vault |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| President | via vault | Owner (TODO confirm) | Owner | via Gmail account | via vault | via vault | via vault | Admin, holds a recovery key |
| Webmaster | Admin collaborator (own account) + vault | Member or Owner (TODO) | Owner (own account) | via Gmail account | via vault | via vault | via vault | Admin |
| Second EB member (VP Internal or Secretary General) | none | none | none | none | none | none | none | Holds the second vault recovery key |
| Other EB | none | none | Portal role `eb` (database assignment, not a dashboard seat) | none | none | none | none | none |
| Officers | none | none | Portal role `officer` in their committee | none | none | none | none | none |

Dashboard seats (Supabase, Vercel, GitHub) are for people who run
infrastructure. Portal permissions (EB, officer, assistant, member) are
assignments in the database and are granted with an invite, not a dashboard
seat. RUNBOOK section 8 covers that.

## 4. Password vault rule

- One society-owned password manager organisation (Bitwarden's free
  organisation tier is sufficient, plan section 10). Its recovery keys are
  held by two EB members who are not the same person as the webmaster.
- Every credential in this list lives there and nowhere else: not in chat, not
  in a Google Doc or Drive, not in a Sheet, not in an email, not in the
  repository, not in a screenshot.
- Secrets that exist and must be in the vault:

| Secret | Used by | Who may see it |
| --- | --- | --- |
| `AUSSS-Website` GitHub password and recovery codes | Whoever must act as the repository owner | President, webmaster |
| `aussswebsite@gmail.com` password, 2FA backup codes | Root of the Google estate | President, webmaster |
| Supabase organisation owner login (if separate from Gmail) | Dashboard | President, webmaster |
| Supabase **secret** key `sb_secret_...` | `npm run db:import-roster` only | Webmaster |
| Supabase **database password** | `npm run db:link` / `db:push`, GitHub secret `SUPABASE_DB_PASSWORD` | Webmaster |
| Supabase **personal access token(s)** | CLI and GitHub secret `SUPABASE_ACCESS_TOKEN`; one per person or per use, named | Its owner only |
| Supabase publishable key `sb_publishable_...` | Browser, Vercel env, GitHub secret `SUPABASE_PUBLISHABLE_KEY` | Not secret, but track where it is set so rotation is complete |
| Google OAuth client secret | Supabase Auth | Webmaster |
| Resend API key | Supabase custom SMTP, `supabase/.env` | Webmaster |
| Resend and registrar logins | Rare admin | President, webmaster |
| Vercel account login (if not SSO via GitHub) | Hosting | President, webmaster |
| Apps Script `ADMIN_KEY` (gallery) | Legacy backend until Phase 5 | Webmaster |

- When someone leaves a role, the secrets they could see are rotated (section 6),
  not merely "removed from the vault".
- A secret that has been pasted into a chat, an issue, a commit or a log is
  considered leaked and is rotated the same day, even if the message was deleted.

## 5. CI and deployment secrets (GitHub repository settings, Secrets and variables, Actions)

| Secret | Used by | Where it comes from |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | `db-deploy.yml` (`supabase link`, `db push`) | Supabase dashboard, Account, Access Tokens (`supabase.com/dashboard/account/tokens`). Create one named `github-actions-ausss`, owned by the webmaster's own Supabase login |
| `SUPABASE_DB_PASSWORD` | `db-deploy.yml` (`supabase link`) | Supabase dashboard, Project Settings, Database. Reset there if lost; that is also how it is rotated |
| `SUPABASE_PROJECT_ID` | `db-deploy.yml` | The project ref: `wjijkqrdaakiwbtdssio` |
| `SUPABASE_URL` | `keepalive.yml` | `https://wjijkqrdaakiwbtdssio.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `keepalive.yml` | Supabase dashboard, Project Settings, API Keys, the `sb_publishable_...` key |

Vercel environment variables (Project Settings, Environment Variables, both
Production and Preview):

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://wjijkqrdaakiwbtdssio.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The `sb_publishable_...` key (the name says ANON for compatibility with `src/lib/supabase.js`; it is the publishable key) |

Never create a `VITE_`-prefixed variable holding the secret key or the database
password: Vite ships every `VITE_*` value to the browser.

## 6. Term rollover checklist

Do this in the first two weeks of the new term, President and outgoing plus
incoming webmaster together. Tick each line; the order matters (transfer before
rotate, so nobody is locked out).

### 6.1 Transfer owner seats

- [ ] Supabase organisation: invite the incoming President and webmaster as
      Owner; confirm they accepted; then remove outgoing people. Never below two.
- [ ] GitHub: add the incoming webmaster as admin collaborator on
      `AUSSS-Website/AUSSS-Website-Project`; remove the outgoing one.
- [ ] Vercel: give the incoming webmaster access to the project (TODO: team or
      personal account, section 2.2); remove the outgoing one.
- [ ] Vault: add incoming people to the organisation; hand over the two
      recovery keys to the new key-holders; remove outgoing people.
- [ ] `aussswebsite@gmail.com`: update recovery phone/email if they belonged to
      an outgoing person.
- [ ] Review this document and `apps-script/MIGRATION.md` for stale names,
      fill any TODO you now know the answer to, and commit.

### 6.2 Rotate secrets

Rotate everything an outgoing person could see. RUNBOOK section 7 has the
step-by-step for the Supabase keys.

- [ ] Supabase secret key (`sb_secret_...`): create new, update `.env.local` on
      the webmaster's machine only, delete old.
- [ ] Supabase database password: reset in the dashboard; update GitHub secret
      `SUPABASE_DB_PASSWORD`; re-run `npm run db:link` locally.
- [ ] Supabase personal access tokens: revoke every token created by outgoing
      people; the incoming webmaster creates a new one and updates GitHub
      secret `SUPABASE_ACCESS_TOKEN`.
- [ ] Publishable key: rotate only if it was mishandled (it is not secret), but
      if you do, update Vercel env, GitHub `SUPABASE_PUBLISHABLE_KEY`,
      `.env.local`, and redeploy.
- [ ] Resend API key: create new, update Supabase Auth SMTP password and
      `supabase/.env`, delete old.
- [ ] Google OAuth client secret: only if an outgoing person had Cloud Console
      access; update Supabase Auth and `supabase/.env`.
- [ ] `AUSSS-Website` GitHub password and `aussswebsite@gmail.com` password:
      change, store in the vault, regenerate recovery codes.
- [ ] Any legacy Apps Script credentials (`ADMIN_KEY`, officer account
      passwords in the `Accounts` sheet) while those backends still run.

### 6.3 Run the database rollover

Exact SQL is in RUNBOOK section 9. In order:

- [ ] Insert the next term row (`terms`) if the reference-data migration has
      not already created it.
- [ ] `select public.set_current_term('<new term id>')` as an EB user (or as
      `postgres` in the SQL editor).
- [ ] End the old term's assignments: `update public.assignments set status =
      'ended', ended_on = current_date where term_id = '<old term id>' and
      status = 'active'`.
- [ ] Insert `invites` for every incoming officer and EB member (personal
      email, position key, new term id). Anyone who has already signed in is
      assigned immediately by the trigger; the rest are assigned on first sign-in.
- [ ] Insert the `society.webmaster` invite for the incoming webmaster.
- [ ] Verify: each incoming officer signs in at `/portal` and sees their
      position chip; the public committee pages show the right names.
- [ ] Also update the names, photos and role mailboxes in `src/data/society.js`:
      the public site still renders it as the static fallback under the
      officer-edited `committees.page` overrides, and `npm run db:gen-reference`
      derives positions and invites from it (RUNBOOK section 3).

### 6.4 Confirm the machines are still alive

- [ ] The `keepalive` GitHub Action ran in the last 24 hours (Actions tab).
      GitHub disables scheduled workflows after 60 days without repository
      activity; a rollover commit resets that clock.
- [ ] Supabase project is not paused (dashboard shows Active).
- [ ] Vercel production deploy is green and `/portal/sign-in` loads.
- [ ] Domain renewal date is more than 60 days away.

## 7. If everything is lost

Order of recovery, each step unlocks the next:

1. Vault recovery key (two EB members) restores access to every login below.
2. `aussswebsite@gmail.com` restores Google Cloud, Drive, Apps Script and the
   Supabase organisation.
3. Supabase dashboard: reset the database password; if the project was deleted,
   create a new one and run every file in `supabase/migrations` in order (the
   schema is fully reproducible from the repository), then re-import the roster
   (RUNBOOK section 4). Auth users are not reproducible; members sign in again
   and are re-claimed by email.
4. GitHub `AUSSS-Website` restores the code and CI; Vercel redeploys from it.
5. Update the redirect URIs, env vars and CI secrets in section 5 if any URL or
   key changed, then redeploy.
