// The AUSSS Incomings Booklet, the welcome guide the Exchange Committee sends
// to students coming to Ain Shams on a SCOPE (clinical) or SCORE (research)
// exchange. It's read on /exchange/incomings in the same page-flipping reader
// magazine uses (src/components/Flipbook.jsx).
//
// Rebuilding the page images (the source PDF is ~115 MB, far too heavy to ship):
//   node _source/build-magazine.mjs incomings "_source/pdf/incomings-booklet.pdf" \
//     public/assets/exchange/incomings-booklet/pages
// That writes NNN.jpg into the folder below, set `pages.count` to the number
// it reports.
//
// `download` is optional: point it at a full-quality copy hosted off-repo (the
// magazines use Drive links) and a Download button appears. Left empty until
// the Exchange Committee shares one.

export const incomingsBooklet = {
  id: 'incomings',
  title: 'The Incomings Booklet',
  // Small label above the title.
  eyebrow: 'SCOPE & SCORE · Ain Shams',
  blurb:
    'Everything an incoming exchange student needs before landing in Cairo: who we are, the hospital and dorms you’ll live in, the month-long social programme, weekend trips across Egypt, and the team who’ll be looking after you.',
  // What's inside, shown as a short contents list next to the cover.
  contents: [
    'Who we are: AUSSS, IFMSA-Egypt and IFMSA',
    'Ain Shams: the faculty and ASU Specialized Hospital',
    'Accommodation, clerkship and the specialties on offer',
    'The social programme: a month of living like a Cairene',
    'Travel & discovery: Alexandria, Siwa, Luxor, Aswan, Dahab',
    'Final tips for landing, money, SIM cards and dress code',
    'Meet the current Exchange Team',
  ],
  pages: {
    base: '/assets/exchange/incomings-booklet/pages',
    count: 11,
    pad: 3,
    ext: 'jpg',
  },
  // Full-quality copy for a Download button (hosted off-repo). Empty = hidden.
  download: '',
}

// Page URLs for the flipbook reader, in order.
export function bookletPageUrls(booklet = incomingsBooklet) {
  const p = booklet.pages
  if (!p?.count) return []
  return Array.from({ length: p.count }, (_, i) => {
    const n = String(i + 1).padStart(p.pad || 3, '0')
    return `${p.base}/${n}.${p.ext || 'jpg'}`
  })
}

// The cover is simply page 1, no separate cover file to keep in sync.
export function bookletCover(booklet = incomingsBooklet) {
  return bookletPageUrls(booklet)[0] || null
}
