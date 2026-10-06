// The words on the home page: the lines around the logo in the hero, the
// figures under its buttons, and the "About the Society" section. Edited by the
// EB. The motto, the logo, the buttons and the live member count stay in the
// code, and so do the Executive Board and the committees further down, which
// come from the people who hold the positions.

const highlightHelp =
  'Put **double stars** around words to highlight them in the deep colour, and *single stars* around the words in the accent colour.'

export default {
  key: 'home.page',
  title: 'Home page',
  description:
    'The lines around the logo at the top of the home page, the figures under the buttons, and the "About the Society" section.',
  path: '/',
  editors: [],
  fields: [
    {
      name: 'badge',
      type: 'text',
      label: 'Badge above the logo',
      help: 'The small highlighted line at the very top, for an anniversary or a campaign. Leave it empty to hide it.',
      max: 80,
    },
    {
      name: 'lead',
      type: 'text',
      label: 'Line under the motto',
      required: true,
      max: 160,
    },
    {
      name: 'figures',
      type: 'list',
      label: 'Figures under the buttons',
      help: 'They follow the member count, which the site keeps up to date by itself.',
      itemLabel: 'figure',
      titleField: 'label',
      min: 1,
      max: 3,
      fields: [
        {
          name: 'value',
          type: 'text',
          label: 'Figure',
          help: 'A number, which counts up as it appears, such as 300+.',
          required: true,
          max: 12,
        },
        { name: 'label', type: 'text', label: 'What it counts', required: true, max: 40 },
      ],
    },
    {
      name: 'note',
      type: 'markdown',
      label: 'Line under the figures',
      help: 'Optional. Words between **double stars** take the accent colour.',
      max: 300,
    },
    {
      name: 'aboutHeading',
      type: 'text',
      label: 'About: heading',
      required: true,
      max: 120,
    },
    {
      name: 'aboutLede',
      type: 'markdown',
      label: 'About: the large text under the heading',
      help: highlightHelp,
      required: true,
      max: 400,
    },
    {
      name: 'aboutBody',
      type: 'markdown',
      label: 'About: paragraphs',
      help: `A blank line starts a new paragraph. ${highlightHelp}`,
      required: true,
      max: 1500,
    },
    {
      name: 'aboutQuote',
      type: 'textarea',
      label: 'About: quotation',
      help: 'Shown in quotation marks under the paragraphs. Leave it empty to hide it.',
      max: 500,
    },
    {
      name: 'pillars',
      type: 'list',
      label: 'About: the three cards',
      help: 'Each card keeps its picture by its place: people, the globe, the document.',
      itemLabel: 'card',
      titleField: 'title',
      min: 3,
      max: 3,
      fields: [
        { name: 'title', type: 'text', label: 'Heading', required: true, max: 60 },
        { name: 'body', type: 'textarea', label: 'Text', required: true, max: 300 },
        {
          name: 'link',
          type: 'url',
          label: 'Link (optional)',
          help: 'A page of this site, such as /exchange, or a full address makes the whole card a link.',
        },
        {
          name: 'linkLabel',
          type: 'text',
          label: 'Link text',
          help: 'The words under the card when it is a link. Empty means "Learn more".',
          max: 40,
        },
      ],
    },
  ],
  defaults: {
    badge: '55 Years of Youth · 55 Years of Impact',
    lead: 'Science, health and humanity, driven by Ain Shams’ medical students.',
    figures: [
      { value: '10', label: 'Committees and divisions' },
      { value: '300+', label: 'Exchange students hosted' },
      { value: '80+', label: 'Campaigns a year' },
    ],
    note: 'This year, AUSSS officially celebrates its **55th anniversary**.',
    aboutHeading: 'Where clinical practice meets scientific inquiry.',
    aboutLede:
      'For **55 years**, AUSSS has been where Ain Shams medical students **turn ideas into action**. It is where curiosity grows into a *calling for change*.',
    aboutBody:
      'The **Ain Shams University Students’ Scientific Society (AUSSS)** is an independent, non-profit, non-political and non-religious student society within the Faculty of Medicine, Ain Shams University, and an **autonomous affiliate member of IFMSA-Egypt**.\n\nThrough clinical and research exchanges, projects, campaigns and peer-to-peer training, AUSSS helps medical students use their knowledge **for the benefit of society**, and offers a forum to discuss health, education and science with peers **across Egypt and around the world**.',
    aboutQuote:
      'Our mission is to offer future physicians a comprehensive introduction to global health issues, developing active, efficient and culturally sensitive students of medicine, intent on influencing the transnational inequalities that shape the health of our planet.',
    pillars: [
      {
        title: 'Health for the community',
        body: 'Awareness campaigns, screenings and outreach take students beyond the lecture hall to serve communities across Egypt.',
        link: '',
        linkLabel: '',
      },
      {
        title: 'Global student exchange',
        body: 'Clinical and research clerkships connect Ain Shams students with partner faculties across the world.',
        link: '/exchange',
        linkLabel: 'Explore exchange',
      },
      {
        title: 'Evidence-based culture',
        body: 'Journal clubs, methodology workshops and mentorship build a generation fluent in scientific rigour.',
        link: '',
        linkLabel: '',
      },
    ],
  },
}
