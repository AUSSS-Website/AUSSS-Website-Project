// AUSSS magazine editions, read in-page as a page-flipping book (/magazine).
//
// Editions are listed NEWEST FIRST. /magazine opens on the latest published
// edition and shows a switcher listing every edition. To add one, prepend an
// object here and build its page images.
//
// Publishing an edition:
//   1. Rasterise the source PDF to web-sized page images:
//        node _source/build-magazine.mjs <issue-id> "<path-to.pdf>"
//      (writes public/assets/magazine/<issue-id>/pages/NNN.jpg). Set
//      `pages.count` to the number it reports.
//   2. Optional `download`: a full-quality copy hosted off-repo (a Drive link).
//   3. Optional `canva`: an "Open on Canva" link to the live design.
//   The header thumbnail is page 1; there is no separate cover file.
//
// A `missing: true` edition is a known back-issue we have no copy of yet. It
// keeps a slot in the switcher (so readers see the gap) and shows a "we're
// still locating this" placeholder pointing at ARCHIVE_CONTACT.

// Who to reach about missing editions. CBSD produces the magazine, so its
// inbox owns archive requests (matches aussscbsdd in src/data/society.js).
export const ARCHIVE_CONTACT = {
  team: 'CBSD',
  email: 'aussscbsdd@gmail.com',
}

const issueOne = {
  id: 'vol-1',
  title: 'Volume 1',
  date: 'Vol. 01 · March', // the masthead reads "The Magazine · Vol. 01 · March"
  pages: { base: '/assets/magazine/vol-1/pages', count: 32 },
  download: 'https://drive.google.com/file/d/12ancWzotqyaZ4hf0mvw9mH6IowHS6xHO/view',
}

const issueTwo = { id: 'vol-2', title: 'Volume 2', missing: true }

const issueThree = {
  id: 'vol-3',
  title: 'Palestine', // themed solidarity issue
  switcherLabel: 'Palestine, Vol. 3',
  date: 'Vol. 03 · December',
  pages: { base: '/assets/magazine/vol-3/pages', count: 42 },
  download: 'https://drive.google.com/file/d/1SQoJCpbFo2naY_1hw2h_77h0cXRTi679/view',
}

const issueFour = { id: 'vol-4', title: 'Volume 4', missing: true }

const issueFive = {
  id: 'vol-5',
  title: 'Volume 5',
  date: '5th Edition', // the masthead reads "AUSSS Magazine · 5th Edition"
  pages: { base: '/assets/magazine/vol-5/pages', count: 19 },
  download: 'https://drive.google.com/file/d/1jmY2TL1r8UuqKXePgxQgHYqXJWTjuwyU/view',
}

const issueSix = {
  id: 'vol-6',
  title: 'The Story of Origin, Vol. 6',
  date: 'A CBSD production',
  blurb:
    'The sixth volume of the AUSSS Magazine. Read it in full below or download it, and share it with your friends.',
  pages: { base: '/assets/magazine/vol-6/pages', count: 30 },
  download: 'https://drive.google.com/file/d/17zMEOGekcoC09X4NDcgBxFlgaA-FiXuw/view',
  canva: 'https://www.canva.com/design/DAHGTEatDDQ/0BPis3tFKLYKp4OCFfUVXw/view',
}

const issueSeven = {
  id: 'vol-7',
  title: 'Summer',
  // The switcher spells out the volume; the page header stays a clean "Summer".
  switcherLabel: 'Summer, Vol. 7',
  date: 'Volume 7 · A CBSD production',
  blurb:
    'The seventh volume of the AUSSS Magazine. Read it in full below or download it, and share it with your friends.',
  pages: { base: '/assets/magazine/vol-7/pages', count: 23 },
  download: 'https://drive.google.com/file/d/1bI7nD273A_3t8vtUwUtBlL7jOaU6IsW9/view',
  canva: 'https://canva.link/buxysnx205xfisq',
}

// Newest first: the shelf order shown in the switcher.
const issues = [issueSeven, issueSix, issueFive, issueFour, issueThree, issueTwo, issueOne]

// An edition is readable once it has flipbook pages or a Canva embed.
function isPublished(issue) {
  return Boolean(issue && (issue.pages?.count || issue.canva))
}

export function isMissing(issue) {
  return Boolean(issue && issue.missing)
}

// Everything that gets a slot in the switcher: readable editions plus the
// known-missing ones. A bare draft (no pages, no canva, not missing) never
// shows, so one can be scaffolded before its images exist.
export const shelfIssues = issues.filter((i) => isPublished(i) || isMissing(i))

// The latest readable edition, where /magazine opens.
export const magazine = issues.find(isPublished) || null
