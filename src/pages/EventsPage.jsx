import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import EventCard from '../components/EventCard.jsx'
import Markdown from '../components/Markdown.jsx'
import ShareBar from '../components/ShareBar.jsx'
import { committeeBySlug } from '../data/society.js'
import { readableAccent } from '../lib/color.js'
import { eventIcs, eventWhen, googleCalendarUrl } from '../lib/eventTime.js'
import {
  ARCHIVE_DESCRIPTION,
  ARCHIVE_TITLE,
  EVENTS_DESCRIPTION,
  EVENTS_TITLE,
  archivedByTerm,
  eventMetaDescription,
  findEvent,
  isUpcoming,
  upcomingEvents,
  useEvents,
} from '../lib/events.js'
import { markdownToText } from '../lib/markdown.js'

// /events (what is coming up), /events/archive (what is over, by term) and
// /events/<slug> (one event). The events come from the database
// (src/lib/events.js); an event moves from the list to the archive by itself
// once it is over, and its own page keeps working either way.
//
// /events/<slug>.ics is the event's calendar file. The build writes one for
// every event it knows; an event published since the last build reaches this
// page instead, which makes the same file in the browser.

export default function EventsPage({ archive = false }) {
  const { slug } = useParams()
  if (slug && slug.endsWith('.ics')) return <CalendarFile slug={slug.slice(0, -4)} />
  if (slug) return <EventPage slug={slug} />
  return archive ? <ArchiveView /> : <UpcomingView />
}

function Spinner({ label }) {
  return (
    <div className="flex justify-center py-10">
      <span
        className="h-10 w-10 animate-spin rounded-full border-2 border-line/15 border-t-accent"
        role="status"
        aria-label={label}
      />
    </div>
  )
}

function PageHead({ eyebrow, title, lead, children }) {
  return (
    <header className="relative overflow-hidden pb-12 pt-32 sm:pt-40">
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
          backgroundSize: '34px 34px',
        }}
        aria-hidden="true"
      />
      <div className="container-prose relative text-center">
        <span className="eyebrow justify-center">
          <span className="h-px w-8 bg-medical" />
          {eyebrow}
          <span className="h-px w-8 bg-medical" />
        </span>
        <h1 className="heading-serif mt-6 text-4xl text-ink sm:text-6xl">{title}</h1>
        <p className="mx-auto mt-5 max-w-2xl text-base font-light leading-relaxed text-soft/80 sm:text-lg">{lead}</p>
        {children}
      </div>
    </header>
  )
}

// ───────────────────────── Upcoming ─────────────────────────

function UpcomingView() {
  usePageTitle(EVENTS_TITLE, EVENTS_DESCRIPTION)
  useReveal()
  const { events, loading } = useEvents()
  const upcoming = upcomingEvents(events)
  const hasPast = events.some((ev) => !isUpcoming(ev))

  return (
    <article className="bg-page">
      <PageHead
        eyebrow="Events"
        title="What’s on"
        lead="Campaigns, workshops, assemblies and socials run by AUSSS and its committees. Every event is in Cairo, and every time on this page is Cairo time."
      />
      <div className="container-prose pb-24">
        {upcoming.length === 0 && loading ? (
          <Spinner label="Loading events" />
        ) : upcoming.length === 0 ? (
          <p className="mx-auto max-w-xl rounded-2xl border border-dashed border-line/15 bg-veil/[0.03] p-8 text-center text-sm leading-relaxed text-soft/65">
            Nothing is scheduled right now. Our committees announce their events here and on{' '}
            <Link to="/contact" className="font-semibold text-accent hover:text-ink">
              our social channels
            </Link>
            , so check back soon.
          </p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((ev) => (
              <li key={ev.id} className="reveal">
                <EventCard ev={ev} headingLevel={2} />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          {hasPast && (
            <Link to="/events/archive" className="font-semibold text-accent transition-colors hover:text-ink">
              Past events →
            </Link>
          )}
          <Link to="/" className="font-semibold text-soft/60 transition-colors hover:text-ink">
            AUSSS home
          </Link>
        </div>
      </div>
    </article>
  )
}

// ───────────────────────── Archive ─────────────────────────

function ArchiveView() {
  usePageTitle(ARCHIVE_TITLE, ARCHIVE_DESCRIPTION)
  useReveal()
  const { events, loading } = useEvents()
  const terms = archivedByTerm(events)

  return (
    <article className="bg-page">
      <PageHead
        eyebrow="Archive"
        title="Past events"
        lead="Everything AUSSS and its committees have run, term by term. An event comes here by itself once it is over."
      />
      <div className="container-prose pb-24">
        {terms.length === 0 && loading ? (
          <Spinner label="Loading past events" />
        ) : terms.length === 0 ? (
          <p className="mx-auto max-w-xl rounded-2xl border border-dashed border-line/15 bg-veil/[0.03] p-8 text-center text-sm text-soft/65">
            No past events yet.
          </p>
        ) : (
          <div className="space-y-16">
            {terms.map((g) => (
              <section key={g.term} aria-labelledby={`term-${g.term}`}>
                <h2 id={`term-${g.term}`} className="heading-serif text-2xl text-ink sm:text-3xl">
                  {/^\d{4}-\d{2}$/.test(g.term) ? `Term ${g.term}` : g.term}
                </h2>
                <p className="mt-1 text-sm text-soft/55">
                  {g.events.length} {g.events.length === 1 ? 'event' : 'events'}
                </p>
                <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {g.events.map((ev) => (
                    <li key={ev.id} className="reveal">
                      <EventCard ev={ev} past headingLevel={3} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          <Link to="/events" className="font-semibold text-accent transition-colors hover:text-ink">
            ← Upcoming events
          </Link>
          <Link to="/" className="font-semibold text-soft/60 transition-colors hover:text-ink">
            AUSSS home
          </Link>
        </div>
      </div>
    </article>
  )
}

// ───────────────────────── One event ─────────────────────────

const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors'

function EventPage({ slug }) {
  const { events, loading } = useEvents()
  const { event, redirectTo } = findEvent(events, slug)
  usePageTitle(event ? event.title : EVENTS_TITLE, event ? eventMetaDescription(event) : undefined)
  useReveal()

  // A link shared before the event's link was changed still opens it.
  if (redirectTo) return <Navigate to={`/events/${redirectTo}`} replace />
  if (!event) return loading ? <Spinner label="Loading the event" /> : <NotFound />
  return <EventView ev={event} events={events} />
}

function NotFound() {
  return (
    <article className="bg-page">
      <PageHead
        eyebrow="Events"
        title="Event not found"
        lead="This event may have been taken down, or the link is mistyped."
      >
        <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm">
          <Link to="/events" className="font-semibold text-accent hover:text-ink">
            Upcoming events
          </Link>
          <Link to="/events/archive" className="font-semibold text-soft/60 hover:text-ink">
            Past events
          </Link>
        </div>
      </PageHead>
    </article>
  )
}

function EventView({ ev, events }) {
  const committee = ev.committee ? committeeBySlug(ev.committee) : null
  const accent = committee ? readableAccent(committee.color) : null
  const upcoming = isUpcoming(ev)
  const details = markdownToText(ev.description)
  // More of what the same organisers run next.
  const more = upcomingEvents(events, { committee: ev.committee }).filter((x) => x.id !== ev.id).slice(0, 3)
  const [pageUrl, setPageUrl] = useState('')
  useEffect(() => {
    setPageUrl(`${window.location.origin}/events/${ev.slug}`)
  }, [ev.slug])

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-10 pt-32 sm:pt-40">
        {/* Centred like the committee pages: the site's floating Back button
            sits at the top left on a phone. */}
        <div className="container-prose relative max-w-4xl text-center">
          <Link
            to={upcoming ? '/events' : '/events/archive'}
            className="mb-8 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {upcoming ? 'All events' : 'Past events'}
          </Link>

          <p
            className={`text-xs font-semibold uppercase tracking-[0.24em] ${accent ? '' : 'text-accent'}`}
            style={accent ? { color: accent } : undefined}
          >
            {committee ? (
              <Link to={`/committees/${ev.committee}`} className="hover:underline">
                {committee.abbr} · {committee.name}
              </Link>
            ) : (
              'AUSSS · Society-wide'
            )}
          </p>
          <h1 className="heading-serif mt-3 break-words text-4xl text-ink sm:text-5xl">{ev.title}</h1>

          <dl className="mx-auto mt-8 grid max-w-3xl gap-4 text-left sm:grid-cols-2">
            <div className="rounded-2xl border border-line/10 bg-card p-5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-soft/50">When</dt>
              <dd className="mt-2 text-base font-medium text-ink">{eventWhen(ev)}</dd>
              <dd className="mt-1 text-xs text-soft/50">Cairo time</dd>
            </div>
            <div className="rounded-2xl border border-line/10 bg-card p-5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-soft/50">Where</dt>
              <dd className="mt-2 break-words text-base font-medium text-ink">{ev.place || 'To be announced'}</dd>
            </div>
          </dl>

          {upcoming ? (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {ev.signupUrl && (
                <a
                  href={ev.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${btnBase} bg-cta text-on-cta hover:bg-cta-hover`}
                >
                  Sign up ↗
                </a>
              )}
              {/* A plain link, not the app's router: the server hands the
                  phone the file, which opens the calendar's "add" sheet. */}
              <a
                href={`/events/${ev.slug}.ics`}
                className={`${btnBase} border border-line/20 text-ink hover:bg-veil/10`}
              >
                <CalendarIcon />
                Add to calendar
              </a>
              <a
                href={googleCalendarUrl(ev, { url: pageUrl, details })}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 text-sm font-semibold text-soft/65 transition-colors hover:text-ink"
              >
                Google Calendar ↗
              </a>
            </div>
          ) : (
            <p className="mx-auto mt-8 max-w-3xl rounded-2xl border border-line/10 bg-sunk/60 px-5 py-4 text-sm text-soft/70">
              This event is over. It stays here in the{' '}
              <Link to="/events/archive" className="font-semibold text-accent hover:text-ink">
                archive
              </Link>
              {ev.term ? ` for the ${ev.term} term` : ''}.
            </p>
          )}
        </div>
      </header>

      <div className="container-prose max-w-4xl pb-24">
        {ev.image && (
          <figure className="reveal overflow-hidden rounded-3xl border border-line/10 bg-sunk">
            <img src={ev.image} alt={ev.title} className="max-h-[70vh] w-full object-contain" />
          </figure>
        )}

        {ev.description && (
          <Markdown
            text={ev.description}
            className={`reveal text-lg leading-relaxed text-soft/85 ${ev.image ? 'mt-10' : ''}`}
            gap="space-y-5"
          />
        )}

        <ShareBar title={ev.title} label="AUSSS events" heading="Share this event" className="reveal mt-12" />

        {more.length > 0 && (
          <section className="reveal mt-20" aria-labelledby="more-events">
            <h2 id="more-events" className="heading-serif text-2xl text-ink">
              {committee ? `More from ${committee.abbr}` : 'More society-wide events'}
            </h2>
            <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((x) => (
                <li key={x.id}>
                  <EventCard ev={x} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          <Link to="/events" className="font-semibold text-accent transition-colors hover:text-ink">
            All events
          </Link>
          <Link to="/events/archive" className="font-semibold text-soft/60 transition-colors hover:text-ink">
            Past events
          </Link>
        </div>
      </div>
    </article>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M12 13v4M10 15h4" strokeLinecap="round" />
    </svg>
  )
}

// ───────────────────────── Calendar file, made here ─────────────────────────

// /events/<slug>.ics when the build has no file for the event yet: make the
// file in the browser and hand it over.
function CalendarFile({ slug }) {
  const { events, loading } = useEvents()
  const { event, redirectTo } = findEvent(events, slug)
  const target = event || (redirectTo ? findEvent(events, redirectTo).event : null)
  usePageTitle(target ? `${target.title} (calendar)` : EVENTS_TITLE)
  const [href, setHref] = useState('')
  const linkRef = useRef(null)

  useEffect(() => {
    if (!target) return undefined
    const ics = eventIcs(target, {
      url: `${window.location.origin}/events/${target.slug}`,
      details: markdownToText(target.description),
    })
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    setHref(url)
    return () => URL.revokeObjectURL(url)
  }, [target])

  // Start the download once the link exists.
  useEffect(() => {
    if (href) linkRef.current?.click()
  }, [href])

  if (!target) return loading ? <Spinner label="Loading the event" /> : <NotFound />
  return (
    <article className="bg-page">
      <PageHead eyebrow="Add to calendar" title={target.title} lead="Your calendar file is on its way. Open it to add the event.">
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm">
          <a
            ref={linkRef}
            href={href || undefined}
            download={`${target.slug}.ics`}
            className={`${btnBase} border border-line/20 text-ink hover:bg-veil/10`}
          >
            <CalendarIcon />
            Download it again
          </a>
          <Link to={`/events/${target.slug}`} className="font-semibold text-accent hover:text-ink">
            Back to the event
          </Link>
        </div>
      </PageHead>
    </article>
  )
}
