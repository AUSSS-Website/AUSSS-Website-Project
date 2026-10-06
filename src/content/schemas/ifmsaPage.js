// The words and figures on /ifmsa: the introduction, the membership card, the
// two rows of figures, the three cards and the links at the foot. Edited by the
// EB. The logo chain (IFMSA, IFMSA-Egypt, AUSSS) and the link to the history
// timeline stay in the code.

const figureFields = [
  {
    name: 'value',
    type: 'text',
    label: 'Figure',
    help: 'A number counts up as it appears; words, such as Ain Shams, are shown as they are.',
    required: true,
    max: 16,
  },
  { name: 'label', type: 'text', label: 'What it counts', required: true, max: 40 },
]

export default {
  key: 'ifmsa.page',
  title: 'IFMSA page',
  description:
    'The introduction, the membership card, the figures for IFMSA and IFMSA-Egypt, the three cards and the links on the IFMSA Ain Shams page.',
  path: '/ifmsa',
  editors: [],
  fields: [
    { name: 'intro', type: 'textarea', label: 'Introduction', help: 'Under the page title.', required: true, max: 600 },
    {
      name: 'membership',
      type: 'textarea',
      label: 'Membership card',
      help: 'Under "AUSSS is an autonomous affiliate member of IFMSA-Egypt."',
      required: true,
      max: 600,
    },
    {
      name: 'worldwide',
      type: 'list',
      label: 'Figures: IFMSA worldwide',
      help: 'Approximate, as IFMSA publishes them on ifmsa.org. Worth checking once a year.',
      itemLabel: 'figure',
      titleField: 'label',
      min: 2,
      max: 4,
      fields: figureFields,
    },
    {
      name: 'egypt',
      type: 'list',
      label: 'Figures: IFMSA-Egypt',
      help: 'As IFMSA-Egypt publishes them on ifmsa-egypt.org.eg.',
      itemLabel: 'figure',
      titleField: 'label',
      min: 2,
      max: 4,
      fields: figureFields,
    },
    {
      name: 'points',
      type: 'list',
      label: 'Cards',
      itemLabel: 'card',
      titleField: 'title',
      min: 1,
      max: 6,
      fields: [
        { name: 'title', type: 'text', label: 'Heading', required: true, max: 80 },
        { name: 'body', type: 'textarea', label: 'Text', required: true, max: 500 },
      ],
    },
    {
      name: 'links',
      type: 'list',
      label: 'Links under "Learn more"',
      itemLabel: 'link',
      titleField: 'label',
      max: 4,
      fields: [
        { name: 'label', type: 'text', label: 'Text', required: true, max: 60 },
        { name: 'href', type: 'url', label: 'Address', required: true },
      ],
    },
  ],
  // Figures sourced from ifmsa.org and ifmsa-egypt.org.eg.
  defaults: {
    intro:
      'The International Federation of Medical Students’ Associations (IFMSA) is one of the world’s oldest and largest student-run organisations. Founded in 1951, it represents, connects, and engages over a million medical students through National Member Organisations across more than 130 countries.',
    membership:
      'AUSSS is an autonomous affiliate member of IFMSA-Egypt, the National Member Organisation representing Egyptian medical students within IFMSA. Through IFMSA-Egypt, AUSSS is connected to a global federation of over a million medical students.',
    worldwide: [
      { value: '1.5M+', label: 'Medical students' },
      { value: '133+', label: 'National organisations' },
      { value: '123', label: 'Countries' },
      { value: '15,000', label: 'Exchanges / year' },
    ],
    egypt: [
      { value: '1969', label: 'IFMSA-Egypt founded' },
      { value: '80,000', label: 'Egyptian medical students' },
      { value: '31', label: 'Local committees' },
      { value: 'Ain Shams', label: 'AUSSS local committee' },
    ],
    points: [
      {
        title: 'Global standing committees',
        body: 'IFMSA organises its work through standing committees on Professional & Research Exchange, Medical Education, Public Health, Human Rights & Peace, and Sexual & Reproductive Health, mirrored locally at AUSSS.',
      },
      {
        title: 'International exchange',
        body: 'Members access clinical and research clerkships hosted by partner faculties worldwide through the IFMSA exchange network.',
      },
      {
        title: 'Advocacy & representation',
        body: 'IFMSA brings the student voice to the WHO, UN, and other global health partners, advocating on health policy and medical education.',
      },
    ],
    links: [
      { label: 'ifmsa.org', href: 'https://ifmsa.org' },
      { label: 'ifmsa-egypt.org.eg', href: 'https://www.ifmsa-egypt.org.eg' },
    ],
  },
}
