// AUSSS magazine editions, each read in-page as a page-flipping book
// (drives /magazine).
//
// ── Multiple issues ──────────────────────────────────────────────────────────
// Issues live in the `issues` array below, NEWEST FIRST. /magazine opens on the
// latest published edition and shows a switcher listing every edition. Adding a
// new one = prepend an object here (and build its page images, see below).
//
// Publishing an edition:
//   1. Rasterise the source PDF to web-sized page images by running
//        node _source/build-magazine.mjs <issue-id> "<path-to.pdf>"
//      (writes public/assets/magazine/<issue-id>/pages/NNN.jpg). Set
//      `pages.count` to the number it reports; `base` to that folder.
//   2. (Optional) `download`: a full-quality copy hosted off-repo (Drive link).
//   3. (Optional) `canva`: an "Open on Canva" link to the live design.
//   4. The header thumbnail is page 1 automatically; no cover file needed.
//
// ── Missing back-issues ──────────────────────────────────────────────────────
// A `missing: true` edition is one we haven't tracked down a copy of yet. It
// still gets a slot in the switcher (so readers see the gap) and renders a
// "we're still locating this" placeholder pointing at ARCHIVE_CONTACT, instead
// of a reader.
//
// A "draft" issue (no pages, no canva, not missing) is UNPUBLISHED: it never
// appears and never renders, so it's safe to scaffold before its images exist.

// Who to reach about missing editions, shown on the placeholder for any
// `missing` edition. CBSD produces the magazine, so its inbox owns archive
// requests (matches aussscbsdd in src/data/society.js).
export const ARCHIVE_CONTACT = {
  team: 'CBSD',
  email: 'aussscbsdd@gmail.com',
}

// ── Vol 1 ────────────────────────────────────────────────────────────────────
const issueOne = {
  id: 'vol-1',
  title: 'Volume 1',
  date: 'Vol. 01 · March', // masthead reads "The Magazine · Vol. 01 · March"
  blurb: '',
  cover: null, // thumbnail derives from page 1
  pages: { base: '/assets/magazine/vol-1/pages', count: 32, pad: 3, ext: 'jpg' },
  download:
    'https://drive.google.com/file/d/12ancWzotqyaZ4hf0mvw9mH6IowHS6xHO/view',
  canva: '',
  aspect: null,
}

// ── Vol 2, MISSING ──────────────────────────────────────────────────────────
const issueTwo = {
  id: 'vol-2',
  title: 'Volume 2',
  missing: true,
  date: '',
  blurb: '',
  cover: null,
  aspect: null,
}

// ── Vol 3 ────────────────────────────────────────────────────────────────────
const issueThree = {
  id: 'vol-3',
  title: 'Palestine', // themed solidarity issue (فلسطين / Dome of the Rock / Gaza)
  switcherLabel: 'Palestine, Vol. 3',
  date: 'Vol. 03 · December',
  blurb: '',
  cover: null,
  pages: { base: '/assets/magazine/vol-3/pages', count: 42, pad: 3, ext: 'jpg' },
  download:
    'https://drive.google.com/file/d/1SQoJCpbFo2naY_1hw2h_77h0cXRTi679/view',
  canva: '',
  aspect: null,
}

// ── Vol 4, MISSING ──────────────────────────────────────────────────────────
const issueFour = {
  id: 'vol-4',
  title: 'Volume 4',
  missing: true,
  date: '',
  blurb: '',
  cover: null,
  aspect: null,
}

// ── Vol 5 ────────────────────────────────────────────────────────────────────
const issueFive = {
  id: 'vol-5',
  title: 'Volume 5',
  date: '5th Edition', // masthead reads "AUSSS Magazine · 5th Edition"
  blurb: '',
  cover: null,
  pages: { base: '/assets/magazine/vol-5/pages', count: 19, pad: 3, ext: 'jpg' },
  download:
    'https://drive.google.com/file/d/1jmY2TL1r8UuqKXePgxQgHYqXJWTjuwyU/view',
  canva: '',
  aspect: null,
}

// ── Vol 6, "The Story of Origin" ───────────────────────────────────────────
const issueSix = {
  id: 'vol-6',
  title: 'The Story of Origin, Vol. 6',
  // Human-readable cover line; kept as a string so it renders verbatim.
  date: 'A CBSD production',
  blurb:
    'The sixth volume of the AUSSS Magazine. Read it in full below or download it, and don’t forget to share it with your friends.',
  cover: '/assets/magazine/vol-6/cover.jpg',
  pages: {
    base: '/assets/magazine/vol-6/pages',
    count: 30,
    pad: 3, // zero-padding in the filenames, e.g. 001.jpg
    ext: 'jpg',
  },
  // Full-quality copy for the Download button (hosted off-repo).
  download:
    'https://drive.google.com/file/d/17zMEOGekcoC09X4NDcgBxFlgaA-FiXuw/view',
  // Canva "view" share link, kept as an "Open on Canva" fallback.
  canva: 'https://www.canva.com/design/DAHGTEatDDQ/0BPis3tFKLYKp4OCFfUVXw/view',
  aspect: null,
}

// ── Vol 7, "Summer" ─────────────────────────────────────────────────────────
const issueSeven = {
  id: 'vol-7',
  title: 'Summer',
  // Label for the edition-switcher button (falls back to `title`). Kept
  // separate so the page header can stay a clean "Summer" while the switcher
  // still spells out the volume.
  switcherLabel: 'Summer, Vol. 7',
  date: 'Volume 7 · A CBSD production',
  blurb:
    'The seventh volume of the AUSSS Magazine. Read it in full below or download it, and don’t forget to share it with your friends.',
  cover: '/assets/magazine/vol-7/cover.jpg',
  pages: {
    base: '/assets/magazine/vol-7/pages',
    count: 23, // built from _source/Summer volume 7.pdf (build-magazine.mjs)
    pad: 3,
    ext: 'jpg',
  },
  download:
    'https://drive.google.com/file/d/1bI7nD273A_3t8vtUwUtBlL7jOaU6IsW9/view',
  canva: 'https://canva.link/buxysnx205xfisq',
  aspect: null,
}

// Newest first, this is the shelf order shown in the switcher.
export const issues = [
  issueSeven,
  issueSix,
  issueFive,
  issueFour,
  issueThree,
  issueTwo,
  issueOne,
]

// An issue is "published" (readable) once it has flipbook pages OR a Canva embed.
export function isPublished(issue) {
  return Boolean(issue && (issue.pages?.count || issue.canva))
}

// A "missing" issue is a known back-issue we haven't found a copy of yet.
export function isMissing(issue) {
  return Boolean(issue && issue.missing)
}

export const publishedIssues = issues.filter(isPublished)

// Everything that gets a slot on the shelf / switcher: real editions plus the
// known-missing ones (so readers can see the gaps). Excludes bare drafts.
export const shelfIssues = issues.filter((i) => isPublished(i) || isMissing(i))

// Back-compat default: the latest published edition. MagazinePage opens here.
export const magazine = publishedIssues[0] || null
