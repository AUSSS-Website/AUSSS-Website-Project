// /exchange/incomings: the page for a student abroad who is choosing where to
// spend an exchange month, written in our own voice ("we", "our", "us").
// Edited by the exchange officers (SCOPE and SCORE) and the EB.
//
// Not in this document: the page's title and search description
// (src/data/society.js, src/seo/pages.js), the officers' contact cards (their
// portal profiles), the welcome booklet (src/data/incomingsBooklet.js) and the
// two track cards (src/data/society.js).
//
// The copy below is what the page shows until an officer publishes. Its facts
// come from our own incomings booklet (the dorms, the hospital, the social
// programme, the trips, the tips); the six pictures are cut from the same
// booklet (public/assets/exchange/incomings).
export default {
  key: 'exchange.incomings',
  title: 'Exchange: the incomings page',
  description:
    'The page for students choosing where to go on exchange: who we are, what we give them, why to choose us, how to get here and what to know before landing.',
  path: '/exchange/incomings',
  editors: ['scope', 'score'],
  fields: [
    {
      name: 'intro',
      type: 'textarea',
      label: 'Introduction',
      required: true,
      max: 500,
      help: 'The paragraph under the page title. Speak as "we", to "you".',
    },
    {
      name: 'facts',
      type: 'list',
      label: 'Figures under the introduction',
      itemLabel: 'figure',
      titleField: 'figure',
      max: 4,
      fields: [
        { name: 'figure', type: 'text', label: 'Figure', required: true, max: 12 },
        { name: 'label', type: 'text', label: 'What it counts', required: true, max: 70 },
      ],
    },
    {
      name: 'points',
      type: 'list',
      label: 'What we give you',
      itemLabel: 'point',
      titleField: 'text',
      max: 8,
      fields: [{ name: 'text', type: 'text', label: 'Point', required: true, max: 200 }],
    },
    {
      name: 'sections',
      type: 'list',
      label: 'Why choose us',
      itemLabel: 'reason',
      titleField: 'title',
      max: 8,
      fields: [
        { name: 'title', type: 'text', label: 'Heading', required: true, max: 80 },
        { name: 'body', type: 'markdown', label: 'Text', required: true, max: 1500 },
        { name: 'image', type: 'image', label: 'Picture (optional)' },
      ],
    },
    {
      name: 'steps',
      type: 'list',
      label: 'How you get to us',
      itemLabel: 'step',
      titleField: 'title',
      max: 6,
      fields: [
        { name: 'title', type: 'text', label: 'Step', required: true, max: 80 },
        { name: 'body', type: 'textarea', label: 'Text', required: true, max: 400 },
      ],
    },
    {
      name: 'tips',
      type: 'list',
      label: 'Before you land',
      itemLabel: 'tip',
      titleField: 'title',
      max: 10,
      fields: [
        { name: 'title', type: 'text', label: 'Subject', required: true, max: 80 },
        { name: 'body', type: 'markdown', label: 'Tip', required: true, max: 800 },
      ],
    },
    {
      name: 'album',
      type: 'album',
      label: 'Photos of our incomings',
      help: 'A gallery album to show on the page. The photos themselves are managed in the Gallery editor.',
    },
    {
      name: 'showContacts',
      type: 'toggle',
      label: 'Show who to write to',
      help: 'The LEO-In and the LORE, with the name and photo from their portal profiles and their work email.',
      default: true,
    },
    {
      name: 'nationalBooklet',
      type: 'url',
      label: 'Our page in the IFMSA-Egypt welcome booklet',
      help: 'The address of the national exchange welcome booklet, or of our page in it. Leave empty to show no link.',
    },
    {
      name: 'links',
      type: 'list',
      label: 'Links at the foot of the page',
      itemLabel: 'link',
      titleField: 'label',
      max: 6,
      fields: [
        { name: 'label', type: 'text', label: 'Label', required: true, max: 60 },
        { name: 'href', type: 'url', label: 'Address', required: true },
      ],
    },
  ],
  defaults: {
    intro:
      'We are AUSSS, the green family: the medical students of Ain Shams University in Cairo, and one of the oldest and most active local committees of IFMSA-Egypt. Spend your exchange month with us. You train at our Specialized Hospital, you live on campus, and we show you Cairo and the rest of Egypt the way we live them.',
    facts: [
      { figure: '1971', label: 'the year AUSSS was founded' },
      { figure: '1984', label: 'the year our Specialized Hospital opened' },
      { figure: '4 weeks', label: 'with us, for a clerkship or a research project' },
      { figure: '1 of us', label: 'paired with you as your contact person' },
    ],
    points: [
      { text: 'A clinical clerkship (SCOPE) or a research project (SCORE) at Ain Shams, with a doctor or mentor supervising you.' },
      { text: 'A bed in the hospital dorms, on campus, and at least one meal a day.' },
      { text: 'A contact person: one of us, paired with you for the whole month.' },
      { text: 'A social programme all month, and a trip out of Cairo most weekends.' },
      { text: 'Your official IFMSA certificate at the end, with at least 80% attendance.' },
    ],
    sections: [
      {
        title: 'You train at our Specialized Hospital',
        body: 'Your clerkship is at ASUSH, the Ain Shams University Specialized Hospital, which opened in 1984. From orthopaedic surgery to ophthalmology you will find the specialty you are after, and you will assist some of the best surgeons in the country.',
        image: '/assets/exchange/incomings/hospital.jpg',
      },
      {
        title: 'You live on campus',
        body: 'We put you up in the hospital dorms, in a building on the same campus as the hospital, so your day starts with a short walk and not a commute. We have two rooms, each made for four students.',
        image: '/assets/exchange/incomings/campus.jpg',
      },
      {
        title: 'One of us is with you all month',
        body: 'We pair each of you with a contact person: one of our members, who meets you, shows you around the hospital and the city, and picks up when you call, at any time of day.',
        image: '/assets/exchange/incomings/together.jpg',
      },
      {
        title: 'A social programme students fly in for',
        body: 'We are proud of it. For a whole month you live like a true Egyptian: yes, we visit the Pyramids, but there are also nights at Cairo Jazz Club, board games at Monoplay, shopping at 5A and food you will keep talking about.',
        image: '/assets/exchange/incomings/social.jpg',
      },
      {
        title: 'Cairo, the city that never sleeps',
        body: 'We are in the capital, so there is always more: Zamalek and Coptic Cairo, a felucca on the Nile, Islamic Cairo and Khan el Khalili, the Baron Palace in Korba, the Grand Egyptian Museum, and koshary at Abou Tarek.',
        image: '/assets/exchange/incomings/cairo.jpg',
      },
      {
        title: 'A new corner of Egypt most weekends',
        body: 'Each weekend we try to plan a trip: the sea in Alexandria, the salt lakes of Siwa, the temples of Luxor and Aswan, the Red Sea in Dahab. Name the city and we will take you.',
        image: '/assets/exchange/incomings/egypt.jpg',
      },
    ],
    steps: [
      {
        title: 'Apply through your own committee',
        body: 'Exchanges are arranged between IFMSA’s member organisations, so your application starts at home, with your local and national exchange officers.',
      },
      {
        title: 'Choose Egypt, then choose us',
        body: 'When you fill in your application on the IFMSA exchange platform, pick Egypt and put Ain Shams University (AUSSS) among your preferred local committees.',
      },
      {
        title: 'We send your acceptance',
        body: 'Once you are placed with us you receive your card of acceptance, with your department and your dates, and we get in touch.',
      },
      {
        title: 'We meet you in Cairo',
        body: 'Your contact person takes it from there. Our welcome booklet, further down this page, has everything else.',
      },
    ],
    tips: [
      {
        title: 'Getting around',
        body: 'You will mostly use Uber or inDrive. Drivers pick you up at the hospital gate and drop you off there too.',
      },
      {
        title: 'Your SIM card',
        body: 'Buy one at the airport when you arrive. We recommend Orange.',
      },
      {
        title: 'Money',
        body: 'Do not exchange all your money at once. Pay by card and change small amounts when you need them; we can help. Most trips are paid in foreign currency, and changing back is not possible.',
      },
      {
        title: 'What to pack and wear',
        body: 'If you come in January or February, bring a hoodie: it gets chilly at night. Most of the time you can wear what you like. When we visit a mosque or anywhere that asks for modest dress, we message you beforehand.',
      },
      {
        title: 'If anything happens',
        body: 'Keep your passport with you, and call us at any time of day.',
      },
    ],
    album: '',
    showContacts: true,
    nationalBooklet: '',
    links: [
      { label: 'Egypt on the IFMSA exchange platform', href: 'https://exchange.ifmsa.org/explore-pages/national/view/6' },
      { label: 'Our exchange team on Instagram', href: 'https://www.instagram.com/ausssexchanges_/' },
    ],
  },
}
