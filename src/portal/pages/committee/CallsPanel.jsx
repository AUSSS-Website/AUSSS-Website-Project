import { useState } from 'react'
import { formatDeadline } from '../../../hooks/useCalls.js'
import {
  todayCairo,
  useApplications,
  useCallMutations,
  useCommitteeCalls,
  useUpdateApplication,
} from '../../officerQueries.js'
import {
  ErrorText,
  Field,
  Spinner,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { smallInputCls, when } from '../../workUi.jsx'
import ExportButtons from '../../ExportButtons.jsx'

// Officer-side Open Calls management for the portal.
//
// Three views, one file:
//   CallsPanel        list of this committee's calls (the entry point)
//   CallEditor        create / edit a call, its positions and its questions
//   ApplicationsList  who applied, what they said, and how triage is going
//
// Every read and write goes through officerQueries.js; authorisation lives in
// the database (row-level security), so a failed write surfaces here as a
// thrown error with a message, never as a silently ignored save.

const MAX_POSITIONS = 8
const MAX_QUESTIONS = 6

const APPLICATION_STATUSES = [
  ['new', 'New'],
  ['shortlisted', 'Shortlisted'],
  ['accepted', 'Accepted'],
  ['declined', 'Declined'],
]

// Client-side ids for new positions/questions. The database keeps whatever id
// we send (falling back to p0/q0 when blank), and applications reference
// positions by id, so an id must never change once the call is saved.
function uid(prefix) {
  try {
    return prefix + crypto.randomUUID().slice(0, 8)
  } catch {
    return prefix + Date.now().toString(36) + Math.round(Math.random() * 1e4)
  }
}

// A labelled section (not a card): portalUi's Field, kept to a readable width.
function Section({ label, hint, children }) {
  return (
    <section className="mx-auto max-w-3xl">
      <Field label={label} hint={hint}>
        {children}
      </Field>
    </section>
  )
}

function BackButton({ onClick }) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-silver/60 transition-colors hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to calls
      </button>
    </div>
  )
}

// One line of status for a call, spelling out *why* it isn't live.
function StatusPill({ call }) {
  const map = {
    open: ['Open', 'bg-medical/20 text-medical-light'],
    expired: ['Closed: deadline passed', 'bg-amber-400/15 text-amber-300'],
    closed: ['Closed by you', 'bg-white/10 text-silver/70'],
    draft: ['Draft: not visible', 'bg-white/10 text-silver/70'],
  }
  const [label, cls] = map[call.effectiveStatus] || map.draft
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${cls}`}
    >
      {label}
    </span>
  )
}

// ── The list ────────────────────────────────────────────────────────────────
export default function CallsPanel({ committee }) {
  const calls = useCommitteeCalls(committee.slug, committee.id)
  const mutations = useCallMutations(committee.slug, committee.id)
  const [view, setView] = useState({ mode: 'list' }) // list | edit | applications
  const [confirming, setConfirming] = useState('') // id pending delete confirm
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('') // last failed status/remove

  const rows = calls.data || []

  const changeStatus = async (id, status) => {
    setBusyId(id)
    setActionError('')
    try {
      await mutations.status.mutateAsync({ id, status })
    } catch (e) {
      setActionError(e?.message || 'Could not update that call.')
    } finally {
      setBusyId('')
    }
  }

  const remove = async (id) => {
    setBusyId(id)
    setActionError('')
    try {
      await mutations.remove.mutateAsync(id)
    } catch (e) {
      setActionError(e?.message || 'Could not remove that call.')
    } finally {
      setConfirming('')
      setBusyId('')
    }
  }

  if (view.mode === 'edit') {
    return (
      <CallEditor
        committee={committee}
        call={view.call}
        onDone={() => setView({ mode: 'list' })}
        onCancel={() => setView({ mode: 'list' })}
      />
    )
  }

  if (view.mode === 'applications') {
    return <ApplicationsList call={view.call} onBack={() => setView({ mode: 'list' })} />
  }

  const loadError = calls.error?.message || ''

  return (
    <div className="space-y-8">
      <Section
        label="Open calls"
        hint={`Recruitment calls for ${committee.abbr}. Open ones show in an “Open Calls” section on your committee page.`}
      >
        {!loadError && (
          <button
            type="button"
            onClick={() => setView({ mode: 'edit', call: null })}
            className={`${primaryBtnCls} px-5`}
          >
            + New call
          </button>
        )}

        {(loadError || actionError) && (
          <div className="mt-4">
            <ErrorText>{loadError || actionError}</ErrorText>
          </div>
        )}

        <div className="mt-6 space-y-4">
          {calls.isPending && <Spinner />}

          {!calls.isPending && rows.length === 0 && !loadError && (
            <p className="rounded-2xl border border-white/10 bg-forest-800 p-6 text-sm text-silver/60">
              No calls yet. Create one and it appears on{' '}
              <span className="text-white">the {committee.abbr} page</span> straight
              away.
            </p>
          )}

          {rows.map((call) => (
            <div
              key={call.id}
              className="rounded-2xl border border-white/10 bg-forest-800 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill call={call} />
                    {call.kind && (
                      <span className="text-[11px] uppercase tracking-[0.14em] text-silver/45">
                        {call.kind}
                      </span>
                    )}
                  </div>
                  <p className="heading-serif mt-2 text-xl text-white">
                    {call.title}
                  </p>
                  <p className="mt-1 text-xs text-silver/50">
                    {call.deadline
                      ? `Closes ${formatDeadline(call.deadline)}`
                      : 'No deadline'}
                    {' · '}
                    {call.positions?.length || 0} position
                    {(call.positions?.length || 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setView({ mode: 'applications', call })}
                  className={`shrink-0 ${outlineBtnCls}`}
                >
                  {call.applications} application
                  {call.applications === 1 ? '' : 's'}
                </button>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => setView({ mode: 'edit', call })}
                  className="text-xs font-semibold text-medical-light hover:text-white"
                >
                  Edit
                </button>

                {/* Close is the reversible one, so it leads. */}
                {call.status === 'open' ? (
                  <button
                    type="button"
                    disabled={busyId === call.id}
                    onClick={() => changeStatus(call.id, 'closed')}
                    className="text-xs font-semibold text-silver/70 hover:text-white disabled:opacity-40"
                  >
                    Close now
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === call.id}
                    onClick={() => changeStatus(call.id, 'open')}
                    className="text-xs font-semibold text-silver/70 hover:text-white disabled:opacity-40"
                  >
                    Reopen
                  </button>
                )}

                {confirming === call.id ? (
                  <span className="flex flex-wrap items-center gap-3 text-xs text-silver/60">
                    Remove this call? Applications already sent are kept.
                    <button
                      type="button"
                      disabled={busyId === call.id}
                      onClick={() => remove(call.id)}
                      className="font-semibold text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      Yes, remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming('')}
                      className="font-semibold text-silver/70 hover:text-white"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(call.id)}
                    className="text-xs font-semibold text-red-400/80 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}

                {call.effectiveStatus === 'expired' && (
                  <span className="text-xs text-silver/45">
                    Give it a later deadline to reopen it.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// ── Create / edit ───────────────────────────────────────────────────────────
function CallEditor({ committee, call, onDone, onCancel }) {
  const editing = Boolean(call)
  const { create, update } = useCallMutations(committee.slug, committee.id)
  const [title, setTitle] = useState(call?.title || '')
  const [kind, setKind] = useState(call?.kind || 'Small Working Group')
  const [summary, setSummary] = useState(call?.summary || '')
  const [description, setDescription] = useState(call?.description || '')
  const [commitment, setCommitment] = useState(call?.commitment || '')
  const [deadline, setDeadline] = useState(call?.deadline || '')
  const [notifyEmail, setNotifyEmail] = useState(call?.notify_email || '')
  const [status, setStatus] = useState(call?.status || 'open')
  // slots is free text in the form; coerce so an older row never trips .trim()
  const [positions, setPositions] = useState(() =>
    (call?.positions || []).map((p) => ({ ...p, slots: String(p.slots ?? '') })),
  )
  const [questions, setQuestions] = useState(() =>
    (call?.questions || []).map((q) => ({ ...q, options: [...(q.options || [])] })),
  )
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const addPosition = () =>
    setPositions((prev) =>
      prev.length >= MAX_POSITIONS
        ? prev
        : [...prev, { id: uid('p'), title: '', blurb: '', slots: '' }],
    )
  const updatePosition = (id, patch) =>
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const removePosition = (id) =>
    setPositions((prev) => prev.filter((p) => p.id !== id))

  const addQuestion = () =>
    setQuestions((prev) =>
      prev.length >= MAX_QUESTIONS
        ? prev
        : [...prev, { id: uid('q'), label: '', type: 'short', options: [], required: false }],
    )
  const updateQuestion = (id, patch) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  const removeQuestion = (id) =>
    setQuestions((prev) => prev.filter((q) => q.id !== id))

  const save = async () => {
    if (!title.trim()) {
      setMsg('Give the call a title first.')
      return
    }
    setBusy(true)
    setMsg('')
    const fields = {
      title: title.trim(),
      kind: kind.trim(),
      summary: summary.trim(),
      description: description.trim(),
      commitment: commitment.trim(),
      deadline,
      notify_email: notifyEmail.trim(),
      status,
      positions: positions
        .map((p) => ({
          id: p.id,
          title: p.title.trim(),
          blurb: (p.blurb || '').trim(),
          slots: (p.slots || '').trim(),
        }))
        .filter((p) => p.title),
      questions: questions
        .map((q) => ({
          id: q.id,
          label: q.label.trim(),
          type: q.type,
          options: (q.options || []).map((o) => o.trim()).filter(Boolean),
          required: Boolean(q.required),
        }))
        .filter((q) => q.label),
    }
    try {
      if (editing) await update.mutateAsync({ id: call.id, fields })
      else await create.mutateAsync(fields)
      onDone()
    } catch (e) {
      setMsg(e?.message || 'Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8 pb-28">
      <BackButton onClick={onCancel} />

      <Section
        label={editing ? 'Edit call' : 'New call'}
        hint={`This appears on the ${committee.abbr} page while it's open.`}
      >
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-xs text-silver/60">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. SWG on Medical Education Reform"
              className={inputCls}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-silver/60">Kind</label>
              <input
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                placeholder="Small Working Group · Campaign · Project"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-silver/60">
                Time commitment
              </label>
              <input
                value={commitment}
                onChange={(e) => setCommitment(e.target.value)}
                placeholder="e.g. ~4 hrs/week, Sept–Dec"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-silver/60">
              Short summary <span className="text-silver/40">(the card blurb)</span>
            </label>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One or two lines."
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-silver/60">
              Full description{' '}
              <span className="text-silver/40">(blank line between paragraphs)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className={`${inputCls} resize-y`}
            />
          </div>
        </div>
      </Section>

      <Section
        label="Deadline"
        hint="Leave blank for no deadline. Otherwise the call closes itself at the end of that day, so you don't have to remember to."
      >
        <div className="flex flex-wrap items-center gap-4">
          <input
            type="date"
            value={deadline}
            min={todayCairo()}
            onChange={(e) => setDeadline(e.target.value)}
            className={`${inputCls} max-w-[14rem] [color-scheme:dark]`}
          />
          {deadline && (
            <button
              type="button"
              onClick={() => setDeadline('')}
              className="text-xs font-semibold text-silver/60 hover:text-white"
            >
              Clear deadline
            </button>
          )}
        </div>
      </Section>

      <Section
        label="Positions"
        hint={`What people can apply for, up to ${MAX_POSITIONS}. Applicants may pick more than one. Leave empty for a general call.`}
      >
        <div className="space-y-4">
          {positions.map((p, i) => (
            <div
              key={p.id}
              className="space-y-3 rounded-2xl border border-white/10 bg-forest-800 p-4"
            >
              <div className="flex gap-3">
                <input
                  value={p.title}
                  onChange={(e) => updatePosition(p.id, { title: e.target.value })}
                  placeholder={`Position ${i + 1} title`}
                  className={smallInputCls}
                />
                <input
                  value={p.slots}
                  onChange={(e) => updatePosition(p.id, { slots: e.target.value })}
                  placeholder="e.g. 2 spots"
                  className={`${smallInputCls} max-w-[9rem]`}
                />
              </div>
              <input
                value={p.blurb}
                onChange={(e) => updatePosition(p.id, { blurb: e.target.value })}
                placeholder="One line on what they'd do (optional)"
                className={smallInputCls}
              />
              <button
                type="button"
                onClick={() => removePosition(p.id)}
                className="text-xs font-semibold text-red-400/80 hover:text-red-300"
              >
                Remove position
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addPosition}
            disabled={positions.length >= MAX_POSITIONS}
            className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {positions.length >= MAX_POSITIONS
              ? `Maximum ${MAX_POSITIONS} positions`
              : '+ Add position'}
          </button>
        </div>
      </Section>

      <Section
        label="Extra questions"
        hint={`Asked on the application form, after name/email and “why do you want to join?”, up to ${MAX_QUESTIONS}.`}
      >
        <div className="space-y-4">
          {questions.map((q, i) => (
            <div
              key={q.id}
              className="space-y-3 rounded-2xl border border-white/10 bg-forest-800 p-4"
            >
              <input
                value={q.label}
                onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                placeholder={`Question ${i + 1}`}
                className={smallInputCls}
              />
              <div className="flex flex-wrap items-center gap-4">
                <select
                  value={q.type}
                  onChange={(e) => updateQuestion(q.id, { type: e.target.value })}
                  className={`${smallInputCls} max-w-[11rem]`}
                >
                  <option value="short">Short answer</option>
                  <option value="long">Long answer</option>
                  <option value="select">Choose one</option>
                </select>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-silver/70">
                  <input
                    type="checkbox"
                    checked={Boolean(q.required)}
                    onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                    className="h-4 w-4 accent-medical"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => removeQuestion(q.id)}
                  className="ml-auto text-xs font-semibold text-red-400/80 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
              {q.type === 'select' && (
                <input
                  value={(q.options || []).join(', ')}
                  onChange={(e) =>
                    updateQuestion(q.id, { options: e.target.value.split(',') })
                  }
                  placeholder="Choices, separated by commas"
                  className={smallInputCls}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addQuestion}
            disabled={questions.length >= MAX_QUESTIONS}
            className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {questions.length >= MAX_QUESTIONS
              ? `Maximum ${MAX_QUESTIONS} questions`
              : '+ Add question'}
          </button>
        </div>
      </Section>

      {/* Application emails are not sent yet; the address is kept so switching
          them on later needs no re-entry. */}
      <Section
        label="Notifications"
        hint="Optional. Application emails aren’t sent yet; this address is saved for when they are."
      >
        <input
          type="email"
          value={notifyEmail}
          onChange={(e) => setNotifyEmail(e.target.value)}
          placeholder="Also notify (optional), e.g. a committee mailbox"
          className={inputCls}
        />
      </Section>

      <Section label="Visibility">
        <div className="flex flex-wrap gap-3">
          {[
            ['open', 'Open: visible, accepting applications'],
            ['draft', 'Draft: only you can see it'],
            ['closed', 'Closed: hidden from the page'],
          ].map(([value, label]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                status === value
                  ? 'border-medical bg-medical/10 text-white'
                  : 'border-white/15 text-silver/70 hover:border-white/30'
              }`}
            >
              <input
                type="radio"
                name="call-status"
                checked={status === value}
                onChange={() => setStatus(value)}
                className="h-4 w-4 accent-medical"
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-white/15 bg-forest-950/95 px-4 py-3 backdrop-blur-md">
        <div className="container-prose flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-silver/70">{msg}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className={primaryBtnCls}
            >
              {busy ? 'Saving…' : editing ? 'Save call' : 'Publish call'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Applications ────────────────────────────────────────────────────────────

// One application card with its own triage controls. Notes are drafted
// locally and only written on "Save notes", so typing never fires a request
// per keystroke; the status select saves immediately since it is one click.
function ApplicationRow({ app, onPatch }) {
  const [notes, setNotes] = useState(app.notes || '')
  const [busy, setBusy] = useState('') // 'status' | 'notes'
  const [error, setError] = useState('')

  const patch = async (what, body) => {
    setBusy(what)
    setError('')
    try {
      await onPatch(app.id, body)
    } catch (e) {
      setError(e?.message || 'Could not save that change.')
    } finally {
      setBusy('')
    }
  }

  const positions = Array.isArray(app.positions) ? app.positions : []
  const answers = Array.isArray(app.answers) ? app.answers : []
  const notesDirty = notes !== (app.notes || '')

  return (
    <article className="rounded-2xl border border-white/10 bg-forest-800 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-base font-semibold text-white">{app.name}</p>
        <p className="text-xs text-silver/45">
          {app.created_at ? new Date(app.created_at).toLocaleString() : ''}
          {app.ref && ` · ${app.ref}`}
        </p>
      </div>

      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-silver/60">
        <a href={`mailto:${app.email}`} className="text-medical-light hover:text-white">
          {app.email}
        </a>
        {app.phone && <span>{app.phone}</span>}
        {app.year && <span>{app.year}</span>}
      </p>

      {positions.length > 0 && (
        <p className="mt-3 text-sm text-silver/80">
          <span className="text-xs uppercase tracking-[0.16em] text-silver/45">
            Applied for:{' '}
          </span>
          {positions.join(', ')}
        </p>
      )}

      {app.motivation && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-silver/45">
            Why they want to join
          </p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-silver/80">
            {app.motivation}
          </p>
        </div>
      )}

      {answers.map((a, i) => (
        <div key={a.id || i} className="mt-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-silver/45">
            {a.label}
          </p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-silver/80">
            {a.value}
          </p>
        </div>
      ))}

      <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`status-${app.id}`} className="text-xs text-silver/60">
            Status
          </label>
          <select
            id={`status-${app.id}`}
            value={app.status || 'new'}
            disabled={Boolean(busy)}
            onChange={(e) => patch('status', { status: e.target.value })}
            className={`${smallInputCls} max-w-[11rem] disabled:opacity-40`}
          >
            {APPLICATION_STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {busy === 'status' && <span className="text-xs text-silver/50">Saving…</span>}
        </div>

        <div>
          <label htmlFor={`notes-${app.id}`} className="mb-1.5 block text-xs text-silver/60">
            Notes <span className="text-silver/40">(only officers see these)</span>
          </label>
          <textarea
            id={`notes-${app.id}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={`${smallInputCls} resize-y`}
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={Boolean(busy) || !notesDirty}
              onClick={() => patch('notes', { notes })}
              className={outlineBtnCls}
            >
              {busy === 'notes' ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
      </div>
    </article>
  )
}

// One export column per field of an application, the call's questions folded
// into one "Answers" block.
const APPLICATION_COLUMNS = [
  { label: 'Name', value: (a) => a.name },
  { label: 'Applied', value: (a) => when(a.created_at) },
  { label: 'Reference', value: (a) => a.ref },
  { label: 'Status', value: (a) => APPLICATION_STATUSES.find(([v]) => v === a.status)?.[1] || a.status },
  { label: 'Email', value: (a) => a.email },
  { label: 'Phone', value: (a) => a.phone },
  { label: 'Year', value: (a) => a.year },
  { label: 'Positions', value: (a) => (Array.isArray(a.positions) ? a.positions.join(', ') : '') },
  { label: 'Motivation', value: (a) => a.motivation },
  {
    label: 'Answers',
    value: (a) => (Array.isArray(a.answers) ? a.answers.map((x) => `${x.label}: ${x.value}`).join('\n') : ''),
  },
  { label: 'Notes', value: (a) => a.notes },
]

function ApplicationsList({ call, onBack }) {
  const applications = useApplications(call.id)
  const updateApplication = useUpdateApplication(call.id)
  const rows = applications.data || []
  const loadError = applications.error?.message || ''

  const onPatch = (id, patch) => updateApplication.mutateAsync({ id, patch })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackButton onClick={onBack} />
        <ExportButtons
          title={`Applications: ${call.title}`}
          subtitle="Everyone who applied to this call through the website, newest first."
          filename={`ausss-applications-${(call.title || 'call').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`}
          columns={APPLICATION_COLUMNS}
          rows={rows}
          layout="records"
        />
      </div>

      <Section label="Applications" hint={`${call.title}, newest first.`}>
        {applications.isPending && <Spinner />}
        <ErrorText>{loadError}</ErrorText>
        {!applications.isPending && !loadError && rows.length === 0 && (
          <p className="rounded-2xl border border-white/10 bg-forest-800 p-6 text-sm text-silver/60">
            Nobody has applied yet.
          </p>
        )}

        <div className="space-y-4">
          {rows.map((app) => (
            <ApplicationRow key={app.id} app={app} onPatch={onPatch} />
          ))}
        </div>
      </Section>
    </div>
  )
}
