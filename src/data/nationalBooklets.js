// The two booklets IFMSA-Egypt's national exchange team gives every incoming
// student, read on /exchange/incomings under our own (NationalBooklets.jsx).
//
// The welcome booklet ships as the team made it. The exchange booklet is 75 MB
// as exported (print-size photos, decoration as vector art), so the site
// carries a web copy: every page drawn once as a picture, with the words put
// back as an invisible layer (so it can still be searched and selected) and
// the links kept. To rebuild it from a new edition:
//   python -I _source/web-pdf.py "_source/pdf/IFMSA-Egypt Exchange Booklet.pdf" \
//     public/assets/exchange/booklets/IFMSA-Egypt-Exchange-Booklet.pdf 1200 66
// then check `pages`, `size` and the pages our profile is on.

export const nationalBooklets = [
  {
    id: 'ifmsa-egypt-exchange-booklet',
    title: 'The IFMSA-Egypt exchange booklet',
    src: '/assets/exchange/booklets/IFMSA-Egypt-Exchange-Booklet.pdf',
    blurb:
      'The national team’s case for an exchange in Egypt: how the placements are taught and looked after, the social programme, a profile of every local committee in the country, and the questions students ask most. We are on pages 33 and 34.',
    meta: '71 pages · PDF, 19 MB',
    // Our own profile in it.
    jump: { label: 'Open at our pages', page: 33 },
  },
  {
    id: 'ifmsa-egypt-welcome-booklet',
    title: 'The IFMSA-Egypt welcome booklet',
    src: '/assets/exchange/booklets/IFMSA-Egypt-Welcome-Booklet-2022-23.pdf',
    blurb:
      'Egypt in practice: the weather, SIM cards and the internet, money, airports, getting around, the food to try, healthcare, and what students who came before you say about it.',
    meta: '2022-23 edition · 30 pages · PDF, 5 MB',
  },
]
