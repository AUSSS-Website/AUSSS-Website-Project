import { describe, expect, it } from 'vitest'
import {
  cairoLocalToIso,
  calendarSpan,
  dateTile,
  dayHours,
  eventDays,
  eventIcs,
  eventOverAt,
  eventWhen,
  googleCalendarUrl,
  isoToCairoDate,
  isoToCairoLocal,
} from './eventTime.js'
import { archivedByTerm, eventSummary, eventsFromSnapshot, findEvent, upcomingEvents } from './events.js'

// Egypt keeps summer time (UTC+3 from the last Friday of April to the last
// Thursday of October, UTC+2 otherwise), so the tests use one date in each.
const WINTER = '2026-11-14T16:00:00.000Z' // 6:00 pm in Cairo (UTC+2)
const SUMMER = '2027-07-10T15:00:00.000Z' // 6:00 pm in Cairo (UTC+3)

describe('Cairo wall clock', () => {
  it('turns a Cairo time into the right instant in winter and in summer', () => {
    expect(cairoLocalToIso('2026-11-14T18:00')).toBe(WINTER)
    expect(cairoLocalToIso('2027-07-10T18:00')).toBe(SUMMER)
  })

  it('reads a date alone as midnight in Cairo', () => {
    expect(cairoLocalToIso('2026-11-14')).toBe('2026-11-13T22:00:00.000Z')
  })

  it('refuses what is not a time', () => {
    expect(cairoLocalToIso('')).toBeNull()
    expect(cairoLocalToIso('next Friday')).toBeNull()
  })

  it('turns an instant back into the Cairo clock for the inputs', () => {
    expect(isoToCairoLocal(WINTER)).toBe('2026-11-14T18:00')
    expect(isoToCairoLocal(SUMMER)).toBe('2027-07-10T18:00')
    expect(isoToCairoDate('2026-11-13T22:00:00.000Z')).toBe('2026-11-14')
    expect(isoToCairoLocal('')).toBe('')
  })

  it('round-trips a time on the day the clocks go forward', () => {
    // Egypt's summer time began at midnight on Friday 24 April 2026.
    const iso = cairoLocalToIso('2026-04-24T12:00')
    expect(isoToCairoLocal(iso)).toBe('2026-04-24T12:00')
  })
})

describe('eventOverAt', () => {
  it('is the end, else the start, of a timed event', () => {
    expect(eventOverAt({ startsAt: WINTER, endsAt: null })).toBe(Date.parse(WINTER))
    expect(eventOverAt({ startsAt: WINTER, endsAt: '2026-11-14T18:00:00.000Z' })).toBe(
      Date.parse('2026-11-14T18:00:00.000Z'),
    )
  })

  it('is the Cairo midnight after the last day of an all-day event', () => {
    const start = cairoLocalToIso('2027-07-10')
    const end = cairoLocalToIso('2027-07-12')
    expect(eventOverAt({ startsAt: start, endsAt: end, allDay: true })).toBe(Date.parse(cairoLocalToIso('2027-07-13')))
    expect(eventOverAt({ startsAt: start, endsAt: null, allDay: true })).toBe(Date.parse(cairoLocalToIso('2027-07-11')))
  })
})

describe('eventWhen', () => {
  it('words a timed event', () => {
    expect(eventWhen({ startsAt: WINTER })).toBe('Saturday 14 November 2026, 6:00 pm')
    expect(eventWhen({ startsAt: WINTER, endsAt: cairoLocalToIso('2026-11-14T20:30') })).toBe(
      'Saturday 14 November 2026, 6:00–8:30 pm',
    )
    expect(eventWhen({ startsAt: cairoLocalToIso('2026-11-14T11:00'), endsAt: cairoLocalToIso('2026-11-14T14:00') })).toBe(
      'Saturday 14 November 2026, 11:00 am – 2:00 pm',
    )
    expect(eventWhen({ startsAt: WINTER, endsAt: cairoLocalToIso('2026-11-16T14:00') })).toBe(
      '14 November, 6:00 pm – 16 November 2026, 2:00 pm',
    )
  })

  it('shortens for cards', () => {
    expect(eventWhen({ startsAt: WINTER }, { short: true })).toBe('Sat 14 Nov 2026, 6:00 pm')
  })

  it('words an all-day event by its days', () => {
    const day = (d) => cairoLocalToIso(d)
    expect(eventWhen({ startsAt: day('2026-11-14'), allDay: true })).toBe('Saturday 14 November 2026')
    expect(eventWhen({ startsAt: day('2026-11-14'), endsAt: day('2026-11-16'), allDay: true })).toBe('14–16 November 2026')
    expect(eventWhen({ startsAt: day('2026-11-30'), endsAt: day('2026-12-02'), allDay: true })).toBe(
      '30 November – 2 December 2026',
    )
    expect(eventWhen({ startsAt: day('2026-12-30'), endsAt: day('2027-01-02'), allDay: true })).toBe(
      '30 December 2026 – 2 January 2027',
    )
  })

  it('gives the tile of the start day', () => {
    expect(dateTile({ startsAt: WINTER })).toEqual({ day: '14', month: 'Nov', weekday: 'Sat', year: '2026' })
  })
})

describe('calendar files', () => {
  const ev = {
    id: 'e1',
    title: 'World Health Day; talks, games',
    startsAt: WINTER,
    endsAt: null,
    place: 'Faculty garden',
  }

  it('gives a timed event without an end an hour', () => {
    expect(calendarSpan(ev)).toEqual({ allDay: false, start: '20261114T160000Z', end: '20261114T170000Z' })
  })

  it('gives an all-day event whole days, the end day exclusive', () => {
    const span = calendarSpan({ startsAt: cairoLocalToIso('2026-11-14'), endsAt: cairoLocalToIso('2026-11-16'), allDay: true })
    expect(span).toEqual({ allDay: true, start: '20261114', end: '20261117' })
  })

  it('writes an .ics file with escaped text and folded lines', () => {
    const ics = eventIcs(
      { ...ev, title: 'يوم الصحة العالمي '.repeat(5).trim() },
      { url: 'https://ausss-ainshams.org/events/whd', details: 'Talks, games\nand food', now: Date.parse('2026-10-07T12:00:00Z') },
    )
    // A reader joins a folded line back up before it reads it.
    const unfolded = ics.replace(/\r\n /g, '')
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(unfolded).toContain('DTSTAMP:20261007T120000Z')
    expect(unfolded).toContain('DTSTART:20261114T160000Z')
    expect(unfolded).toContain('LOCATION:Faculty garden')
    expect(unfolded).toContain('DESCRIPTION:Talks\\, games\\nand food\\n\\nhttps://ausss-ainshams.org/events/whd')
    expect(unfolded).toContain(`SUMMARY:${'يوم الصحة العالمي '.repeat(5).trim()}`)
    const enc = new TextEncoder()
    for (const line of ics.split('\r\n')) expect(enc.encode(line).length).toBeLessThanOrEqual(75)
  })

  it('links to Google Calendar with the same times', () => {
    const url = new URL(googleCalendarUrl(ev, { url: 'https://ausss-ainshams.org/events/whd' }))
    expect(url.searchParams.get('dates')).toBe('20261114T160000Z/20261114T170000Z')
    expect(url.searchParams.get('text')).toBe(ev.title)
    expect(url.searchParams.get('ctz')).toBe('Africa/Cairo')
  })
})

describe('events from the database', () => {
  const doc = {
    events: [
      { id: '1', slug: 'past-2025', title: 'Past', committee: 'scoph', starts_at: '2025-10-01T10:00:00Z', over_at: '2025-10-01T10:00:00Z', term: '2025-26' },
      { id: '2', slug: 'older-2025', title: 'Older', committee: null, starts_at: '2025-03-01T10:00:00Z', over_at: '2025-03-01T10:00:00Z', term: '2024-25' },
      { id: '3', slug: 'next-2026', title: 'Next', committee: 'scoph', starts_at: '2026-11-01T10:00:00Z', over_at: '2026-11-01T12:00:00Z', term: '2026-27', aliases: ['old-link'] },
      { id: '4', slug: 'soon-2026', title: 'Soon', committee: 'scora', starts_at: '2026-10-20T10:00:00Z', over_at: '2026-10-20T10:00:00Z', term: '2026-27' },
      { id: '', slug: 'broken' },
    ],
  }
  const now = Date.parse('2026-10-07T12:00:00Z')
  const events = eventsFromSnapshot(doc)

  it('drops rows it cannot show', () => {
    expect(events.map((e) => e.slug)).toEqual(['past-2025', 'older-2025', 'next-2026', 'soon-2026'])
  })

  it('lists what is not over, soonest first, and by committee', () => {
    expect(upcomingEvents(events, { now }).map((e) => e.slug)).toEqual(['soon-2026', 'next-2026'])
    expect(upcomingEvents(events, { now, committee: 'scoph' }).map((e) => e.slug)).toEqual(['next-2026'])
  })

  it('files what is over by term, newest first', () => {
    expect(archivedByTerm(events, { now }).map((g) => [g.term, g.events.map((e) => e.slug)])).toEqual([
      ['2025-26', ['past-2025']],
      ['2024-25', ['older-2025']],
    ])
  })

  it('finds an event by its link or an old one', () => {
    expect(findEvent(events, 'next-2026').event.id).toBe('3')
    expect(findEvent(events, 'old-link')).toEqual({ event: null, redirectTo: 'next-2026' })
    expect(findEvent(events, 'nothing')).toEqual({ event: null, redirectTo: null })
  })

  it('cuts a long text at a word for a card', () => {
    const ev = { description: '**Bring** a friend. ' + 'word '.repeat(60) }
    const out = eventSummary(ev, 40)
    expect(out.endsWith('…')).toBe(true)
    expect(out.startsWith('Bring a friend.')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(41)
  })
})

describe('multiple days', () => {
  const day = (d, from, to) => ({ startsAt: cairoLocalToIso(`${d}T${from}`), endsAt: cairoLocalToIso(`${d}T${to}`) })
  const ev = {
    id: 'e2',
    title: 'Spring school',
    days: [day('2026-11-12', '10:00', '16:00'), day('2026-11-13', '12:00', '18:00'), day('2026-11-14', '09:00', '13:00')],
  }
  ev.startsAt = ev.days[0].startsAt
  ev.endsAt = ev.days[2].endsAt

  it('words the span and counts the days', () => {
    expect(eventWhen(ev)).toBe('12–14 November 2026, 3 days')
    expect(eventWhen(ev, { short: true })).toBe('12–14 Nov 2026 · 3 days')
  })

  it('gives each day its own hours', () => {
    expect(ev.days.map(dayHours)).toEqual(['10:00 am – 4:00 pm', '12:00–6:00 pm', '9:00 am – 1:00 pm'])
    expect(dayHours({ startsAt: cairoLocalToIso('2026-11-12T22:00'), endsAt: cairoLocalToIso('2026-11-13T02:00') })).toBe(
      '10:00 pm – Fri 2:00 am',
    )
  })

  it('treats one day, or none, as an ordinary event', () => {
    expect(eventDays({ days: [ev.days[0]] })).toEqual([])
    expect(eventDays({})).toEqual([])
  })

  it('puts every day in the calendar file, each with its hours', () => {
    const ics = eventIcs(ev, { now: Date.parse('2026-10-07T12:00:00Z') }).replace(/\r\n /g, '')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    expect(ics).toContain('UID:e2-2@ausss-ainshams.org')
    expect(ics).toContain('SUMMARY:Spring school (day 2 of 3)')
    expect(ics).toContain('DTSTART:20261113T100000Z')
    expect(ics).toContain('DTEND:20261113T160000Z')
  })
})
