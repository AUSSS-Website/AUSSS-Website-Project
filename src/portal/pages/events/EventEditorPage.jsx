import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import EventCard from '../../../components/EventCard.jsx'
import { eventWhen } from '../../../lib/eventTime.js'
import { isUpcoming } from '../../../lib/events.js'
import { removeEventImage, uploadEventImage, useEvent, useEventMutations } from '../../eventQueries.js'
import { useCommittees } from '../../officerQueries.js'
import { scheduleFromRow, scheduleProblem, schedulePatch } from '../../eventSchedule.js'
import ScheduleFields from './ScheduleFields.jsx'
import {
  Centered,
  ConfirmButton,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  Toggle,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { eventFromRow } from './EventsPanel.jsx'

// /portal/events/:id. One event: whether visitors see it, its words, times and
// place, its sign-up link and link on the site, its picture, and removing it.
// The database decides who may do what (row-level security); this page asks
// it for the event and shows a polite refusal when the answer is nothing.

const SOCIETY = 'society'

function formFrom(row) {
  return {
    title: row.title,
    owner: row.committee_id || SOCIETY,
    schedule: scheduleFromRow(row),
    place: row.place || '',
    signupUrl: row.signup_url || '',
    slug: row.slug,
    description: row.description || '',
  }
}

// The form back into columns; when it happens comes from eventSchedule.js.
function patchFrom(form) {
  return {
    title: form.title.trim(),
    committee_id: form.owner === SOCIETY ? null : form.owner,
    ...schedulePatch(form.schedule),
    place: form.place.trim(),
    signup_url: form.signupUrl.trim(),
    slug: form.slug.trim(),
    description: form.description.trim(),
  }
}

// What is wrong with the form, in words, or ''.
function problem(form) {
  if (!form.title.trim()) return 'Give the event a title.'
  return scheduleProblem(form.schedule)
}

function DetailsForm({ row, choices: allowed }) {
  const { update } = useEventMutations()
  // The event's own owner is always an option, even before the committee list
  // has arrived.
  const own = row.committee_id || SOCIETY
  const choices = allowed.some((c) => c.value === own)
    ? allowed
    : [{ value: own, label: row.committee ? `${row.committee.abbr}, ${row.committee.name}` : 'Society-wide (Executive Board)' }, ...allowed]
  const [form, setForm] = useState(() => formFrom(row))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (e) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  // Follow the row when it changes elsewhere (another editor saved, the
  // picture changed), unless there are unsaved edits here.
  const base = JSON.stringify(formFrom(row))
  const current = JSON.stringify(form)
  const dirty = current !== base
  const lastBase = useRef(base)
  useEffect(() => {
    if (base !== lastBase.current && current === lastBase.current) setForm(formFrom(row))
    lastBase.current = base
  }, [base, current, row])

  const setSchedule = (schedule) => {
    setSaved(false)
    setForm((f) => ({ ...f, schedule }))
  }

  const issue = problem(form)
  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (issue) {
      setError(issue)
      return
    }
    try {
      await update.mutateAsync({ id: row.id, patch: patchFrom(form) })
      setSaved(true)
    } catch (err) {
      setError(err.message || 'The event could not be saved.')
    }
  }

  return (
    <Panel title="The event">
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" htmlFor="ev-title">
            <input id="ev-title" className={inputCls} value={form.title} onChange={set('title')} maxLength={140} required />
          </Field>
        </div>

        {choices.length > 1 && (
          <div className="sm:col-span-2 sm:max-w-md">
            <Field label="Whose event" htmlFor="ev-owner" hint="Moving it needs a right over both.">
              <select id="ev-owner" className={inputCls} value={form.owner} onChange={set('owner')}>
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <div className="sm:col-span-2">
          <ScheduleFields value={form.schedule} onChange={setSchedule} idPrefix="ev" />
        </div>

        <div className="sm:col-span-2">
          <Field label="Where" htmlFor="ev-place" hint="The room, the place or the address. Leave blank while it is not known yet.">
            <input
              id="ev-place"
              className={inputCls}
              value={form.place}
              onChange={set('place')}
              maxLength={200}
              placeholder="Faculty garden, Ain Shams Faculty of Medicine"
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field
            label="About it"
            htmlFor="ev-description"
            hint="What happens, who it is for, what to bring. **bold**, *italic*, [a link](https://…) and lines starting with - for a list."
          >
            <textarea
              id="ev-description"
              className={`${inputCls} min-h-[10rem]`}
              value={form.description}
              onChange={set('description')}
              maxLength={4000}
            />
          </Field>
        </div>

        <Field
          label="Sign-up link"
          htmlFor="ev-signup"
          hint="A form or a page where people register. Optional; the event page shows a Sign up button."
        >
          <input
            id="ev-signup"
            className={inputCls}
            value={form.signupUrl}
            onChange={set('signupUrl')}
            maxLength={500}
            placeholder="https://forms.gle/…"
            inputMode="url"
          />
        </Field>
        <Field
          label="Link on the site"
          htmlFor="ev-slug"
          hint="Lower-case words and hyphens. A link changed after it was shared keeps working."
        >
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-sm text-soft/55">/events/</span>
            <input id="ev-slug" className={`${inputCls} min-w-0`} value={form.slug} onChange={set('slug')} maxLength={80} />
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={primaryBtnCls} disabled={update.isPending || !dirty}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button type="button" className={outlineBtnCls} onClick={() => setForm(formFrom(row))}>
              Undo changes
            </button>
          )}
          {saved && !dirty && (
            <span className="text-xs text-ok">
              Saved. {row.published ? 'The site shows it now.' : 'It is still a draft.'}
            </span>
          )}
          {dirty && issue && <span className="text-xs text-warn">{issue}</span>}
        </div>
        {error && (
          <div className="sm:col-span-2">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </form>
    </Panel>
  )
}

function PicturePanel({ row }) {
  const { update } = useEventMutations()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = row.image

  const replace = async (file) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const url = await uploadEventImage(row.id, file)
      try {
        await update.mutateAsync({ id: row.id, patch: { image: url } })
      } catch (err) {
        await removeEventImage(url).catch(() => {})
        throw err
      }
      await removeEventImage(current).catch(() => {})
    } catch (err) {
      setError(err.message || 'The picture could not be uploaded.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const clear = async () => {
    setBusy(true)
    setError('')
    try {
      await update.mutateAsync({ id: row.id, patch: { image: '' } })
      await removeEventImage(current).catch(() => {})
    } catch (err) {
      setError(err.message || 'The picture could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Picture" className="mt-8">
      <div className="mt-4 flex flex-col gap-5 sm:flex-row">
        <div className="aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl bg-sunk sm:w-64">
          {current ? (
            <img src={current} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-center text-[10px] uppercase tracking-[0.2em] text-soft/40">
              None
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-soft/55">
            The poster or a photo. It heads the event&rsquo;s page and its card, and shows when the link is shared on
            WhatsApp or Instagram. A wide picture (16 by 9) fits the card best; it is shrunk to 1600 pixels before
            upload.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="ev-picture"
              onChange={(e) => replace(e.target.files?.[0])}
              disabled={busy}
            />
            <label
              htmlFor="ev-picture"
              className={`${outlineBtnCls} cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}
            >
              {busy ? 'Working…' : current ? 'Replace' : 'Upload'}
            </label>
            {current && (
              <button type="button" className={outlineBtnCls} onClick={clear} disabled={busy}>
                Remove
              </button>
            )}
          </div>
          {error && (
            <div className="mt-2">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

function EventEditor({ row, choices }) {
  const navigate = useNavigate()
  const { update, remove } = useEventMutations()
  const ev = eventFromRow(row)
  const upcoming = isUpcoming(ev)
  const back = row.committee ? `/portal/committees/${row.committee.slug}` : '/portal/events'

  const deleteEvent = async () => {
    await remove.mutateAsync(row)
    navigate('/portal/events', { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap gap-x-4">
            <Link to="/portal/events" className="hover:text-ink">
              &larr; All events
            </Link>
            {row.committee && (
              <Link to={back} className="hover:text-ink">
                {row.committee.abbr}
              </Link>
            )}
          </span>
        }
        title={row.title}
        subtitle={`${row.committee ? row.committee.abbr : 'Society-wide'} · ${eventWhen(ev, { short: true })}`}
        action={
          row.published ? (
            <Link to={`/events/${row.slug}`} target="_blank" rel="noopener noreferrer" className={outlineBtnCls}>
              View on the site ↗
            </Link>
          ) : null
        }
      />

      <Panel className="mb-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold text-ink">Published</p>
            <p className="mt-1 text-xs text-soft/55">
              {row.published
                ? upcoming
                  ? 'Visitors see it on /events, on the committee page and, when it is one of the next three, on the home page. The saved pages catch up within a few minutes.'
                  : 'It is over, so visitors find it in the archive. Its page and link keep working.'
                : 'A draft: only the people who can edit it see it. Publish it when the details are in.'}
            </p>
          </div>
          <Toggle
            checked={row.published}
            onChange={(v) => update.mutate({ id: row.id, patch: { published: v } })}
            label="Published"
            disabled={update.isPending}
          />
        </div>
        {update.error && (
          <div className="mt-3">
            <ErrorText>{update.error.message}</ErrorText>
          </div>
        )}
      </Panel>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <DetailsForm row={row} choices={choices} />
          <PicturePanel row={row} />
        </div>
        <aside className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Its card on the site</p>
          <p className="mb-3 mt-1 text-xs text-soft/50">As saved. Save the form to see a change here.</p>
          <EventCard ev={ev} past={!upcoming} />
        </aside>
      </div>

      <Panel title="Remove event" className="mt-8">
        <p className="mt-3 text-xs text-soft/55">
          Removes the event and its picture, and its link stops working. An event that is over needs no removing: it
          stays in the archive. This cannot be undone.
        </p>
        <div className="mt-4">
          <ConfirmButton
            label="Remove this event"
            confirmLabel="Remove event and picture"
            onConfirm={deleteEvent}
            disabled={remove.isPending}
          />
        </div>
        {remove.error && <ErrorText>{remove.error.message}</ErrorText>}
      </Panel>
    </>
  )
}

export default function EventEditorPage() {
  const { id } = useParams()
  const { isEB, officerOf } = useAuth()
  const event = useEvent(id)
  const committees = useCommittees()
  usePageTitle(event.data ? `Edit ${event.data.title}` : 'Edit event')

  // Whose the event may become: the committees this person is an officer of,
  // and the society for the EB.
  const choices = [
    ...(isEB ? [{ value: SOCIETY, label: 'Society-wide (Executive Board)' }] : []),
    ...(committees.data || []).filter((c) => officerOf(c.slug)).map((c) => ({ value: c.id, label: `${c.abbr}, ${c.name}` })),
  ]

  if (event.isPending) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  if (event.error) {
    return (
      <Panel>
        <ErrorText>Couldn’t load the event: {event.error.message}</ErrorText>
      </Panel>
    )
  }
  if (!event.data) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">
          No event here that you can edit. It may have been removed, or it belongs to a committee you are not an officer
          of.
        </p>
        <Link to="/portal/events" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
          &larr; All events
        </Link>
      </Panel>
    )
  }
  return <EventEditor row={event.data} choices={choices} />
}
