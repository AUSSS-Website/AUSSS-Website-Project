// The AUSSS Incomings Booklet: the welcome guide the exchange team sends to
// students coming to Ain Shams on a SCOPE (clinical) or SCORE (research)
// exchange. It is read on /exchange/incomings in the same page-flipping reader
// as the magazine (src/components/Flipbook.jsx).
//
// Rebuilding the page images (the source PDF is ~115 MB, far too heavy to ship):
//   node _source/build-magazine.mjs incomings "_source/pdf/incomings-booklet.pdf" \
//     public/assets/exchange/incomings-booklet/pages
// That writes NNN.jpg into the folder below; set `pages.count` to the number
// it reports.

export const incomingsBooklet = {
  title: 'The Incomings Booklet',
  // Small label above the title.
  eyebrow: 'SCOPE & SCORE · Ain Shams',
  blurb:
    'Everything an incoming exchange student needs before landing in Cairo: who we are, the hospital and the dorms you’ll live in, the month-long social programme, weekend trips across Egypt, and the team who’ll be looking after you.',
  // What's inside, shown as a short contents list next to the cover.
  contents: [
    'Who we are: AUSSS, IFMSA-Egypt and IFMSA',
    'Ain Shams: the faculty and the ASU Specialized Hospital',
    'Accommodation, the clerkship and the specialties on offer',
    'The social programme: a month of living like a Cairene',
    'Travel and discovery: Alexandria, Siwa, Luxor, Aswan, Dahab',
    'Final tips for landing, money, SIM cards and dress code',
    'Meet the current exchange team',
  ],
  pages: { base: '/assets/exchange/incomings-booklet/pages', count: 11 },
  // A full-quality copy hosted off-repo for a Download button. Empty = hidden.
  download: '',
}
