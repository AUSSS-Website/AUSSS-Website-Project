import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cairoLocalToIso, cairoParts } from '../../../lib/eventTime.js'
import { pressCls } from '../../../lib/motion.js'
import {
  MAX_DAYS,
  SCHEDULE_KINDS,
  addDay,
  removeDay,
  restoreDay,
  scheduleFault,
  setDay,
  setScheduleField,
  switchKind,
} from '../../eventSchedule.js'
import { ErrorText, UndoLine, inputCls, outlineBtnCls } from '../../portalUi.jsx'

// When an event happens, in the new-event form and the event editor: one
// time, all day, or multiple days (src/portal/eventSchedule.js holds the logic).
// `value` is the schedule, `onChange` gets the next one; `idPrefix` keeps the
// two forms' field ids apart.
//
// What is wrong with the times shows at the field it is about, the moment it
// goes wrong, and goes the moment it is put right. The two forms that hold
// these fields give their own fields' messages the same look with the three
// pieces below, and ask scheduleFieldId where to put the cursor when a save
// is tried with something still wrong.

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps the portal's small pill. In px and not rem, because the root size
// shrinks on a 320px phone.
export const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// The sentence under a field that has something wrong with it.
export function FieldProblem({ id, children }) {
  if (!children) return null
  return (
    <div className="mt-2">
      <ErrorText id={id}>{children}</ErrorText>
    </div>
  )
}

// What ties a field to the sentence under it, for a screen reader, and marks
// it as wrong. The sentence's id is the field's with '-problem' after it.
export function problemProps(id, problem) {
  return problem ? { 'aria-invalid': true, 'aria-describedby': `${id}-problem` } : {}
}

// A field with something wrong with it takes a red border over its own.
export const fieldCls = (cls, problem) => (problem ? `${cls} !border-danger/70` : cls)

// The id of the field a fault from scheduleFault is about.
export function scheduleFieldId(idPrefix, fault) {
  if (!fault) return ''
  if (fault.day !== null) return `${idPrefix}-day-${fault.day}-${fault.field}`
  return `${idPrefix}-${{ start: 'start', end: 'end', firstDay: 'first', lastDay: 'last', days: 'add-day' }[fault.field]}`
}

// The id of the first field of the kind in use: where the cursor goes for a
// message about the times as a whole, which no one field can be blamed for.
export function scheduleFirstFieldId(idPrefix, schedule) {
  if (schedule.kind === 'days') return `${idPrefix}-${schedule.days.length ? 'day-0-date' : 'add-day'}`
  return `${idPrefix}-${schedule.kind === 'allday' ? 'first' : 'start'}`
}

// The same label as every other field of the form (Field in portalUi.jsx).
const labelCls = 'block text-sm font-medium text-ink'
const smallLabelCls = 'mb-1 block text-2xs font-semibold uppercase tracking-[0.16em] text-soft/55'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// 'Thursday' for '2026-11-12', '' while the date is not set.
function weekdayOf(date) {
  const iso = date ? cairoLocalToIso(`${date}T12:00`) : null
  const p = iso ? cairoParts(iso) : null
  return p ? WEEKDAYS[p.wd] : ''
}

function KindPicker({ value, onChange, idPrefix }) {
  const at = SCHEDULE_KINDS.findIndex((k) => k.value === value.kind)
  // The arrow keys move along the row and choose as they go, as in any set of
  // radio buttons, and Tab stops on the chosen one alone.
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = SCHEDULE_KINDS[(at + step + SCHEDULE_KINDS.length) % SCHEDULE_KINDS.length]
    onChange(switchKind(value, next.value))
    document.getElementById(`${idPrefix}-kind-${next.value}`)?.focus()
  }
  return (
    <div>
      <p className={labelCls}>When</p>
      <div
        role="radiogroup"
        aria-label="When the event happens"
        aria-describedby={`${idPrefix}-kind-hint`}
        onKeyDown={onKeyDown}
        className="mt-3 inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-line/15 bg-sunk p-1"
      >
        {SCHEDULE_KINDS.map((k) => {
          const on = k.value === value.kind
          return (
            <button
              key={k.value}
              id={`${idPrefix}-kind-${k.value}`}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(switchKind(value, k.value))}
              className={`rounded-xl px-4 py-2 text-xs font-semibold ${pressCls} ${tapCls} ${
                on ? 'bg-cta text-on-cta shadow-sm' : 'text-soft/70 hover:bg-veil/10 hover:text-ink'
              }`}
            >
              {k.label}
            </button>
          )
        })}
      </div>
      <p id={`${idPrefix}-kind-hint`} className="mt-2 text-xs text-soft/55">
        {SCHEDULE_KINDS[at]?.hint}
      </p>
    </div>
  )
}

function ClearButton({ onClick, label }) {
  return (
    <button type="button" className={`${outlineBtnCls} ${tapCls} shrink-0`} onClick={onClick} aria-label={label}>
      Clear
    </button>
  )
}

function OneTime({ value, onChange, idPrefix, fault }) {
  const set = (field) => (e) => onChange(setScheduleField(value, field, e.target.value))
  const wrong = (field) => (fault?.field === field ? fault.text : '')
  const startId = `${idPrefix}-start`
  const endId = `${idPrefix}-end`
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor={startId} className={smallLabelCls}>
          Starts
        </label>
        <input
          id={startId}
          className={fieldCls(inputCls, wrong('start'))}
          type="datetime-local"
          value={value.start}
          onChange={set('start')}
          required
          {...problemProps(startId, wrong('start'))}
        />
        <FieldProblem id={`${startId}-problem`}>{wrong('start')}</FieldProblem>
      </div>
      <div>
        <label htmlFor={endId} className={smallLabelCls}>
          Ends (optional)
        </label>
        {/* The field keeps the 15rem a date with its time and its am or pm
            takes; where Clear does not fit beside that (a phone), it goes
            under the field instead of cutting the end of the time off. */}
        <div className="flex flex-wrap gap-2">
          <input
            id={endId}
            className={fieldCls(`${inputCls} min-w-0 grow basis-60`, wrong('end'))}
            type="datetime-local"
            value={value.end}
            onChange={set('end')}
            {...problemProps(endId, wrong('end'))}
          />
          {value.end && <ClearButton label="Clear the end" onClick={() => onChange(setScheduleField(value, 'end', ''))} />}
        </div>
        <FieldProblem id={`${endId}-problem`}>{wrong('end')}</FieldProblem>
        <p className="mt-1.5 text-xs text-soft/50">Without an end, the event moves to the archive when it starts.</p>
      </div>
    </div>
  )
}

function AllDay({ value, onChange, idPrefix, fault }) {
  const set = (field) => (e) => onChange(setScheduleField(value, field, e.target.value))
  const wrong = (field) => (fault?.field === field ? fault.text : '')
  const firstId = `${idPrefix}-first`
  const lastId = `${idPrefix}-last`
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor={firstId} className={smallLabelCls}>
          First day
        </label>
        <input
          id={firstId}
          className={fieldCls(inputCls, wrong('firstDay'))}
          type="date"
          value={value.firstDay}
          onChange={set('firstDay')}
          required
          {...problemProps(firstId, wrong('firstDay'))}
        />
        <FieldProblem id={`${firstId}-problem`}>{wrong('firstDay')}</FieldProblem>
      </div>
      <div>
        <label htmlFor={lastId} className={smallLabelCls}>
          Last day (optional)
        </label>
        <div className="flex gap-2">
          <input
            id={lastId}
            className={fieldCls(`${inputCls} min-w-0`, wrong('lastDay'))}
            type="date"
            value={value.lastDay}
            min={value.firstDay || undefined}
            onChange={set('lastDay')}
            {...problemProps(lastId, wrong('lastDay'))}
          />
          {value.lastDay && <ClearButton label="Clear the last day" onClick={() => onChange(setScheduleField(value, 'lastDay', ''))} />}
        </div>
        <FieldProblem id={`${lastId}-problem`}>{wrong('lastDay')}</FieldProblem>
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
// On a narrow phone the two hours do not fit side by side with their am or pm
// in view, so each takes a line of its own.
const HOURS_PAIR_PX = 320
const ONE_ROW_PX = 620
const LIST_STEPS = [HOURS_PAIR_PX, ONE_ROW_PX]

// How many of the widths in `steps` (narrowest first) the element is at least
// as wide as, following it as it resizes. It is measured before the first
// paint, so the list is never drawn one way and then moved to another.
function useReached(steps) {
  const ref = useRef(null)
  const [reached, setReached] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const count = (width) => steps.filter((px) => width >= px).length
    setReached(count(el.getBoundingClientRect().width))
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setReached(count(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [steps])
  return [ref, reached]
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

// The round button is 32px to the eye; its ::after gives a finger 44px, in px
// because the root size shrinks on a 320px phone, without moving anything.
function RemoveDay({ id, n, onClick }) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      // A held key repeats Enter's click, and the keyboard lands on the next
      // day's button each time: only a fresh press removes a day.
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.repeat) e.preventDefault()
      }}
      className={`relative grid h-8 w-8 place-items-center rounded-full text-soft/55 ${pressCls} hover:bg-veil/10 hover:text-danger after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']`}
      aria-label={`Remove day ${n}`}
      title={`Remove day ${n}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function DayByDay({ value, onChange, idPrefix, fault }) {
  const days = value.days
  const removable = days.length > 2
  const [listRef, reached] = useReached(LIST_STEPS)
  const oneRow = reached === 2
  const stacked = reached === 0
  const addId = `${idPrefix}-add-day`
  const listProblem = fault?.field === 'days' ? fault.text : ''

  // The last day removed, for one Undo: { day, index }.
  const [removed, setRemoved] = useState(null)
  // The schedule as this list last sent it up. Any other one arriving in
  // `value` was made elsewhere (the form was put back as saved), and the day
  // Undo holds no longer belongs to it: the offer is dropped before the list
  // is drawn, so it never shows beside a list it does not fit.
  const [sent, setSent] = useState(value)
  if (value !== sent) {
    setSent(value)
    setRemoved(null)
  }
  const send = (next) => {
    setSent(next)
    onChange(next)
  }

  // Where the keyboard goes once the list has been drawn again: the button
  // that was pressed went with its row, or with the Undo line.
  const focusNext = useRef('')
  useEffect(() => {
    if (!focusNext.current) return
    document.getElementById(focusNext.current)?.focus()
    focusNext.current = ''
  })

  const remove = (i) => (e) => {
    // The keyboard stays at the same place in the list: on the day that moved
    // up, on the last day, or on "Add a day" once no day can be removed.
    if (document.activeElement === e.currentTarget) {
      const left = days.length - 1
      focusNext.current = left > 2 ? `${idPrefix}-day-${Math.min(i, left - 1)}-remove` : addId
    }
    setRemoved({ day: days[i], index: i })
    send(removeDay(value, i))
  }
  const undo = (e) => {
    if (!removed) return
    if (document.activeElement === e.currentTarget) {
      focusNext.current = `${idPrefix}-day-${Math.min(removed.index, days.length)}-remove`
    }
    send(restoreDay(value, removed.index, removed.day))
    setRemoved(null)
  }
  const add = () => {
    // A full list has no room for the day Undo would put back.
    if (days.length + 1 >= MAX_DAYS) setRemoved(null)
    send(addDay(value))
  }

  return (
    <div>
      <ol ref={listRef} className="space-y-2.5">
        {days.map((d, i) => {
          const id = `${idPrefix}-day-${i}`
          const weekday = weekdayOf(d.date)
          const wrong = (field) => (fault?.day === i && fault.field === field ? fault.text : '')
          const removeButton = removable && <RemoveDay id={`${id}-remove`} n={i + 1} onClick={remove(i)} />
          return (
            <li key={i} className={`rounded-2xl border border-line/10 bg-sunk/50 ${oneRow ? 'p-4' : 'p-3'}`}>
              {!oneRow && (
                <div className="mb-3 flex items-center gap-3">
                  <DayNumber n={i + 1} />
                  <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-soft/55">
                    Day {i + 1}
                    {weekday && <span className="ml-1.5 normal-case tracking-normal text-soft/45">{weekday}</span>}
                  </p>
                  <span className="ml-auto">{removeButton}</span>
                </div>
              )}
              <div
                className={`grid gap-3 ${
                  oneRow
                    ? 'grid-cols-[2.25rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-end'
                    : stacked
                      ? 'grid-cols-1'
                      : 'grid-cols-2'
                }`}
              >
                {oneRow && <DayNumber n={i + 1} className="mb-1" />}
                <div className={oneRow || stacked ? '' : 'col-span-2'}>
                  <label htmlFor={`${id}-date`} className={smallLabelCls}>
                    <span className={oneRow ? 'hidden' : ''}>Date</span>
                    <span className={oneRow ? '' : 'hidden'}>
                      Day {i + 1}
                      {weekday && <span className="ml-1.5 normal-case tracking-normal text-soft/45">{weekday}</span>}
                    </span>
                  </label>
                  <input
                    id={`${id}-date`}
                    className={fieldCls(inputCls, wrong('date'))}
                    type="date"
                    value={d.date}
                    onChange={(e) => send(setDay(value, i, 'date', e.target.value))}
                    required
                    {...problemProps(`${id}-date`, wrong('date'))}
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-from`} className={smallLabelCls}>
                    From
                  </label>
                  <input
                    id={`${id}-from`}
                    className={fieldCls(`${inputCls} !px-3`, wrong('from'))}
                    type="time"
                    value={d.from}
                    onChange={(e) => send(setDay(value, i, 'from', e.target.value))}
                    required
                    {...problemProps(`${id}-from`, wrong('from'))}
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-to`} className={smallLabelCls}>
                    To
                  </label>
                  <input
                    id={`${id}-to`}
                    className={fieldCls(`${inputCls} !px-3`, wrong('to'))}
                    type="time"
                    value={d.to}
                    onChange={(e) => send(setDay(value, i, 'to', e.target.value))}
                    required
                    {...problemProps(`${id}-to`, wrong('to'))}
                  />
                </div>
                {oneRow && <div className="mb-1">{removeButton}</div>}
              </div>
              {fault?.day === i && <FieldProblem id={`${id}-${fault.field}-problem`}>{fault.text}</FieldProblem>}
            </li>
          )
        })}
      </ol>
      <FieldProblem id={`${addId}-problem`}>{listProblem}</FieldProblem>
      <div className="mt-3">
        <button
          id={addId}
          type="button"
          className={`${outlineBtnCls} ${tapCls}`}
          onClick={add}
          disabled={days.length >= MAX_DAYS}
          aria-describedby={listProblem ? `${addId}-problem` : undefined}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add a day
        </button>
      </div>
      {/* Always in the page, so that a screen reader says the line when it
          comes. Its padding keeps Undo's 44px clear of the button above. */}
      <UndoLine onUndo={undo} className="mt-2 py-2">
        {removed ? `Day ${removed.index + 1} removed.` : null}
      </UndoLine>
    </div>
  )
}

export default function ScheduleFields({ value, onChange, idPrefix = 'ev' }) {
  const fault = scheduleFault(value)
  return (
    <div className="space-y-5">
      <KindPicker value={value} onChange={onChange} idPrefix={idPrefix} />
      {value.kind === 'single' && <OneTime value={value} onChange={onChange} idPrefix={idPrefix} fault={fault} />}
      {value.kind === 'allday' && <AllDay value={value} onChange={onChange} idPrefix={idPrefix} fault={fault} />}
      {value.kind === 'days' && <DayByDay value={value} onChange={onChange} idPrefix={idPrefix} fault={fault} />}
    </div>
  )
}
