// The society's address, map pin, official social channels and the short lines
// around them: the footer of every page and the /contact page. Edited by the EB.
// The inboxes listed on /contact are not here: they belong to the positions
// (src/data/society.js) and follow the domain-email switch in Site settings.

// The networks a channel may be, in the order the portal offers them. The value
// picks the icon (src/components/SocialIcon.jsx), the label is the name shown.
export const SOCIAL_NETWORKS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'x', label: 'X' },
]

export const networkName = (value) => SOCIAL_NETWORKS.find((n) => n.value === value)?.label || ''

// Google Maps, searched for the pin text. The host is fixed and the text is
// encoded, so an edit can only move the pin.
export const mapLink = (query) => `https://maps.google.com/maps?q=${encodeURIComponent(query)}`
export const mapEmbed = (query) => `${mapLink(query)}&z=16&output=embed`

export default {
  key: 'site.contact',
  title: 'Footer and contact details',
  description:
    'The address, the map, the official social channels and the short lines in the footer of every page and on the Contact page.',
  path: '/contact',
  editors: [],
  fields: [
    {
      name: 'motto',
      type: 'text',
      label: 'Motto',
      help: 'Under the logo in the footer.',
      required: true,
      max: 80,
    },
    {
      name: 'footerLine',
      type: 'textarea',
      label: 'Footer line',
      help: 'The short description under the motto.',
      required: true,
      max: 300,
    },
    {
      name: 'contactIntro',
      type: 'textarea',
      label: 'Contact page introduction',
      help: 'Under the title of the Contact page.',
      required: true,
      max: 400,
    },
    {
      name: 'place',
      type: 'text',
      label: 'Where we are',
      help: 'The first line of the address card in the footer.',
      required: true,
      max: 120,
    },
    {
      name: 'address',
      type: 'textarea',
      label: 'Address',
      help: 'Each line here is a line of the address.',
      required: true,
      max: 300,
    },
    {
      name: 'mapQuery',
      type: 'text',
      label: 'Map pin',
      help: 'What Google Maps searches for to place the pin in the footer map and the "Open in Google Maps" link. A place name works best.',
      required: true,
      max: 200,
    },
    {
      name: 'followIntro',
      type: 'textarea',
      label: 'Social channels introduction',
      help: 'Under "Follow AUSSS" on the Contact page.',
      required: true,
      max: 300,
    },
    {
      name: 'socials',
      type: 'list',
      label: 'Official social channels',
      help: 'Shown as icons in the footer and as cards on the Contact page, in this order. Search engines read them too, as the society’s official profiles.',
      itemLabel: 'channel',
      titleField: 'network',
      min: 1,
      max: 6,
      fields: [
        { name: 'network', type: 'select', label: 'Network', options: SOCIAL_NETWORKS },
        {
          name: 'handle',
          type: 'text',
          label: 'Handle or page name',
          help: 'As it appears on the network, such as @ausss_ainshams.',
          required: true,
          max: 120,
        },
        { name: 'href', type: 'url', label: 'Address of the profile', required: true },
        { name: 'blurb', type: 'text', label: 'One line about it', max: 120 },
      ],
    },
  ],
  // The official channels are the ones the Constitution names (§14.2).
  defaults: {
    motto: 'Life Savers, Change Makers',
    footerLine:
      'Ain Shams University Students’ Scientific Society, the IFMSA society at the Faculty of Medicine, Ain Shams University.',
    contactIntro:
      'Reach the Executive Board, a standing committee or a support division directly, or follow us on our official channels.',
    place: 'Faculty of Medicine, Ain Shams University',
    address: '38 Abbassia, next to Al-Nour Mosque\nCairo 1181, Egypt',
    mapQuery: 'Faculty of Medicine, Ain Shams University',
    followIntro: 'Events, announcements and campaigns. Keep up with the society on our official channels.',
    socials: [
      {
        network: 'instagram',
        handle: '@ausss_ainshams',
        href: 'https://instagram.com/ausss_ainshams',
        blurb: 'Events, announcements and campaigns.',
      },
      {
        network: 'facebook',
        handle: 'Ain Shams University Students’ Scientific Society – AUSSS',
        href: 'https://www.facebook.com/ausssofficial',
        blurb: 'Events, announcements and campaigns.',
      },
      {
        network: 'tiktok',
        handle: '@ausss_ainshams',
        href: 'https://www.tiktok.com/@ausss_ainshams',
        blurb: 'Campaign highlights and behind-the-scenes.',
      },
    ],
  },
}
