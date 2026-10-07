import { describe, expect, it } from 'vitest'
import {
  addDay,
  addDays,
  defaultSchedule,
  removeDay,
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

describe('multiple days', () => {
  const base = switchKind(defaultSchedule('2026-11-14T08:00:00.000Z'), 'days')

  it('adds the next day with the same hours', () => {
    const s = addDay(setDay(base, 1, 'to', '18:30'))
    expect(s.days[2]).toEqual({ date: '2026-11-16', from: '10:00', to: '18:30' })
  })

  it('removes a day', () => {
    expect(removeDay(addDay(base), 0).days.map((d) => d.date)).toEqual(['2026-11-15', '2026-11-16'])
  })

  it('says what is wrong', () => {
    expect(scheduleProblem(removeDay(base, 1))).toBe('Give at least two days, or choose One time.')
    expect(scheduleProblem(setDay(base, 1, 'to', '09:00'))).toBe('Day 2 ends before it starts.')
    expect(scheduleProblem(setDay(base, 1, 'date', '2026-11-14'))).toBe('Two of the days fall on the same date.')
    expect(scheduleProblem(setDay(base, 0, 'date', ''))).toBe('Day 1 needs a date, a start and an end.')
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
  })

  it('counts days across a month end', () => {
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02')
  })
})
