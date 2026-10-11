import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { formatDeadline } from '../../../hooks/useCalls.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls, scrollBehavior } from '../../../lib/motion.js'
import {
  callProblems,
  todayCairo,
  useApplications,
  useCallMutations,
  useCommitteeCalls,
  useUpdateApplication,
} from '../../officerQueries.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  SaveStatus,
  Spinner,
  UndoLine,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
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
// Which view is open is in the address, beside the page's own ?tab=calls:
// ?call= names the call ("new" for one not saved yet) and ?view=applications
// opens its applications where the editor would be. A reload, and a link sent
// to another officer, open the same view.
//
// Every read and write goes through officerQueries.js; authorisation lives in
// the database (row-level security), so a failed write surfaces here as a
// thrown error with a message, never as a silently ignored save.

const MAX_POSITIONS = 8
const MAX_QUESTIONS = 6

// What ?call= holds while a call that is not saved yet is being written.
const NEW = 'new'

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

// A control that is one line of small text keeps a finger's 44px to land on:
// an unseen ::after reaches past the words, in px because the root size
// shrinks on a 320px phone. Nothing looks any different.
const tapCls =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[calc(100%+1rem)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
const linkBtnCls = `text-xs font-semibold transition-colors disabled:opacity-40 ${tapCls}`
// The same for a pill, which is some 30px high to the eye: the 44px are added
// above and below it only, so it reaches no further sideways than it looks.
const pillTapCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"
const addBtnCls = `rounded-full border border-line/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-veil/10 disabled:opacity-40 ${pressCls} ${pillTapCls}`

// The label of a field inside a card, where the fields are small and close.
const rowLabelCls = 'mb-1.5 block text-xs text-soft/60'

// The top of a view, where the focus is put when the view comes in. It is a
// place to carry on from with Tab and not a control, so it shows no ring.
const viewTopCls = 'outline-none'

// One part of a screen under a title in the panel title look: the list of
// calls, a group of the editor's fields. A part that is a single field hands
// over that field's id as `htmlFor`, and its title is then the field's label.
// `titleId` and `hintId` let what is inside point at the title and the hint.
function Section({ label, hint, htmlFor, titleId, hintId, children }) {
  return (
    <section className="mx-auto max-w-3xl">
      <h2 id={titleId} className={panelTitleCls}>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
      </h2>
      {hint ? (
        <p id={hintId} className="mb-3 mt-1 text-xs text-soft/50">
          {hint}
        </p>
      ) : (
        <div className="mt-3" />
      )}
      {children}
    </section>
  )
}

// The sentence under a field that has something wrong with it.
function Problem({ id, children }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-danger">
      {children}
    </p>
  )
}

// What ties a field to its label, to the sentence under it and to its hint,
// for a screen reader.
function fieldProps(id, problem, hintId) {
  const describedBy = [problem ? `${id}-problem` : '', hintId || ''].filter(Boolean).join(' ')
  return {
    id,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': describedBy || undefined,
  }
}

// A field with something wrong with it takes a red border over its own.
const fieldCls = (cls, problem) => (problem ? `${cls} !border-danger/70` : cls)

const backCls = `inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 transition-colors hover:text-ink ${tapCls}`

// `ask` is true while leaving would throw typed text away: the button then
// asks first, on itself, as every other discard in the portal does.
function BackButton({ onClick, ask = false }) {
  const face = (
    <>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back to calls
    </>
  )
  return (
    <div>
      {ask ? (
        <ConfirmButton variant="text" confirmLabel="Discard changes" onConfirm={onClick} className={backCls}>
          {face}
        </ConfirmButton>
      ) : (
        <button type="button" onClick={onClick} className={backCls}>
          {face}
        </button>
      )}
    </div>
  )
}

const cancelCls = `rounded-full border border-line/20 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-veil/10 ${pressCls} ${pillTapCls}`

// The editor's Cancel. `ask` is true while leaving would throw typed text
// away: the button then asks first, on itself. It is as wide as "Discard
// changes" from the start, asking or not. Left to grow when pressed, it pushed
// the save button along the bar, and on a screen some 430 to 480px wide a
// second tap in the same place landed on Save.
function CancelButton({ onClick, ask = false }) {
  if (ask) {
    return (
      <ConfirmButton
        label="Cancel"
        confirmLabel="Discard changes"
        onConfirm={onClick}
        className={cancelCls}
        keepWidth
      />
    )
  }
  return (
    <button type="button" onClick={onClick} className={cancelCls}>
      {/* The same one cell ConfirmButton lays its wordings in, so the button
          does not change width when the first key is typed. */}
      <span className="grid items-center justify-items-center text-center">
        <span className="col-start-1 row-start-1">Cancel</span>
        <span aria-hidden="true" className="invisible col-start-1 row-start-1">
          Discard changes
        </span>
      </span>
    </button>
  )
}

// One line of status for a call, spelling out *why* it isn't live.
function StatusPill({ call }) {
  const map = {
    open: ['Open', 'bg-medical/20 text-accent'],
    expired: ['Closed: deadline passed', 'bg-amber-400/15 text-warn'],
    closed: ['Closed by you', 'bg-veil/10 text-soft/90'],
    draft: ['Draft: not visible', 'bg-veil/10 text-soft/90'],
  }
  const [label, cls] = map[call.effectiveStatus] || map.draft
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-3xs font-bold uppercase tracking-[0.14em] ${cls}`}
    >
      {label}
    </span>
  )
}

// ── The list ────────────────────────────────────────────────────────────────
export default function CallsPanel({ committee }) {
  const calls = useCommitteeCalls(committee.slug, committee.id)
  const mutations = useCallMutations(committee.slug, committee.id)
  const rows = calls.data || []
  // The open view, read from the address. A call that is not in the list (not
  // loaded yet, or removed since the link was made) shows the list.
  const [callKey, setCallKey] = useTabParam([NEW, ...rows.map((r) => r.id)], '', 'call')
  const [view, setView] = useTabParam(['edit', 'applications'], 'edit', 'view')
  const [busyId, setBusyId] = useState('')
  // The last status change or removal that failed: { id, message }, shown on
  // the call it belongs to.
  const [failed, setFailed] = useState(null)

  // The button that swaps one view for another goes with the view it was in,
  // and the keyboard's place would go back to the top of the whole page. So
  // the view that comes in takes the focus at its own top, and when that top
  // is above the screen (a call far down the list was opened) it is brought
  // into sight. `arriving` holds the view a button has just asked for, until
  // the page shows it.
  const topRef = useRef(null)
  const arriving = useRef('')
  useEffect(() => {
    if (arriving.current !== `${callKey}|${view}`) return
    arriving.current = ''
    const top = topRef.current
    if (!top) return
    top.focus({ preventScroll: true })
    if (top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
  }, [callKey, view])

  const open = (id, what = 'edit') => {
    arriving.current = `${id}|${what}`
    setView(what)
    setCallKey(id)
  }
  const toList = () => {
    arriving.current = '|edit'
    setCallKey('')
    setView('edit')
  }

  const changeStatus = async (id, status) => {
    setBusyId(id)
    setFailed(null)
    try {
      await mutations.status.mutateAsync({ id, status })
    } catch (e) {
      setFailed({ id, message: errorText(e, 'Could not update that call.') })
    } finally {
      setBusyId('')
    }
  }

  const remove = async (id) => {
    setBusyId(id)
    setFailed(null)
    try {
      await mutations.remove.mutateAsync(id)
    } catch (e) {
      setFailed({ id, message: errorText(e, 'Could not remove that call.') })
    } finally {
      setBusyId('')
    }
  }

  const call = rows.find((r) => r.id === callKey) || null

  if (callKey === NEW || (call && view === 'edit')) {
    return (
      <CallEditor
        key={callKey}
        committee={committee}
        call={call}
        onDone={toList}
        onCancel={toList}
        topRef={topRef}
      />
    )
  }

  if (call && view === 'applications') {
    return <ApplicationsList key={call.id} call={call} onBack={toList} topRef={topRef} />
  }

  const loadError = calls.error ? errorText(calls.error, 'Could not load the calls.') : ''

  return (
    <div ref={topRef} tabIndex={-1} className={`space-y-8 ${viewTopCls}`}>
      <Section
        label="Open calls"
        hint={`Recruitment calls for ${committee.abbr}. Open ones show in an “Open Calls” section on your committee page.`}
      >
        {!loadError && (
          <button type="button" onClick={() => open(NEW)} className={`${primaryBtnCls} px-5 ${pillTapCls}`}>
            + New call
          </button>
        )}

        {loadError && (
          <div className="mt-4">
            <ErrorText>{loadError}</ErrorText>
          </div>
        )}

        <div className="mt-6">
          {calls.isPending && <Spinner />}

          {!calls.isPending && rows.length === 0 && !loadError && (
            <p className="rounded-2xl border border-line/10 bg-card p-6 text-sm text-soft/60">
              No calls yet. Create one and it appears on{' '}
              <span className="text-ink">the {committee.abbr} page</span> straight
              away.
            </p>
          )}

          <ul className="space-y-4">
            {rows.map((row) => (
              <li key={row.id} className="rounded-2xl border border-line/10 bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill call={row} />
                      {row.kind && (
                        <span className="text-2xs uppercase tracking-[0.14em] text-soft/45">
                          {row.kind}
                        </span>
                      )}
                    </div>
                    <p className="heading-serif mt-2 break-words text-xl text-ink">{row.title}</p>
                    <p className="mt-1 text-xs text-soft/50">
                      {row.deadline ? `Closes ${formatDeadline(row.deadline)}` : 'No deadline'}
                      {' · '}
                      {row.positions?.length || 0} position
                      {(row.positions?.length || 0) === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => open(row.id, 'applications')}
                    className={`shrink-0 ${outlineBtnCls} ${pillTapCls}`}
                  >
                    {row.applications} application
                    {row.applications === 1 ? '' : 's'}
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/10 pt-4">
                  <button
                    type="button"
                    onClick={() => open(row.id)}
                    className={`${linkBtnCls} text-accent hover:text-ink`}
                  >
                    Edit
                  </button>

                  {/* Close is the reversible one, so it leads. */}
                  {row.status === 'open' ? (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => changeStatus(row.id, 'closed')}
                      className={`${linkBtnCls} text-soft/70 hover:text-ink`}
                    >
                      Close now
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => changeStatus(row.id, 'open')}
                      className={`${linkBtnCls} text-soft/70 hover:text-ink`}
                    >
                      Reopen
                    </button>
                  )}

                  <ConfirmButton
                    variant="text"
                    label="Remove"
                    title="Applications already sent are kept."
                    disabled={busyId === row.id}
                    onConfirm={() => remove(row.id)}
                    className={`${linkBtnCls} text-soft/60 hover:text-ink`}
                  />

                  {row.effectiveStatus === 'expired' && (
                    <span className="text-xs text-soft/45">
                      Give it a later deadline to reopen it.
                    </span>
                  )}
                </div>

                {failed?.id === row.id && (
                  <div className="mt-3">
                    <ErrorText>{failed.message}</ErrorText>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </div>
  )
}

// ── Create / edit ───────────────────────────────────────────────────────────

// The editor's form for a call's row, or for a new call when there is none.
function formOf(call) {
  return {
    title: call?.title || '',
    kind: call?.kind || 'Small Working Group',
    summary: call?.summary || '',
    description: call?.description || '',
    commitment: call?.commitment || '',
    deadline: call?.deadline || '',
    notifyEmail: call?.notify_email || '',
    status: call?.status || 'open',
    // slots is free text in the form; coerce so an older row never trips .trim()
    positions: (call?.positions || []).map((p) => ({
      id: p.id,
      title: p.title || '',
      blurb: p.blurb || '',
      slots: String(p.slots ?? ''),
    })),
    // A question's choices stay the text that was typed, commas and all, and
    // become a list only when the call is saved: turned into a list and back
    // on every key, the text gained a space after each comma as it was typed.
    questions: (call?.questions || []).map((q) => ({
      id: q.id,
      label: q.label || '',
      type: q.type || 'short',
      choices: (q.options || []).join(', '),
      required: Boolean(q.required),
    })),
  }
}

const choicesOf = (text) =>
  text
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

// A row nobody has typed in can go without a way back.
const isBlankRow = (row) =>
  !['title', 'blurb', 'slots', 'label', 'choices'].some((k) => String(row[k] || '').trim())

function CallEditor({ committee, call, onDone, onCancel, topRef }) {
  const editing = Boolean(call)
  const { create, update } = useCallMutations(committee.slug, committee.id)
  const base = useId()
  const fid = (name) => `${base}-${name}`
  // The form as it opened. Typed text is whatever differs from it.
  const [initial] = useState(() => formOf(call))
  const [form, setForm] = useState(initial)
  const patch = (p) => setForm((prev) => ({ ...prev, ...p }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A sentence shows under a field once that field has been left, or once
  // Save has been pressed; it goes the moment the field is put right.
  const [touched, setTouched] = useState({})
  const [tried, setTried] = useState(false)
  // The last position or question removed, for one Undo:
  // { list: 'positions' | 'questions', row, index }.
  const [removed, setRemoved] = useState(null)

  const { title, kind, summary, description, commitment, deadline, notifyEmail, status, positions, questions } = form

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  useLeaveWarning(dirty)

  // Choices count only while the question is a "choose one": typed and then
  // hidden by a change of kind, they are not on screen to be put right.
  const problems = callProblems(
    {
      ...form,
      questions: questions.map((q) => ({ ...q, options: q.type === 'select' ? choicesOf(q.choices) : [] })),
    },
    { saved: call },
  )
  const touch = (key) => setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  const shown = (key) => (tried || touched[key] ? problems[key] || '' : '')

  const addRow = (list, max, row) => {
    if (form[list].length >= max) return
    patch({ [list]: [...form[list], row] })
    // The list may be full again, with no room for the row Undo would put back.
    if (removed?.list === list) setRemoved(null)
  }
  const updateRow = (list, id, p) =>
    setForm((prev) => ({ ...prev, [list]: prev[list].map((r) => (r.id === id ? { ...r, ...p } : r)) }))
  const removeRow = (list, id) => {
    const index = form[list].findIndex((r) => r.id === id)
    if (index < 0) return
    const row = form[list][index]
    // An empty row goes without a way back of its own, and it leaves the way
    // back to the row removed before it standing (one place up, if the empty
    // row stood above that one).
    if (!isBlankRow(row)) setRemoved({ list, row, index })
    else if (removed?.list === list && index < removed.index) setRemoved({ ...removed, index: removed.index - 1 })
    patch({ [list]: form[list].filter((r) => r.id !== id) })
  }
  // The Undo button goes with its line once it is pressed, and the keyboard's
  // place would go back to the top of the page with it. So the row that has
  // just been put back takes the focus, in its first field, once it is on the
  // page. `focusNext` holds that field's id until then.
  const focusNext = useRef('')
  useEffect(() => {
    if (!focusNext.current) return
    document.getElementById(focusNext.current)?.focus()
    focusNext.current = ''
  }, [positions, questions])
  const undoRemove = () => {
    if (!removed) return
    const { list, row, index } = removed
    const at = Math.min(index, form[list].length)
    setForm((prev) => {
      const next = [...prev[list]]
      next.splice(Math.min(index, next.length), 0, row)
      return { ...prev, [list]: next }
    })
    setRemoved(null)
    focusNext.current = fid(list === 'positions' ? `p${at}-title` : `q${at}-label`)
  }

  // Every field that can have something wrong with it, in the order the form
  // shows them, so Save can take the reader to the first one.
  const checks = [
    ['title', fid('title')],
    ['deadline', fid('deadline')],
    ...positions.map((p, i) => [`position:${p.id}`, fid(`p${i}-title`)]),
    ...questions.flatMap((q, i) => [
      [`question:${q.id}`, fid(`q${i}-label`)],
      [`options:${q.id}`, fid(`q${i}-choices`)],
    ]),
    ['notifyEmail', fid('notify')],
  ]
  const wrong = checks.filter(([key]) => problems[key])

  const save = async () => {
    setError('')
    if (wrong.length) {
      setTried(true)
      document.getElementById(wrong[0][1])?.focus()
      return
    }
    setBusy(true)
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
          blurb: p.blurb.trim(),
          slots: p.slots.trim(),
        }))
        .filter((p) => p.title),
      questions: questions
        .map((q) => ({
          id: q.id,
          label: q.label.trim(),
          type: q.type,
          options: choicesOf(q.choices),
          required: Boolean(q.required),
        }))
        .filter((q) => q.label),
    }
    try {
      if (editing) await update.mutateAsync({ id: call.id, fields })
      else await create.mutateAsync(fields)
      onDone()
    } catch (e) {
      setError(errorText(e, 'Could not save. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  // What Save will do, said on the button: a draft is saved, and only a call
  // that becomes visible with this save is published.
  const saveLabel =
    status === 'draft'
      ? 'Save draft'
      : status === 'open' && call?.status !== 'open'
        ? 'Publish call'
        : 'Save call'

  const blocked = tried && wrong.length > 0

  return (
    <div ref={topRef} tabIndex={-1} className={`space-y-8 pb-28 ${viewTopCls}`}>
      <BackButton onClick={onCancel} ask={dirty} />

      <Section
        label={editing ? 'Edit call' : 'New call'}
        hint={`This appears on the ${committee.abbr} page while it's open.`}
      >
        <div className="space-y-5">
          <Field label="Title" htmlFor={fid('title')}>
            <input
              {...fieldProps(fid('title'), shown('title'))}
              value={title}
              onChange={(e) => patch({ title: e.target.value })}
              onBlur={() => touch('title')}
              maxLength={140}
              placeholder="e.g. SWG on Medical Education Reform"
              className={fieldCls(inputCls, shown('title'))}
            />
            <Problem id={`${fid('title')}-problem`}>{shown('title')}</Problem>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
            <Field label="Kind" htmlFor={fid('kind')}>
              <input
                id={fid('kind')}
                value={kind}
                onChange={(e) => patch({ kind: e.target.value })}
                maxLength={60}
                placeholder="Small Working Group · Campaign · Project"
                className={inputCls}
              />
            </Field>
            <Field label="Time commitment" htmlFor={fid('commitment')}>
              <input
                id={fid('commitment')}
                value={commitment}
                onChange={(e) => patch({ commitment: e.target.value })}
                maxLength={140}
                placeholder="e.g. ~4 hrs/week, Sept–Dec"
                className={inputCls}
              />
            </Field>
          </div>
          <Field
            label={
              <>
                Short summary <span className="font-normal text-soft/55">(the card blurb)</span>
              </>
            }
            htmlFor={fid('summary')}
          >
            <input
              id={fid('summary')}
              value={summary}
              onChange={(e) => patch({ summary: e.target.value })}
              maxLength={300}
              placeholder="One or two lines."
              className={inputCls}
            />
          </Field>
          <Field
            label={
              <>
                Full description{' '}
                <span className="font-normal text-soft/55">(blank line between paragraphs)</span>
              </>
            }
            htmlFor={fid('description')}
          >
            <textarea
              id={fid('description')}
              value={description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={5}
              maxLength={4000}
              className={`${inputCls} resize-y`}
            />
          </Field>
        </div>
      </Section>

      <Section
        label="Deadline"
        htmlFor={fid('deadline')}
        hintId={fid('deadline-hint')}
        hint="Leave blank for no deadline. Otherwise the call closes itself at the end of that day, so you don't have to remember to."
      >
        <div className="flex flex-wrap items-center gap-4">
          {/* Like the other fields, it waits until it has been left. A year
              typed digit by digit is 0002 and then 0020 on its way to 2026,
              and "That day has passed" came and went under the typing. */}
          <input
            type="date"
            {...fieldProps(fid('deadline'), shown('deadline'), fid('deadline-hint'))}
            value={deadline}
            min={todayCairo()}
            onChange={(e) => patch({ deadline: e.target.value })}
            onBlur={() => touch('deadline')}
            className={fieldCls(`${inputCls} max-w-[14rem]`, shown('deadline'))}
          />
          {deadline && (
            <button
              type="button"
              onClick={() => patch({ deadline: '' })}
              className={`${linkBtnCls} text-soft/60 hover:text-ink`}
            >
              Clear deadline
            </button>
          )}
        </div>
        <Problem id={`${fid('deadline')}-problem`}>{shown('deadline')}</Problem>
      </Section>

      <Section
        label="Positions"
        hint={`What people can apply for, up to ${MAX_POSITIONS}. Applicants may pick more than one. Leave empty for a general call.`}
      >
        <div className="space-y-4">
          {positions.map((p, i) => {
            const key = `position:${p.id}`
            const pid = fid(`p${i}`)
            return (
              <div
                key={p.id}
                role="group"
                aria-label={`Position ${i + 1}`}
                onBlur={() => touch(key)}
                className="space-y-3 rounded-2xl border border-line/10 bg-card p-4"
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                  <div>
                    <label htmlFor={`${pid}-title`} className={rowLabelCls}>
                      Position {i + 1} title
                    </label>
                    <input
                      {...fieldProps(`${pid}-title`, shown(key))}
                      value={p.title}
                      onChange={(e) => updateRow('positions', p.id, { title: e.target.value })}
                      maxLength={120}
                      className={fieldCls(smallInputCls, shown(key))}
                    />
                    <Problem id={`${pid}-title-problem`}>{shown(key)}</Problem>
                  </div>
                  <div>
                    <label htmlFor={`${pid}-slots`} className={rowLabelCls}>
                      Spots
                    </label>
                    <input
                      id={`${pid}-slots`}
                      value={p.slots}
                      onChange={(e) => updateRow('positions', p.id, { slots: e.target.value })}
                      maxLength={40}
                      placeholder="e.g. 2 spots"
                      className={smallInputCls}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor={`${pid}-blurb`} className={rowLabelCls}>
                    What they’d do <span className="text-soft/40">(optional)</span>
                  </label>
                  <input
                    id={`${pid}-blurb`}
                    value={p.blurb}
                    onChange={(e) => updateRow('positions', p.id, { blurb: e.target.value })}
                    maxLength={400}
                    placeholder="One line"
                    className={smallInputCls}
                  />
                </div>
                {/* A little further down than the card's own spacing, so its
                    unseen 44px stops short of the field above. */}
                <button
                  type="button"
                  onClick={() => removeRow('positions', p.id)}
                  aria-label={`Remove position ${i + 1}`}
                  className={`${linkBtnCls} !mt-4 text-danger/80 hover:text-danger`}
                >
                  Remove position
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => addRow('positions', MAX_POSITIONS, { id: uid('p'), title: '', blurb: '', slots: '' })}
            disabled={positions.length >= MAX_POSITIONS}
            className={addBtnCls}
          >
            {positions.length >= MAX_POSITIONS
              ? `Maximum ${MAX_POSITIONS} positions`
              : '+ Add position'}
          </button>
        </div>
        {/* Far enough under the add button that the two do not share any of
            their unseen 44px. */}
        <UndoLine onUndo={undoRemove} className="mt-5 py-1">
          {removed?.list === 'positions' ? 'Position removed.' : null}
        </UndoLine>
      </Section>

      <Section
        label="Extra questions"
        hint={`Asked on the application form, after name/email and “why do you want to join?”, up to ${MAX_QUESTIONS}.`}
      >
        <div className="space-y-4">
          {questions.map((q, i) => {
            const labelKey = `question:${q.id}`
            const optionsKey = `options:${q.id}`
            const qid = fid(`q${i}`)
            return (
              <div
                key={q.id}
                role="group"
                aria-label={`Question ${i + 1}`}
                className="space-y-3 rounded-2xl border border-line/10 bg-card p-4"
              >
                <div>
                  <label htmlFor={`${qid}-label`} className={rowLabelCls}>
                    Question {i + 1}
                  </label>
                  <input
                    {...fieldProps(`${qid}-label`, shown(labelKey))}
                    value={q.label}
                    onChange={(e) => updateRow('questions', q.id, { label: e.target.value })}
                    onBlur={() => touch(labelKey)}
                    maxLength={200}
                    className={fieldCls(smallInputCls, shown(labelKey))}
                  />
                  <Problem id={`${qid}-label-problem`}>{shown(labelKey)}</Problem>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <select
                    value={q.type}
                    onChange={(e) => updateRow('questions', q.id, { type: e.target.value })}
                    aria-label={`Kind of answer to question ${i + 1}`}
                    className={`${smallInputCls} max-w-[11rem]`}
                  >
                    <option value="short">Short answer</option>
                    <option value="long">Long answer</option>
                    <option value="select">Choose one</option>
                  </select>
                  <CheckField
                    checked={q.required}
                    onChange={(required) => updateRow('questions', q.id, { required })}
                    label="Required"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow('questions', q.id)}
                    aria-label={`Remove question ${i + 1}`}
                    className={`${linkBtnCls} ml-auto text-danger/80 hover:text-danger`}
                  >
                    Remove
                  </button>
                </div>
                {q.type === 'select' && (
                  <div>
                    <label htmlFor={`${qid}-choices`} className={rowLabelCls}>
                      Choices
                    </label>
                    <input
                      {...fieldProps(`${qid}-choices`, shown(optionsKey))}
                      value={q.choices}
                      onChange={(e) => updateRow('questions', q.id, { choices: e.target.value })}
                      onBlur={() => {
                        touch(optionsKey)
                        touch(labelKey)
                      }}
                      placeholder="Choices, separated by commas"
                      className={fieldCls(smallInputCls, shown(optionsKey))}
                    />
                    <Problem id={`${qid}-choices-problem`}>{shown(optionsKey)}</Problem>
                  </div>
                )}
              </div>
            )
          })}
          <button
            type="button"
            onClick={() =>
              addRow('questions', MAX_QUESTIONS, { id: uid('q'), label: '', type: 'short', choices: '', required: false })
            }
            disabled={questions.length >= MAX_QUESTIONS}
            className={addBtnCls}
          >
            {questions.length >= MAX_QUESTIONS
              ? `Maximum ${MAX_QUESTIONS} questions`
              : '+ Add question'}
          </button>
        </div>
        <UndoLine onUndo={undoRemove} className="mt-5 py-1">
          {removed?.list === 'questions' ? 'Question removed.' : null}
        </UndoLine>
      </Section>

      {/* Application emails are not sent yet; the address is kept so switching
          them on later needs no re-entry. */}
      <Section
        label="Notifications"
        htmlFor={fid('notify')}
        hintId={fid('notify-hint')}
        hint="Optional. Application emails aren’t sent yet; this address is saved for when they are."
      >
        <input
          type="email"
          {...fieldProps(fid('notify'), shown('notifyEmail'), fid('notify-hint'))}
          value={notifyEmail}
          onChange={(e) => patch({ notifyEmail: e.target.value })}
          onBlur={() => touch('notifyEmail')}
          maxLength={200}
          autoComplete="off"
          placeholder="Also notify (optional), e.g. a committee mailbox"
          className={fieldCls(inputCls, shown('notifyEmail'))}
        />
        <Problem id={`${fid('notify')}-problem`}>{shown('notifyEmail')}</Problem>
      </Section>

      <Section label="Visibility" titleId={fid('visibility')}>
        <div role="radiogroup" aria-labelledby={fid('visibility')} className="flex flex-wrap gap-3">
          {[
            ['open', 'Open: visible, accepting applications'],
            ['draft', 'Draft: only you can see it'],
            ['closed', 'Closed: hidden from the page'],
          ].map(([value, label]) => (
            <label
              key={value}
              className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                status === value
                  ? 'border-medical bg-medical/10 text-ink'
                  : 'border-line/15 text-soft/70 hover:border-line/30'
              }`}
            >
              <input
                type="radio"
                name={fid('status')}
                checked={status === value}
                onChange={() => patch({ status: value })}
                className="h-4 w-4 accent-medical"
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      {/* Fixed save bar. The page hides this whole panel on the other tabs, so
          its bar is never on screen with the committee page's own. The bar
          has no side padding of its own: container-prose alone puts what is
          in it on the page's own column. */}
      <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-line/15 bg-page/95 py-3 backdrop-blur-md reduce-transparency:bg-page reduce-transparency:backdrop-filter-none">
        <div className="container-prose flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <ErrorText>
              {blocked
                ? wrong.length === 1
                  ? 'One thing needs fixing above before this can be saved.'
                  : `${wrong.length} things need fixing above before this can be saved.`
                : error}
            </ErrorText>
            <SaveStatus dirty={dirty && !blocked && !error} className="text-sm" />
          </div>
          {/* The row wraps where the two buttons do not fit side by side.
              Cancel keeps one width, so it wraps the same way before and
              after Cancel is pressed. */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <CancelButton onClick={onCancel} ask={dirty} />
            <button type="button" onClick={save} disabled={busy} className={`${primaryBtnCls} ${pillTapCls}`}>
              {busy ? 'Saving…' : saveLabel}
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
// `onUnsaved(id, true)` tells the list that this card holds notes not saved
// yet (typed, or still being written), and `onUnsaved(id, false)` that it no
// longer does.
function ApplicationRow({ app, onPatch, onUnsaved }) {
  const [notes, setNotes] = useState(app.notes || '')
  const [busy, setBusy] = useState('') // 'status' | 'notes'
  const [error, setError] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)

  const patch = async (what, body) => {
    setBusy(what)
    setError('')
    if (what === 'notes') setNotesSaved(false)
    try {
      await onPatch(app.id, body)
      if (what === 'notes') setNotesSaved(true)
    } catch (e) {
      setError(errorText(e, 'Could not save that change.'))
    } finally {
      setBusy('')
    }
  }

  const positions = Array.isArray(app.positions) ? app.positions : []
  const answers = Array.isArray(app.answers) ? app.answers : []
  const notesDirty = notes !== (app.notes || '')
  // Notes on their way to the database are not safe yet either: the list
  // shows them as saved from the moment Save is pressed, and a write that
  // then fails would be lost unseen if Back had already been let through.
  const notesAtRisk = notesDirty || busy === 'notes'

  useEffect(() => {
    onUnsaved(app.id, notesAtRisk)
  }, [onUnsaved, app.id, notesAtRisk])
  useEffect(() => () => onUnsaved(app.id, false), [onUnsaved, app.id])

  return (
    <li className="rounded-2xl border border-line/10 bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-base font-semibold text-ink">{app.name}</p>
        <p className="text-xs text-soft/45">
          {app.created_at ? when(app.created_at) : ''}
          {app.ref && ` · ${app.ref}`}
        </p>
      </div>

      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-soft/60">
        {/* One line of small text that a thumb has to find: the same unseen
            44px as the pills, above and below it. */}
        <a href={`mailto:${app.email}`} className={`break-all text-accent hover:text-ink ${pillTapCls}`}>
          {app.email}
        </a>
        {app.phone && <span>{app.phone}</span>}
        {app.year && <span>{app.year}</span>}
      </p>

      {positions.length > 0 && (
        <p className="mt-3 text-sm text-soft/80">
          <span className="text-xs uppercase tracking-[0.16em] text-soft/45">
            Applied for:{' '}
          </span>
          {positions.join(', ')}
        </p>
      )}

      {app.motivation && (
        <div className="mt-3">
          <p className="text-2xs uppercase tracking-[0.16em] text-soft/45">
            Why they want to join
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-soft/80">
            {app.motivation}
          </p>
        </div>
      )}

      {answers.map((a, i) => (
        <div key={a.id || i} className="mt-3">
          <p className="text-2xs uppercase tracking-[0.16em] text-soft/45">
            {a.label}
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-soft/80">
            {a.value}
          </p>
        </div>
      ))}

      <div className="mt-5 space-y-3 border-t border-line/10 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`status-${app.id}`} className="text-xs text-soft/60">
            Status
          </label>
          {/* Not dimmed while it saves: it already shows the new status, and
              "Saving…" beside it says the rest. */}
          <select
            id={`status-${app.id}`}
            value={app.status || 'new'}
            disabled={Boolean(busy)}
            onChange={(e) => patch('status', { status: e.target.value })}
            className={`${smallInputCls} max-w-[11rem]`}
          >
            {APPLICATION_STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span role="status" className="text-xs text-soft/50">
            {busy === 'status' ? 'Saving…' : ''}
          </span>
        </div>

        <div>
          <label htmlFor={`notes-${app.id}`} className="mb-1.5 block text-xs text-soft/60">
            Notes <span className="text-soft/40">(only officers see these)</span>
          </label>
          <textarea
            id={`notes-${app.id}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={4000}
            className={`${smallInputCls} resize-y`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={Boolean(busy) || !notesDirty}
              onClick={() => patch('notes', { notes })}
              className={`${outlineBtnCls} ${pillTapCls}`}
            >
              {busy === 'notes' ? 'Saving…' : 'Save notes'}
            </button>
            <SaveStatus dirty={notesDirty} saved={notesSaved} />
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
      </div>
    </li>
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

function ApplicationsList({ call, onBack, topRef }) {
  const applications = useApplications(call.id)
  const updateApplication = useUpdateApplication(call.id)
  const rows = applications.data || []
  const loadError = applications.error
    ? errorText(applications.error, 'Could not load the applications.')
    : ''
  // The applications whose notes have been typed and not saved. Going back
  // would lose them, so Back asks first while there are any.
  const [unsaved, setUnsaved] = useState([])
  const onUnsaved = useCallback(
    (id, on) =>
      setUnsaved((prev) =>
        prev.includes(id) === on ? prev : on ? [...prev, id] : prev.filter((x) => x !== id),
      ),
    [],
  )
  useLeaveWarning(unsaved.length > 0)

  const onPatch = (id, patch) => updateApplication.mutateAsync({ id, patch })

  return (
    <div ref={topRef} tabIndex={-1} className={`space-y-8 ${viewTopCls}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackButton onClick={onBack} ask={unsaved.length > 0} />
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
          <p className="rounded-2xl border border-line/10 bg-card p-6 text-sm text-soft/60">
            Nobody has applied yet.
          </p>
        )}

        <ul className="space-y-4">
          {rows.map((app) => (
            <ApplicationRow key={app.id} app={app} onPatch={onPatch} onUnsaved={onUnsaved} />
          ))}
        </ul>
      </Section>
    </div>
  )
}
