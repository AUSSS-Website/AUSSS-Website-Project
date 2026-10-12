# AUSSS, Ain Shams University Students' Scientific Society

The public website and members portal of AUSSS, the IFMSA society at the
Faculty of Medicine, Ain Shams University. Live at
[ausss-ainshams.org](https://ausss-ainshams.org).

## Stack

- **React 18** + **Vite 5**, React Router 7, Tailwind CSS 3
- **Supabase** for the members portal (auth, database, edge functions) and for
  the public reads that need live data (membership lookup, committee page
  overrides, site settings, open calls, the photo gallery, the magazine shelf
  and its reading statistics)
- The public forms (merch orders, exchange stories, the recruitment waitlist)
  write to Supabase too and are triaged in the portal under Submissions; the
  Apps Script web apps that used to serve them are retired (see
  [`apps-script/`](./apps-script), kept for the roster sync and as an archive)
- The exchange exam runs on Supabase as well: registered students sit it on
  their phones at a hidden address with its own Google sign-in, the database
  marks it, and the exchange officers read the results in the portal
- Hosted on **Vercel** through the GitHub integration; `vercel.json` holds the
  headers, CSP and the SPA rewrite

## Getting started

```bash
npm install
npm run dev                  # http://localhost:5173
npm run build                # production bundle in /dist, then pre-renders every public page
npm run preview:prerendered  # serve /dist the way Vercel does (pre-rendered pages + spa.html fallback, same response headers)
npm run walk                 # open every page at several widths in both themes: screenshots + console report (docs/RUNBOOK.md section 21)
npm run guide                # take the website guide's pictures and print it as a PDF (docs/guide/README.md)
npm test                     # unit tests (Vitest): the markdown reader, the content schemas, the exam's rules and more
npm run preview              # Vite's preview (SPA only: it does not show the pre-rendered pages)
```

Copy `.env.example` to `.env.local` and fill in the Supabase keys for the
portal and the live reads; without them the public site still builds and falls
back to its static content.

## Where things live

| What | Where |
| --- | --- |
| People, committees and page copy | `src/data/society.js` |
| Join-page FAQ | The portal content editor (`/portal/content`, EB); `src/data/faq.js` is the copy shown until one is published |
| Incomings exchange page copy | The portal content editor (`/portal/content`, exchange officers and EB) |
| Parts of pages edited from the portal | Schemas in `src/content/`, documents in `content_blocks` (`docs/RUNBOOK.md` section 25) |
| Magazine editions | The portal magazine editor (`/portal/magazine`, CBSD and EB) |
| Merch catalogue, orders and the orders switch | Portal, Merch page (EB); `src/data/merchProducts.js` is only the fallback copy |
| Merch payment handles | `src/data/merchConfig.js` |
| Form switches (waitlist, stories, orders) | `src/data/*Config.js` |
| Merch orders, exchange stories, waitlist sign-ups | The portal Submissions page (`/portal/submissions`, EB; exchange officers for stories) |
| Gallery albums | The portal gallery editor (`/portal/gallery`, PNSD and EB) |
| Exchange exam: questions, registered student IDs, results | The portal Exam page (`/portal/exam`, SCOPE and SCORE officers and EB) |
| Exchange exam as students sit it | `src/exam/`, at `/exam/<word>`; the word is set in the portal and nothing links to it (`docs/RUNBOOK.md` section 30) |
| Public page list, titles, descriptions, sitemap | `src/seo/pages.js` |
| Colours and animations | `tailwind.config.js` |
| Members portal | `src/portal/`, `src/auth/`, `supabase/` |

## Design language

| Token | Value | Use |
| --- | --- | --- |
| `forest` (700) | `#06402B` | Primary brand |
| `forest` (950) | `#021c12` | Dark sections and hero |
| `medical` | `#5B8DB8` | Scientific blue accent |
| `silver` | `#C9D6DF` | Light silver detail |
| `cream` | `#FAFCFB` | Light section background |

Headings are set in **Cormorant Garamond**, everything else in **Inter**.

## Docs

- [`docs/RUNBOOK.md`](./docs/RUNBOOK.md): day-to-day operations (migrations,
  roster, term rollover, discoverability, the content editor, the exchange
  exam)
- [`docs/HANDOVER.md`](./docs/HANDOVER.md): every account the site depends on
  and who holds it
- [`docs/guide/`](./docs/guide/README.md): the website guide for visitors,
  members, officers and the board, as chapters and a list of pictures that one
  command prints as a PDF
- [`docs/PORTAL_BACKEND_PLAN.md`](./docs/PORTAL_BACKEND_PLAN.md): the portal
  design and its phases
- [`apps-script/MIGRATION.md`](./apps-script/MIGRATION.md): moving the Google
  assets to the society's permanent account

## Maintenance scripts

- `node scripts/make-icons.mjs` rebuilds the favicon set after a logo change
- `scripts/exam-rehearsal.mjs` plays 400 made-up students through a mock
  exchange exam and checks the marking. It runs only against a local Supabase
  stack, so normally on GitHub: Actions > exam-rehearsal > Run workflow
  (`docs/RUNBOOK.md` section 30)
- `node scripts/psychometrics/check_quiz.mjs` sanity-checks the Sorting quiz
  scoring (every committee reachable)
- `python scripts/psychometrics/build_norms.py` regenerates the quiz norms
  (see `scripts/psychometrics/README.md`)
