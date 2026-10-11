// When an event happens, as the portal's forms hold it, and the columns the
// database stores (public.events: starts_at, ends_at, all_day, days).
//
// Three kinds, chosen in the form:
//   single   one time: a start, and an end when known (Cairo clock)
//   allday   whole days: the first day, and the last when there are several
//   days     multiple days: two or more days, each with its own hours
//
// The form keeps a value for every kind at once, so switching kinds carries
// the dates across instead of emptying the fields. A kind nobody has typed in
// is made from the one in use, and made again whenever that one changes. A
// kind that has been typed in, or that came with the saved event, is kept as
// it stands (`typed` lists those kinds), so switching away and back loses
// nothing: not a third day, a day's own hours or a last day. Only its dates
// move, all together, when the first date was changed under another kind:
// the first date is the one thing the three kinds share.
//
// Times are Cairo wall-clock strings ('YYYY-MM-DDTHH:mm', 'YYYY-MM-DD',
// 'HH:mm'); src/lib/eventTime.js turns them into instants.
import { cairoLocalToIso, isoToCairoDate, isoToCairoLocal } from '../lib/eventTime.js'

export const MAX_DAYS = 14
const DEFAULT_FROM = '10:00'
const DEFAULT_TO = '16:00'

export const SCHEDULE_KINDS = [
  { value: 'single', label: 'One time', hint: 'A start, and an end when you know it. Times are Cairo time.' },
  { value: 'allday', label: 'All day', hint: 'One or more whole days, without times.' },
  // the webmaster's wording, 2026-10-08
  { value: 'days', label: 'Multiple days', hint: 'Two or more days, timezone to use is CLT (Cairo Local Time)' },
]

// The fields each kind keeps its value in.
const FIELDS = { single: ['start', 'end'], allday: ['firstDay', 'lastDay'], days: ['days'] }
const KINDS = Object.keys(FIELDS)
const NOTHING = { start: '', end: '', firstDay: '', lastDay: '', days: [] }

const pad = (n) => String(n).padStart(2, '0')
const DAY_MS = 24 * 60 * 60 * 1000

// A 'YYYY-MM-DD' as a count of days, or NaN when it is not a date. Counted
// with setUTCFullYear because Date.UTC reads the years 0 to 99 as 1900 to
// 1999, and a date field hands over such a year while one is being typed.
function dayNumber(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '')
  return m ? Math.round(new Date(0).setUTCFullYear(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : NaN
}

// Whether the text is a date. A date field can hand over one that is not: it
// takes a year of five or six digits.
const isDate = (date) => !Number.isNaN(dayNumber(date))

// 'YYYY-MM-DD' plus n days, or '' when it is not a date: a date field shows
// that as empty, and anything else as a fault of the page.
export function addDays(date, n) {
  if (!isDate(date)) return ''
  const t = new Date((dayNumber(date) + n) * DAY_MS)
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

// 'HH:mm' plus two hours, kept within the day.
function twoHoursLater(time) {
  const [h, m] = time.split(':').map(Number)
  return h + 2 > 23 ? '23:59' : `${pad(h + 2)}:${pad(m)}`
}

const dateOf = (local) => (local || '').slice(0, 10)
const timeOf = (local) => (local || '').slice(11, 16)

// The other kinds' values, made from the one in use. A first date that is not
// a date yet gives them nothing to be made from.
function fromSingle(start, end) {
  const date = dateOf(start)
  if (!isDate(date)) return { firstDay: '', lastDay: '', days: [] }
  const from = timeOf(start) || DEFAULT_FROM
  const to = end && dateOf(end) === date && timeOf(end) > from ? timeOf(end) : twoHoursLater(from)
  return {
    firstDay: date,
    lastDay: end && isDate(dateOf(end)) && dateOf(end) > date ? dateOf(end) : '',
    days: [{ date, from, to }, { date: addDays(date, 1), from, to }],
  }
}

function fromAllDay(firstDay, lastDay) {
  if (!isDate(firstDay)) return { start: '', end: '', days: [] }
  const days = []
  const last = isDate(lastDay) && lastDay > firstDay ? lastDay : addDays(firstDay, 1)
  for (let d = firstDay; d <= last && days.length < MAX_DAYS; d = addDays(d, 1)) {
    days.push({ date: d, from: DEFAULT_FROM, to: DEFAULT_TO })
  }
  return { start: `${firstDay}T${DEFAULT_FROM}`, end: '', days }
}

function fromDays(days) {
  const first = days[0]
  const last = days[days.length - 1]
  if (!isDate(first?.date)) return { start: '', end: '', firstDay: '', lastDay: '' }
  return {
    start: `${first.date}T${first.from || DEFAULT_FROM}`,
    end: first.to ? `${first.date}T${first.to}` : '',
    firstDay: first.date,
    lastDay: isDate(last.date) && last.date !== first.date ? last.date : '',
  }
}

function madeFrom(s) {
  if (s.kind === 'single') return fromSingle(s.start, s.end)
  if (s.kind === 'allday') return fromAllDay(s.firstDay, s.lastDay)
  return fromDays(s.days)
}

// One kind's own fields out of a schedule.
const own = (kind, s) => Object.fromEntries(FIELDS[kind].map((field) => [field, s[field]]))

// The kinds whose values are kept as typed.
const typedOf = (s) => s.typed || [s.kind]

// The schedule with every kind that is neither in use nor typed made again
// from the one in use.
function complete(s) {
  const typed = typedOf(s)
  const made = madeFrom(s)
  const next = { ...s, typed }
  for (const kind of KINDS) {
    if (kind !== s.kind && !typed.includes(kind)) Object.assign(next, own(kind, made))
  }
  return next
}

// The kind in use has been typed in: it is kept as typed from now on.
function touched(s) {
  const typed = typedOf(s)
  return typed.includes(s.kind) ? s : { ...s, typed: [...typed, s.kind] }
}

// The first date of one kind's values.
function firstDate(kind, s) {
  if (kind === 'single') return dateOf(s.start)
  return kind === 'allday' ? s.firstDay : s.days[0]?.date || ''
}

const moveDate = (date, n) => (Number.isNaN(dayNumber(date)) ? date : addDays(date, n))
const moveLocal = (local, n) => (local ? `${moveDate(dateOf(local), n)}${local.slice(10)}` : '')

// One kind's values as they stand, with their dates moved together so that
// the first of them is `date`. Left alone while either is not a date yet.
function startingOn(kind, s, date) {
  const n = dayNumber(date) - dayNumber(firstDate(kind, s))
  if (!n) return own(kind, s)
  if (kind === 'single') return { start: moveLocal(s.start, n), end: moveLocal(s.end, n) }
  if (kind === 'allday') return { firstDay: moveDate(s.firstDay, n), lastDay: moveDate(s.lastDay, n) }
  return { days: s.days.map((d) => ({ ...d, date: moveDate(d.date, n) })) }
}

// A new event: one time, starting now.
export function defaultSchedule(nowIso = new Date().toISOString()) {
  return complete({ ...NOTHING, kind: 'single', typed: ['single'], start: isoToCairoLocal(nowIso) })
}

// What a table row holds, in its own kind.
function stored(row) {
  const days = Array.isArray(row.days) ? row.days : []
  if (days.length >= 2) {
    return {
      kind: 'days',
      days: days.map((d) => ({
        date: isoToCairoDate(d.starts_at),
        from: timeOf(isoToCairoLocal(d.starts_at)),
        to: timeOf(isoToCairoLocal(d.ends_at)),
      })),
    }
  }
  if (row.all_day) {
    return { kind: 'allday', firstDay: isoToCairoDate(row.starts_at), lastDay: row.ends_at ? isoToCairoDate(row.ends_at) : '' }
  }
  return { kind: 'single', start: isoToCairoLocal(row.starts_at), end: row.ends_at ? isoToCairoLocal(row.ends_at) : '' }
}

// What a table row holds, as the form shows it. `kept` is the schedule the
// form held until now, when the row replaces it (after a save, or when the
// event changed elsewhere): what was typed there under another kind and never
// stored is still there to switch back to.
export function scheduleFromRow(row, kept) {
  const s = { ...NOTHING, ...stored(row) }
  s.typed = [s.kind]
  for (const kind of kept ? typedOf(kept) : []) {
    if (kind === s.kind) continue
    s.typed.push(kind)
    Object.assign(s, startingOn(kind, kept, firstDate(s.kind, s)))
  }
  return complete(s)
}

// Switching kinds. A kind that was typed in comes back as it was left,
// starting on the first date now in use; any other is made from the one in use.
export function switchKind(schedule, kind) {
  if (kind === schedule.kind) return schedule
  const typed = typedOf(schedule)
  const values = typed.includes(kind)
    ? startingOn(kind, schedule, firstDate(schedule.kind, schedule))
    : own(kind, madeFrom(schedule))
  return complete({ ...schedule, ...values, kind, typed })
}

// A field of the kind in use changed: that kind is as typed, and the kinds
// nobody has typed in follow it.
export function setScheduleField(schedule, field, value) {
  return complete(touched({ ...schedule, [field]: value }))
}

const withDays = (schedule, days) => complete(touched({ ...schedule, kind: 'days', days }))

export function setDay(schedule, index, field, value) {
  return withDays(schedule, schedule.days.map((d, i) => (i === index ? { ...d, [field]: value } : d)))
}

// A day after the last one, with the same hours.
export function addDay(schedule) {
  const last = schedule.days[schedule.days.length - 1]
  const date = last?.date ? addDays(last.date, 1) : ''
  const next = { date, from: last?.from || DEFAULT_FROM, to: last?.to || DEFAULT_TO }
  return withDays(schedule, [...schedule.days, next].slice(0, MAX_DAYS))
}

export function removeDay(schedule, index) {
  return withDays(schedule, schedule.days.filter((_, i) => i !== index))
}

// A removed day put back where it was, or at the end when the list has grown
// shorter since. A full list is left as it is.
export function restoreDay(schedule, index, day) {
  if (schedule.days.length >= MAX_DAYS) return schedule
  const days = [...schedule.days]
  days.splice(Math.min(index, days.length), 0, day)
  return withDays(schedule, days)
}

// What is wrong with the schedule and where, or null: { text, field, day }.
// `field` names the input to point at: 'start' or 'end', 'firstDay' or
// 'lastDay', or 'date', 'from' or 'to' of the day at `day` (counted from 0).
// 'days' is the list as a whole, when it is too short or too long.
export function scheduleFault(s) {
  const at = (text, field, day = null) => ({ text, field, day })
  if (s.kind === 'single') {
    const start = cairoLocalToIso(s.start)
    if (!start) return at('Give the event a start.', 'start')
    if (s.end) {
      const end = cairoLocalToIso(s.end)
      if (!end) return at('The end is not a time the form understands.', 'end')
      if (Date.parse(end) < Date.parse(start)) return at('The event cannot end before it starts.', 'end')
    }
    return null
  }
  if (s.kind === 'allday') {
    if (!cairoLocalToIso(s.firstDay)) return at('Give the event its first day.', 'firstDay')
    // Said here, because schedulePatch stores a last day it cannot read as none.
    if (s.lastDay && !cairoLocalToIso(s.lastDay)) return at('The last day is not a date the form understands.', 'lastDay')
    if (s.lastDay && s.lastDay < s.firstDay) return at('The last day cannot come before the first.', 'lastDay')
    return null
  }
  if (s.days.length < 2) return at('Give at least two days, or choose One time.', 'days')
  if (s.days.length > MAX_DAYS) return at(`An event can have at most ${MAX_DAYS} days.`, 'days')
  for (const [i, d] of s.days.entries()) {
    if (!d.date || !d.from || !d.to) {
      return at(`Day ${i + 1} needs a date, a start and an end.`, !d.date ? 'date' : !d.from ? 'from' : 'to', i)
    }
    if (!cairoLocalToIso(`${d.date}T${d.from}`) || !cairoLocalToIso(`${d.date}T${d.to}`)) {
      return at(`Day ${i + 1} has a date the form does not understand.`, 'date', i)
    }
    if (d.to <= d.from) return at(`Day ${i + 1} ends before it starts.`, 'to', i)
  }
  // The later of two days on one date is the one to look at.
  const again = s.days.findIndex((d, i) => s.days.findIndex((o) => o.date === d.date) < i)
  if (again !== -1) return at('Two of the days fall on the same date.', 'date', again)
  return null
}

// What is wrong with the schedule, in words, or ''.
export function scheduleProblem(s) {
  return scheduleFault(s)?.text || ''
}

// The columns to store. The database checks the days again, puts them in
// order and takes the event's start and end from them.
export function schedulePatch(s) {
  if (s.kind === 'allday') {
    return {
      all_day: true,
      days: [],
      starts_at: cairoLocalToIso(s.firstDay),
      ends_at: s.lastDay ? cairoLocalToIso(s.lastDay) : null,
    }
  }
  if (s.kind === 'days') {
    const days = [...s.days]
      .sort((a, b) => `${a.date}T${a.from}`.localeCompare(`${b.date}T${b.from}`))
      .map((d) => ({ starts_at: cairoLocalToIso(`${d.date}T${d.from}`), ends_at: cairoLocalToIso(`${d.date}T${d.to}`) }))
    return { all_day: false, days, starts_at: days[0]?.starts_at ?? null, ends_at: days[days.length - 1]?.ends_at ?? null }
  }
  return {
    all_day: false,
    days: [],
    starts_at: cairoLocalToIso(s.start),
    ends_at: s.end ? cairoLocalToIso(s.end) : null,
  }
}
