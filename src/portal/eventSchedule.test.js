import { describe, expect, it } from 'vitest'
import {
  addDay,
  addDays,
  defaultSchedule,
  removeDay,
  restoreDay,
  scheduleFault,
  scheduleFromRow,
  scheduleProblem,
  schedulePatch,
  setDay,
  setScheduleField,
  switchKind,
} from './eventSchedule.js'

describe('a new event', () => {
  it('starts now, on the Cairo clock, as one time', () => {
    const s = defaultSchedule('2026-11-14T16:05:00.000Z')
    expect(s.kind).toBe('single')
    expect(s.start).toBe('2026-11-14T18:05')
    expect(s.end).toBe('')
    expect(scheduleProblem(s)).toBe('')
  })
})

describe('switching kinds keeps the dates', () => {
  const single = setScheduleField(defaultSchedule('2026-11-14T16:00:00.000Z'), 'end', '2026-11-14T20:00')

  it('one time to multiple days: that day and the next, with its hours', () => {
    const s = switchKind(single, 'days')
    expect(s.kind).toBe('days')
    expect(s.days).toEqual([
      { date: '2026-11-14', from: '18:00', to: '20:00' },
      { date: '2026-11-15', from: '18:00', to: '20:00' },
    ])
    expect(scheduleProblem(s)).toBe('')
  })

  it('one time to all day: the same day', () => {
    const s = switchKind(single, 'allday')
    expect([s.firstDay, s.lastDay]).toEqual(['2026-11-14', ''])
  })

  it('all day over three days to multiple days: one row a day', () => {
    const s = switchKind(setScheduleField(switchKind(single, 'allday'), 'lastDay', '2026-11-16'), 'days')
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16'])
  })

  it('multiple days back to one time: the first day', () => {
    const s = switchKind(switchKind(single, 'days'), 'single')
    expect([s.start, s.end]).toEqual(['2026-11-14T18:00', '2026-11-14T20:00'])
  })
})

describe('switching kinds keeps what was typed', () => {
  // Four days from 14 November, each with hours of its own.
  const twoDays = switchKind(defaultSchedule('2026-11-14T08:00:00.000Z'), 'days')
  const typedDays = [
    { date: '2026-11-14', from: '09:00', to: '13:00' },
    { date: '2026-11-15', from: '12:00', to: '18:30' },
    { date: '2026-11-16', from: '10:00', to: '12:00' },
    { date: '2026-11-18', from: '15:00', to: '21:00' },
  ]
  const four = typedDays.reduce(
    (s, d, i) => ['date', 'from', 'to'].reduce((t, field) => setDay(t, i, field, d[field]), i < 2 ? s : addDay(s)),
    twoDays,
  )

  it('multiple days to one time and back: every day and its hours', () => {
    expect(four.days).toEqual(typedDays)
    expect(switchKind(switchKind(four, 'single'), 'days').days).toEqual(typedDays)
  })

  it('multiple days to all day and back: every day and its hours', () => {
    const allDay = switchKind(four, 'allday')
    expect([allDay.firstDay, allDay.lastDay]).toEqual(['2026-11-14', '2026-11-18'])
    expect(switchKind(allDay, 'days').days).toEqual(typedDays)
  })

  it('through both other kinds and back', () => {
    const round = switchKind(switchKind(switchKind(four, 'single'), 'allday'), 'days')
    expect(round.days).toEqual(typedDays)
    expect(schedulePatch(round)).toEqual(schedulePatch(four))
  })

  it('one time with no end stays without one', () => {
    const single = defaultSchedule('2026-11-14T16:00:00.000Z')
    const back = switchKind(switchKind(single, 'days'), 'single')
    expect([back.start, back.end]).toEqual(['2026-11-14T18:00', ''])
    expect(schedulePatch(back)).toEqual(schedulePatch(single))
  })

  it('all day keeps its last day through one time', () => {
    const allDay = setScheduleField(switchKind(defaultSchedule('2026-11-14T16:00:00.000Z'), 'allday'), 'lastDay', '2026-11-17')
    const back = switchKind(switchKind(allDay, 'single'), 'allday')
    expect([back.firstDay, back.lastDay]).toEqual(['2026-11-14', '2026-11-17'])
  })

  it('a first date changed under another kind moves the typed days with it', () => {
    const single = setScheduleField(switchKind(four, 'single'), 'start', '2026-12-30T17:00')
    expect(switchKind(single, 'days').days).toEqual([
      { date: '2026-12-30', from: '09:00', to: '13:00' },
      { date: '2026-12-31', from: '12:00', to: '18:30' },
      { date: '2027-01-01', from: '10:00', to: '12:00' },
      { date: '2027-01-03', from: '15:00', to: '21:00' },
    ])
  })

  it('a year half typed and then finished leaves the typed days where they were', () => {
    // A date field hands over '0002-…' and '0020-…' on the way to '2026-…'.
    const half = setScheduleField(switchKind(four, 'allday'), 'firstDay', '0002-11-14')
    const away = switchKind(half, 'days')
    expect(away.days[3].date).toBe('0002-11-18')
    const done = setScheduleField(switchKind(away, 'allday'), 'firstDay', '2026-11-14')
    expect(switchKind(done, 'days').days).toEqual(typedDays)
  })

  it('a kind nobody typed in still follows the one in use', () => {
    const single = setScheduleField(defaultSchedule('2026-11-14T16:00:00.000Z'), 'start', '2026-11-20T09:30')
    expect(switchKind(single, 'days').days.map((d) => d.date)).toEqual(['2026-11-20', '2026-11-21'])
    // Looked at and left alone, the days are made again from the new start.
    const looked = switchKind(switchKind(single, 'days'), 'single')
    const later = setScheduleField(looked, 'start', '2026-11-25T09:30')
    expect(switchKind(later, 'days').days.map((d) => d.date)).toEqual(['2026-11-25', '2026-11-26'])
  })

  it('a saved row keeps what the form had typed under another kind', () => {
    const asSingle = switchKind(four, 'single')
    const saved = scheduleFromRow(schedulePatch(asSingle), asSingle)
    expect(saved.kind).toBe('single')
    expect(switchKind(saved, 'days').days).toEqual(typedDays)
    // Without the form's schedule the row is all there is.
    expect(switchKind(scheduleFromRow(schedulePatch(asSingle)), 'days').days).toHaveLength(2)
  })
})

describe('multiple days', () => {
  const base = switchKind(defaultSchedule('2026-11-14T08:00:00.000Z'), 'days')

  it('adds the next day with the same hours', () => {
    const s = addDay(setDay(base, 1, 'to', '18:30'))
    expect(s.days[2]).toEqual({ date: '2026-11-16', from: '10:00', to: '18:30' })
  })

  it('removes a day', () => {
    expect(removeDay(addDay(base), 0).days.map((d) => d.date)).toEqual(['2026-11-15', '2026-11-16'])
  })

  it('puts a removed day back where it was', () => {
    const three = addDay(setDay(base, 1, 'to', '18:30'))
    const day = three.days[1]
    expect(restoreDay(removeDay(three, 1), 1, day).days).toEqual(three.days)
    // The list has grown shorter since: the day goes at the end.
    expect(restoreDay(removeDay(removeDay(three, 1), 1), 5, day).days.map((d) => d.date)).toEqual(['2026-11-14', '2026-11-15'])
  })

  it('does not put a day back into a full list', () => {
    let full = base
    while (full.days.length < 14) full = addDay(full)
    expect(restoreDay(full, 0, { date: '2026-12-01', from: '10:00', to: '12:00' })).toBe(full)
  })

  it('says what is wrong', () => {
    expect(scheduleProblem(removeDay(base, 1))).toBe('Give at least two days, or choose One time.')
    expect(scheduleProblem(setDay(base, 1, 'to', '09:00'))).toBe('Day 2 ends before it starts.')
    expect(scheduleProblem(setDay(base, 1, 'date', '2026-11-14'))).toBe('Two of the days fall on the same date.')
    expect(scheduleProblem(setDay(base, 0, 'date', ''))).toBe('Day 1 needs a date, a start and an end.')
  })

  it('says which field it is about', () => {
    expect(scheduleFault(base)).toBe(null)
    expect(scheduleFault(removeDay(base, 1))).toMatchObject({ field: 'days', day: null })
    expect(scheduleFault(setDay(base, 1, 'to', '09:00'))).toMatchObject({ field: 'to', day: 1 })
    expect(scheduleFault(setDay(base, 1, 'date', '2026-11-14'))).toMatchObject({ field: 'date', day: 1 })
    expect(scheduleFault(setDay(base, 0, 'date', ''))).toMatchObject({ field: 'date', day: 0 })
    expect(scheduleFault(setDay(base, 1, 'from', ''))).toMatchObject({ field: 'from', day: 1 })
  })

  it('stores the days in order, with the event from the first start to the last end', () => {
    // 10:00 to 12:00 in Cairo (UTC+2) each day: the two hours a start without an end is given
    const s = setDay(base, 0, 'date', '2026-11-20')
    const patch = schedulePatch(s)
    expect(patch.all_day).toBe(false)
    expect(patch.days).toEqual([
      { starts_at: '2026-11-15T08:00:00.000Z', ends_at: '2026-11-15T10:00:00.000Z' },
      { starts_at: '2026-11-20T08:00:00.000Z', ends_at: '2026-11-20T10:00:00.000Z' },
    ])
    expect([patch.starts_at, patch.ends_at]).toEqual(['2026-11-15T08:00:00.000Z', '2026-11-20T10:00:00.000Z'])
  })

  it('reads back what it stored', () => {
    const row = { ...schedulePatch(base), all_day: false }
    expect(scheduleFromRow(row).days).toEqual(base.days)
  })
})

describe('the other kinds as stored', () => {
  it('one time', () => {
    const s = setScheduleField(defaultSchedule('2027-07-10T15:00:00.000Z'), 'end', '')
    expect(schedulePatch(s)).toEqual({ all_day: false, days: [], starts_at: '2027-07-10T15:00:00.000Z', ends_at: null })
  })

  it('all day: Cairo midnights, and a row reads back the same days', () => {
    const s = setScheduleField(switchKind(defaultSchedule('2027-07-10T15:00:00.000Z'), 'allday'), 'lastDay', '2027-07-12')
    const patch = schedulePatch(s)
    expect(patch).toEqual({ all_day: true, days: [], starts_at: '2027-07-09T21:00:00.000Z', ends_at: '2027-07-11T21:00:00.000Z' })
    const back = scheduleFromRow(patch)
    expect([back.kind, back.firstDay, back.lastDay]).toEqual(['allday', '2027-07-10', '2027-07-12'])
  })

  it('refuses a last day before the first', () => {
    const s = setScheduleField(switchKind(defaultSchedule('2027-07-10T15:00:00.000Z'), 'allday'), 'lastDay', '2027-07-01')
    expect(scheduleProblem(s)).toBe('The last day cannot come before the first.')
    expect(scheduleFault(s)).toMatchObject({ field: 'lastDay', day: null })
    expect(scheduleFault(setScheduleField(s, 'firstDay', ''))).toMatchObject({ field: 'firstDay' })
  })

  it('says which field of one time is wrong', () => {
    const s = defaultSchedule('2027-07-10T15:00:00.000Z')
    expect(scheduleFault(s)).toBe(null)
    expect(scheduleFault(setScheduleField(s, 'start', ''))).toMatchObject({ text: 'Give the event a start.', field: 'start' })
    expect(scheduleFault(setScheduleField(s, 'end', '2027-07-10T09:00'))).toMatchObject({
      text: 'The event cannot end before it starts.',
      field: 'end',
    })
  })

  it('counts days across a month end', () => {
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02')
  })
})

describe('a date the form cannot read', () => {
  // A date field takes a year of five digits and hands it over as typed.
  const single = defaultSchedule('2027-07-10T15:00:00.000Z')
  const allDay = switchKind(single, 'allday')
  const days = switchKind(single, 'days')

  it('has no day after it', () => {
    expect(addDays('20277-07-10', 1)).toBe('')
    expect(addDays('', 1)).toBe('')
  })

  it('is said at the last day, and never stored as no last day', () => {
    const s = setScheduleField(allDay, 'lastDay', '20277-07-12')
    expect(scheduleFault(s)).toMatchObject({ text: 'The last day is not a date the form understands.', field: 'lastDay' })
  })

  it('is said at the day it is in', () => {
    const s = setDay(days, 1, 'date', '20277-07-11')
    expect(scheduleFault(s)).toMatchObject({ text: 'Day 2 has a date the form does not understand.', field: 'date', day: 1 })
  })

  it('makes no days and no times for the other kinds', () => {
    const start = setScheduleField(single, 'start', '20277-07-10T18:00')
    expect(switchKind(start, 'days').days).toEqual([])
    expect(switchKind(start, 'allday').firstDay).toBe('')
    const first = setScheduleField(allDay, 'firstDay', '20277-07-10')
    expect(switchKind(first, 'days').days).toEqual([])
    const day = setDay(days, 0, 'date', '20277-07-10')
    expect([switchKind(day, 'allday').firstDay, switchKind(day, 'allday').lastDay]).toEqual(['', ''])
  })

  it('leaves the next day blank when a day is added after it', () => {
    const s = addDay(setDay(days, 1, 'date', '20277-07-11'))
    expect(s.days[2].date).toBe('')
  })
})
