// Event times: Cairo's clock, the words the pages show, and calendar files.
//
// Every event happens in Cairo, so every date and time on the site is Cairo
// time, whatever the visitor's own time zone (an incoming exchange student
// planning from abroad reads the time the event starts where it happens). The
// database stores instants (timestamptz); the portal's inputs are Cairo wall
// clock. Egypt keeps summer time, so the offset is UTC+2 or UTC+3 depending on
// the date, and it is read from the browser's (or Node's) time zone data, never
// hard-coded.
//
// Only numeric parts come from Intl; the month and weekday names and the am/pm
// are this file's, so the words are the same in every browser and in the
// build's pre-render.

export const EVENT_TZ = 'Africa/Cairo'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t))

// The Cairo wall clock at an instant: { y, m (1-12), d, h (0-23), min, s, wd (0 = Sunday) }.
export function cairoParts(t) {
  const ms = toMs(t)
  if (!Number.isFinite(ms)) return null
  const p = {}
  for (const { type, value } of partsFormat.formatToParts(new Date(ms))) p[type] = Number(value)
  const out = { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, s: p.second }
  out.wd = new Date(Date.UTC(out.y, out.m - 1, out.d)).getUTCDay()
  return out
}

// How far Cairo's clock is ahead of UTC at an instant, in milliseconds.
function offsetAt(ms) {
  const p = cairoParts(ms)
  const whole = Math.floor(ms / 1000) * 1000
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - whole
}

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DDTHH:mm' (or 'YYYY-MM-DD', midnight) on Cairo's clock -> an ISO
// instant, or null when the text is not such a time.
export function cairoLocalToIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(local || '').trim())
  if (!m) return null
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))
  if (!Number.isFinite(wall)) return null
  // The offset at the guess may differ from the offset at the answer when the
  // clocks change in between; one more step settles it.
  let ms = wall - offsetAt(wall)
  const again = wall - offsetAt(ms)
  if (again !== ms) ms = again
  return new Date(ms).toISOString()
}

// An instant -> 'YYYY-MM-DDTHH:mm' on Cairo's clock, for a datetime-local input.
export function isoToCairoLocal(iso) {
  const p = iso ? cairoParts(iso) : null
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}` : ''
}

// An instant -> 'YYYY-MM-DD' on Cairo's clock, for a date input.
export function isoToCairoDate(iso) {
  const p = iso ? cairoParts(iso) : null
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : ''
}

// When an event leaves the upcoming list, in ms: its end, else its start; an
// all-day event at the Cairo midnight after its last day. The database's
// app.event_over_at says the same; the portal, which reads the table, uses this.
export function eventOverAt(ev) {
  const last = ev.endsAt || ev.startsAt
  if (!ev.allDay) return toMs(last)
  const p = cairoParts(last)
  if (!p) return NaN
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1))
  return Date.parse(cairoLocalToIso(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`))
}

// An instant as ISO 8601 on Cairo's clock with its offset
// ('2026-11-14T18:00:00+02:00'), for schema.org data: search engines show the
// local time.
export function cairoIsoWithOffset(iso) {
  const ms = toMs(iso)
  const p = cairoParts(ms)
  if (!p) return ''
  const off = Math.round(offsetAt(ms) / 60000)
  const sign = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:${pad(p.s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// ---- words ------------------------------------------------------------------

const monthName = (p, short) => (short ? MONTHS[p.m - 1].slice(0, 3) : MONTHS[p.m - 1])
const weekdayName = (p, short) => (short ? WEEKDAYS[p.wd].slice(0, 3) : WEEKDAYS[p.wd])
const sameDay = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d

// '6:00 pm', '12:30 am'.
function clock(p, withPeriod = true) {
  const h = p.h % 12 || 12
  return `${h}:${pad(p.min)}${withPeriod ? ` ${p.h < 12 ? 'am' : 'pm'}` : ''}`
}

// '6:00–8:00 pm' within one half of the day, '11:00 am – 2:00 pm' across noon.
function clockRange(a, b) {
  return a.h < 12 === b.h < 12 ? `${clock(a, false)}–${clock(b)}` : `${clock(a)} – ${clock(b)}`
}

// The days an all-day event covers: '14 November 2026', '14–16 November 2026',
// '30 November – 2 December 2026', '30 December 2026 – 2 January 2027'.
function dayRange(a, b, short) {
  if (!b || sameDay(a, b)) return `${a.d} ${monthName(a, short)} ${a.y}`
  if (a.y !== b.y) return `${a.d} ${monthName(a, short)} ${a.y} – ${b.d} ${monthName(b, short)} ${b.y}`
  if (a.m !== b.m) return `${a.d} ${monthName(a, short)} – ${b.d} ${monthName(b, short)} ${b.y}`
  return `${a.d}–${b.d} ${monthName(a, short)} ${a.y}`
}

// The days of a multiple-day event ([{ startsAt, endsAt }], in order), or []
// for any other event.
export function eventDays(ev) {
  return Array.isArray(ev.days) && ev.days.length >= 2 ? ev.days : []
}

// When an event happens, in words. `short` abbreviates the month and weekday
// for cards ('Sat 14 Nov 2026, 6:00–8:00 pm').
//   timed, no end       Saturday 14 November 2026, 6:00 pm
//   timed, one day      Saturday 14 November 2026, 6:00–8:00 pm
//   timed, many days    14 November, 6:00 pm – 16 November 2026, 2:00 pm
//   all day             Saturday 14 November 2026  /  14–16 November 2026
//   multiple days       12–14 November 2026, 3 days  /  12–14 Nov 2026 · 3 days
export function eventWhen(ev, { short = false } = {}) {
  const a = cairoParts(ev.startsAt)
  if (!a) return ''
  const b = ev.endsAt ? cairoParts(ev.endsAt) : null
  const days = eventDays(ev)
  if (days.length > 0) {
    const last = cairoParts(days[days.length - 1].startsAt)
    return `${dayRange(a, last, short)}${short ? ' · ' : ', '}${days.length} days`
  }
  if (ev.allDay) {
    // An all-day event's end is the midnight its last day starts.
    if (!b || sameDay(a, b)) return `${weekdayName(a, short)} ${dayRange(a, null, short)}`
    return dayRange(a, b, short)
  }
  const day = `${weekdayName(a, short)} ${a.d} ${monthName(a, short)} ${a.y}`
  if (!b) return `${day}, ${clock(a)}`
  if (sameDay(a, b)) return `${day}, ${clockRange(a, b)}`
  const startYear = a.y === b.y ? '' : ` ${a.y}`
  return `${a.d} ${monthName(a, short)}${startYear}, ${clock(a)} – ${b.d} ${monthName(b, short)} ${b.y}, ${clock(b)}`
}

// The hours of one day of a multiple-day event: '10:00 am – 4:00 pm', or with
// the next day's weekday when it runs past midnight ('10:00 pm – Fri 2:00 am').
export function dayHours(day) {
  const a = cairoParts(day.startsAt)
  const b = cairoParts(day.endsAt)
  if (!a || !b) return ''
  return sameDay(a, b) ? clockRange(a, b) : `${clock(a)} – ${weekdayName(b, true)} ${clock(b)}`
}

// The tile on an event card: { day: '14', month: 'Nov', weekday: 'Sat' }.
export function dateTile(ev) {
  const a = cairoParts(ev.startsAt)
  return a ? { day: String(a.d), month: monthName(a, true), weekday: weekdayName(a, true), year: String(a.y) } : null
}

// ---- calendars --------------------------------------------------------------

const HOUR = 60 * 60 * 1000

// '20261114T160000Z'
const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
// '20261114'
const dateStamp = (p) => `${p.y}${pad(p.m)}${pad(p.d)}`

// The day after a Cairo calendar day, as a date stamp (an all-day event's
// calendar end is exclusive).
function nextDayStamp(p) {
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1))
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`
}

// Start and end as calendars take them. A timed event without an end is given
// an hour, the length a calendar gives a new event of its own.
export function calendarSpan(ev) {
  const start = toMs(ev.startsAt)
  if (ev.allDay) {
    const a = cairoParts(start)
    const last = ev.endsAt ? cairoParts(ev.endsAt) : a
    return { allDay: true, start: dateStamp(a), end: nextDayStamp(last) }
  }
  const end = ev.endsAt ? toMs(ev.endsAt) : start + HOUR
  return { allDay: false, start: utcStamp(start), end: utcStamp(end) }
}

// RFC 5545 text: backslash, semicolon, comma and line breaks escaped.
function icsText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Lines longer than 75 octets are folded: CRLF and a space, never inside a
// character (Arabic letters are two octets each).
function fold(line) {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = out.length === 0 ? 75 : 74
    if (bytes + n > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

// One event as an .ics file: what "Add to calendar" hands the phone. A
// multiple-day event is one calendar entry per day, each with its own hours.
// `url` is the event's page, `details` its text as plain words, `now` the
// stamp time (a parameter so tests are repeatable).
export function eventIcs(ev, { url, details = '', now = Date.now() } = {}) {
  const days = eventDays(ev)
  const entries = days.length
    ? days.map((d, i) => ({
        uid: `${ev.id}-${i + 1}`,
        title: `${ev.title} (day ${i + 1} of ${days.length})`,
        span: { allDay: false, start: utcStamp(toMs(d.startsAt)), end: utcStamp(toMs(d.endsAt)) },
      }))
    : [{ uid: ev.id, title: ev.title, span: calendarSpan(ev) }]
  const description = `DESCRIPTION:${icsText([details, url].filter(Boolean).join('\n\n'))}`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AUSSS//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...entries.flatMap(({ uid, title, span }) => [
      'BEGIN:VEVENT',
      `UID:${uid}@ausss-ainshams.org`,
      `DTSTAMP:${utcStamp(now)}`,
      span.allDay ? `DTSTART;VALUE=DATE:${span.start}` : `DTSTART:${span.start}`,
      span.allDay ? `DTEND;VALUE=DATE:${span.end}` : `DTEND:${span.end}`,
      `SUMMARY:${icsText(title)}`,
      ev.place ? `LOCATION:${icsText(ev.place)}` : null,
      description,
      url ? `URL:${url}` : null,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.map(fold).join('\r\n') + '\r\n'
}

// The same event as a Google Calendar "add" link (Android phones open it in
// their calendar app). A link holds one entry, so the pages offer it only for
// an event that is not multiple days.
export function googleCalendarUrl(ev, { url, details = '' } = {}) {
  const span = calendarSpan(ev)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${span.start}/${span.end}`,
    details: [details, url].filter(Boolean).join('\n\n'),
    location: ev.place || '',
    ctz: EVENT_TZ,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}
