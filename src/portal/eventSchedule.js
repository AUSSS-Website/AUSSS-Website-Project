// When an event happens, as the portal's forms hold it, and the columns the
// database stores (public.events: starts_at, ends_at, all_day, days).
//
// Three kinds, chosen in the form:
//   single   one time: a start, and an end when known (Cairo clock)
//   allday   whole days: the first day, and the last when there are several
//   days     multiple days: two or more days, each with its own hours
//
// The form keeps a value for every kind at once, so switching kinds carries
// the dates across instead of emptying the fields. Times are Cairo wall-clock
// strings ('YYYY-MM-DDTHH:mm', 'YYYY-MM-DD', 'HH:mm'); src/lib/eventTime.js
// turns them into instants.
import { cairoLocalToIso, isoToCairoDate, isoToCairoLocal } from '../lib/eventTime.js'

export const MAX_DAYS = 14
const DEFAULT_FROM = '10:00'
const DEFAULT_TO = '16:00'

export const SCHEDULE_KINDS = [
  { value: 'single', label: 'One time', hint: 'A start, and an end when you know it. Times are Cairo time.' },
  { value: 'allday', label: 'All day', hint: 'One or more whole days, without times. Times are Cairo time.' },
  // the webmaster's wording, 2026-10-08
  { value: 'days', label: 'Multiple days', hint: 'Two or more days, timezone to use is CLT (Cairo Local Time)' },
]

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' plus n days.
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

// 'HH:mm' plus two hours, kept within the day.
function twoHoursLater(time) {
  const [h, m] = time.split(':').map(Number)
  return h + 2 > 23 ? '23:59' : `${pad(h + 2)}:${pad(m)}`
}

const dateOf = (local) => (local || '').slice(0, 10)
const timeOf = (local) => (local || '').slice(11, 16)

// The other kinds' values, made from the one in use.
function fromSingle(start, end) {
  const date = dateOf(start)
  const from = timeOf(start) || DEFAULT_FROM
  const to = end && dateOf(end) === date && timeOf(end) > from ? timeOf(end) : twoHoursLater(from)
  return {
    firstDay: date,
    lastDay: end && dateOf(end) > date ? dateOf(end) : '',
    days: date ? [{ date, from, to }, { date: addDays(date, 1), from, to }] : [],
  }
}

function fromAllDay(firstDay, lastDay) {
  const days = []
  if (firstDay) {
    const last = lastDay && lastDay > firstDay ? lastDay : addDays(firstDay, 1)
    for (let d = firstDay; d <= last && days.length < MAX_DAYS; d = addDays(d, 1)) {
      days.push({ date: d, from: DEFAULT_FROM, to: DEFAULT_TO })
    }
  }
  return { start: firstDay ? `${firstDay}T${DEFAULT_FROM}` : '', end: '', days }
}

function fromDays(days) {
  const first = days[0]
  const last = days[days.length - 1]
  return {
    start: first?.date ? `${first.date}T${first.from || DEFAULT_FROM}` : '',
    end: first?.date && first.to ? `${first.date}T${first.to}` : '',
    firstDay: first?.date || '',
    lastDay: last?.date && last.date !== first?.date ? last.date : '',
  }
}

// A schedule of one kind, with the other kinds filled in from it.
function complete(kind, part) {
  if (kind === 'single') return { kind, start: part.start, end: part.end, ...fromSingle(part.start, part.end) }
  if (kind === 'allday') return { kind, firstDay: part.firstDay, lastDay: part.lastDay, ...fromAllDay(part.firstDay, part.lastDay) }
  return { kind, days: part.days, ...fromDays(part.days) }
}

// A new event: one time, starting now.
export function defaultSchedule(nowIso = new Date().toISOString()) {
  return complete('single', { start: isoToCairoLocal(nowIso), end: '' })
}

// What a table row holds, as the form shows it.
export function scheduleFromRow(row) {
  const days = Array.isArray(row.days) ? row.days : []
  if (days.length >= 2) {
    return complete('days', {
      days: days.map((d) => ({
        date: isoToCairoDate(d.starts_at),
        from: timeOf(isoToCairoLocal(d.starts_at)),
        to: timeOf(isoToCairoLocal(d.ends_at)),
      })),
    })
  }
  if (row.all_day) {
    return complete('allday', { firstDay: isoToCairoDate(row.starts_at), lastDay: row.ends_at ? isoToCairoDate(row.ends_at) : '' })
  }
  return complete('single', { start: isoToCairoLocal(row.starts_at), end: row.ends_at ? isoToCairoLocal(row.ends_at) : '' })
}

// Switching kinds: the new kind's values come from the one in use.
export function switchKind(schedule, kind) {
  if (kind === schedule.kind) return schedule
  return { ...complete(schedule.kind, schedule), kind }
}

// A field of one kind changed: that kind's value, the others follow it.
export function setScheduleField(schedule, field, value) {
  return complete(schedule.kind, { ...schedule, [field]: value })
}

export function setDay(schedule, index, field, value) {
  const days = schedule.days.map((d, i) => (i === index ? { ...d, [field]: value } : d))
  return complete('days', { days })
}

// A day after the last one, with the same hours.
export function addDay(schedule) {
  const last = schedule.days[schedule.days.length - 1]
  const date = last?.date ? addDays(last.date, 1) : ''
  const next = { date, from: last?.from || DEFAULT_FROM, to: last?.to || DEFAULT_TO }
  return complete('days', { days: [...schedule.days, next].slice(0, MAX_DAYS) })
}

export function removeDay(schedule, index) {
  return complete('days', { days: schedule.days.filter((_, i) => i !== index) })
}

// What is wrong with the schedule, in words, or ''.
export function scheduleProblem(s) {
  if (s.kind === 'single') {
    const start = cairoLocalToIso(s.start)
    if (!start) return 'Give the event a start.'
    if (s.end) {
      const end = cairoLocalToIso(s.end)
      if (!end) return 'The end is not a time the form understands.'
      if (Date.parse(end) < Date.parse(start)) return 'The event cannot end before it starts.'
    }
    return ''
  }
  if (s.kind === 'allday') {
    if (!cairoLocalToIso(s.firstDay)) return 'Give the event its first day.'
    if (s.lastDay && s.lastDay < s.firstDay) return 'The last day cannot come before the first.'
    return ''
  }
  if (s.days.length < 2) return 'Give at least two days, or choose One time.'
  if (s.days.length > MAX_DAYS) return `An event can have at most ${MAX_DAYS} days.`
  for (const [i, d] of s.days.entries()) {
    if (!d.date || !d.from || !d.to) return `Day ${i + 1} needs a date, a start and an end.`
    if (d.to <= d.from) return `Day ${i + 1} ends before it starts.`
  }
  const dates = s.days.map((d) => d.date)
  if (new Set(dates).size !== dates.length) return 'Two of the days fall on the same date.'
  return ''
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
