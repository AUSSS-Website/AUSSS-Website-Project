import { exchange } from '../../data/society.js'

// /exchange/incomings: the page for students thinking of coming to Ain Shams
// on exchange. Edited by the exchange officers (SCOPE and SCORE) and the EB.
// The page's title and its search description stay in src/data/society.js and
// src/seo/pages.js; the officers' contact cards come from their portal
// profiles; the welcome booklet is src/data/incomingsBooklet.js.
const d = exchange.directions.incoming

export default {
  key: 'exchange.incomings',
  title: 'Exchange: coming to Ain Shams',
  description:
    'The page for students thinking of an exchange at Ain Shams: the introduction, why to come, the photos and the links.',
  path: '/exchange/incomings',
  editors: ['scope', 'score'],
  fields: [
    {
      name: 'intro',
      type: 'textarea',
      label: 'Introduction',
      required: true,
      max: 400,
      help: 'The paragraph under the page title. Two or three sentences.',
    },
    {
      name: 'points',
      type: 'list',
      label: 'In short',
      itemLabel: 'point',
      titleField: 'text',
      max: 8,
      fields: [{ name: 'text', type: 'text', label: 'Point', required: true, max: 200 }],
    },
    {
      name: 'sections',
      type: 'list',
      label: 'Why Ain Shams',
      itemLabel: 'section',
      titleField: 'title',
      max: 8,
      fields: [
        { name: 'title', type: 'text', label: 'Heading', required: true, max: 80 },
        {
          name: 'body',
          type: 'markdown',
          label: 'Text',
          required: true,
          max: 1500,
          help: 'The hospitals, the departments, the social programme, Cairo: one subject per section.',
        },
        { name: 'image', type: 'image', label: 'Picture (optional)' },
      ],
    },
    {
      name: 'album',
      type: 'album',
      label: 'Photos of our work with incomings',
      help: 'A gallery album to show on the page. The photos themselves are managed in the Gallery editor.',
    },
    {
      name: 'showContacts',
      type: 'toggle',
      label: 'Show who to contact',
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
      label: 'Other links',
      itemLabel: 'link',
      titleField: 'label',
      max: 6,
      fields: [
        { name: 'label', type: 'text', label: 'Label', required: true, max: 60 },
        { name: 'href', type: 'url', label: 'Address', required: true },
      ],
    },
  ],
  // The copy the page had before it became editable, plus four short sections
  // that only restate what the site and the booklet already say.
  defaults: {
    intro: d.intro,
    points: d.points.map((text) => ({ text })),
    sections: [
      {
        title: 'Your clerkship',
        body: 'Placements are at the Ain Shams University Specialized Hospital. The welcome booklet below lists the specialties on offer and describes the faculty.',
        image: '',
      },
      {
        title: 'Someone looking out for you',
        body: 'Every incoming student has a contact person: an AUSSS member who is your first call for the whole month.',
        image: '',
      },
      {
        title: 'The social programme',
        body: 'A month of living like a Cairene, run by the exchange team, with the IFMSA-Egypt National Weekends in Cairo, Alexandria and Dahab.',
        image: '',
      },
      {
        title: 'Beyond Cairo',
        body: 'Weekend trips reach Alexandria, Siwa, Luxor, Aswan and Dahab. The booklet has the details, and tips for landing, money, SIM cards and dress.',
        image: '',
      },
    ],
    album: '',
    showContacts: true,
    nationalBooklet: '',
    links: d.links,
  },
}
