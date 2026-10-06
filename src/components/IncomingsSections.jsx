import { Link } from 'react-router-dom'
import { committees, slugFor } from '../data/society.js'
import { publicEmail } from '../data/emailConfig.js'
import { committeeOfficers, usePeople } from '../lib/people.js'
import { useGallery } from '../lib/gallery.js'
import Markdown from './Markdown.jsx'
import FAQ from './FAQ.jsx'
import { PersonCard } from './committeeUi.jsx'

// The sections of /exchange/incomings and /exchange/outgoings whose copy the
// exchange officers edit from the portal (blocks `exchange.incomings` and
// `exchange.outgoings`, src/content/schemas/). Both pages speak in our own
// voice, "we" to "you". The fixed headings default to the incomings wording;
// the outgoings page passes its own. The portal's previews draw these same
// components.

const h2Cls = 'heading-serif text-center text-3xl text-ink sm:text-4xl'
const leadCls = 'mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-soft/70'

// A row of figures under the introduction.
export function IncomingsFacts({ facts }) {
  if (!facts?.length) return null
  return (
    <dl className="reveal mx-auto grid max-w-4xl grid-cols-2 gap-4 lg:grid-cols-4">
      {facts.map((f, i) => (
        <div key={i} className="rounded-2xl border border-line/10 bg-card px-4 py-5 text-center">
          <dt className="sr-only">{f.label}</dt>
          <dd>
            <span className="heading-serif block text-3xl text-accent sm:text-4xl">{f.figure}</span>
            <span aria-hidden="true" className="mt-1.5 block text-xs leading-snug text-soft/65">
              {f.label}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

// "What we give you": the month in a few ticked lines.
export function IncomingsIncludes({ points, heading = 'What we give you' }) {
  if (!points?.length) return null
  return (
    <section className="reveal mx-auto max-w-3xl">
      <h2 className={h2Cls}>{heading}</h2>
      <ul className="mt-9 space-y-3">
        {points.map((p, i) => (
          <li key={i} className="flex gap-4 rounded-2xl border border-line/10 bg-card p-5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-medical/20 text-xs font-bold text-accent">
              ✓
            </span>
            <p className="text-sm leading-relaxed text-soft/80">{p.text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

// "Why choose us": one card per reason, with its picture when it has one.
const WHY_LEAD =
  'You have a whole world of local committees to pick from. Here is what a month with us looks like.'

export function IncomingsWhy({ sections, heading = 'Why choose us', lead = WHY_LEAD }) {
  if (!sections?.length) return null
  return (
    <section className="reveal mx-auto max-w-6xl">
      <h2 className={h2Cls}>{heading}</h2>
      {lead && <p className={leadCls}>{lead}</p>}
      <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((s, i) => (
          <article key={i} className="flex flex-col overflow-hidden rounded-3xl border border-line/10 bg-card">
            {s.image && (
              <img
                src={s.image}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[4/3] w-full object-cover"
              />
            )}
            <div className="p-6 sm:p-7">
              <h3 className="heading-serif text-2xl text-ink">{s.title}</h3>
              <Markdown text={s.body} className="mt-3 text-sm leading-relaxed text-soft/75" />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

// "How you get to us" (or "How to apply"): numbered steps. Three, five or six
// steps sit three to a row on a wide screen, so no row is left with one card.
export function IncomingsSteps({ steps, heading = 'How you get to us', id }) {
  if (!steps?.length) return null
  const n = steps.length
  const lgCols = n % 3 === 0 || n === 5 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'
  return (
    <section id={id} className="reveal mx-auto max-w-5xl scroll-mt-28">
      <h2 className={h2Cls}>{heading}</h2>
      <ol className={`mt-10 grid gap-5 sm:grid-cols-2 ${lgCols}`}>
        {steps.map((s, i) => (
          <li key={i} className="rounded-2xl border border-line/10 bg-card p-6">
            <span className="heading-serif text-3xl text-accent">{String(i + 1).padStart(2, '0')}</span>
            <h3 className="mt-2 text-base font-semibold text-ink">{s.title}</h3>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-soft/65">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

// "Before you land": our practical tips, one per line of an accordion.
const TIPS_LEAD = 'The things we tell every incoming student, so nothing catches you out.'

export function IncomingsTips({ tips, heading = 'Before you land', lead = TIPS_LEAD }) {
  if (!tips?.length) return null
  return (
    <section className="reveal mx-auto max-w-3xl">
      <h2 className={h2Cls}>{heading}</h2>
      {lead && <p className={leadCls}>{lead}</p>}
      <FAQ items={tips.map((t) => ({ q: t.title, a: t.body }))} className="mt-8" />
    </section>
  )
}

// The two officers an incoming student writes to: the LEO-In for a clinical
// exchange, the LORE for a research one. Names and photos follow whoever holds
// the position (src/lib/people.js). The outgoings page passes its own pair
// (OUTGOING_CONTACTS: the LEO-Out and the LORE).
const CONTACTS = [
  { committee: 'scope', alias: 'leo-in', role: 'For a clinical exchange (SCOPE)' },
  { committee: 'score', alias: 'lore', role: 'For a research exchange (SCORE)' },
]

export const OUTGOING_CONTACTS = [
  { committee: 'scope', alias: 'leo-out', role: 'For a clinical exchange (SCOPE)' },
  { committee: 'score', alias: 'lore', role: 'For a research exchange (SCORE)' },
]

// The fixed wording of the outgoings page's sections (the defaults above are
// the incomings page's), shared with the portal's preview of its block.
export const OUTGOINGS_COPY = {
  includes: 'What the exchange gives you',
  whyHeading: 'Why go',
  whyLead: 'Four weeks away is a big step. Here is what you go for.',
  steps: 'How to apply',
  album: 'With our outgoings',
  tipsHeading: 'Before you fly',
  tipsLead: 'The things we tell every student before they go, so nothing catches you out.',
  contactsLead:
    'Thinking of applying? Write to the officer for your kind of exchange and we will answer.',
}

const CONTACTS_LEAD =
  'Ask us anything before you apply. Write to the officer for your kind of exchange and we will answer.'

export function IncomingsContacts({ contacts = CONTACTS, lead = CONTACTS_LEAD }) {
  const people = usePeople()
  const cards = contacts.map((want) => {
    const c = committees.find((x) => slugFor(x) === want.committee)
    const officer = c ? committeeOfficers(c, people).find((o) => o.alias === want.alias) : null
    return officer ? { ...want, officer, color: c.color } : null
  }).filter(Boolean)
  if (cards.length === 0) return null
  return (
    <section id="write-to-us" className="reveal mx-auto max-w-3xl scroll-mt-28 text-center">
      <h2 className={h2Cls}>Write to us</h2>
      {lead && <p className={leadCls}>{lead}</p>}
      <ul className="mt-9 grid gap-5 sm:grid-cols-2">
        {cards.map(({ officer, color, role, alias }) => {
          const email = publicEmail(officer)
          return (
            <li key={alias} className="flex flex-col items-center rounded-2xl border border-line/10 bg-card p-6">
              <PersonCard person={officer} color={color} />
              <p className="mt-3 text-xs text-soft/60">{role}</p>
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="mt-3 break-all text-sm font-semibold text-accent underline decoration-line/25 underline-offset-2 hover:text-ink"
                >
                  {email}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// A strip of photos from one gallery album, linking to the whole album. The
// album is chosen in the editor and its photos are managed in the gallery
// editor, so there is no second place to upload them. Nothing renders when the
// album is not set, was deleted or is empty.
export function IncomingsAlbum({ slug, heading = 'With our incomings' }) {
  // The gallery is only fetched when an album is chosen.
  return slug ? <AlbumStrip slug={slug} heading={heading} /> : null
}

function AlbumStrip({ slug, heading }) {
  const { albums } = useGallery()
  // The album by its name, or by an older name if it was renamed since.
  const album = albums.find((a) => a.slug === slug) || albums.find((a) => a.aliases.includes(slug))
  if (!album || album.photos.length === 0) return null
  const shown = album.photos.slice(0, 8)
  return (
    <section className="reveal mx-auto max-w-5xl">
      <h2 className={h2Cls}>{heading}</h2>
      {album.blurb && <p className={`${leadCls} max-w-2xl`}>{album.blurb}</p>}
      <ul className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {shown.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-xl border border-line/10 bg-sunk">
            <img
              src={p.thumb}
              alt={p.label || album.title}
              loading="lazy"
              decoding="async"
              className="aspect-square w-full object-cover"
            />
          </li>
        ))}
      </ul>
      <div className="mt-7 text-center">
        <Link
          to={`/gallery/${album.slug}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors hover:text-ink"
        >
          See all {album.count} photos
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </section>
  )
}

// The link to our page in the national welcome booklet.
export function NationalBookletLink({ href }) {
  if (!href) return null
  return (
    <section className="reveal mx-auto max-w-4xl">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-line/10 bg-card p-7 text-center sm:flex-row sm:text-left">
        <div className="min-w-0 flex-1">
          <h2 className="heading-serif text-xl text-ink">The IFMSA-Egypt welcome booklet</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-soft/70">
            The national exchange team’s guide to every local committee in Egypt, with our page in it.
          </p>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-cta px-5 py-2.5 text-sm font-semibold text-on-cta transition-colors hover:bg-cta-hover"
        >
          Open the booklet
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </section>
  )
}
