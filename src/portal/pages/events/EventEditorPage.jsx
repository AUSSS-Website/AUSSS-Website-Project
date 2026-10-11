import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import EventCard from '../../../components/EventCard.jsx'
import { errorText } from '../../../lib/errorText.js'
import { eventWhen } from '../../../lib/eventTime.js'
import { isUpcoming } from '../../../lib/events.js'
import { pressCls } from '../../../lib/motion.js'
import { removeEventImage, uploadEventImage, useEvent, useEventMutations } from '../../eventQueries.js'
import { useCommittees } from '../../officerQueries.js'
import { scheduleFault, scheduleFromRow, schedulePatch } from '../../eventSchedule.js'
import ScheduleFields, {
  FieldProblem,
  fieldCls,
  problemProps,
  scheduleFieldId,
  scheduleFirstFieldId,
  tapCls,
} from './ScheduleFields.jsx'
import {
  ConfirmButton,
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  SaveStatus,
  Toggle,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { eventFromRow } from './EventsPanel.jsx'

// /portal/events/:id. One event: whether visitors see it, its words, times and
// place, its sign-up link and link on the site, its picture, and removing it.
// The database decides who may do what (row-level security); this page asks
// it for the event and shows a polite refusal when the answer is nothing.

const SOCIETY = 'society'

// `kept` is the schedule the form held until now, when the row replaces it
// (scheduleFromRow keeps what was typed there under another kind).
function formFrom(row, kept) {
  return {
    title: row.title,
    owner: row.committee_id || SOCIETY,
    schedule: scheduleFromRow(row, kept),
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

// A form as the columns it would store, as text to compare. Two forms that
// would store the same thing are the same form: a space typed after the title,
// or days typed under a kind that is not the one in use, is nothing to save.
const storedAs = (form) => JSON.stringify(patchFrom(form))

// Which field a refusal from the database is about, told from its sentence
// (app.normalize_event in supabase/migrations writes them). '' is the save as
// a whole: no connection, no permission, anything the form cannot point at.
function fieldOfRefusal(text) {
  if (/^The link \/events\//.test(text)) return 'slug'
  if (/^The sign-up link /.test(text)) return 'signupUrl'
  if (/^An event needs a title/.test(text)) return 'title'
  if (/^(An event needs a start|An event can have at most|An event cannot end|Each day needs|Two of the days)/.test(text)) {
    return 'schedule'
  }
  return ''
}

// Where the cursor goes for a refusal about one field.
const REFUSED_AT = { title: 'ev-title', signupUrl: 'ev-signup', slug: 'ev-slug' }

// One line of small text to the eye; its ::after gives a finger 44px of
// height, in px because the root size shrinks on a 320px phone.
const lineTapCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"
// The same for the button inside an element, whatever classes the button
// wears: a ConfirmButton swaps its own when it turns red, and the red pill is
// where the second tap lands.
const lineTapInsideCls =
  "[&>button]:relative [&>button]:after:absolute [&>button]:after:inset-x-0 [&>button]:after:top-1/2 [&>button]:after:h-[44px] [&>button]:after:-translate-y-1/2 [&>button]:after:content-['']"

// The form's values, and whether they hold anything to save. The form follows
// the row when it changes elsewhere (another editor saved), unless there are
// unsaved edits here.
function useEventForm(row) {
  const [form, setForm] = useState(() => formFrom(row))
  const base = storedAs(formFrom(row))
  const current = storedAs(form)
  const lastBase = useRef(base)
  useEffect(() => {
    if (base !== lastBase.current && current === lastBase.current) setForm((f) => formFrom(row, f.schedule))
    lastBase.current = base
  }, [base, current, row])
  return { form, setForm, dirty: current !== base }
}

function DetailsForm({ row, choices, form, setForm, dirty }) {
  const { update } = useEventMutations()
  const [saved, setSaved] = useState(false)
  // What the database refused at the last save, and the field it is about:
  // { field, text }.
  const [refusal, setRefusal] = useState(null)

  // A field changed: "Saved." no longer holds, and neither does a refusal
  // about that field or about the save as a whole.
  const edited = (field) => {
    setSaved(false)
    setRefusal((r) => (r && (r.field === field || !r.field) ? null : r))
  }
  const set = (key) => (e) => {
    const { value } = e.target
    edited(key)
    setForm((f) => ({ ...f, [key]: value }))
  }
  const setSchedule = (schedule) => {
    edited('schedule')
    setForm((f) => ({ ...f, schedule }))
  }

  // What stands in the way of saving, each at its own field. Worked out on
  // every render, so a message goes the moment its field is put right.
  const refused = (field) => (refusal?.field === field ? refusal.text : '')
  const titleProblem = form.title.trim() ? refused('title') : 'Give the event a title.'
  const fault = scheduleFault(form.schedule)

  const submit = async (e) => {
    e.preventDefault()
    setRefusal(null)
    if (!form.title.trim() || fault) {
      // Each message is at its field already; the first of them gets the cursor.
      document.getElementById(form.title.trim() ? scheduleFieldId('ev', fault) : 'ev-title')?.focus()
      return
    }
    const sent = storedAs(form)
    try {
      const stored = await update.mutateAsync({ id: row.id, patch: patchFrom(form) })
      // The form shows what was stored: the database tidies a link and a
      // sign-up address as it saves them. Anything typed since Save was
      // pressed stays as typed.
      setForm((f) => (storedAs(f) === sent ? formFrom(stored, f.schedule) : f))
      setSaved(true)
    } catch (err) {
      const text = errorText(err, 'The event could not be saved.')
      const field = fieldOfRefusal(text)
      setRefusal({ field, text })
      // The cursor goes to the field the refusal is about, which also brings
      // its message into view: Save is a long way below most of them.
      const at = field === 'schedule' ? scheduleFirstFieldId('ev', form.schedule) : REFUSED_AT[field]
      if (at) document.getElementById(at)?.focus()
    }
  }

  const undo = () => {
    // The button goes with the changes it throws away. When the keyboard was
    // on it, the cursor moves to the top of the form, which is as saved again;
    // a mouse click is left where it is, so the page does not jump.
    const pressed = document.activeElement
    if (pressed?.tagName === 'BUTTON' && pressed.matches(':focus-visible')) document.getElementById('ev-title')?.focus()
    setForm(formFrom(row))
    setRefusal(null)
    setSaved(false)
  }

  return (
    <Panel title="The event">
      {/* noValidate: what is missing is said at its field in the form's own
          words, not in the browser's bubble. */}
      <form onSubmit={submit} noValidate className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" htmlFor="ev-title">
            <input
              id="ev-title"
              className={fieldCls(inputCls, titleProblem)}
              value={form.title}
              onChange={set('title')}
              maxLength={140}
              required
              {...problemProps('ev-title', titleProblem)}
            />
            <FieldProblem id="ev-title-problem">{titleProblem}</FieldProblem>
          </Field>
        </div>

        {choices.length > 1 && (
          <div className="sm:col-span-2 sm:max-w-md">
            <Field label="Whose event" htmlFor="ev-owner" hint="You can move it to any committee you are an officer of.">
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
          <FieldProblem>{refused('schedule')}</FieldProblem>
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
            className={fieldCls(inputCls, refused('signupUrl'))}
            value={form.signupUrl}
            onChange={set('signupUrl')}
            maxLength={500}
            placeholder="https://forms.gle/…"
            inputMode="url"
            {...problemProps('ev-signup', refused('signupUrl'))}
          />
          <FieldProblem id="ev-signup-problem">{refused('signupUrl')}</FieldProblem>
        </Field>
        <Field
          label="Link on the site"
          htmlFor="ev-slug"
          hint="Lower-case words and hyphens. A link changed after it was shared keeps working."
        >
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-sm text-soft/55">/events/</span>
            <input
              id="ev-slug"
              className={fieldCls(`${inputCls} min-w-0`, refused('slug'))}
              value={form.slug}
              onChange={set('slug')}
              maxLength={80}
              {...problemProps('ev-slug', refused('slug'))}
            />
          </div>
          <FieldProblem id="ev-slug-problem">{refused('slug')}</FieldProblem>
        </Field>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={update.isPending || !dirty}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            // Typed work is about to go: the button turns red and asks once more.
            <ConfirmButton
              label="Undo changes"
              confirmLabel="Discard changes"
              onConfirm={undo}
              disabled={update.isPending}
              className={`${outlineBtnCls} ${tapCls}`}
              keepWidth
            />
          )}
          <SaveStatus
            dirty={dirty}
            saved={saved && (row.published ? 'Saved. The site shows it now.' : 'Saved. It is still a draft.')}
          />
        </div>
        {refused('') && (
          <div className="sm:col-span-2">
            <ErrorText>{refused('')}</ErrorText>
          </div>
        )}
      </form>
    </Panel>
  )
}

function PicturePanel({ row }) {
  const { update } = useEventMutations()
  const inputRef = useRef(null)
  const chooseRef = useRef(null)
  const actionsRef = useRef(null)
  // What the panel is doing, for the button that started it: 'upload',
  // 'remove' or ''.
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  // What has just been done, for a screen reader: the picture itself is the
  // only other sign of it.
  const [said, setSaid] = useState('')
  const current = row.image
  // Closing the tab while a picture is on its way would cut the upload off.
  useLeaveWarning(Boolean(busy))

  // Remove goes with the picture. When the keyboard was on it, it moves to
  // the button that is left, once that button can take it again.
  const focusChoose = useRef(false)
  useEffect(() => {
    if (busy || !focusChoose.current) return
    focusChoose.current = false
    chooseRef.current?.focus()
  }, [busy])

  const replace = async (file) => {
    if (!file) return
    setBusy('upload')
    setError('')
    setSaid('')
    try {
      const url = await uploadEventImage(row.id, file)
      try {
        await update.mutateAsync({ id: row.id, patch: { image: url } })
      } catch (err) {
        await removeEventImage(url).catch(() => {})
        throw err
      }
      await removeEventImage(current).catch(() => {})
      setSaid(current ? 'Picture replaced.' : 'Picture uploaded.')
    } catch (err) {
      setError(errorText(err, 'The picture could not be uploaded.'))
    } finally {
      setBusy('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const clear = async () => {
    const hadFocus = Boolean(actionsRef.current?.contains(document.activeElement))
    setBusy('remove')
    setError('')
    setSaid('')
    try {
      await update.mutateAsync({ id: row.id, patch: { image: '' } })
      await removeEventImage(current).catch(() => {})
      setSaid('Picture removed.')
      focusChoose.current = hadFocus
    } catch (err) {
      setError(errorText(err, 'The picture could not be removed.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <Panel title="Picture" className="mt-8">
      <div className="mt-4 flex flex-col gap-5 sm:flex-row">
        <div className="aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl bg-sunk sm:w-64">
          {current ? (
            <img src={current} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-center text-3xs uppercase tracking-[0.2em] text-soft/40">
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
          <div ref={actionsRef} className="mt-3 flex flex-wrap items-center gap-2">
            {/* The file field itself stays out of sight and out of the tab
                order; the button beside it opens it, and takes the keyboard. */}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => replace(e.target.files?.[0])}
              disabled={Boolean(busy)}
            />
            <button
              ref={chooseRef}
              type="button"
              className={`${outlineBtnCls} ${tapCls}`}
              onClick={() => inputRef.current?.click()}
              disabled={Boolean(busy)}
            >
              {busy === 'upload' ? 'Uploading…' : current ? 'Replace' : 'Upload'}
            </button>
            {current && (
              // The stored file goes with it, so it asks once more first.
              <ConfirmButton
                label="Remove"
                busyLabel="Removing…"
                busy={busy === 'remove'}
                disabled={Boolean(busy)}
                onConfirm={clear}
                className={`${outlineBtnCls} ${tapCls}`}
                keepWidth
              />
            )}
          </div>
          <p role="status" className="sr-only">
            {said}
          </p>
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

// A way back from the editor. With unsaved typing in the form it asks first,
// on itself, as every other discard in the portal does: the router changes
// the screen without the browser's own question.
function WayBack({ to, ask, children }) {
  const navigate = useNavigate()
  const cls = `uppercase tracking-[0.22em] ${pressCls} hover:text-ink`
  if (!ask) {
    return (
      <Link to={to} className={`${lineTapCls} ${cls}`}>
        {children}
      </Link>
    )
  }
  return (
    // The red "Discard changes" is read as a sentence, not in the eyebrow's
    // spaced capitals.
    <span className={`normal-case tracking-normal ${lineTapInsideCls}`}>
      <ConfirmButton variant="text" confirmLabel="Discard changes" onConfirm={() => navigate(to)} className={cls}>
        {children}
      </ConfirmButton>
    </span>
  )
}

function EventEditor({ row, choices: allowed }) {
  const navigate = useNavigate()
  const { publish, remove } = useEventMutations()
  const { form, setForm, dirty } = useEventForm(row)
  // Closing the tab or reloading asks first with unsaved typing, and while a
  // flip of Published is still on its way: the switch has already moved, so
  // the screen shows what the database does not hold yet.
  useLeaveWarning(dirty || publish.isPending)

  // The event's own owner is always an option, even before the committee list
  // has arrived.
  const own = row.committee_id || SOCIETY
  const choices = allowed.some((c) => c.value === own)
    ? allowed
    : [
        {
          value: own,
          label: row.committee ? `${row.committee.abbr}, ${row.committee.name}` : 'Society-wide (Executive Board)',
          slug: row.committee?.slug ?? null,
        },
        ...allowed,
      ]

  const ev = eventFromRow(row)
  const upcoming = isUpcoming(ev)
  const back = row.committee ? `/portal/committees/${row.committee.slug}` : '/portal/events'

  // The card as the site would draw it from the form as it stands, so every
  // edit shows at once. A blank title, or a time that cannot be read yet (a
  // start being retyped), leaves the saved one on the card.
  const patch = patchFrom(form)
  const owner = choices.find((c) => c.value === form.owner)
  const { starts_at, ends_at, all_day, days } = row
  const shown = eventFromRow({
    ...row,
    ...patch,
    ...(scheduleFault(form.schedule) ? { starts_at, ends_at, all_day, days } : null),
    title: patch.title || row.title,
    committee: !owner ? row.committee : owner.slug ? { slug: owner.slug } : null,
  })

  const deleteEvent = async () => {
    try {
      await remove.mutateAsync(row)
      navigate('/portal/events', { replace: true })
    } catch {
      // remove.error holds what went wrong, and the panel shows it.
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex min-h-5 flex-wrap items-center gap-x-4">
            <WayBack to="/portal/events" ask={dirty}>
              &larr; All events
            </WayBack>
            {row.committee && (
              <WayBack to={back} ask={dirty}>
                {row.committee.abbr}
              </WayBack>
            )}
          </span>
        }
        title={row.title}
        subtitle={`${row.committee ? row.committee.abbr : 'Society-wide'} · ${eventWhen(ev, { short: true })}`}
        action={
          row.published ? (
            <Link
              to={`/events/${row.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${outlineBtnCls} ${tapCls}`}
            >
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
          {/* The switch moves at once and is never dimmed: the save follows it,
              and puts it back with a word below if it fails (eventQueries.js). */}
          <Toggle
            checked={row.published}
            onChange={(published) => publish.mutate({ id: row.id, published })}
            label="Published"
          />
        </div>
        {publish.error && (
          <div className="mt-3">
            <ErrorText>
              {errorText(
                publish.error,
                publish.variables?.published
                  ? 'The event could not be published.'
                  : 'The event could not be made a draft again.',
              )}
            </ErrorText>
          </div>
        )}
      </Panel>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <DetailsForm row={row} choices={choices} form={form} setForm={setForm} dirty={dirty} />
          <PicturePanel row={row} />
        </div>
        {/* Beside the form on a wide screen, where it stays in view while the
            fields further down are typed in. */}
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <p className={panelTitleCls}>Its card on the site</p>
          <p className="mb-3 mt-1 text-xs text-soft/50">
            {dirty ? 'With the changes you have not saved yet.' : 'As saved.'}
          </p>
          {/* A picture of the card, not a way out of the editor: its link
              would leave with the form half typed, for a page that may not be
              there yet. `inert` also hides it from a screen reader, so the
              line after it says the same in words. */}
          <div inert="">
            <EventCard ev={shown} past={!isUpcoming(shown)} />
          </div>
          <p className="sr-only">
            {[shown.title, eventWhen(shown, { short: true }), shown.place].filter(Boolean).join('. ')}
          </p>
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
            busyLabel="Removing…"
            busy={remove.isPending}
            onConfirm={deleteEvent}
            className={`${outlineBtnCls} ${tapCls}`}
            keepWidth
          />
        </div>
        {remove.error && (
          <div className="mt-3">
            <ErrorText>{errorText(remove.error, 'The event could not be removed.')}</ErrorText>
          </div>
        )}
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
  // and the society for the EB. `slug` is what the card preview draws the
  // owner's colours from.
  const choices = [
    ...(isEB ? [{ value: SOCIETY, label: 'Society-wide (Executive Board)', slug: null }] : []),
    ...(committees.data || [])
      .filter((c) => officerOf(c.slug))
      .map((c) => ({ value: c.id, label: `${c.abbr}, ${c.name}`, slug: c.slug })),
  ]

  if (event.isPending) return <PageLoading />
  if (event.error) {
    return (
      <Panel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <ErrorText>{errorText(event.error, 'Couldn’t load the event.')}</ErrorText>
          <button type="button" onClick={() => event.refetch()} className={`${outlineBtnCls} ${tapCls}`}>
            Try again
          </button>
        </div>
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
        {/* 44px for a finger; the margins take the extra height back. */}
        <Link
          to="/portal/events"
          className="-mb-3 mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent hover:text-ink"
        >
          &larr; All events
        </Link>
      </Panel>
    )
  }
  // The key gives each event a form of its own: one event's unsaved typing is
  // never carried into another's.
  return <EventEditor key={event.data.id} row={event.data} choices={choices} />
}
