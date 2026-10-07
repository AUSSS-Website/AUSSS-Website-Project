import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { cairoLocalToIso, eventWhen } from '../../../lib/eventTime.js'
import { isUpcoming, normalizeEvent } from '../../../lib/events.js'
import { useEventList, useEventMutations } from '../../eventQueries.js'
import { useCommittees } from '../../officerQueries.js'
import { ErrorText, Field, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// The list of events one person may edit, and the form that starts a new one.
// The same panel is the Events tab of a committee (`committee` set: only its
// events, new ones are its own) and the whole of /portal/events (no
// `committee`: every event this person may edit, with a choice of whose a new
// one is; the EB also has "Society-wide"). A new event is a draft; its own page
// (/portal/events/:id) fills it in and publishes it.

// A table row in the shape the public pages read, for the shared wording.
export function eventFromRow(row) {
  return normalizeEvent({ ...row, committee: row.committee?.slug ?? null })
}

const SOCIETY = 'society'

function NewEventForm({ committee, choices }) {
  const navigate = useNavigate()
  const { create } = useEventMutations()
  const [title, setTitle] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [start, setStart] = useState('')
  // Until a choice is made, the first one (the list may arrive after the form).
  const [chosen, setOwner] = useState('')
  const owner = committee ? committee.id : chosen || choices[0]?.value || ''
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const startsAt = cairoLocalToIso(start)
    if (!title.trim() || !startsAt || !owner) {
      setError('Give the event a title and a start.')
      return
    }
    try {
      const row = await create.mutateAsync({
        committeeId: owner === SOCIETY ? null : owner,
        title: title.trim(),
        startsAt,
        allDay,
      })
      navigate(`/portal/events/${row.id}`)
    } catch (err) {
      setError(err.message || 'The event could not be added.')
    }
  }

  return (
    <Panel title="New event">
      <p className="mt-2 text-xs text-soft/55">
        It starts as a draft that only editors see. Its own page takes the rest: the end, the place,
        the text, a picture and the sign-up link, and publishes it.
      </p>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" htmlFor="ev-new-title">
            <input
              id="ev-new-title"
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
              placeholder="World Health Day stand"
              required
            />
          </Field>
        </div>
        {!committee && (
          <Field label="Whose event" htmlFor="ev-new-owner">
            <select id="ev-new-owner" className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={allDay ? 'First day' : 'Starts (Cairo time)'} htmlFor="ev-new-start">
          <input
            id="ev-new-start"
            className={inputCls}
            type={allDay ? 'date' : 'datetime-local'}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => {
                setAllDay(e.target.checked)
                // keep the day when switching between a date and a time
                setStart((s) => (e.target.checked ? s.slice(0, 10) : s && s.length === 10 ? `${s}T18:00` : s))
              }}
            />
            All day (no times, one or more whole days)
          </label>
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={primaryBtnCls} disabled={create.isPending || !title.trim() || !start}>
            {create.isPending ? 'Adding…' : 'Add event'}
          </button>
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </Panel>
  )
}

function StatusChip({ children, tone = 'soft' }) {
  const cls = {
    soft: 'border-line/15 text-soft/65',
    ok: 'border-emerald-400/50 text-ok',
    accent: 'border-medical/60 text-accent',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  )
}

function EventRow({ row, showCommittee }) {
  const ev = eventFromRow(row)
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line/10 bg-sunk/40 p-3">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold text-ink">{row.title}</p>
        <p className="mt-0.5 text-xs text-soft/60">
          {eventWhen(ev, { short: true })}
          {row.place ? ` · ${row.place}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showCommittee && <StatusChip>{row.committee?.abbr || 'Society-wide'}</StatusChip>}
        {row.published ? <StatusChip tone="ok">Published</StatusChip> : <StatusChip>Draft</StatusChip>}
        {!isUpcoming(ev) && <StatusChip>Over</StatusChip>}
        <Link to={`/portal/events/${row.id}`} className={outlineBtnCls}>
          Edit
        </Link>
      </div>
    </li>
  )
}

export default function EventsPanel({ committee = null }) {
  const { isEB, officerOf } = useAuth()
  const scope = committee ? committee.id : 'all'
  const list = useEventList(scope)
  const committees = useCommittees(!committee)
  const [showPast, setShowPast] = useState(false)
  const [filter, setFilter] = useState('')

  // Whose a new event can be, on /portal/events: the committees this person is
  // an officer of, and the society for the EB.
  const choices = committee
    ? []
    : [
        ...(isEB ? [{ value: SOCIETY, label: 'Society-wide (Executive Board)' }] : []),
        ...(committees.data || [])
          .filter((c) => officerOf(c.slug))
          .map((c) => ({ value: c.id, label: `${c.abbr}, ${c.name}` })),
      ]

  const rows = (list.data || []).filter((r) =>
    !filter ? true : filter === SOCIETY ? !r.committee_id : r.committee_id === filter,
  )
  const now = Date.now()
  const upcoming = rows.filter((r) => isUpcoming(eventFromRow(r), now)).reverse()
  const past = rows.filter((r) => !isUpcoming(eventFromRow(r), now))
  const owners = !committee
    ? [...new Map((list.data || []).map((r) => [r.committee_id || SOCIETY, r.committee?.abbr || 'Society-wide'])).entries()]
    : []

  return (
    <div className="space-y-8">
      {(committee || choices.length > 0) && <NewEventForm committee={committee} choices={choices} />}

      <Panel title={committee ? `${committee.abbr} events` : 'Events you can edit'}>
        <p className="mt-2 text-xs text-soft/55">
          Published events show on <Link to="/events" target="_blank" className="font-semibold text-accent hover:text-ink">/events</Link>,
          on the committee&rsquo;s page and, for the next three, on the home page. An event moves to the
          archive by itself once it is over; its page and link keep working.
        </p>

        {owners.length > 1 && (
          <div className="mt-4 max-w-xs">
            <label htmlFor="ev-filter" className="sr-only">
              Show the events of
            </label>
            <select id="ev-filter" className={inputCls} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Every committee</option>
              {owners.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}

        {list.isPending ? (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        ) : list.error ? (
          <div className="mt-4">
            <ErrorText>Couldn’t load the events: {list.error.message}</ErrorText>
          </div>
        ) : (
          <>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-soft/50">Coming up</p>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-soft/60">Nothing coming up yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {upcoming.map((r) => (
                  <EventRow key={r.id} row={r} showCommittee={!committee} />
                ))}
              </ul>
            )}

            {past.length > 0 && (
              <div className="mt-6">
                <button
                  type="button"
                  className="text-xs font-semibold uppercase tracking-[0.2em] text-soft/50 hover:text-ink"
                  aria-expanded={showPast}
                  onClick={() => setShowPast((v) => !v)}
                >
                  {showPast ? '▾' : '▸'} Over ({past.length})
                </button>
                {showPast && (
                  <ul className="mt-3 space-y-2">
                    {past.map((r) => (
                      <EventRow key={r.id} row={r} showCommittee={!committee} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
