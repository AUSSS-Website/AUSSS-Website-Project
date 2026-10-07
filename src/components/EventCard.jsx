import { Link } from 'react-router-dom'
import { committeeBySlug } from '../data/society.js'
import { chipAccent, readableAccent, rgba } from '../lib/color.js'
import { dateTile, eventWhen } from '../lib/eventTime.js'
import { upcomingEvents, useEvents } from '../lib/events.js'
import { SectionLabel } from './committeeUi.jsx'

// The pieces every list of events shares: the card (on /events, the archive,
// the home page and the committee pages), and the two "coming up" sections.
// A society-wide event wears the site's accent; a committee's wears its colour.

// The organiser's colours for an event: its committee's, or none for a
// society-wide one (the site's accent then).
export function eventAccent(ev) {
  const c = ev.committee ? committeeBySlug(ev.committee) : null
  return c
    ? { committee: c, accent: readableAccent(c.color), chip: chipAccent(c.color), tint: rgba(c.color, 0.14) }
    : { committee: null }
}

// The start day as a calendar leaf: month, day, weekday. `accent` is the
// committee colour as text on its own tint (chipAccent).
export function DateTile({ ev, accent, tint, className = '' }) {
  const t = dateTile(ev)
  if (!t) return null
  return (
    <div
      className={`flex w-14 shrink-0 flex-col items-center self-start rounded-xl border border-line/10 py-2 text-center ${
        accent ? '' : 'bg-medical/10'
      } ${className}`}
      style={tint ? { background: tint } : undefined}
      aria-hidden="true"
    >
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.18em] ${accent ? '' : 'text-accent'}`}
        style={accent ? { color: accent } : undefined}
      >
        {t.month}
      </span>
      <span className="heading-serif text-2xl leading-none text-ink">{t.day}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-soft/80">{t.weekday}</span>
    </div>
  )
}

// One event as a card. `past` greys its picture for the archive (the text
// keeps its full contrast); `headingLevel` keeps the outline right wherever
// the card sits.
export default function EventCard({ ev, past = false, headingLevel = 3 }) {
  const { committee, accent, chip, tint } = eventAccent(ev)
  const Heading = `h${headingLevel}`
  return (
    <Link
      to={`/events/${ev.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line/10 bg-card transition-colors hover:border-medical/40"
    >
      {ev.image ? (
        <div className="dark relative aspect-[16/9] overflow-hidden bg-sunk">
          <img
            src={ev.image}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-105 ${
              past ? 'grayscale-[35%]' : ''
            }`}
          />
        </div>
      ) : (
        // No picture: the organiser's logo on its own tint, so a row of cards
        // keeps one shape.
        <div
          className={`grid aspect-[16/9] place-items-center ${tint ? '' : 'bg-medical/10'}`}
          style={tint ? { background: tint } : undefined}
          aria-hidden="true"
        >
          <img
            src={committee?.logo || '/assets/brand/ausss-icon-white.png'}
            alt=""
            loading="lazy"
            className={`logo-ink h-16 w-auto max-w-[40%] object-contain opacity-80 transition-transform duration-700 group-hover:scale-105 sm:h-20 ${
              past ? 'grayscale-[35%]' : ''
            }`}
          />
        </div>
      )}
      <div className="flex flex-1 gap-4 p-5">
        <DateTile ev={ev} accent={chip} tint={tint} />
        <div className="min-w-0">
          <p
            className={`text-[11px] font-bold uppercase tracking-[0.2em] ${accent ? '' : 'text-accent'}`}
            style={accent ? { color: accent } : undefined}
          >
            {committee ? committee.abbr : 'AUSSS'}
          </p>
          <Heading className="heading-serif mt-1 break-words text-lg leading-snug text-ink transition-colors group-hover:text-accent sm:text-xl">
            {ev.title}
          </Heading>
          <p className="mt-2 text-sm text-soft/75">{eventWhen(ev, { short: true })}</p>
          {ev.place && <p className="mt-1 break-words text-sm text-soft/55">{ev.place}</p>}
        </div>
      </div>
    </Link>
  )
}

// A committee's upcoming events, on its own page. Nothing at all when it has
// none, like Open Calls.
export function CommitteeEvents({ slug, abbr, accent }) {
  const { events } = useEvents()
  const list = upcomingEvents(events, { committee: slug })
  if (list.length === 0) return null
  return (
    <section className="reveal mx-auto max-w-5xl">
      <SectionLabel accent={accent}>Upcoming events</SectionLabel>
      <p className="mt-6 max-w-2xl text-sm leading-relaxed text-soft/60">
        What {abbr} is running next. Open one for the details and to add it to your calendar.
      </p>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((ev) => (
          <li key={ev.id}>
            <EventCard ev={ev} />
          </li>
        ))}
      </ul>
      <Link
        to="/events"
        className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors hover:text-ink"
      >
        All AUSSS events →
      </Link>
    </section>
  )
}

// The next three events, on the home page, with its own breathing room after
// it. Nothing at all when nothing is coming up.
export function HomeEvents() {
  const { events } = useEvents()
  const next = upcomingEvents(events).slice(0, 3)
  if (next.length === 0) return null
  return (
    <>
      <section id="events" className="container-prose">
        <div className="reveal flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow">
              <span className="h-px w-8 bg-medical" />
              Coming up
            </span>
            <h2 className="heading-serif mt-4 text-4xl text-ink sm:text-5xl">Our next events</h2>
          </div>
          <Link
            to="/events"
            className="inline-flex items-center gap-2 rounded-full border border-line/20 px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-veil/10"
          >
            All events →
          </Link>
        </div>
        <ul className="reveal mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {next.map((ev) => (
            <li key={ev.id}>
              <EventCard ev={ev} />
            </li>
          ))}
        </ul>
      </section>
      <div aria-hidden="true" className="h-24 sm:h-32" />
    </>
  )
}
