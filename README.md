# AUSSS, Ain Shams University Students' Scientific Society

A high-end, responsive single-page site for AUSSS.
*Empowering Medical Research and Student Exchange.*

## Stack

- **React 18** + **Vite 5**
- **Tailwind CSS 3** (custom forest-green / medical-blue design system)
- Zero runtime dependencies beyond React

## Design language

| Token            | Value     | Use                         |
| ---------------- | --------- | --------------------------- |
| `forest` (700)   | `#06402B` | Primary brand               |
| `forest` (950)   | `#021c12` | Dark sections / hero        |
| `medical`        | `#5B8DB8` | Scientific blue accent      |
| `silver`         | `#C9D6DF` | Light silver detail         |
| `cream`          | `#FAFCFB` | Light section background    |

Typography pairs **Cormorant Garamond** (serif headings, "academic
journal") with **Inter** (UI sans, "modern tech").

## Architecture

- **Hero**, `AUSSS` title + tagline over an animated canvas
  node-connection network (molecular/neural motif). Respects
  `prefers-reduced-motion`.
- **About Us**, mission: bridging clinical practice and research.
- **Executive Board**, hierarchical tiers (Patron → President →
  Vice Presidents → Officers) with connectors.
- **Team of Officials**, searchable, category-filtered, mobile-first
  grid of the 6 standing committees and 4 support divisions.
- **Registration Portal**, formal "Member Portal" entry card with a
  3-step process and a working demo form.
- Sticky transparent→solid navbar, back-to-top button, scroll-reveal
  animations, smooth section scrolling.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in /dist, then pre-renders every public page
npm run preview:prerendered  # serve /dist the way Vercel does (pre-rendered pages + spa.html fallback)
npm run preview  # Vite's preview (SPA only: it does not show the pre-rendered pages)
```

Public pages are listed in `src/seo/pages.js`; the build writes one HTML file per
entry plus `sitemap.xml` and `llms.txt` (see `docs/RUNBOOK.md`, section 15).

## Customizing

- People & committees: `src/data/society.js`
- Colors / animation: `tailwind.config.js`
- Background density/speed: `src/components/NetworkBackground.jsx`

Names are placeholders, replace them in `src/data/society.js`.

## Backends

The live features (officer editor, gallery takedown, merch orders, signups,
exchange stories, magazine counters) are Google Apps Script web apps whose
URLs live in `src/data/*Config.js`. They currently run under the rotating
`loreausss@gmail.com` role account and are being moved to a permanent
`aussswebsite@gmail.com` — see [`apps-script/MIGRATION.md`](./apps-script/MIGRATION.md).
