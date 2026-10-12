import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  itemsSummary,
  receiptUrl,
  submissionKeys,
  useSubmissionMutations,
  useSubmissions,
} from '../../submissionsQueries.js'
import ExportButtons from '../../ExportButtons.jsx'
import { paymentMethodLabel } from '../../../data/merchConfig.js'
import { uniquePeople } from '../../../lib/gmail.js'
import { usePaymentMethods } from '../../merchQueries.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  PageHeader,
  PageLoading,
  Panel,
  SaveStatus,
  UndoLine,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { chipBtnCls, smallInputCls, when } from '../../workUi.jsx'
import { BulkEmail, GmailButton, PickBox } from './EmailPanel.jsx'

// /portal/submissions. The three public forms that used to land in Google
// Sheets: merch orders, exchange stories and the recruitment waitlist.
// One tab per kind, newest first, with a status per row and private notes.
// The EB sees all three; the SCOPE and SCORE officers see the stories.
// Reads and writes go through submissionsQueries.js; authorisation lives in
// the database (row-level security), so a failed write shows up as an error.
//
// A status shows the moment it is chosen and is saved behind it. The row then
// stays where it is, whatever filter is on, with a line that offers to take
// the change back (see SubmissionList). A story goes on the site from its own
// panel, never from the status list (see PublishPanel).
//
// Every entry can be written to: "Write in Gmail" opens an email to that
// person in the officer's own Gmail, and the tick boxes with the bar above the
// list do the same for several at once (see EmailPanel.jsx).

const STATUSES = {
  orders: [
    ['new', 'New'],
    ['contacted', 'Contacted'],
    ['delivered', 'Delivered'],
  ],
  stories: [
    ['new', 'New'],
    ['contacted', 'Contacted'],
    ['published', 'Published'],
    ['declined', 'Declined'],
  ],
  signups: [
    ['new', 'New'],
    ['contacted', 'Contacted'],
    ['archived', 'Archived'],
  ],
}

const statusLabel = (kind, value) => STATUSES[kind].find(([v]) => v === value)?.[1] || value

// The export columns for a tab, with each order's payment method by name.
function exportColumns(kind, methods) {
  if (kind !== 'orders') return EXPORT_COLUMNS[kind]
  return EXPORT_COLUMNS.orders.map((c) =>
    c.label === 'Payment method' ? { ...c, value: (r) => paymentMethodLabel(methods, r.payment_method) } : c,
  )
}

const TAB_LABEL = { orders: 'Orders', stories: 'Stories', signups: 'Waitlist' }

const tabId = (key) => `submissions-tab-${key}`
const panelId = (key) => `submissions-part-${key}`

// On a touch screen a button or a field stands at least a thumb tall; with a
// mouse it keeps the portal's small size. In px and not rem, because the root
// size shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// A tab is a small pill to the eye and 44px high for a finger: an unseen
// ::after carries the extra.
const tabTapCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"

// Shared by the CSV and the PDF. The first column heads each block in the PDF's
// records layout, so it is the person's name for orders and stories.
const EXPORT_COLUMNS = {
  orders: [
    { label: 'Name', value: (r) => r.name },
    { label: 'Date', value: (r) => when(r.created_at) },
    { label: 'Reference', value: (r) => r.ref },
    { label: 'Status', value: (r) => r.status },
    { label: 'Email', value: (r) => r.email },
    { label: 'Phone', value: (r) => r.phone },
    { label: 'AUSSS member', value: (r) => (r.is_member == null ? '' : r.is_member ? 'Yes' : 'No') },
    { label: 'LC (if non-member)', value: (r) => r.lc },
    { label: 'Year / status', value: (r) => r.year },
    { label: 'Payment method', value: (r) => r.payment_method },
    { label: 'Subtotal (EGP)', value: (r) => r.subtotal },
    { label: 'Items', value: (r) => itemsSummary(r.items) },
    { label: 'Price flag', value: (r) => r.price_flag },
    { label: 'Receipt', value: (r) => (r.receipt_path ? 'yes' : 'no') },
    { label: 'Buyer notes', value: (r) => r.notes },
    { label: 'Officer notes', value: (r) => r.officer_notes },
  ],
  stories: [
    { label: 'Name', value: (r) => r.name },
    { label: 'Date', value: (r) => when(r.created_at) },
    { label: 'Reference', value: (r) => r.ref },
    { label: 'Status', value: (r) => r.status },
    { label: 'Email', value: (r) => r.email },
    { label: 'Phone', value: (r) => r.phone },
    { label: 'Destination', value: (r) => r.destination },
    { label: 'Programme', value: (r) => r.programme },
    { label: 'Year', value: (r) => r.year },
    { label: 'Story', value: (r) => r.story },
    { label: 'Featured', value: (r) => (r.featured ? 'yes' : '') },
    { label: 'Name on the site', value: (r) => (r.status === 'published' ? r.public_name : '') },
    { label: 'Story on the site', value: (r) => (r.status === 'published' ? r.public_story : '') },
    { label: 'Published', value: (r) => (r.published_at ? when(r.published_at) : '') },
    { label: 'Notes', value: (r) => r.notes },
  ],
  signups: [
    { label: 'Date', value: (r) => when(r.created_at) },
    { label: 'Kind', value: (r) => r.kind },
    { label: 'Status', value: (r) => r.status },
    { label: 'Name', value: (r) => r.name },
    { label: 'Email', value: (r) => r.email },
    { label: 'Phone', value: (r) => r.phone },
    { label: 'Notes', value: (r) => r.notes },
  ],
}

function formatEGP(n) {
  return `${Number(n || 0).toLocaleString('en-EG')} EGP`
}

function matches(row, q) {
  if (!q) return true
  const hay = [row.name, row.email, row.phone, row.ref, row.destination, row.lc, row.year]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

// What the line under a row says once its status has changed, or null when
// there is nothing to say: no change, or one the row no longer shows. A
// story's status also decides whether the exchange page shows it, so there the
// line says that part first.
function movedText(kind, row, move) {
  if (!move || row.status !== move.to) return null
  if (kind === 'stories' && move.to === 'published') return 'Published on the exchange page.'
  const label = statusLabel(kind, move.to)
  if (kind === 'stories' && move.from === 'published') {
    return `Taken off the exchange page and moved to ${label}.`
  }
  return `Moved to ${label}.`
}

// ── Shared bits ──────────────────────────────────────────────────────────────

const pickLabel = (row) => `Select ${row.name || row.email} to write to`

function Contact({ row }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft/60">
      {/* An address has nowhere to wrap, and a long one is wider than a phone.
          On a touch screen the two links are what a thumb goes for, to write
          or to ring, so each stands a thumb tall there. */}
      <a href={`mailto:${row.email}`} className={`inline-flex items-center break-all text-accent hover:text-ink ${tapCls}`}>
        {row.email}
      </a>
      {row.phone && (
        <a href={`tel:${row.phone}`} className={`inline-flex items-center hover:text-ink ${tapCls}`}>
          {row.phone}
        </a>
      )}
      {row.year && <span>{row.year}</span>}
    </p>
  )
}

function Meta({ row }) {
  return (
    <p className="text-xs text-soft/45">
      {when(row.created_at)}
      {row.ref && ` · ${row.ref}`}
    </p>
  )
}

// A button's two wordings in one grid cell, the one in use showing. The
// button is as wide as the longer of them from the start, so nothing beside
// it moves while it is busy, and on a narrow phone both can still wrap.
function BusyLabel({ busy, label, busyLabel }) {
  return (
    <span className="grid justify-items-center">
      <span className={`col-start-1 row-start-1 ${busy ? 'invisible' : ''}`}>{label}</span>
      <span className={`col-start-1 row-start-1 ${busy ? '' : 'invisible'}`}>{busyLabel}</span>
    </span>
  )
}

// Undo leaves the page the moment it is pressed. If the keyboard was on it,
// it goes to the row's status list, where the change was made: left alone it
// would be on nothing, and the next Tab would start from the top of the page.
function focusFromUndo(event, statusRef) {
  if (document.activeElement === event.currentTarget) statusRef.current?.focus()
}

// Status select (shown at once, saved behind it) + private notes (saved on
// click) + delete for the EB. `notesField` is the column the notes live in.
// `move` is the row's last change of status, for the line that takes it back,
// and `sending` says a change of status is still on its way.
// Each of the three is busy on its own: saving the notes does not switch the
// status off, and a status on its way does not hold the notes.
function Triage({ kind, row, notesField, move, sending, onStatus, onPatch, onRemove, canDelete, from }) {
  const stored = row[notesField] || ''
  const [notes, setNotes] = useState(stored)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const [notesError, setNotesError] = useState('')
  const statusRef = useRef(null)
  const notesDirty = notes !== stored
  useLeaveWarning(notesDirty)

  // Follow the notes when they change elsewhere (another officer saved),
  // unless there is unsaved typing here.
  const lastStored = useRef(stored)
  useEffect(() => {
    if (stored !== lastStored.current && notes === lastStored.current) setNotes(stored)
    lastStored.current = stored
  }, [stored, notes])

  // A story is published from its own panel, once the name and the text the
  // site will show have been looked at. So "Published" is only in the list of
  // a story that already is, where any other choice takes it off the site.
  const published = kind === 'stories' && row.status === 'published'
  const choices =
    kind === 'stories' && !published ? STATUSES.stories.filter(([value]) => value !== 'published') : STATUSES[kind]

  const changeStatus = (to) => {
    setError('')
    onStatus(row, to).catch((e) => setError(errorText(e, 'Could not save that change.')))
  }
  const undo = (e) => {
    focusFromUndo(e, statusRef)
    changeStatus(move.from)
  }
  const saveNotes = async () => {
    setSaving(true)
    setNotesError('')
    try {
      await onPatch(row.id, { [notesField]: notes })
      setSaved(true)
    } catch (e) {
      setNotesError(errorText(e, 'Could not save the notes.'))
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    setRemoving(true)
    setError('')
    try {
      await onRemove(row.id)
    } catch (e) {
      setError(errorText(e, 'Could not delete this.'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-line/10 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`status-${row.id}`} className="text-xs text-soft/60">
          Status
        </label>
        <select
          ref={statusRef}
          id={`status-${row.id}`}
          value={row.status || 'new'}
          onChange={(e) => changeStatus(e.target.value)}
          aria-describedby={published ? `status-hint-${row.id}` : undefined}
          className={`${smallInputCls} ${tapCls} max-w-[11rem]`}
        >
          {choices.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {published && (
          <span id={`status-hint-${row.id}`} className="text-xs text-soft/45">
            Any other status takes it off the exchange page.
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <GmailButton kind={kind} row={row} from={from} />
          {canDelete && (
            <ConfirmButton
              label="Delete"
              busyLabel="Deleting…"
              busy={removing}
              onConfirm={remove}
              className={`${outlineBtnCls} ${tapCls}`}
              keepWidth
            />
          )}
        </span>
      </div>
      {/* Always in the page, so the line is read out when it comes. It says
          the status is on its way until the database has it, and only then
          where the row went. Undo is 44px tall to a finger: the room around
          the line keeps that clear of Delete, which wraps to just above it
          on a phone. */}
      <UndoLine onUndo={sending ? undefined : undo} className="py-1.5">
        {sending ? 'Saving…' : movedText(kind, row, move)}
      </UndoLine>
      <ErrorText>{error}</ErrorText>

      <div>
        <label htmlFor={`notes-${row.id}`} className="mb-1.5 block text-xs text-soft/60">
          Notes <span className="text-soft/40">(only the people on this page see these)</span>
        </label>
        <textarea
          id={`notes-${row.id}`}
          value={notes}
          onChange={(e) => {
            setSaved(false)
            setNotes(e.target.value)
          }}
          rows={2}
          maxLength={4000}
          className={`${smallInputCls} resize-y`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            disabled={saving || removing || !notesDirty}
            onClick={saveNotes}
            className={`${outlineBtnCls} ${tapCls}`}
          >
            <BusyLabel busy={saving} label="Save notes" busyLabel="Saving…" />
          </button>
          <SaveStatus dirty={notesDirty && !saving} saved={saved} />
          <ErrorText>{notesError}</ErrorText>
        </div>
      </div>
    </div>
  )
}

// ── Orders ───────────────────────────────────────────────────────────────────

// Opens the buyer's payment screenshot in a new tab. The tab is opened on the
// click itself and pointed at the signed link once it arrives, because a
// browser blocks a tab opened after a wait as a pop-up.
export function ReceiptButton({ path, label = 'View receipt', className = outlineBtnCls }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!path) {
    return <span className="text-xs text-warn">No receipt uploaded</span>
  }
  const open = async () => {
    setBusy(true)
    setError('')
    const tab = window.open('', '_blank')
    try {
      const url = await receiptUrl(path)
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else {
        window.location.assign(url)
      }
    } catch (e) {
      tab?.close()
      setError(errorText(e, 'Could not open the receipt.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={open} disabled={busy} className={className}>
        {busy ? 'Opening…' : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  )
}

function OrderCard({ row, move, sending, onStatus, onPatch, onRemove, canDelete, ticked, onTick, from }) {
  const methods = usePaymentMethods()
  const items = Array.isArray(row.items) ? row.items : []
  return (
    <article className="rounded-2xl border border-line/10 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-center gap-3">
          <PickBox checked={ticked} onChange={onTick} label={pickLabel(row)} />
          <p className="min-w-0 break-words text-base font-semibold text-ink">{row.name}</p>
        </div>
        <Meta row={row} />
      </div>
      <Contact row={row} />
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-soft/60">
        {row.is_member != null && (
          <span>{row.is_member ? 'AUSSS member' : `Not a member${row.lc ? ` · ${row.lc}` : ''}`}</span>
        )}
        {row.payment_method && <span>Paid via {paymentMethodLabel(methods, row.payment_method)}</span>}
      </p>

      <ul className="mt-4 divide-y divide-line/10 rounded-xl border border-line/10 bg-page/60 px-4">
        {items.map((it, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
            <span className="font-medium text-ink">
              {it.qty}× {it.name}
            </span>
            <span className="text-xs uppercase tracking-[0.12em] text-soft/55">
              {[it.size, it.design].filter(Boolean).join(' · ')}
            </span>
            <span className="ml-auto text-soft/80">{formatEGP(it.line_total)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between py-2.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-soft/60">Subtotal</span>
          <span className="font-semibold text-accent">{formatEGP(row.subtotal)}</span>
        </li>
      </ul>

      {row.price_flag && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-warn">
          Check the amount: {row.price_flag}.
        </p>
      )}

      {row.notes && (
        <div className="mt-3">
          <p className="text-2xs uppercase tracking-[0.16em] text-soft/45">Buyer&rsquo;s note</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-soft/80">{row.notes}</p>
        </div>
      )}

      <div className="mt-4">
        <ReceiptButton path={row.receipt_path} className={`${outlineBtnCls} ${tapCls}`} />
      </div>

      <Triage
        kind="orders"
        row={row}
        notesField="officer_notes"
        move={move}
        sending={sending}
        onStatus={onStatus}
        onPatch={onPatch}
        onRemove={onRemove}
        canDelete={canDelete}
        from={from}
      />
    </article>
  )
}

// ── Stories ──────────────────────────────────────────────────────────────────

// The three things the exchange page takes from the portal, as the form holds
// them. The name and the text start from the tidied copy when there is one,
// otherwise from the story as it was sent, so a typo can be mended where it
// stands. Featured pins the story to the top of the page with a highlight.
const siteCopy = (row) => ({
  name: row.public_name || row.name || '',
  story: row.public_story || row.story || '',
  featured: Boolean(row.featured),
})

function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-3 w-3 motion-safe:transition-transform motion-safe:duration-150 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  )
}

// What the exchange page shows of a story, and the one place a story is put
// on the site from. Choosing "Published" in the status list used to publish it
// there and then, before anyone had seen the name and the text the site would
// show. Now the panel of a story that is not on the site is closed: opening it
// shows those fields, and Publish is the last thing in it.
//
// The three fields are one form. On a published story they wait for "Save
// what the site shows"; the Featured tick used to save by itself, and the
// read that followed threw away whatever had been typed beside it.
function PublishPanel({ row, onPatch, onStatus }) {
  const published = row.status === 'published'
  const base = siteCopy(row)
  const [form, setForm] = useState(base)
  const [open, setOpen] = useState(false)
  // True from the click that opens the form until its fade has run. The fade
  // belongs to that click alone: left on the form, it played again each time
  // the list came back from behind another tab.
  const [entering, setEntering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const set = (field) => (value) => {
    setSaved(false)
    setForm((f) => ({ ...f, [field]: value }))
  }

  // Follow the row when it changes elsewhere (another officer saved), unless
  // there are unsaved edits here.
  const baseKey = JSON.stringify(base)
  const formKey = JSON.stringify(form)
  const dirty = formKey !== baseKey
  useLeaveWarning(dirty)
  const lastBase = useRef(baseKey)
  useEffect(() => {
    if (baseKey !== lastBase.current && formKey === lastBase.current) setForm(JSON.parse(baseKey))
    lastBase.current = baseKey
  }, [baseKey, formKey])

  // Only what was changed is sent. A name or a text left as it was sent in
  // stays blank in the database, which fills it from the submission when the
  // story is published, as it always has.
  const changes = () => {
    const out = {}
    if (form.name !== base.name) out.public_name = form.name
    if (form.story !== base.story) out.public_story = form.story
    if (form.featured !== base.featured) out.featured = form.featured
    return out
  }

  const send = async (write, fallback) => {
    const sent = form
    setBusy(true)
    setError('')
    try {
      const kept = await write()
      // The form takes what the database kept (trimmed, a blank filled from
      // the submission), unless more was typed while it was on its way.
      setForm((f) => (f === sent ? siteCopy(kept) : f))
      return true
    } catch (e) {
      setError(errorText(e, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (await send(() => onPatch(row.id, changes()), 'Could not save that change.')) setSaved(true)
  }
  // The card says "Published" only once the database has, hence the wait.
  //
  // Both of the panel's buttons leave the page when the story is published.
  // If the keyboard was on one of them it goes to the panel itself, whose
  // fields are the next stop: left alone it would be on nothing.
  const panel = useRef(null)
  const onOwnButton = () => {
    const at = document.activeElement
    return at?.tagName === 'BUTTON' && Boolean(panel.current?.contains(at))
  }
  const publish = async () => {
    const held = onOwnButton()
    const done = await send(
      () => onStatus(row, 'published', { fields: changes(), wait: true }),
      'Could not publish the story.',
    )
    if (done && held && (onOwnButton() || document.activeElement === document.body)) panel.current?.focus()
  }

  const titleId = `publish-title-${row.id}`
  const bodyId = `publish-${row.id}`
  const shown = published || open

  return (
    <div
      ref={panel}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`mt-4 rounded-xl border p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        published ? 'border-medical/30 bg-medical/5' : 'border-line/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p id={titleId} className={panelTitleCls}>
          On the exchange page
        </p>
        {published && row.published_at && (
          <span className="text-xs text-soft/50">Published {when(row.published_at)}</span>
        )}
        {!published && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => {
              setEntering(!open)
              setOpen(!open)
            }}
            className={`${outlineBtnCls} ${tapCls}`}
          >
            Review and publish
            <Chevron open={open} />
          </button>
        )}
      </div>

      {shown && (
        // Opened by its button, the form fades in; on a story that is already
        // published it is simply part of the card. A field inside has
        // transitions of its own, which end here too: only the form's own
        // counts.
        <div
          id={bodyId}
          className={entering && !published ? 'enter-panel' : undefined}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget) setEntering(false)
          }}
        >
          {!published && (
            <p className="mt-2 text-xs text-soft/60">
              Check the name and the story as the site will show them. Nothing is on the site until you publish.
            </p>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
            <label className="text-xs text-soft/60">
              Name shown
              <input
                type="text"
                value={form.name}
                maxLength={140}
                placeholder={row.name}
                onChange={(e) => set('name')(e.target.value)}
                className={`${smallInputCls} ${tapCls} mt-1`}
              />
            </label>
            <label className="text-xs text-soft/60">
              {/* One step stronger than the same aside under Notes: on the
                  blue tint of a published story the fainter step fell just
                  short of 4.5:1 in the dark theme. */}
              Story shown <span className="text-soft/50">(tidy typos, keep their voice)</span>
              <textarea
                value={form.story}
                maxLength={4000}
                rows={4}
                placeholder={row.story}
                onChange={(e) => set('story')(e.target.value)}
                className={`${smallInputCls} mt-1 resize-y`}
              />
            </label>
          </div>
          {/* The tick box brings its own 44px row, which is the gap above and
              below it. */}
          <CheckField
            checked={form.featured}
            onChange={set('featured')}
            label="Featured"
            hint="Pinned first, highlighted."
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {published ? (
              <>
                <button
                  type="button"
                  disabled={busy || !dirty}
                  onClick={save}
                  className={`${outlineBtnCls} ${tapCls}`}
                >
                  <BusyLabel busy={busy} label="Save what the site shows" busyLabel="Saving…" />
                </button>
                <SaveStatus dirty={dirty && !busy} saved={saved} />
              </>
            ) : (
              <button type="button" disabled={busy} onClick={publish} className={`${primaryBtnCls} ${tapCls}`}>
                <BusyLabel busy={busy} label="Publish on the exchange page" busyLabel="Publishing…" />
              </button>
            )}
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      )}
    </div>
  )
}

function StoryCard({ row, move, sending, onStatus, onPatch, onRemove, canDelete, ticked, onTick, from }) {
  return (
    <article
      className={`rounded-2xl border bg-card p-5 ${
        row.status === 'published' && row.featured ? 'border-medical/50' : 'border-line/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-center gap-3">
          <PickBox checked={ticked} onChange={onTick} label={pickLabel(row)} />
          <p className="min-w-0 break-words text-base font-semibold text-ink">
            {row.name}
            {row.status === 'published' && (
              <span className="ml-2 rounded-full border border-medical/50 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wider text-accent">
                {row.featured ? 'Featured' : 'Published'}
              </span>
            )}
          </p>
        </div>
        <Meta row={row} />
      </div>
      <Contact row={row} />
      {(row.destination || row.programme) && (
        <p className="mt-3 text-sm text-soft/80">
          <span className="text-xs uppercase tracking-[0.16em] text-soft/45">Exchange: </span>
          {[row.destination, row.programme].filter(Boolean).join(' · ')}
        </p>
      )}
      <div className="mt-3">
        <p className="text-2xs uppercase tracking-[0.16em] text-soft/45">Their story</p>
        <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-soft/80">{row.story}</p>
      </div>
      <PublishPanel row={row} onPatch={onPatch} onStatus={onStatus} />
      <Triage
        kind="stories"
        row={row}
        notesField="notes"
        move={move}
        sending={sending}
        onStatus={onStatus}
        onPatch={onPatch}
        onRemove={onRemove}
        canDelete={canDelete}
        from={from}
      />
    </article>
  )
}

// ── Waitlist ─────────────────────────────────────────────────────────────────

function SignupRow({ row, move, sending, onStatus, onRemove, canDelete, ticked, onTick, from }) {
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const statusRef = useRef(null)
  const changeStatus = (to) => {
    setError('')
    onStatus(row, to).catch((e) => setError(errorText(e, 'Could not save that change.')))
  }
  const undo = (e) => {
    focusFromUndo(e, statusRef)
    changeStatus(move.from)
  }
  const remove = async () => {
    setRemoving(true)
    setError('')
    try {
      await onRemove(row.id)
    } catch (e) {
      setError(errorText(e, 'Could not delete this.'))
    } finally {
      setRemoving(false)
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <PickBox checked={ticked} onChange={onTick} label={pickLabel(row)} />
      <span className="w-40 shrink-0 text-xs text-soft/45">{when(row.created_at)}</span>
      <span className="min-w-[8rem] flex-1 break-words text-sm font-medium text-ink">{row.name || '—'}</span>
      <a
        href={`mailto:${row.email}`}
        className={`flex min-w-[12rem] flex-1 items-center break-all text-sm text-accent hover:text-ink ${tapCls}`}
      >
        {row.email}
      </a>
      <select
        ref={statusRef}
        aria-label={`Status for ${row.email}`}
        value={row.status || 'new'}
        onChange={(e) => changeStatus(e.target.value)}
        className={`${smallInputCls} ${tapCls} max-w-[10rem]`}
      >
        {STATUSES.signups.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <GmailButton kind="signups" row={row} from={from} />
      {canDelete && (
        <span>
          <ConfirmButton
            label="Delete"
            busyLabel="Deleting…"
            busy={removing}
            onConfirm={remove}
            className={`${outlineBtnCls} ${tapCls}`}
            keepWidth
          />
        </span>
      )}
      {/* Always in the page, so the line is read out when it comes. Undo is
          44px tall to a finger, more than the line it stands in: the room
          around the line keeps that clear of Delete, which wraps to just
          above it on a phone. */}
      <UndoLine onUndo={sending ? undefined : undo} className="basis-full py-2.5">
        {sending ? 'Saving…' : movedText('signups', row, move)}
      </UndoLine>
      {error && (
        <div className="basis-full">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </li>
  )
}

// ── One tab ──────────────────────────────────────────────────────────────────

function SubmissionList({ kind, canDelete, active }) {
  const list = useSubmissions(kind)
  const { update, remove } = useSubmissionMutations(kind)
  const [status, setStatus] = useState('new')
  const [query, setQuery] = useState('')
  // Coming back to a tab reads its list again when the last read has gone
  // stale, as opening a tab always did before the lists stayed in the page.
  // The cards stay where they are, with whatever is typed in them.
  const qc = useQueryClient()
  const wasActive = useRef(active)
  useEffect(() => {
    if (active && !wasActive.current) qc.refetchQueries({ queryKey: submissionKeys.list(kind), stale: true })
    wasActive.current = active
  }, [active, qc, kind])
  // The rows whose status was changed since the filter was chosen, by id:
  // the row's last change ({ from, to }), or null once that was taken back.
  // They stay in the list although they no longer belong under the filter. A
  // card that left the moment its status changed took its unsaved notes with
  // it, and gave no way to undo a slip.
  const [touched, setTouched] = useState({})
  // The status changes of a row that are still on their way, by id: how many
  // (`n`), and the status asked for last (`to`). The row says "Saving…" until
  // the last has landed, and the tab asks before it is closed on one: a change
  // made with no connection waits for it to come back.
  //
  // The row also shows `to` for as long (see onScreen below). The list itself
  // takes the change a moment after the click, and a status select drawn from
  // the list alone went back to the old choice for a frame or more in between.
  const [sending, setSending] = useState({})
  useLeaveWarning(Object.keys(sending).length > 0)
  // The entries ticked to be written to, by id. They are kept through a
  // search, so several people can be looked up and ticked one after another,
  // and dropped when another filter is chosen, where the list is a new one.
  const [ticked, setTicked] = useState({})
  const { user } = useAuth()
  const from = user?.email || ''
  const methods = usePaymentMethods()
  const rows = useMemo(() => list.data || [], [list.data])

  const q = query.trim().toLowerCase()
  // What the filter and the search pick out, which is what an export holds.
  const picked = useMemo(
    () => rows.filter((r) => (status === 'all' || r.status === status) && matches(r, q)),
    [rows, status, q],
  )
  // On screen the touched rows are there as well, and so is a row with a
  // change still on its way, whatever filter was chosen meanwhile: if the
  // change is refused, the sentence that says so is on that row's card.
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (status === 'all' || r.status === status || touched[r.id] !== undefined || sending[r.id] !== undefined) &&
          matches(r, q),
      ),
    [rows, status, q, touched, sending],
  )
  const countBy = useMemo(() => {
    const out = { all: rows.length }
    for (const r of rows) out[r.status] = (out[r.status] || 0) + 1
    return out
  }, [rows])

  // Choosing a filter, the one that is on included, lists afresh: the rows
  // that were kept in sight go where they now belong.
  const filterBy = (value) => {
    setStatus(value)
    setTouched({})
    setTicked({})
  }

  // The ticked entries that are still in the list (one may have been deleted
  // since), and the people they are from, each address once.
  const tickedRows = useMemo(() => rows.filter((r) => ticked[r.id]), [rows, ticked])
  const people = useMemo(() => uniquePeople(tickedRows), [tickedRows])
  const allTicked = shown.length > 0 && shown.every((r) => ticked[r.id])
  const tick = (id, on) =>
    setTicked((t) => {
      const out = { ...t }
      if (on) out[id] = true
      else delete out[id]
      return out
    })
  // The box above the list ticks everything listed, or unticks it when all of it is.
  const tickAll = (on) =>
    setTicked((t) => {
      const out = { ...t }
      for (const r of shown) {
        if (on) out[r.id] = true
        else delete out[r.id]
      }
      return out
    })

  // Changes a row's status. It shows at once and is saved behind; `wait`
  // holds the screen until the database has answered instead, and `fields` are
  // columns to save in the same write (what the site shows of a story). The
  // row is marked as touched before anything is sent, so it is never out of
  // the list in between. Going straight back to where the row was is taking
  // the last change back, and leaves no line.
  const onStatus = async (row, to, { fields, wait = false } = {}) => {
    const from = row.status || 'new'
    const was = touched[row.id]
    const move = was && was.from === to && was.to === from ? null : { from, to }
    const note = (value) => setTouched((t) => ({ ...t, [row.id]: value }))
    const count = (by) =>
      setSending(({ [row.id]: now, ...rest }) => {
        const n = (now?.n || 0) + by
        return n > 0 ? { ...rest, [row.id]: { n, to: by > 0 ? to : now.to } } : rest
      })
    note(wait ? (was ?? null) : move)
    if (!wait) count(1)
    try {
      const kept = await update.mutateAsync({ id: row.id, patch: { ...fields, status: to }, wait })
      if (wait) note(move)
      return kept
    } catch (err) {
      // The row is back where it was, and so is the line about it, unless a
      // later change has written its own. If a filter was chosen meanwhile,
      // the row is marked again: it stays, with the sentence about the refusal.
      if (!wait) {
        setTouched((t) => {
          if (t[row.id] === move) return { ...t, [row.id]: was ?? null }
          return t[row.id] === undefined ? { ...t, [row.id]: null } : t
        })
      }
      throw err
    } finally {
      if (!wait) count(-1)
    }
  }
  // Typed text: the form holds it while it is saved, so nothing has to show early.
  const onPatch = (id, patch) => update.mutateAsync({ id, patch, wait: true })
  const onRemove = (id) =>
    remove.mutateAsync({ id, receiptPath: rows.find((r) => r.id === id)?.receipt_path })
  const filterLabel = status === 'all' ? '' : statusLabel(kind, status).toLowerCase()
  // A row as its card shows it: with the status last asked for while that is
  // on its way, from the click itself.
  const onScreen = (row) => (sending[row.id] ? { ...row, status: sending[row.id].to } : row)

  if (list.isPending) return <PageLoading />
  // A read that failed can be asked for again from where the sentence
  // stands, as on the other pages of the portal: with nothing but the
  // sentence, the only way on was to reload the page.
  const tryAgain = (
    <button
      type="button"
      disabled={list.isFetching}
      onClick={() => list.refetch()}
      className={`${outlineBtnCls} ${tapCls}`}
    >
      Try again
    </button>
  )
  // A list that was read once stays on screen when a later read fails: the
  // cards hold typed notes, and an error in their place would lose them.
  if (list.error && !list.data) {
    return (
      <div className="space-y-3">
        <ErrorText>{errorText(list.error, 'Could not load the list.')}</ErrorText>
        {tryAgain}
      </div>
    )
  }

  const Card = kind === 'orders' ? OrderCard : kind === 'stories' ? StoryCard : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={`Show ${TAB_LABEL[kind].toLowerCase()}`}
          className="flex flex-wrap items-center gap-2"
        >
          {[['new', 'New'], ...STATUSES[kind].filter(([v]) => v !== 'new'), ['all', 'All']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => filterBy(value)}
              aria-pressed={status === value}
              className={`${chipBtnCls(status === value)} ${tapCls}`}
            >
              {label}
              {countBy[value] ? ` · ${countBy[value]}` : ''}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, phone, reference"
          aria-label="Search"
          className={`${smallInputCls} ${tapCls} ml-auto max-w-xs`}
        />
        <ExportButtons
          title={TAB_LABEL[kind]}
          subtitle={`${filterLabel ? `Status ${filterLabel}` : 'Everything'} submitted through the website${
            q ? `, matching “${query.trim()}”` : ''
          }.`}
          filename={`ausss-${kind}`}
          columns={exportColumns(kind, methods)}
          rows={picked}
          layout={kind === 'signups' ? 'table' : 'records'}
          className={`${outlineBtnCls} ${tapCls}`}
        />
      </div>

      <BulkEmail
        shownCount={shown.length}
        allTicked={allTicked}
        onTickAll={tickAll}
        tickedCount={tickedRows.length}
        people={people}
        onClear={() => setTicked({})}
        from={from}
      />

      {list.error && (
        <div>
          <ErrorText>{errorText(list.error, 'Could not refresh the list.')}</ErrorText>
          <p className="mb-3 mt-1 text-xs text-soft/60">What you see is the last read. Nothing you typed is lost.</p>
          {tryAgain}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-soft/60">
          {rows.length === 0 ? 'Nothing here yet.' : 'Nothing matches that filter.'}
        </p>
      ) : Card ? (
        <div className="space-y-4">
          {shown.map((row) => (
            <Card
              key={row.id}
              row={onScreen(row)}
              move={touched[row.id]}
              sending={Boolean(sending[row.id])}
              onStatus={onStatus}
              onPatch={onPatch}
              onRemove={onRemove}
              canDelete={canDelete}
              ticked={Boolean(ticked[row.id])}
              onTick={(on) => tick(row.id, on)}
              from={from}
            />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line/10 rounded-2xl border border-line/10 bg-card px-5">
          {shown.map((row) => (
            <SignupRow
              key={row.id}
              row={onScreen(row)}
              move={touched[row.id]}
              sending={Boolean(sending[row.id])}
              onStatus={onStatus}
              onRemove={onRemove}
              canDelete={canDelete}
              ticked={Boolean(ticked[row.id])}
              onTick={(on) => tick(row.id, on)}
              from={from}
            />
          ))}
        </ul>
      )}
      {rows.length >= 500 && (
        <p className="text-xs text-soft/45">Showing the newest 500.</p>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SubmissionsPage() {
  usePageTitle('Submissions')
  const { isEB, officerOf } = useAuth()
  const canStories = isEB || officerOf('scope') || officerOf('score')
  const tabs = [
    isEB && 'orders',
    canStories && 'stories',
    isEB && 'signups',
  ].filter(Boolean)
  // The open tab is in the address as ?tab=, where the links in a
  // notification point (workUi.jsx). Changing tab replaces the address, so
  // Back leaves the page and does not walk back through the tabs.
  const [tab, setTab] = useTabParam(tabs, tabs[0])
  // A list is put on the page the first time its tab is opened and then stays
  // there, hidden while another tab shows: notes typed under one tab are
  // still there after a look at another.
  const [opened, setOpened] = useState([tab])
  if (tab && !opened.includes(tab)) setOpened([...opened, tab])

  if (tabs.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">
          Submissions are handled by the Executive Board (orders and the waitlist) and the
          exchange officers (stories). If you think you should have access, ask the webmaster
          to check your assignment for this term.
        </p>
        <Link
          to="/portal"
          className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent transition-colors hover:text-ink"
        >
          &larr; Back to your dashboard
        </Link>
      </Panel>
    )
  }

  const tabbed = tabs.length > 1

  // The arrow keys move along the row, as they do in any set of tabs. They
  // count from the tab that has the focus, not from the open one, as the
  // committee editor's do: every tab can be reached with Tab, and from one
  // that is not open an arrow used to jump to the open tab's neighbour.
  const onKeyDown = (e) => {
    // With a key held beside it an arrow is the browser's own (Alt and the
    // left arrow go back a page).
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const at = tabs.findIndex((key) => tabId(key) === e.target.id)
    if (at < 0) return
    const to =
      e.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1
    if (to < 0) return
    e.preventDefault()
    setTab(tabs[to])
    document.getElementById(tabId(tabs[to]))?.focus()
  }

  return (
    <>
      <PageHeader
        eyebrow="Submissions"
        title="Submissions"
        subtitle="What people sent through the website: merch orders, exchange stories and the recruitment waitlist."
      />

      {tabbed && (
        <div role="tablist" aria-label="Submissions" onKeyDown={onKeyDown} className="mb-8 flex flex-wrap gap-2">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={tabId(key)}
              aria-selected={tab === key}
              aria-controls={panelId(key)}
              onClick={() => setTab(key)}
              // The hairline is there on the open tab too, unseen, so the row
              // does not shift by its width when the tab changes.
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${pressCls} ${tabTapCls} ${
                tab === key
                  ? 'border-transparent bg-cta text-on-cta'
                  : 'border-line/15 text-soft/70 hover:text-ink'
              }`}
            >
              {TAB_LABEL[key]}
            </button>
          ))}
        </div>
      )}

      {tabs.map(
        (key) =>
          (tab === key || opened.includes(key)) && (
            <div
              key={key}
              role={tabbed ? 'tabpanel' : undefined}
              id={panelId(key)}
              aria-labelledby={tabbed ? tabId(key) : undefined}
              className={tab === key ? '' : 'hidden'}
            >
              <SubmissionList kind={key} canDelete={isEB} active={tab === key} />
            </div>
          ),
      )}
    </>
  )
}
