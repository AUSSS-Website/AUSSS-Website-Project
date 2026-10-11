import { useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { errorText } from '../../../lib/errorText.js'
import { eventWhen } from '../../../lib/eventTime.js'
import { isUpcoming, normalizeEvent } from '../../../lib/events.js'
import { pressCls } from '../../../lib/motion.js'
import { useEventList, useEventMutations } from '../../eventQueries.js'
import { useCommittees } from '../../officerQueries.js'
import { defaultSchedule, scheduleFault, schedulePatch } from '../../eventSchedule.js'
import ScheduleFields, { FieldProblem, fieldCls, problemProps, scheduleFieldId, tapCls } from './ScheduleFields.jsx'
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
  // One time, today, at the time the form opens (Cairo clock), until the
  // officer picks the real start.
  const [schedule, setSchedule] = useState(() => defaultSchedule())
  // Until a choice is made, the first one (the list may arrive after the form).
  const [chosen, setOwner] = useState('')
  const owner = committee ? committee.id : chosen || choices[0]?.value || ''
  // What the database said when the event could not be added.
  const [error, setError] = useState('')
  // The title's message waits until the title has been typed in, or a save
  // was tried: nobody is told off for a field they have not reached yet. A
  // time that is wrong shows at once (ScheduleFields), since the form opens
  // with one that is right.
  const [seen, setSeen] = useState(false)
  // One press of Enter, one event: a second submit while the first is still
  // on its way is dropped.
  const adding = useRef(false)

  const titleProblem = title.trim() ? '' : 'Give the event a title.'
  const fault = scheduleFault(schedule)
  const ownerProblem = owner ? '' : 'Choose whose event it is.'

  const submit = async (e) => {
    e.preventDefault()
    if (adding.current) return
    setError('')
    if (titleProblem || fault || ownerProblem) {
      // Every message shows at its own field; the first of them gets the cursor.
      setSeen(true)
      const first = titleProblem ? 'ev-new-title' : ownerProblem ? 'ev-new-owner' : scheduleFieldId('ev-new', fault)
      document.getElementById(first)?.focus()
      return
    }
    adding.current = true
    try {
      const row = await create.mutateAsync({
        committeeId: owner === SOCIETY ? null : owner,
        title: title.trim(),
        schedule: schedulePatch(schedule),
      })
      navigate(`/portal/events/${row.id}`)
    } catch (err) {
      setError(errorText(err, 'The event could not be added.'))
    } finally {
      adding.current = false
    }
  }

  const showTitleProblem = seen ? titleProblem : ''
  const showOwnerProblem = seen ? ownerProblem : ''

  return (
    <Panel title="New event">
      <p className="mt-2 text-xs text-soft/55">
        It starts as a draft that only editors can see. On its own page you add the place, the
        text, a picture and the sign-up link, then publish it.
      </p>
      {/* noValidate: what is missing is said at its field in the form's own
          words, not in the browser's bubble. */}
      <form onSubmit={submit} noValidate className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" htmlFor="ev-new-title">
            <input
              id="ev-new-title"
              className={fieldCls(inputCls, showTitleProblem)}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setSeen(true)
              }}
              maxLength={140}
              placeholder="World Health Day stand"
              required
              {...problemProps('ev-new-title', showTitleProblem)}
            />
            <FieldProblem id="ev-new-title-problem">{showTitleProblem}</FieldProblem>
          </Field>
        </div>
        {!committee && (
          <Field label="Whose event" htmlFor="ev-new-owner">
            <select
              id="ev-new-owner"
              className={fieldCls(inputCls, showOwnerProblem)}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              {...problemProps('ev-new-owner', showOwnerProblem)}
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <FieldProblem id="ev-new-owner-problem">{showOwnerProblem}</FieldProblem>
          </Field>
        )}
        <div className="sm:col-span-2">
          <ScheduleFields value={schedule} onChange={setSchedule} idPrefix="ev-new" />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={create.isPending}>
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
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-semibold ${cls}`}>
      {children}
    </span>
  )
}

function EventRow({ row, showCommittee }) {
  const ev = eventFromRow(row)
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line/10 bg-sunk/40 p-3">
      {/* The words ask for 12rem of the row. Where the chips do not fit
          beside that (a phone), they go under the words, which were being
          squeezed into a column one letter wide. */}
      <div className="min-w-0 grow basis-48">
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
        <Link to={`/portal/events/${row.id}`} className={`${outlineBtnCls} ${tapCls}`} aria-label={`Edit ${row.title}`}>
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
  const pastId = useId()

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
          Published events show on <Link to="/events" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:text-ink">/events</Link>,
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
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <ErrorText>{errorText(list.error, 'Couldn’t load the events.')}</ErrorText>
            <button type="button" onClick={() => list.refetch()} className={`${outlineBtnCls} ${tapCls}`}>
              Try again
            </button>
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
                {/* One line of small capitals to the eye; its ::after gives a
                    finger 44px of height, in px because the root size shrinks
                    on a 320px phone. */}
                <button
                  type="button"
                  className={`relative text-xs font-semibold uppercase tracking-[0.2em] text-soft/50 ${pressCls} hover:text-ink after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']`}
                  aria-expanded={showPast}
                  aria-controls={pastId}
                  onClick={() => setShowPast((v) => !v)}
                >
                  <span aria-hidden="true">{showPast ? '▾' : '▸'}</span> Over ({past.length})
                </button>
                {showPast && (
                  <ul id={pastId} className="mt-3 space-y-2">
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
