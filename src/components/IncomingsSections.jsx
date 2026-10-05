import { Link } from 'react-router-dom'
import { committees, slugFor } from '../data/society.js'
import { publicEmail } from '../data/emailConfig.js'
import { committeeOfficers, usePeople } from '../lib/people.js'
import { useGallery } from '../lib/gallery.js'
import Markdown from './Markdown.jsx'
import { PersonCard } from './committeeUi.jsx'

// The parts of /exchange/incomings that the exchange officers edit from the
// portal (block `exchange.incomings`, src/content/schemas/exchangeIncomings.js).
// The portal's preview draws these same components.

// "Why Ain Shams": one card per section, with its picture when it has one.
export function IncomingsWhy({ sections }) {
  if (!sections?.length) return null
  return (
    <section className="reveal mx-auto max-w-5xl">
      <h2 className="heading-serif text-center text-3xl text-ink">Why Ain Shams</h2>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {sections.map((s, i) => (
          <article key={i} className="overflow-hidden rounded-2xl border border-line/10 bg-card">
            {s.image && (
              <img
                src={s.image}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[16/9] w-full object-cover"
              />
            )}
            <div className="p-6">
              <h3 className="heading-serif text-xl text-ink">{s.title}</h3>
              <Markdown text={s.body} className="mt-3 text-sm leading-relaxed text-soft/75" />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

// The two officers an incoming student writes to: the LEO-In for a clinical
// exchange, the LORE for a research one. Names and photos follow whoever holds
// the position (src/lib/people.js).
const CONTACTS = [
  { committee: 'scope', alias: 'leo-in', role: 'Clinical exchanges (SCOPE)' },
  { committee: 'score', alias: 'lore', role: 'Research exchanges (SCORE)' },
]

export function IncomingsContacts() {
  const people = usePeople()
  const cards = CONTACTS.map((want) => {
    const c = committees.find((x) => slugFor(x) === want.committee)
    const officer = c ? committeeOfficers(c, people).find((o) => o.alias === want.alias) : null
    return officer ? { ...want, officer, color: c.color } : null
  }).filter(Boolean)
  if (cards.length === 0) return null
  return (
    <section className="reveal mx-auto max-w-3xl text-center">
      <h2 className="heading-serif text-3xl text-ink">Who to contact</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-soft/70">
        Write to the officer for your kind of exchange. They answer questions before you apply and
        look after your placement once you are accepted.
      </p>
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
export function IncomingsAlbum({ slug }) {
  // The gallery is only fetched when an album is chosen.
  return slug ? <AlbumStrip slug={slug} /> : null
}

function AlbumStrip({ slug }) {
  const { albums } = useGallery()
  // The album by its name, or by an older name if it was renamed since.
  const album = albums.find((a) => a.slug === slug) || albums.find((a) => a.aliases.includes(slug))
  if (!album || album.photos.length === 0) return null
  const shown = album.photos.slice(0, 8)
  return (
    <section className="reveal mx-auto max-w-5xl">
      <h2 className="heading-serif text-center text-3xl text-ink">With our incomings</h2>
      {album.blurb && (
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-soft/70">{album.blurb}</p>
      )}
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
    <section className="reveal mx-auto max-w-3xl">
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
