// The public site's page list: one entry per URL a search engine or an AI
// crawler should find. It feeds three things at build time
// (scripts/prerender.mjs): the pre-rendered HTML for each URL, that page's
// <head> (title, description, canonical, Open Graph, JSON-LD), and
// sitemap.xml. It is deliberately plain data so the whole list of what the
// site publishes lives in one place.
//
// Titles and descriptions must match what each page sets at runtime through
// usePageTitle(): the pre-rendered head is what crawlers read, the hook is
// what a visitor sees after client-side navigation. Keep the two in step.
//
// Not listed on purpose: /portal/** (sign-in only), /login,
// /account, /merch/checkout, /social, /quiz and the singular exchange aliases
// (all redirects or private surfaces).
import { committees, slugFor, society, exchange } from '../data/society.js'
import joinFaqSchema from '../content/schemas/joinFaq.js'
import siteContactSchema from '../content/schemas/siteContact.js'
import { publicEmail } from '../data/emailConfig.js'
import { resolveDoc } from '../content/schema.js'
import { markdownToText } from '../lib/markdown.js'
import {
  ARCHIVE_DESCRIPTION,
  ARCHIVE_TITLE,
  EVENTS_DESCRIPTION,
  EVENTS_TITLE,
  eventMetaDescription,
  isUpcoming,
} from '../lib/events.js'
import { cairoIsoWithOffset, eventDays, isoToCairoDate } from '../lib/eventTime.js'

export const SITE_URL = 'https://ausss-ainshams.org'
export const SITE_NAME = 'AUSSS'
export const BASE_TITLE = "AUSSS, Ain Shams University Students' Scientific Society"
export const BASE_DESCRIPTION =
  "AUSSS is the Ain Shams University Students' Scientific Society: the IFMSA society at the Faculty of Medicine, Ain Shams University, Cairo. Medical research, public health, medical education and student exchange since 1971. Life Savers, Change Makers."
export const DEFAULT_IMAGE = `${SITE_URL}/assets/brand/ausss-horizontal-white.png`
export const DEFAULT_IMAGE_ALT = "AUSSS, Ain Shams University Students' Scientific Society"

const abs = (path) => (path.startsWith('http') ? path : `${SITE_URL}${path}`)

// The organisation itself, referenced from every page's JSON-LD by @id so
// Google merges the facts instead of seeing ten unrelated organisations.
export const ORG_ID = `${SITE_URL}/#organization`

// The LinkedIn page is an official profile even while it is not one of the
// channels the footer shows.
const LINKEDIN = 'https://www.linkedin.com/company/ausss'

// `contact` is the published block `site.contact` (address, motto, channels),
// `email` the society's public address as the site shows it.
export function organizationJsonLd(contact, email) {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    '@id': ORG_ID,
    name: society.name,
    // The names people actually type into a search box.
    alternateName: [
      'AUSSS',
      'AUSSS Ain Shams',
      'Ain Shams University Student Scientific Society',
      'Ain Shams Students’ Scientific Society',
      'IFMSA Ain Shams',
      'IFMSA Ain Shams University',
    ],
    url: `${SITE_URL}/`,
    logo: DEFAULT_IMAGE,
    image: DEFAULT_IMAGE,
    slogan: contact.motto,
    description:
      'The student-run scientific society of the Faculty of Medicine, Ain Shams University, Cairo: six IFMSA standing committees and four support divisions running medical research, public health campaigns, medical education and international student exchange since 1971.',
    foundingDate: '1971',
    email,
    // Every profile Google already ranks for "AUSSS": tells it they are all
    // the same organisation and this site is its home.
    sameAs: [...new Set([...contact.socials.map((s) => s.href), LINKEDIN])],
    parentOrganization: {
      '@type': 'CollegeOrUniversity',
      name: 'Ain Shams University, Faculty of Medicine',
      url: 'https://med.asu.edu.eg/',
    },
    memberOf: [
      { '@type': 'Organization', name: 'IFMSA-Egypt', url: 'https://www.ifmsa-egypt.org.eg' },
      {
        '@type': 'Organization',
        name: 'International Federation of Medical Students’ Associations (IFMSA)',
        url: 'https://ifmsa.org',
      },
    ],
    address: {
      '@type': 'PostalAddress',
      streetAddress: contact.address.split('\n')[0],
      addressLocality: 'Cairo',
      addressCountry: 'EG',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Secretary General',
      email,
      availableLanguage: ['en', 'ar'],
    },
  }
}

// Tells Google which site name to show in results ("AUSSS") and what else
// the site is called.
function webSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: `${SITE_URL}/`,
    name: 'AUSSS',
    alternateName: [society.name, 'IFMSA Ain Shams'],
    publisher: { '@id': ORG_ID },
    inLanguage: 'en',
  }
}

function webPageJsonLd(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${abs(page.path)}#webpage`,
    url: abs(page.path),
    name: page.title ? `${page.title} · ${SITE_NAME}` : BASE_TITLE,
    description: page.description,
    isPartOf: { '@type': 'WebSite', url: `${SITE_URL}/`, name: society.name },
    about: { '@id': ORG_ID },
    inLanguage: 'en',
  }
}

function breadcrumbJsonLd(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: abs(path),
    })),
  }
}

function faqJsonLd(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      // Answers may carry the editor's markdown; search engines get plain text.
      acceptedAnswer: { '@type': 'Answer', text: markdownToText(f.a) },
    })),
  }
}

function committeeJsonLd(c, path) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${abs(path)}#committee`,
    name: `${c.abbr}, ${c.name}`,
    alternateName: c.abbr,
    url: abs(path),
    logo: c.logo ? abs(c.logo) : undefined,
    description: c.description,
    slogan: c.tagline,
    parentOrganization: { '@id': ORG_ID },
  }
}

function albumJsonLd(a, path) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    '@id': `${abs(path)}#gallery`,
    name: a.title,
    description: a.blurb,
    url: abs(path),
    image: a.cover ? abs(a.cover) : undefined,
    numberOfItems: a.count,
    publisher: { '@id': ORG_ID },
  }
}

// schema.org Event, so search engines can show the date and place. All-day
// events give their days; timed ones the Cairo time with its offset; a
// multiple-day event lists each day as a sub-event with its own hours.
function eventJsonLd(ev, path) {
  const c = ev.committee ? committees.find((x) => slugFor(x) === ev.committee) : null
  const lastDay = ev.allDay && ev.endsAt ? isoToCairoDate(ev.endsAt) : null
  const location = {
    '@type': 'Place',
    name: ev.place || 'Faculty of Medicine, Ain Shams University',
    address: { '@type': 'PostalAddress', addressLocality: 'Cairo', addressCountry: 'EG' },
  }
  const days = eventDays(ev)
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${abs(path)}#event`,
    name: ev.title,
    description: markdownToText(ev.description) || undefined,
    url: abs(path),
    startDate: ev.allDay ? isoToCairoDate(ev.startsAt) : cairoIsoWithOffset(ev.startsAt),
    endDate: ev.allDay ? lastDay || undefined : ev.endsAt ? cairoIsoWithOffset(ev.endsAt) : undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location,
    image: ev.image ? [abs(ev.image)] : undefined,
    subEvent: days.length
      ? days.map((d, i) => ({
          '@type': 'Event',
          name: `${ev.title}, day ${i + 1}`,
          startDate: cairoIsoWithOffset(d.startsAt),
          endDate: cairoIsoWithOffset(d.endsAt),
          location,
        }))
      : undefined,
    organizer: c
      ? { '@type': 'Organization', name: `${c.abbr}, ${c.name}`, url: abs(`/committees/${slugFor(c)}`) }
      : { '@type': 'Organization', '@id': ORG_ID, name: society.name, url: `${SITE_URL}/` },
  }
}

// One entry per public URL. `title` is the part before " · AUSSS" (empty on
// the home page, which uses BASE_TITLE), `image` an absolute URL for the
// social preview card, `changefreq` and `priority` are the sitemap hints.
//  is the gallery snapshot the prerender fetched (src/lib/gallery.js shape:
// cover/coverFull are absolute Storage URLs for live albums, site paths for the
// static fallback).
// `issues` is the magazine shelf (src/lib/magazine.js shape); the latest edition's
// cover page becomes the /magazine share card.
// `content` is the documents published from the portal's content editor
// (src/lib/content.js shape), for the data that is built from them.
// `settings` are the site settings (src/hooks/useSiteSettings.js): the
// domain-email switch decides which address the JSON-LD gives.
// `events` are the published events (src/lib/events.js shape): one page each,
// upcoming or past by the build's clock.
export function publicPages(albums = [], issues = [], content = {}, settings = {}, events = []) {
  const joinFaqs = resolveDoc(joinFaqSchema, content[joinFaqSchema.key]).items
  const contact = resolveDoc(siteContactSchema, content[siteContactSchema.key])
  const email = publicEmail(society.contact, settings.domainEmailsLive === true)
  const latest = issues.find((i) => !i.missing && (i.pages?.count || i.canva)) || null
  const latestCover = latest && latest.pages?.count
    ? abs(latest.pages.base + '/' + String(latest.heroPage || 1).padStart(3, '0') + '.jpg')
    : undefined
  const pages = [
    {
      path: '/',
      title: '',
      description: BASE_DESCRIPTION,
      changefreq: 'weekly',
      priority: 1.0,
      jsonLd: [organizationJsonLd(contact, email), webSiteJsonLd()],
    },
    {
      path: '/join',
      title: 'Join us',
      description:
        'Become part of AUSSS, the Ain Shams University Students’ Scientific Society. Join our committees for research, public health, and global student exchange.',
      changefreq: 'monthly',
      priority: 0.9,
      jsonLd: [faqJsonLd(joinFaqs)],
    },
    {
      path: '/exchange',
      title: 'Exchange',
      description:
        'Clinical (SCOPE) and research (SCORE) exchanges with AUSSS: go abroad, host incoming students, or join the exchange team.',
      changefreq: 'monthly',
      priority: 0.8,
    },
    {
      path: `/exchange/${exchange.directions.outgoing.slug}`,
      title: exchange.directions.outgoing.title,
      description: exchange.directions.outgoing.meta,
      changefreq: 'monthly',
      priority: 0.7,
      crumbs: [['Exchange', '/exchange']],
    },
    {
      path: `/exchange/${exchange.directions.incoming.slug}`,
      title: exchange.directions.incoming.title,
      description: exchange.directions.incoming.meta,
      changefreq: 'monthly',
      priority: 0.7,
      crumbs: [['Exchange', '/exchange']],
    },
    {
      path: '/exchange/join',
      title: 'Join the exchange team',
      description:
        'The AUSSS exchange team: the LEO-In, LEO-Out and LORE officer roles, their assistants, and the contact persons who host every arrival.',
      changefreq: 'monthly',
      priority: 0.6,
      crumbs: [['Exchange', '/exchange']],
    },
    {
      path: '/exchange/share',
      title: 'Share your story',
      description:
        'Been on a SCOPE or SCORE exchange with AUSSS? Share your story with the next generation of exchange students.',
      changefreq: 'yearly',
      priority: 0.4,
      crumbs: [['Exchange', '/exchange']],
    },
    {
      path: '/ifmsa',
      title: 'IFMSA Ain Shams',
      description:
        'IFMSA at Ain Shams University: AUSSS is the IFMSA-Egypt affiliate at the Faculty of Medicine, with the six standing committees, the SCOPE and SCORE exchanges, and a worldwide network of medical students.',
      changefreq: 'monthly',
      priority: 0.7,
    },
    {
      path: '/ifmsa/history',
      title: 'IFMSA history',
      description:
        'From IFMSA’s founding in 1951 to IFMSA-Egypt and AUSSS today: the history of the medical students’ federation AUSSS belongs to.',
      changefreq: 'yearly',
      priority: 0.5,
      crumbs: [['IFMSA', '/ifmsa']],
    },
    {
      path: '/events',
      title: EVENTS_TITLE,
      description: EVENTS_DESCRIPTION,
      changefreq: 'weekly',
      priority: 0.8,
    },
    {
      path: '/events/archive',
      title: ARCHIVE_TITLE,
      description: ARCHIVE_DESCRIPTION,
      changefreq: 'monthly',
      priority: 0.4,
      crumbs: [['Events', '/events']],
    },
    {
      path: '/gallery',
      title: 'Gallery',
      description:
        'Photos from AUSSS camps, campaigns, assemblies and exchanges: the society’s year in pictures.',
      changefreq: 'monthly',
      priority: 0.7,
    },
    {
      path: '/magazine',
      title: 'Magazine',
      description:
        'The AUSSS magazine: articles, research features and society news by Ain Shams medical students, read online.',
      image: latestCover,
      imageAlt: latest ? `AUSSS Magazine, ${latest.title}` : undefined,
      changefreq: 'monthly',
      priority: 0.7,
    },
    {
      path: '/merch',
      title: 'Merch',
      description:
        'Official AUSSS 55th-edition merch: tees, the varsity jacket, bucket hats and notebooks. Order to support the society.',
      changefreq: 'monthly',
      priority: 0.6,
    },
    {
      path: '/sorting',
      title: 'Sorting quiz',
      description:
        'Not sure which AUSSS committee fits you? A short quiz that matches your interests to the six standing committees and four support divisions.',
      changefreq: 'yearly',
      priority: 0.6,
    },
    {
      path: '/members',
      title: 'Members',
      description:
        'Look up your AUSSS membership: check your status, committee and position on the society roster.',
      changefreq: 'yearly',
      priority: 0.3,
    },
    {
      path: '/contact',
      title: 'Contact',
      description:
        'Reach AUSSS: the Secretary General’s email, our Instagram, Facebook and TikTok, and where to find us at the Faculty of Medicine, Ain Shams University.',
      changefreq: 'yearly',
      priority: 0.6,
    },
    {
      path: '/constitution',
      title: 'Constitution',
      description:
        'The constitution of the Ain Shams University Students’ Scientific Society: structure, executive board, committees, membership and elections.',
      changefreq: 'yearly',
      priority: 0.4,
    },
    {
      path: '/privacy',
      title: 'Privacy policy',
      description:
        'What AUSSS collects on this site and in the members portal, who can see it, and how IFMSA handles exchange data.',
      changefreq: 'yearly',
      priority: 0.3,
    },
  ]

  for (const c of committees) {
    const path = `/committees/${slugFor(c)}`
    pages.push({
      path,
      title: c.name,
      description:
        `${c.abbr}, the ${c.name} ${c.group || 'committee'} of AUSSS at Ain Shams University. ${c.tagline || c.description || ''}`.trim(),
      image: c.logo ? abs(c.logo) : undefined,
      imageAlt: `${c.abbr} logo`,
      changefreq: 'monthly',
      priority: 0.7,
      crumbs: [['Committees', '/#committees']],
      jsonLd: [committeeJsonLd(c, path)],
    })
  }

  for (const a of albums) {
    const path = `/gallery/${a.slug}`
    pages.push({
      path,
      title: a.title,
      description: a.blurb
        ? `${a.blurb} ${a.count} photos from AUSSS.`
        : `${a.count} photos from ${a.title}, an AUSSS album.`,
      // The cover's full-size file rather than its thumbnail, so the preview
      // card is sharp.
      image: a.coverFull ? abs(a.coverFull) : undefined,
      imageAlt: a.title,
      changefreq: 'yearly',
      priority: 0.5,
      crumbs: [['Gallery', '/gallery']],
      jsonLd: [albumJsonLd(a, path)],
    })
  }

  const now = Date.now()
  for (const ev of events) {
    const path = `/events/${ev.slug}`
    const upcoming = isUpcoming(ev, now)
    pages.push({
      path,
      title: ev.title,
      description: eventMetaDescription(ev),
      image: ev.image ? abs(ev.image) : undefined,
      imageAlt: ev.title,
      changefreq: upcoming ? 'weekly' : 'yearly',
      priority: upcoming ? 0.6 : 0.3,
      crumbs: upcoming ? [['Events', '/events']] : [['Events', '/events'], ['Past events', '/events/archive']],
      jsonLd: [eventJsonLd(ev, path)],
    })
  }

  return pages.map((p) => ({
    ...p,
    url: abs(p.path),
    image: p.image || DEFAULT_IMAGE,
    imageAlt: p.imageAlt || DEFAULT_IMAGE_ALT,
    fullTitle: p.title ? `${p.title} · ${SITE_NAME}` : BASE_TITLE,
    jsonLd: [
      webPageJsonLd(p),
      ...(p.path === '/'
        ? []
        : [breadcrumbJsonLd([['Home', '/'], ...(p.crumbs || []), [p.title, p.path]])]),
      ...(p.jsonLd || []),
    ],
  }))
}
