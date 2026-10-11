import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import EventCard, { DateTile, eventAccent } from '../components/EventCard.jsx'
import Markdown from '../components/Markdown.jsx'
import ShareBar from '../components/ShareBar.jsx'
import { committeeBySlug } from '../data/society.js'
import { readableAccent } from '../lib/color.js'
import { dayHours, eventDays, eventIcs, eventWhen, googleCalendarUrl } from '../lib/eventTime.js'
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
import { pressCls } from '../lib/motion.js'
import NotFoundPage from './NotFoundPage.jsx'

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

// The links that close a page are one line of text to the eye. This gives a
// finger 44px to land on (in px, since the root size shrinks on a 320px phone)
// and takes back whatever that adds to the line (1.25rem at text-sm) with a
// negative margin, so nothing moves.
const tapLinkCls = '-my-[calc((44px_-_1.25rem)/2)] inline-flex min-h-[44px] items-center'

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

// One event's page, or its calendar file, opened before the list has
// answered. The wait is shown where the page will be: a bare spinner at the
// top of the page would turn behind the fixed header, unseen.
function LoadingEvent() {
  return (
    <article className="bg-page">
      <div className="container-prose flex min-h-[60vh] items-center justify-center pt-32 sm:pt-40">
        <Spinner label="Loading the event" />
      </div>
    </article>
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
        <p className="mx-auto mt-5 max-w-2xl text-base font-normal leading-relaxed text-soft/80 dark:font-light sm:text-lg">{lead}</p>
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
        lead="Campaigns, workshops, assemblies and socials run by AUSSS and its committees."
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
            <Link to="/events/archive" className={`${tapLinkCls} font-semibold text-accent transition-colors hover:text-ink`}>
              Past events →
            </Link>
          )}
          <Link to="/" className={`${tapLinkCls} font-semibold text-soft/60 transition-colors hover:text-ink`}>
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
        lead="Everything AUSSS and its committees have run, term by term."
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
          <Link to="/events" className={`${tapLinkCls} font-semibold text-accent transition-colors hover:text-ink`}>
            ← Upcoming events
          </Link>
          <Link to="/" className={`${tapLinkCls} font-semibold text-soft/60 transition-colors hover:text-ink`}>
            AUSSS home
          </Link>
        </div>
      </div>
    </article>
  )
}

// ───────────────────────── One event ─────────────────────────

const btnBase = `inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold ${pressCls}`

// The events, and whether the list is the live one. The page starts from the
// list the build baked in or the one this browser kept, and useEvents puts
// another in its place only when the live answer arrives, so a different
// list is the live one. Only that list can say for certain that an address
// names no event: the first may be older than the event, and a read that
// failed says nothing either way.
function useEventsAndLive() {
  const { events, loading } = useEvents()
  const [startedWith] = useState(events)
  return { events, loading, live: events !== startedWith }
}

function EventPage({ slug }) {
  const { events, loading, live } = useEventsAndLive()
  const { event, redirectTo } = findEvent(events, slug)

  // A link shared before the event's link was changed still opens it.
  if (redirectTo) return <Navigate to={`/events/${redirectTo}`} replace />
  // An address that names no event gets the site's "not found" page, which
  // also asks search engines to leave the address out, once the live list has
  // answered without it. Past events are in the same list, so theirs still
  // open. The event's own page is a component of its own below, so only one
  // of the two sets the page title.
  if (!event && !loading && live) return <NotFoundPage />
  return <EventOrWait event={event} events={events} loading={loading} />
}

function EventOrWait({ event, events, loading }) {
  usePageTitle(event ? event.title : EVENTS_TITLE, event ? eventMetaDescription(event) : undefined)
  useReveal()
  if (!event) return loading ? <LoadingEvent /> : <NotFound />
  return <EventView ev={event} events={events} />
}

// Shown for an event the page does not know when the live list never came
// (the read failed): the event may be a new one, so this says so on the
// events' own page and leaves the address to search engines.
function NotFound() {
  return (
    <article className="bg-page">
      <PageHead
        eyebrow="Events"
        title="Event not found"
        lead="This event may have been taken down, or the link is mistyped."
      >
        <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm">
          <Link to="/events" className={`${tapLinkCls} font-semibold text-accent transition-colors hover:text-ink`}>
            Upcoming events
          </Link>
          <Link to="/events/archive" className={`${tapLinkCls} font-semibold text-soft/60 transition-colors hover:text-ink`}>
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
          {/* 44px for a finger. The margins take back what that adds to the
              1rem line, worked out from the root size so the 2rem gap below
              holds on a small phone and a wide screen alike. */}
          <Link
            to={upcoming ? '/events' : '/events/archive'}
            className="-mt-[calc((44px_-_1rem)/2)] mb-[calc(2rem_-_(44px_-_1rem)/2)] inline-flex min-h-[44px] items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 transition-colors hover:text-ink"
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
              // The ::after reaches above and below the 1rem line until the
              // two make 44px, for a finger.
              <Link
                to={`/committees/${ev.committee}`}
                className="relative inline-block hover:underline after:absolute after:inset-x-0 after:-inset-y-[calc((44px_-_1rem)/2)] after:content-['']"
              >
                {committee.abbr} · {committee.name}
              </Link>
            ) : (
              'AUSSS · Society-wide'
            )}
          </p>
          <h1 className="heading-serif mt-3 break-words text-4xl text-ink sm:text-5xl">{ev.title}</h1>

          <dl className="mx-auto mt-8 grid max-w-3xl gap-4 text-left sm:grid-cols-2">
            <div className="rounded-2xl border border-line/10 bg-card p-5">
              <dt className="text-2xs font-semibold uppercase tracking-[0.2em] text-soft/50">When</dt>
              <dd className="mt-2 text-base font-medium text-ink">{eventWhen(ev)}</dd>
              <dd className="mt-1 text-xs text-soft/50">Cairo time</dd>
            </div>
            <div className="rounded-2xl border border-line/10 bg-card p-5">
              <dt className="text-2xs font-semibold uppercase tracking-[0.2em] text-soft/50">Where</dt>
              <dd className="mt-2 break-words text-base font-medium text-ink">{ev.place || 'To be announced'}</dd>
            </div>
          </dl>

          <DayByDay ev={ev} />

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
              {/* A Google link holds one entry; a multiple-day event's file
                  holds them all, so it gets the file only. */}
              {eventDays(ev).length === 0 && (
                <a
                  href={googleCalendarUrl(ev, { url: pageUrl, details })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-soft/65 transition-colors hover:text-ink"
                >
                  Google Calendar ↗
                </a>
              )}
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
          <Link to="/events" className={`${tapLinkCls} font-semibold text-accent transition-colors hover:text-ink`}>
            All events
          </Link>
          <Link to="/events/archive" className={`${tapLinkCls} font-semibold text-soft/60 transition-colors hover:text-ink`}>
            Past events
          </Link>
        </div>
      </div>
    </article>
  )
}

// A multiple-day event's days, one card each: the day as a calendar leaf in the
// organiser's colour (as on the event cards), its number and its hours.
function DayByDay({ ev }) {
  const days = eventDays(ev)
  if (days.length === 0) return null
  const { chip, tint } = eventAccent(ev)
  return (
    <section aria-labelledby="multiple-days" className="mx-auto mt-4 max-w-3xl text-left">
      <h2 id="multiple-days" className="sr-only">
        Multiple days
      </h2>
      <ol className={`grid gap-3 ${days.length === 2 || days.length === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
        {days.map((d, i) => (
          <li key={d.startsAt} className="flex items-center gap-3 rounded-2xl border border-line/10 bg-card p-3.5">
            <DateTile ev={d} accent={chip} tint={tint} className="!self-center" />
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-soft/50">
                Day {i + 1} of {days.length}
              </p>
              {/* One line: three cards share the row on a wide screen. */}
              <p className="mt-1 whitespace-nowrap text-[0.9375rem] font-medium text-ink">{dayHours(d)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
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
  const { events, loading, live } = useEventsAndLive()
  const { event, redirectTo } = findEvent(events, slug)
  const target = event || (redirectTo ? findEvent(events, redirectTo).event : null)
  // The calendar file of an event the live list does not have: not found,
  // as the event's own page is (EventPage above).
  if (!target && !loading && live) return <NotFoundPage />
  return <CalendarDownload target={target} loading={loading} />
}

function CalendarDownload({ target, loading }) {
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

  if (!target) return loading ? <LoadingEvent /> : <NotFound />
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
          <Link to={`/events/${target.slug}`} className="inline-flex min-h-[44px] items-center font-semibold text-accent transition-colors hover:text-ink">
            Back to the event
          </Link>
        </div>
      </PageHead>
    </article>
  )
}
