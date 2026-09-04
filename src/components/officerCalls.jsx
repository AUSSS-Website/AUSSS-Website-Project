import { useCallback, useEffect, useState } from 'react'
import {
  callsBackendReady,
  fetchOfficerCalls,
  saveCall,
  setCallStatus,
  deleteCall,
  fetchApplications,
} from '../lib/calls.js'
import { formatDeadline } from '../hooks/useCalls.js'

// Officer-side Open Calls management, mounted as a tab in AccountPage.
//
// Three views, one file, same convention as committeeUi.jsx:
//   CallsPanel        list of this committee's calls (the entry point)
//   CallEditor        create / edit a call, its positions and its questions
//   ApplicationsList  who applied, and what they said
//
// Every write goes through src/lib/calls.js, which posts the token in the body
// and claims the reply, so nothing sensitive is ever in a URL.

const MAX_POSITIONS = 8
const MAX_QUESTIONS = 6

const inputCls =
  'w-full rounded-xl border border-white/15 bg-forest-900 px-4 py-2.5 text-sm text-white placeholder:text-silver/40 focus:border-medical focus:outline-none'

const smallInputCls =
  'w-full rounded-lg border border-white/15 bg-forest-950 px-3 py-2 text-sm text-white placeholder:text-silver/40 focus:border-medical focus:outline-none'

function uid(prefix) {
  try {
    return prefix + crypto.randomUUID().slice(0, 8)
  } catch {
    return prefix + Date.now().toString(36) + Math.round(Math.random() * 1e4)
  }
}

function todayISO() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function Panel({ label, hint, children }) {
  return (
    <section className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">
        {label}
      </p>
      {hint && <p className="mb-3 mt-1 text-xs text-silver/50">{hint}</p>}
      {!hint && <div className="mt-3" />}
      {children}
    </section>
  )
}

// One line of status for a call, spelling out *why* it isn't live.
function StatusPill({ call }) {
  const map = {
    open: ['Open', 'bg-medical/20 text-medical-light'],
    expired: ['Closed, deadline passed', 'bg-amber-400/15 text-amber-300'],
    closed: ['Closed by you', 'bg-white/10 text-silver/70'],
    draft: ['Draft, not visible', 'bg-white/10 text-silver/70'],
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
export function CallsPanel({ auth, committee, targetSlug }) {
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState({ mode: 'list' }) // list | edit | applications
  const [confirming, setConfirming] = useState('') // id pending delete confirm
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    // Ask the readable GET first, so an un-redeployed backend gets named
    // rather than silently timing out a POST that stores no claim.
    if (!(await callsBackendReady())) {
      setError(
        'Open Calls needs the officer backend redeployed before it can be used. Nothing else on this page is affected.',
      )
      setLoading(false)
      return
    }
    const res = await fetchOfficerCalls(auth.token, targetSlug)
    if (res.ok) {
      setCalls(res.calls || [])
      setError('')
    } else {
      setError(res.error || 'Could not load your calls.')
    }
    setLoading(false)
  }, [auth.token, targetSlug])

  useEffect(() => {
    load()
  }, [load])

  const changeStatus = async (id, status) => {
    setBusyId(id)
    const res = await setCallStatus(auth.token, id, status)
    if (!res.ok) setError(res.error || 'Could not update that call.')
    await load()
    setBusyId('')
  }

  const remove = async (id) => {
    setBusyId(id)
    const res = await deleteCall(auth.token, id)
    if (!res.ok) setError(res.error || 'Could not remove that call.')
    setConfirming('')
    await load()
    setBusyId('')
  }

  if (view.mode === 'edit') {
    return (
      <CallEditor
        auth={auth}
        committee={committee}
        targetSlug={targetSlug}
        call={view.call}
        onDone={async () => {
          setView({ mode: 'list' })
          await load()
        }}
        onCancel={() => setView({ mode: 'list' })}
      />
    )
  }

  if (view.mode === 'applications') {
    return (
      <ApplicationsList
        auth={auth}
        call={view.call}
        onBack={() => setView({ mode: 'list' })}
      />
    )
  }

  return (
    <div className="space-y-8">
      <Panel
        label="Open calls"
        hint={`Recruitment calls for ${committee.abbr}. Open ones show in an “Open Calls” section on your committee page.`}
      >
        {!error && (
          <button
            type="button"
            onClick={() => setView({ mode: 'edit', call: null })}
            className="rounded-full bg-medical px-5 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light"
          >
            + New call
          </button>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-4">
          {loading && <p className="text-sm text-silver/50">Loading…</p>}

          {!loading && calls.length === 0 && !error && (
            <p className="rounded-2xl border border-white/10 bg-forest-800 p-6 text-sm text-silver/60">
              No calls yet. Create one and it appears on{' '}
              <span className="text-white">the {committee.abbr} page</span> straight
              away.
            </p>
          )}

          {calls.map((call) => (
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
                  className="shrink-0 rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
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
      </Panel>
    </div>
  )
}

// ── Create / edit ───────────────────────────────────────────────────────────
export function CallEditor({ auth, committee, targetSlug, call, onDone, onCancel }) {
  const editing = Boolean(call)
  const [title, setTitle] = useState(call?.title || '')
  const [kind, setKind] = useState(call?.kind || 'Small Working Group')
  const [summary, setSummary] = useState(call?.summary || '')
  const [description, setDescription] = useState(call?.description || '')
  const [commitment, setCommitment] = useState(call?.commitment || '')
  const [deadline, setDeadline] = useState(call?.deadline || '')
  const [notifyEmail, setNotifyEmail] = useState(call?.notifyEmail || '')
  const [status, setStatus] = useState(call?.status || 'open')
  const [positions, setPositions] = useState(() =>
    (call?.positions || []).map((p) => ({ ...p })),
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
    const res = await saveCall(auth.token, {
      id: call?.id || '',
      slug: targetSlug,
      status,
      fields: {
        title: title.trim(),
        kind: kind.trim(),
        summary: summary.trim(),
        description: description.trim(),
        commitment: commitment.trim(),
        deadline,
        notifyEmail: notifyEmail.trim(),
        positions: positions
          .map((p) => ({
            id: p.id,
            title: p.title.trim(),
            blurb: p.blurb.trim(),
            slots: p.slots.trim(),
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
      },
    })
    setBusy(false)
    if (res.ok) onDone()
    else setMsg(res.error || 'Could not save. Try again.')
  }

  return (
    <div className="space-y-8 pb-28">
      <div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-silver/60 transition-colors hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to calls
        </button>
      </div>

      <Panel
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
      </Panel>

      <Panel
        label="Deadline"
        hint="Leave blank for no deadline. Otherwise the call closes itself at the end of that day, so you don't have to remember to."
      >
        <div className="flex flex-wrap items-center gap-4">
          <input
            type="date"
            value={deadline}
            min={todayISO()}
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
      </Panel>

      <Panel
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
      </Panel>

      <Panel
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
      </Panel>

      <Panel
        label="Notifications"
        hint="Every application emails you. Add another address to copy in a committee inbox."
      >
        <input
          type="email"
          value={notifyEmail}
          onChange={(e) => setNotifyEmail(e.target.value)}
          placeholder="Also notify (optional), e.g. scope@ausss.org"
          className={inputCls}
        />
      </Panel>

      <Panel label="Visibility">
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
      </Panel>

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
              className="rounded-full bg-medical px-6 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light disabled:opacity-40"
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
export function ApplicationsList({ auth, call, onBack }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetchApplications(auth.token, call.id).then((res) => {
      if (!alive) return
      if (res.ok) setRows(res.applications || [])
      else setError(res.error || 'Could not load applications.')
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [auth.token, call.id])

  return (
    <div className="space-y-8">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-silver/60 transition-colors hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to calls
        </button>
      </div>

      <Panel
        label="Applications"
        hint={`${call.title}, newest first. Every one of these also emailed you.`}
      >
        {loading && <p className="text-sm text-silver/50">Loading…</p>}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="rounded-2xl border border-white/10 bg-forest-800 p-6 text-sm text-silver/60">
            Nobody has applied yet.
          </p>
        )}

        <div className="space-y-4">
          {rows.map((r) => (
            <article
              key={r.ref || `${r.email}-${r.at}`}
              className="rounded-2xl border border-white/10 bg-forest-800 p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-base font-semibold text-white">{r.name}</p>
                <p className="text-xs text-silver/45">
                  {r.at ? new Date(r.at).toLocaleString() : ''}
                  {r.ref && ` · ${r.ref}`}
                </p>
              </div>

              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-silver/60">
                <a
                  href={`mailto:${r.email}`}
                  className="text-medical-light hover:text-white"
                >
                  {r.email}
                </a>
                {r.phone && <span>{r.phone}</span>}
                {r.year && <span>{r.year}</span>}
              </p>

              {r.positions && (
                <p className="mt-3 text-sm text-silver/80">
                  <span className="text-xs uppercase tracking-[0.16em] text-silver/45">
                    Applied for:{' '}
                  </span>
                  {r.positions}
                </p>
              )}

              {r.motivation && (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-silver/45">
                    Why they want to join
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-silver/80">
                    {r.motivation}
                  </p>
                </div>
              )}

              {Object.entries(r.answers || {}).map(([label, value]) => (
                <div key={label} className="mt-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-silver/45">
                    {label}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-silver/80">
                    {value}
                  </p>
                </div>
              ))}
            </article>
          ))}
        </div>
      </Panel>
    </div>
  )
}
