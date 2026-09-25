import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { itemsSummary, receiptUrl, useSubmissionMutations, useSubmissions } from '../../submissionsQueries.js'
import ExportButtons from '../../ExportButtons.jsx'
import { Centered, ErrorText, PageHeader, Panel, Spinner, outlineBtnCls } from '../../portalUi.jsx'
import { chipBtnCls, smallInputCls, when } from '../../workUi.jsx'
import { ConfirmButton } from '../gallery/galleryUi.jsx'

// /portal/submissions. The three public forms that used to land in Google
// Sheets: merch pre-orders, exchange stories and the recruitment waitlist.
// One tab per kind, newest first, with a status per row and private notes.
// The EB sees all three; the SCOPE and SCORE officers see the stories.
// Reads and writes go through submissionsQueries.js; authorisation lives in
// the database (row-level security), so a failed write shows up as an error.

const STATUSES = {
  orders: [
    ['new', 'New'],
    ['confirmed', 'Confirmed'],
    ['collected', 'Collected'],
    ['cancelled', 'Cancelled'],
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

const TAB_LABEL = { orders: 'Orders', stories: 'Stories', signups: 'Waitlist' }

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

// ── Shared bits ──────────────────────────────────────────────────────────────

function Contact({ row }) {
  return (
    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-silver/60">
      <a href={`mailto:${row.email}`} className="text-medical-light hover:text-white">
        {row.email}
      </a>
      {row.phone && (
        <a href={`tel:${row.phone}`} className="hover:text-white">
          {row.phone}
        </a>
      )}
      {row.year && <span>{row.year}</span>}
    </p>
  )
}

function Meta({ row }) {
  return (
    <p className="text-xs text-silver/45">
      {when(row.created_at)}
      {row.ref && ` · ${row.ref}`}
    </p>
  )
}

// Status select (saves at once) + private notes (saved on click) + delete
// for the EB. `notesField` is the column the notes live in.
function Triage({ kind, row, notesField, onPatch, onRemove, canDelete }) {
  const [notes, setNotes] = useState(row[notesField] || '')
  const [busy, setBusy] = useState('') // 'status' | 'notes' | 'remove'
  const [error, setError] = useState('')
  const notesDirty = notes !== (row[notesField] || '')

  const run = async (what, fn) => {
    setBusy(what)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e?.message || 'Could not save that change.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`status-${row.id}`} className="text-xs text-silver/60">
          Status
        </label>
        <select
          id={`status-${row.id}`}
          value={row.status || 'new'}
          disabled={Boolean(busy)}
          onChange={(e) => run('status', () => onPatch(row.id, { status: e.target.value }))}
          className={`${smallInputCls} max-w-[11rem] disabled:opacity-40`}
        >
          {STATUSES[kind].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {busy === 'status' && <span className="text-xs text-silver/50">Saving…</span>}
        {kind === 'stories' && row.status !== 'published' && (
          <span className="text-xs text-silver/45">Published = shown on the exchange page</span>
        )}
        {canDelete && (
          <span className="ml-auto">
            <ConfirmButton
              label="Delete"
              confirmLabel="Yes, delete it"
              disabled={Boolean(busy)}
              onConfirm={() => run('remove', () => onRemove(row.id))}
            />
          </span>
        )}
      </div>

      <div>
        <label htmlFor={`notes-${row.id}`} className="mb-1.5 block text-xs text-silver/60">
          Notes <span className="text-silver/40">(only the people on this page see these)</span>
        </label>
        <textarea
          id={`notes-${row.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={`${smallInputCls} resize-y`}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={Boolean(busy) || !notesDirty}
            onClick={() => run('notes', () => onPatch(row.id, { [notesField]: notes }))}
            className={outlineBtnCls}
          >
            {busy === 'notes' ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>
    </div>
  )
}

// ── Orders ───────────────────────────────────────────────────────────────────

function ReceiptButton({ path }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!path) {
    return <span className="text-xs text-amber-200">No receipt uploaded</span>
  }
  const open = async () => {
    setBusy(true)
    setError('')
    try {
      const url = await receiptUrl(path)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError(e?.message || 'Could not open the receipt.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={open} disabled={busy} className={outlineBtnCls}>
        {busy ? 'Opening…' : 'View receipt'}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </span>
  )
}

function OrderCard({ row, onPatch, onRemove, canDelete }) {
  const items = Array.isArray(row.items) ? row.items : []
  return (
    <article className="rounded-2xl border border-white/10 bg-forest-800 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-base font-semibold text-white">{row.name}</p>
        <Meta row={row} />
      </div>
      <Contact row={row} />
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-silver/60">
        {row.is_member != null && (
          <span>{row.is_member ? 'AUSSS member' : `Not a member${row.lc ? ` · ${row.lc}` : ''}`}</span>
        )}
        {row.payment_method && <span>Paid via {row.payment_method}</span>}
      </p>

      <ul className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10 bg-forest-950/60 px-4">
        {items.map((it, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
            <span className="font-medium text-white">
              {it.qty}× {it.name}
            </span>
            <span className="text-xs uppercase tracking-[0.12em] text-silver/55">
              {[it.size, it.design].filter(Boolean).join(' · ')}
            </span>
            <span className="ml-auto text-silver/80">{formatEGP(it.line_total)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between py-2.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-silver/60">Subtotal</span>
          <span className="font-semibold text-medical-light">{formatEGP(row.subtotal)}</span>
        </li>
      </ul>

      {row.price_flag && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          Check the amount: {row.price_flag}.
        </p>
      )}

      {row.notes && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-silver/45">Buyer&rsquo;s note</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-silver/80">{row.notes}</p>
        </div>
      )}

      <div className="mt-4">
        <ReceiptButton path={row.receipt_path} />
      </div>

      <Triage
        kind="orders"
        row={row}
        notesField="officer_notes"
        onPatch={onPatch}
        onRemove={onRemove}
        canDelete={canDelete}
      />
    </article>
  )
}

// ── Stories ──────────────────────────────────────────────────────────────────

// What the site shows once a story is published: the name and the text can be
// tidied here (blank = as submitted), and Featured pins it to the top of the
// exchange page with a highlight.
function PublishPanel({ row, onPatch }) {
  const [name, setName] = useState(row.public_name || '')
  const [story, setStory] = useState(row.public_story || '')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const dirty = name !== (row.public_name || '') || story !== (row.public_story || '')

  const run = async (what, fn) => {
    setBusy(what)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e?.message || 'Could not save that change.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-medical/30 bg-medical/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-medical-light">
          On the exchange page
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white">
          <input
            type="checkbox"
            checked={Boolean(row.featured)}
            disabled={Boolean(busy)}
            onChange={(e) => run('featured', () => onPatch(row.id, { featured: e.target.checked }))}
            className="h-4 w-4 accent-medical"
          />
          Featured
          <span className="text-xs text-silver/50">(pinned first, highlighted)</span>
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <label className="text-xs text-silver/60">
          Name shown
          <input
            type="text"
            value={name}
            maxLength={140}
            placeholder={row.name}
            onChange={(e) => setName(e.target.value)}
            className={`${smallInputCls} mt-1`}
          />
        </label>
        <label className="text-xs text-silver/60">
          Story shown <span className="text-silver/40">(tidy typos, keep their voice)</span>
          <textarea
            value={story}
            maxLength={4000}
            rows={4}
            placeholder={row.story}
            onChange={(e) => setStory(e.target.value)}
            className={`${smallInputCls} mt-1 resize-y`}
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={Boolean(busy) || !dirty}
          onClick={() => run('text', () => onPatch(row.id, { public_name: name, public_story: story }))}
          className={outlineBtnCls}
        >
          {busy === 'text' ? 'Saving…' : 'Save what the site shows'}
        </button>
        {row.published_at && (
          <span className="text-xs text-silver/50">Published {when(row.published_at)}</span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

function StoryCard({ row, onPatch, onRemove, canDelete }) {
  return (
    <article
      className={`rounded-2xl border bg-forest-800 p-5 ${
        row.status === 'published' && row.featured ? 'border-medical/50' : 'border-white/10'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-base font-semibold text-white">
          {row.name}
          {row.status === 'published' && (
            <span className="ml-2 rounded-full border border-medical/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-medical-light">
              {row.featured ? 'Featured' : 'Live'}
            </span>
          )}
        </p>
        <Meta row={row} />
      </div>
      <Contact row={row} />
      {(row.destination || row.programme) && (
        <p className="mt-3 text-sm text-silver/80">
          <span className="text-xs uppercase tracking-[0.16em] text-silver/45">Exchange: </span>
          {[row.destination, row.programme].filter(Boolean).join(' · ')}
        </p>
      )}
      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-silver/45">Their story</p>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-silver/80">{row.story}</p>
      </div>
      {row.status === 'published' && <PublishPanel key={row.updated_at} row={row} onPatch={onPatch} />}
      <Triage
        kind="stories"
        row={row}
        notesField="notes"
        onPatch={onPatch}
        onRemove={onRemove}
        canDelete={canDelete}
      />
    </article>
  )
}

// ── Waitlist ─────────────────────────────────────────────────────────────────

function SignupRow({ row, onPatch, onRemove, canDelete }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e?.message || 'Could not save that change.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <span className="w-40 shrink-0 text-xs text-silver/45">{when(row.created_at)}</span>
      <span className="min-w-[8rem] flex-1 text-sm font-medium text-white">{row.name || '—'}</span>
      <a href={`mailto:${row.email}`} className="min-w-[12rem] flex-1 text-sm text-medical-light hover:text-white">
        {row.email}
      </a>
      <select
        aria-label={`Status for ${row.email}`}
        value={row.status || 'new'}
        disabled={busy}
        onChange={(e) => run(() => onPatch(row.id, { status: e.target.value }))}
        className={`${smallInputCls} max-w-[10rem] disabled:opacity-40`}
      >
        {STATUSES.signups.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {canDelete && (
        <ConfirmButton
          label="Delete"
          confirmLabel="Yes, delete"
          disabled={busy}
          onConfirm={() => run(() => onRemove(row.id))}
        />
      )}
      {error && <span className="basis-full text-xs text-red-300">{error}</span>}
    </li>
  )
}

// ── One tab ──────────────────────────────────────────────────────────────────

function SubmissionList({ kind, canDelete }) {
  const list = useSubmissions(kind)
  const { update, remove } = useSubmissionMutations(kind)
  const [status, setStatus] = useState('new')
  const [query, setQuery] = useState('')
  const rows = list.data || []

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => rows.filter((r) => (status === 'all' || r.status === status) && matches(r, q)),
    [rows, status, q],
  )
  const countBy = useMemo(() => {
    const out = { all: rows.length }
    for (const r of rows) out[r.status] = (out[r.status] || 0) + 1
    return out
  }, [rows])

  const onPatch = (id, patch) => update.mutateAsync({ id, patch })
  const onRemove = (id) =>
    remove.mutateAsync({ id, receiptPath: rows.find((r) => r.id === id)?.receipt_path })
  const filterLabel =
    status === 'all' ? '' : STATUSES[kind].find(([v]) => v === status)?.[1]?.toLowerCase() || status

  if (list.isPending) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  if (list.error) {
    return <ErrorText>{list.error.message || 'Could not load the list.'}</ErrorText>
  }

  const Card = kind === 'orders' ? OrderCard : kind === 'stories' ? StoryCard : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {[['new', 'New'], ...STATUSES[kind].filter(([v]) => v !== 'new'), ['all', 'All']].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            aria-pressed={status === value}
            className={chipBtnCls(status === value)}
          >
            {label}
            {countBy[value] ? ` · ${countBy[value]}` : ''}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, phone, reference"
          aria-label="Search"
          className={`${smallInputCls} ml-auto max-w-xs`}
        />
        <ExportButtons
          title={TAB_LABEL[kind]}
          subtitle={`${filterLabel ? `Status ${filterLabel}` : 'Everything'} submitted through the website${
            q ? `, matching “${query.trim()}”` : ''
          }.`}
          filename={`ausss-${kind}`}
          columns={EXPORT_COLUMNS[kind]}
          rows={shown}
          layout={kind === 'signups' ? 'table' : 'records'}
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-silver/60">
          {rows.length === 0 ? 'Nothing here yet.' : 'Nothing matches that filter.'}
        </p>
      ) : Card ? (
        <div className="space-y-4">
          {shown.map((row) => (
            <Card key={row.id} row={row} onPatch={onPatch} onRemove={onRemove} canDelete={canDelete} />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-forest-800 px-5">
          {shown.map((row) => (
            <SignupRow key={row.id} row={row} onPatch={onPatch} onRemove={onRemove} canDelete={canDelete} />
          ))}
        </ul>
      )}
      {rows.length >= 500 && (
        <p className="text-xs text-silver/45">Showing the newest 500.</p>
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
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = tabs.includes(requested) ? requested : tabs[0]

  if (tabs.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-silver/70">
          Submissions are handled by the Executive Board (orders and the waitlist) and the
          exchange officers (stories). If you think you should have access, ask the webmaster
          to check your assignment for this term.
        </p>
        <Link to="/portal" className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white">
          &larr; Back to your dashboard
        </Link>
      </Panel>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Submissions"
        title="Submissions"
        subtitle="What people sent through the website: merch pre-orders, exchange stories and the recruitment waitlist."
      />

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Submissions" className="mb-8 flex gap-2">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setParams({ tab: key })}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                tab === key
                  ? 'bg-medical text-forest-950'
                  : 'border border-white/15 text-silver/70 hover:text-white'
              }`}
            >
              {TAB_LABEL[key]}
            </button>
          ))}
        </div>
      )}

      <SubmissionList key={tab} kind={tab} canDelete={isEB} />
    </>
  )
}
