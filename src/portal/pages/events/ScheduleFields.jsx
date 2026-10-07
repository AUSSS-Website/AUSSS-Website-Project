import { useEffect, useRef, useState } from 'react'
import { cairoLocalToIso, cairoParts } from '../../../lib/eventTime.js'
import {
  MAX_DAYS,
  SCHEDULE_KINDS,
  addDay,
  removeDay,
  setDay,
  setScheduleField,
  switchKind,
} from '../../eventSchedule.js'
import { inputCls, outlineBtnCls } from '../../portalUi.jsx'

// When an event happens, in the new-event form and the event editor: one
// time, all day, or multiple days (src/portal/eventSchedule.js holds the logic).
// `value` is the schedule, `onChange` gets the next one; `idPrefix` keeps the
// two forms' field ids apart.

const labelCls = 'block text-xs font-semibold uppercase tracking-[0.2em] text-accent'
const smallLabelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-soft/55'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// 'Thursday' for '2026-11-12', '' while the date is not set.
function weekdayOf(date) {
  const iso = date ? cairoLocalToIso(`${date}T12:00`) : null
  const p = iso ? cairoParts(iso) : null
  return p ? WEEKDAYS[p.wd] : ''
}

function KindPicker({ value, onChange }) {
  const current = SCHEDULE_KINDS.find((k) => k.value === value.kind)
  return (
    <div>
      <p className={labelCls}>When</p>
      <div
        role="radiogroup"
        aria-label="When the event happens"
        className="mt-3 inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-line/15 bg-sunk p-1"
      >
        {SCHEDULE_KINDS.map((k) => {
          const on = k.value === value.kind
          return (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(switchKind(value, k.value))}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
                on ? 'bg-cta text-on-cta shadow-sm' : 'text-soft/70 hover:bg-veil/10 hover:text-ink'
              }`}
            >
              {k.label}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-soft/55">{current?.hint} Times are Cairo time.</p>
    </div>
  )
}

function ClearButton({ onClick, label }) {
  return (
    <button type="button" className={`${outlineBtnCls} shrink-0`} onClick={onClick} aria-label={label}>
      Clear
    </button>
  )
}

function OneTime({ value, onChange, idPrefix }) {
  const set = (field) => (e) => onChange(setScheduleField(value, field, e.target.value))
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-start`} className={smallLabelCls}>
          Starts
        </label>
        <input id={`${idPrefix}-start`} className={inputCls} type="datetime-local" value={value.start} onChange={set('start')} required />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-end`} className={smallLabelCls}>
          Ends (optional)
        </label>
        <div className="flex gap-2">
          <input id={`${idPrefix}-end`} className={`${inputCls} min-w-0`} type="datetime-local" value={value.end} onChange={set('end')} />
          {value.end && <ClearButton label="Clear the end" onClick={() => onChange(setScheduleField(value, 'end', ''))} />}
        </div>
        <p className="mt-1.5 text-xs text-soft/50">Without an end, the event moves to the archive when it starts.</p>
      </div>
    </div>
  )
}

function AllDay({ value, onChange, idPrefix }) {
  const set = (field) => (e) => onChange(setScheduleField(value, field, e.target.value))
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-first`} className={smallLabelCls}>
          First day
        </label>
        <input id={`${idPrefix}-first`} className={inputCls} type="date" value={value.firstDay} onChange={set('firstDay')} required />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-last`} className={smallLabelCls}>
          Last day (optional)
        </label>
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-last`}
            className={`${inputCls} min-w-0`}
            type="date"
            value={value.lastDay}
            min={value.firstDay || undefined}
            onChange={set('lastDay')}
          />
          {value.lastDay && <ClearButton label="Clear the last day" onClick={() => onChange(setScheduleField(value, 'lastDay', ''))} />}
        </div>
        <p className="mt-1.5 text-xs text-soft/50">Leave it blank for a one-day event.</p>
      </div>
    </div>
  )
}

// One card per day: its number, its date (with the weekday, so a slip of a
// day is easy to see), and its hours. When the list has room (it is narrower
// in the editor, beside the card preview, than in the new-event form) a day
// is one row; otherwise the number, the weekday and the remove button head
// the card, the date takes the full width and the hours share the line below.
const ONE_ROW_PX = 620

// Whether the element is at least `px` wide, following it as it resizes.
function useAtLeast(px) {
  const ref = useRef(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= px))
    ro.observe(el)
    return () => ro.disconnect()
  }, [px])
  return [ref, wide]
}
function DayNumber({ n, className = '' }) {
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-medical/10 text-sm font-semibold text-accent ${className}`}
      aria-hidden="true"
    >
      {n}
    </span>
  )
}

function RemoveDay({ n, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full text-soft/55 transition-colors hover:bg-veil/10 hover:text-danger"
      aria-label={`Remove day ${n}`}
      title={`Remove day ${n}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function DayByDay({ value, onChange, idPrefix }) {
  const days = value.days
  const removable = days.length > 2
  const [listRef, oneRow] = useAtLeast(ONE_ROW_PX)
  return (
    <div>
      <ol ref={listRef} className="space-y-2.5">
        {days.map((d, i) => {
          const id = `${idPrefix}-day-${i}`
          const weekday = weekdayOf(d.date)
          const remove = () => onChange(removeDay(value, i))
          return (
            <li key={i} className={`rounded-2xl border border-line/10 bg-sunk/50 ${oneRow ? 'p-4' : 'p-3'}`}>
              <div className={`mb-3 flex items-center gap-3 ${oneRow ? 'hidden' : ''}`}>
                <DayNumber n={i + 1} />
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-soft/55">
                  Day {i + 1}
                  {weekday && <span className="ml-1.5 normal-case tracking-normal text-soft/45">{weekday}</span>}
                </p>
                <span className="ml-auto">{removable && <RemoveDay n={i + 1} onClick={remove} />}</span>
              </div>
              <div
                className={`grid gap-3 ${
                  oneRow ? 'grid-cols-[2.25rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-end' : 'grid-cols-2'
                }`}
              >
                {oneRow && <DayNumber n={i + 1} className="mb-1" />}
                <div className={oneRow ? '' : 'col-span-2'}>
                  <label htmlFor={`${id}-date`} className={smallLabelCls}>
                    <span className={oneRow ? 'hidden' : ''}>Date</span>
                    <span className={oneRow ? '' : 'hidden'}>
                      Day {i + 1}
                      {weekday && <span className="ml-1.5 normal-case tracking-normal text-soft/45">{weekday}</span>}
                    </span>
                  </label>
                  <input
                    id={`${id}-date`}
                    className={inputCls}
                    type="date"
                    value={d.date}
                    onChange={(e) => onChange(setDay(value, i, 'date', e.target.value))}
                    required
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-from`} className={smallLabelCls}>
                    From
                  </label>
                  <input
                    id={`${id}-from`}
                    className={`${inputCls} !px-3`}
                    type="time"
                    value={d.from}
                    onChange={(e) => onChange(setDay(value, i, 'from', e.target.value))}
                    required
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-to`} className={smallLabelCls}>
                    To
                  </label>
                  <input
                    id={`${id}-to`}
                    className={`${inputCls} !px-3`}
                    type="time"
                    value={d.to}
                    onChange={(e) => onChange(setDay(value, i, 'to', e.target.value))}
                    required
                  />
                </div>
                {oneRow && <div className="mb-1">{removable && <RemoveDay n={i + 1} onClick={remove} />}</div>}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={outlineBtnCls}
          onClick={() => onChange(addDay(value))}
          disabled={days.length >= MAX_DAYS}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add a day
        </button>
        <span className="text-xs text-soft/50">
          The next day, with the same hours. Up to {MAX_DAYS} days.
        </span>
      </div>
    </div>
  )
}

export default function ScheduleFields({ value, onChange, idPrefix = 'ev' }) {
  return (
    <div className="space-y-5">
      <KindPicker value={value} onChange={onChange} />
      {value.kind === 'single' && <OneTime value={value} onChange={onChange} idPrefix={idPrefix} />}
      {value.kind === 'allday' && <AllDay value={value} onChange={onChange} idPrefix={idPrefix} />}
      {value.kind === 'days' && <DayByDay value={value} onChange={onChange} idPrefix={idPrefix} />}
    </div>
  )
}
