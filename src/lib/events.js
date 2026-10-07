// The society's events, live from the database (Phase 6, step 4).
//
// Officers add their committee's events in the portal (src/portal/pages/events)
// and the EB adds the society-wide ones; the public site reads the published
// ones through rpc/events_public() and never sees the table. Same loading order
// as the gallery (src/lib/gallery.js): the list the build baked in, else the
// last one this browser saw, then the live answer replaces both. One fetch
// serves every component on the page.
//
// Upcoming or archived is decided here, by the clock, every time a page
// renders: an event is upcoming until it is over (its end, or its start when it
// has none; an all-day event at the end of its last day) and archived after,
// grouped by the term it happened in. Nothing in the database changes when an
// event ends, and its page and link keep working.
//
// Event shape (what the pages read):
//   { id, slug, title, committee (slug or null), startsAt, endsAt (ISO or
//     null), allDay, overAt (ms), term ('2026-27'), place, description
//     (markdown), image, signupUrl, aliases, updatedAt }
import { useEffect, useState } from 'react'
import { restRpc, supabaseRestEnabled } from './supabaseRest.js'
import { readJson } from './localCache.js'
import { eventOverAt, eventWhen } from './eventTime.js'
import { markdownToText } from './markdown.js'

// The titles and descriptions of /events and /events/archive: the pages set
// them at runtime and src/seo/pages.js writes them into the saved pages.
export const EVENTS_TITLE = 'Events'
export const EVENTS_DESCRIPTION =
  'Upcoming AUSSS events: campaigns, workshops, assemblies and socials run by the society and its committees at the Faculty of Medicine, Ain Shams University, Cairo.'
export const ARCHIVE_TITLE = 'Past events'
export const ARCHIVE_DESCRIPTION =
  'Every event AUSSS and its committees have run, term by term: campaigns, workshops, assemblies and socials at Ain Shams University, Cairo.'

const CACHE_KEY = 'ausss-events-snapshot'
const GLOBAL_KEY = '__AUSSS_EVENTS__'
const FRESH_MS = 60 * 1000

const text = (v) => (typeof v === 'string' ? v : '')

// One event from rpc/events_public() (or a cached one) to the page shape.
export function normalizeEvent(e) {
  const ev = {
    id: String(e.id),
    slug: String(e.slug),
    title: text(e.title),
    committee: e.committee ? String(e.committee) : null,
    startsAt: text(e.startsAt || e.starts_at),
    endsAt: text(e.endsAt || e.ends_at) || null,
    allDay: Boolean(e.allDay ?? e.all_day),
    term: text(e.term),
    place: text(e.place),
    description: text(e.description),
    image: text(e.image),
    signupUrl: text(e.signupUrl || e.signup_url),
    aliases: Array.isArray(e.aliases) ? e.aliases.filter((a) => typeof a === 'string') : [],
    updatedAt: text(e.updatedAt || e.updated_at),
  }
  // A number once cached, an ISO time from the database.
  const raw = e.overAt ?? e.over_at
  const over = typeof raw === 'number' ? raw : Date.parse(text(raw))
  ev.overAt = Number.isFinite(over) ? over : eventOverAt(ev)
  return ev
}

function fromList(list) {
  return Array.isArray(list)
    ? list.filter((e) => e && e.id && e.slug && (e.startsAt || e.starts_at)).map(normalizeEvent)
    : []
}

// The document rpc/events_public() returns -> normalised events, oldest first.
export function eventsFromSnapshot(doc) {
  return fromList(doc && doc.events)
}

export async function fetchEvents() {
  if (!supabaseRestEnabled) return []
  return eventsFromSnapshot(await restRpc('events_public', {}))
}

// Used by entry-server.jsx: the prerender fetched the events once.
export function setBakedEvents(events) {
  globalThis[GLOBAL_KEY] = events
}

const baked = () => (typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null)

function initialEvents() {
  if (Array.isArray(baked())) return fromList(baked())
  return fromList(readJson(CACHE_KEY, []))
}

let pending = null
let fetchedAt = 0
function loadEvents() {
  if (!pending || Date.now() - fetchedAt > FRESH_MS) {
    fetchedAt = Date.now()
    pending = fetchEvents().then((live) => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(live))
      } catch {
        /* cache write is best-effort */
      }
      return live
    })
    // A failed fetch may be tried again by the next component.
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}

// { events, loading }. `loading` is true until the live answer has settled, so
// the page of a brand-new event can wait instead of saying "not found".
export function useEvents() {
  const [events, setEvents] = useState(initialEvents)
  // The build's render has its answer already (and runs no effects), so it
  // says "nothing scheduled" rather than showing a spinner.
  const [loading, setLoading] = useState(() => supabaseRestEnabled && !Array.isArray(baked()))

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    loadEvents()
      .then((live) => {
        if (alive) setEvents(live)
      })
      .catch(() => {
        /* keep whatever we had: baked or cached */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return { events, loading }
}

// ---- splitting by the clock ---------------------------------------------------

export const isUpcoming = (ev, now = Date.now()) => ev.overAt > now

// Not over yet, soonest first. `committee` narrows it to one committee's.
export function upcomingEvents(events, { now = Date.now(), committee } = {}) {
  return events
    .filter((ev) => isUpcoming(ev, now) && (committee === undefined || ev.committee === committee))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
}

// Over, newest first, in terms: [{ term: '2026-27', events: [...] }], the
// latest term first.
export function archivedByTerm(events, { now = Date.now() } = {}) {
  const past = events
    .filter((ev) => !isUpcoming(ev, now))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
  const groups = []
  for (const ev of past) {
    const term = ev.term || 'Earlier'
    let g = groups.find((x) => x.term === term)
    if (!g) {
      g = { term, events: [] }
      groups.push(g)
    }
    g.events.push(ev)
  }
  return groups.sort((a, b) => b.term.localeCompare(a.term))
}

// The event at a link, or where an old link of it now points.
export function findEvent(events, slug) {
  if (!slug) return { event: null, redirectTo: null }
  const direct = events.find((ev) => ev.slug === slug)
  if (direct) return { event: direct, redirectTo: null }
  const moved = events.find((ev) => ev.aliases.includes(slug))
  return moved ? { event: null, redirectTo: moved.slug } : { event: null, redirectTo: null }
}

// Plain words cut at a word near `max` characters.
function clip(plain, max) {
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`
}

// The event's text as plain words, cut at a word near `max` characters, for
// cards, share previews and search engines.
export function eventSummary(ev, max = 160) {
  return clip(markdownToText(ev.description), max)
}

// The description of an event's page (its <meta> and its share card): when,
// where, then the start of its text. The pre-render and the page itself both
// use it, so the two always match.
export function eventMetaDescription(ev) {
  const lead = [eventWhen(ev), ev.place].filter(Boolean).join(', ')
  const rest = markdownToText(ev.description)
  return clip(rest ? `${lead}. ${rest}` : `${lead}. An AUSSS event.`, 200)
}
