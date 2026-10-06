// /exchange/outgoings: the page for one of our own students, a medical student
// at Ain Shams thinking of going abroad on exchange, written in our own voice
// ("we", "our", "us", to "you"). Edited by the exchange officers (SCOPE and
// SCORE) and the EB.
//
// Not in this document: the page's title and search description
// (src/data/society.js, src/seo/pages.js), the officers' contact cards (their
// portal profiles), the two track cards (src/data/society.js) and the stories
// (sent through /exchange/share).
//
// The copy below is what the page shows until an officer publishes. Every fact
// in it was already on the site: the outgoing page's own points and its
// application steps, and what src/data/society.js says SCOPE, SCORE and the
// exchange team do. Keep it that way: a fact we cannot stand behind stays out.
export default {
  key: 'exchange.outgoings',
  title: 'Exchange: the outgoings page',
  description:
    'The page for our own students thinking of going abroad: what the exchange gives them, why to go, how to apply and what to sort out before they fly.',
  path: '/exchange/outgoings',
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
      label: 'What the exchange gives you',
      itemLabel: 'point',
      titleField: 'text',
      max: 8,
      fields: [{ name: 'text', type: 'text', label: 'Point', required: true, max: 200 }],
    },
    {
      name: 'sections',
      type: 'list',
      label: 'Why go',
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
      label: 'How to apply',
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
      label: 'Before you fly',
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
      label: 'Photos of our outgoings',
      help: 'A gallery album to show on the page. The photos themselves are managed in the Gallery editor.',
    },
    {
      name: 'showContacts',
      type: 'toggle',
      label: 'Show who to write to',
      help: 'The LEO-Out and the LORE, with the name and photo from their portal profiles and their work email.',
      default: true,
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
      'Four weeks in a hospital or a lab somewhere else in the world, arranged through IFMSA. You pick the country, apply through us and IFMSA-Egypt, and arrive to lodging, a meal a day and a doctor or mentor expecting you. We take you through every step, from the exchange exam to the day you fly.',
    facts: [
      { figure: '4 weeks', label: 'abroad, in a hospital or a lab' },
      { figure: '2 tracks', label: 'SCOPE for a clerkship, SCORE for research' },
      { figure: '80%', label: 'attendance earns your official certificate' },
      { figure: 'Lodging', label: 'and at least one meal a day while you are there' },
    ],
    points: [
      { text: 'A four-week clinical clerkship (SCOPE) or research project (SCORE), in the country you pick.' },
      { text: 'Lodging and at least one meal a day while you are there.' },
      { text: 'A doctor or a mentor supervising you for the whole four weeks.' },
      { text: 'Us, before you go: help with your documents and a pre-departure orientation.' },
      { text: 'Your official IFMSA certificate at the end, with at least 80% attendance.' },
    ],
    sections: [
      {
        title: 'Medicine in another country',
        body: 'On a SCOPE clerkship you spend four weeks in a clinical department of a hospital abroad, with a doctor supervising you. You see how medicine is practised somewhere else, alongside future doctors from across the globe.',
        image: '',
      },
      {
        title: 'Real research, with a mentor',
        body: 'On a SCORE exchange you spend four weeks on a research project abroad, under a mentor, with a structured plan that runs from the literature review to the final report.',
        image: '',
      },
      {
        title: 'We take you through it',
        body: 'You are not left to work out IFMSA on your own. Our exchange team runs the exam and the interviews, matches you to your contract, checks your documents with you and prepares you before you fly. The LEO-Out looks after clinical exchanges and the LORE research ones.',
        image: '',
      },
    ],
    steps: [
      {
        title: 'Exchange exam',
        body: 'Register when the exchange exam opens, then sit it.',
      },
      {
        title: 'Interview',
        body: 'Attend your exchange interview with us.',
      },
      {
        title: 'Get your contract',
        body: 'If you are selected, we match you to your exchange contract.',
      },
      {
        title: 'Prepare and travel',
        body: 'Get your documents ready, join our pre-departure orientation, then travel for your four weeks.',
      },
      {
        title: 'Certificate',
        body: 'Finish with at least 80% attendance and receive your official certificate.',
      },
    ],
    tips: [
      {
        title: 'Your documents',
        body: 'Your application needs the required documents, so start gathering them early. We check them with you before anything is sent.',
      },
      {
        title: 'Your passport and visa',
        body: 'Make sure your passport is valid for the whole trip. As soon as you have your contract, look up what your host country asks of you to enter, and apply early if it needs a visa: it can take weeks.',
      },
      {
        title: 'Health insurance',
        body: 'Have health insurance that covers you for the whole of your stay abroad.',
      },
      {
        title: 'Our pre-departure orientation',
        body: 'Before you fly, our exchange team prepares you in a pre-departure orientation, and guides you on having your exchange recognised academically. Bring your questions to it.',
      },
      {
        title: 'Your attendance',
        body: 'Your certificate needs at least 80% attendance, so plan any travel around your four weeks, not the other way round.',
      },
    ],
    album: '',
    showContacts: true,
    links: [
      { label: 'IFMSA exchange portal', href: 'https://exchange.ifmsa.org' },
      { label: 'Our exchange team on Instagram', href: 'https://www.instagram.com/ausssexchanges_/' },
    ],
  },
}
