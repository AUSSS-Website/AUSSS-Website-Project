import { useCallback, useEffect, useRef, useState } from 'react'
import useFocusTrap from '../hooks/useFocusTrap.js'
import { readableAccent } from '../lib/color.js'
import { pressCls } from '../lib/motion.js'
import { submitApplication } from '../lib/calls.js'
import { formatDeadline } from '../hooks/useCalls.js'

// The application form for one Open Call, in a dialog.
//
// Form handling follows ShareStoryPage: one object in a single useState, a
// validate() that returns an errors map, and `noValidate` so our own messages
// show instead of the browser's. Questions are whatever the officer added to
// the call, rendered by type.
//
// A message sits under its field. It appears when the form is sent (the first
// field with one takes the focus, since the form is longer than a screen),
// under the email as soon as that is left with a slip in it, and it goes when
// its field is edited.

// What has been typed into each call's form and not sent, by call id. Closing
// the dialog (Escape, the cross, Cancel) loses nothing: opening the same call
// again brings it back, with a way to start afresh. It is held in memory and
// not in the browser's storage, and only for a while, because it is a name, an
// email and a phone number and the computer may be a shared one. Sending the
// application clears it.
const drafts = new Map()
const DRAFT_LIFE = 30 * 60 * 1000

function readDraft(id) {
  const draft = drafts.get(id)
  if (!draft) return null
  if (Date.now() - draft.at > DRAFT_LIFE) {
    drafts.delete(id)
    return null
  }
  return draft
}

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  year: '',
  motivation: '',
  website: '', // honeypot, real people never see this
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const without = (map, key) => {
  if (!(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

const inputBase =
  'w-full rounded-xl border bg-page px-4 py-3 text-sm text-ink placeholder:text-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60'

const inputClass = (error) =>
  `${inputBase} ${error ? 'border-danger/70' : 'border-line/15 focus-visible:border-medical'}`

// What ties a field to the message under it, for a screen reader.
const flagged = (id, error) =>
  error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : { 'aria-invalid': false }

const quietBtn = `inline-flex min-h-11 items-center justify-center rounded-full border border-line/20 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-veil/10 ${pressCls}`

function Field({ label, htmlFor, error, hint, required, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-soft/70"
      >
        {label}
        {required && <span className="text-accent"> *</span>}
      </label>
      {hint && <p className="mb-2 text-xs text-soft/45">{hint}</p>}
      {children}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export default function ApplyModal({ call, color, onClose }) {
  const accent = readableAccent(color)
  const positions = Array.isArray(call.positions) ? call.positions : []
  const questions = Array.isArray(call.questions) ? call.questions : []

  // The draft left by an earlier opening of this call, read once.
  const [kept] = useState(() => readDraft(call.id))
  const [form, setForm] = useState(() => kept?.form || EMPTY_FORM)
  // A position the officer has since removed is dropped from a kept draft,
  // and so is the answer to a question that is no longer asked: it has no
  // field to show in, and would count as something typed.
  const [chosen, setChosen] = useState(() =>
    (kept?.chosen || []).filter((id) => positions.some((p) => p.id === id)),
  )
  const [answers, setAnswers] = useState(() =>
    Object.fromEntries(
      Object.entries(kept?.answers || {}).filter(([id]) => questions.some((q) => String(q.id) === id)),
    ),
  )
  // Whether anything a person would mind losing has been typed or ticked.
  const dirty =
    chosen.length > 0 ||
    Object.entries(form).some(([key, value]) => key !== 'website' && value.trim()) ||
    Object.values(answers).some((value) => String(value || '').trim())
  const [errors, setErrors] = useState({})
  const [state, setState] = useState('idle') // idle | busy | done | error
  const [result, setResult] = useState(null)
  const [submitError, setSubmitError] = useState('')
  // The line above the form, there when the form opened with an earlier draft
  // in it (one with something left in it, once the positions and questions
  // that have gone are taken out):
  //   kept     the draft is in the form, beside "Start again"
  //   emptied  "Start again" has cleared the form; Undo puts the draft back
  //   passed   something new was typed after that, so there is nothing to offer
  // The line keeps its place when it has nothing left to say, so the fields
  // do not jump under the first key typed.
  const [note, setNote] = useState(kept && dirty ? 'kept' : '')
  const emptied = useRef(null)
  const doneRef = useRef(null)

  // The focus trap sets itself up again whenever it is handed a new function,
  // and each time it moves the focus back to the first control. The page
  // makes a new onClose on every render of its own, so the trap is given one
  // that never changes.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const close = useCallback(() => onCloseRef.current(), [])
  const ref = useFocusTrap(true, close)

  // The draft follows the form: kept while there is something in it, dropped
  // once it is empty. A sent application has dropped it already (onSubmit).
  useEffect(() => {
    if (state === 'done') return
    if (dirty) drafts.set(call.id, { form, chosen, answers, at: Date.now() })
    else drafts.delete(call.id)
  }, [call.id, dirty, form, chosen, answers, state])

  // A kept draft that has been deleted by hand is no longer "still here".
  useEffect(() => {
    if (!dirty) setNote((n) => (n === 'kept' ? 'passed' : n))
  }, [dirty])

  // Any edit: the last failed send is being answered, and the offer to undo
  // "Start again" has passed (taking it now would write over the new words).
  const edited = (key) => {
    setErrors((e) => without(e, key))
    setSubmitError('')
    setNote((n) => (n === 'emptied' ? 'passed' : n))
  }
  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    edited(key)
  }
  const setAnswer = (id, value) => {
    setAnswers((a) => ({ ...a, [id]: value }))
    edited(`q-${id}`)
  }
  const togglePosition = (id) => {
    setChosen((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
    edited('positions')
  }

  const startAgain = () => {
    emptied.current = { form, chosen, answers }
    setForm(EMPTY_FORM)
    setChosen([])
    setAnswers({})
    setErrors({})
    setSubmitError('')
    setNote('emptied')
  }
  const undoStartAgain = () => {
    setForm(emptied.current.form)
    setChosen(emptied.current.chosen)
    setAnswers(emptied.current.answers)
    setNote('kept')
  }

  // Lock the page behind the dialog while it's open.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // The Submit button goes with the form once the application is sent: the
  // focus moves to the confirmation, so it is read out and the keyboard (and
  // Escape) still work inside the dialog.
  useEffect(() => {
    if (state === 'done') doneRef.current?.focus()
  }, [state])

  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Please tell us your name.'
    if (!EMAIL.test(form.email.trim())) {
      next.email = 'Please enter a valid email address.'
    }
    if (!form.motivation.trim()) next.motivation = 'Please tell us why you want to join.'
    if (positions.length > 0 && chosen.length === 0) {
      next.positions = 'Choose at least one position.'
    }
    questions.forEach((q) => {
      if (q.required && !String(answers[q.id] || '').trim()) {
        next[`q-${q.id}`] = 'This one is required.'
      }
    })
    return next
  }

  // The first field with a message, in the order the form shows them.
  const focusFirst = (found) => {
    const key = ['name', 'email', 'positions', 'motivation', ...questions.map((q) => `q-${q.id}`)].find(
      (k) => found[k],
    )
    if (!key) return
    const el =
      key === 'positions'
        ? ref.current?.querySelector('#ac-positions input')
        : document.getElementById(`ac-${key}`)
    el?.focus()
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (state === 'busy') return
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      focusFirst(found)
      return
    }

    setState('busy')
    setSubmitError('')
    const res = await submitApplication({
      callId: call.id,
      positions: chosen,
      answers,
      name: form.name,
      email: form.email,
      phone: form.phone,
      year: form.year,
      motivation: form.motivation,
      website: form.website,
    })
    if (res.ok) {
      drafts.delete(call.id)
      setResult(res)
      setState('done')
    } else {
      setState('error')
      setSubmitError(res.error)
    }
  }

  return (
    <div
      className="enter-scrim fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-forest-950/85 p-4 backdrop-blur-sm reduce-transparency:backdrop-filter-none sm:p-6"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return
        // This layer scrolls, and its scrollbar is not "beside the dialog".
        if (e.clientX >= e.currentTarget.clientWidth) return
        // A click beside the dialog closes it only while the form is empty.
        // Once something is typed, a stray click must not take the form away
        // (the cross, Cancel and Escape still close it, and the draft is
        // kept), nor take the cursor out of the field: with the focus on the
        // page behind, Escape and Tab would stop working in here.
        if (dirty) e.preventDefault()
        else onClose()
      }}
    >
      {/* tabIndex: a click on plain text in here leaves the focus on the
          dialog, where the focus trap still hears the keyboard. */}
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-title"
        tabIndex={-1}
        className="enter-panel my-8 w-full max-w-2xl rounded-3xl border border-line/15 bg-sunk shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/10 p-6 sm:p-8">
          <div className="min-w-0">
            <p
              className="text-2xs font-semibold uppercase tracking-[0.2em]"
              style={{ color: accent }}
            >
              Applying for
            </p>
            <h2 id="apply-title" className="heading-serif mt-2 text-2xl text-ink">
              {call.title}
            </h2>
            {call.deadline && (
              <p className="mt-1 text-xs text-soft/50">
                Applications close {formatDeadline(call.deadline)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line/15 text-soft/70 hover:bg-veil/10 hover:text-ink ${pressCls}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {state === 'done' ? (
          <div className="p-6 text-center sm:p-10">
            <p ref={doneRef} tabIndex={-1} className="heading-serif text-2xl text-ink focus:outline-none">
              Application sent
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-soft/75">
              Thanks. The {call.title} team has been notified and will get back to
              you by email.
            </p>
            {result?.ref && (
              <p className="mt-4 text-xs uppercase tracking-[0.18em] text-soft/45">
                Reference {result.ref}
              </p>
            )}
            <button type="button" onClick={onClose} className={`mt-8 ${quietBtn}`}>
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-6 p-6 sm:p-8">
            {note && (
              <div className="flex min-h-11 items-center justify-between gap-x-4">
                <p id="ac-note" role="status" className="min-w-0 text-xs text-soft/70">
                  {note === 'kept' && 'What you typed earlier is still here.'}
                  {note === 'emptied' && 'The form is empty again.'}
                </p>
                {/* One button for both, in one place and of one size, so the
                    focus stays on it as it changes and a second tap lands on
                    Undo. It is described by the line beside it: a status line
                    that is already there when the dialog opens is not read
                    out, and this way it is heard on reaching the button. */}
                {note !== 'passed' && (
                  <button
                    type="button"
                    onClick={note === 'emptied' ? undoStartAgain : startAgain}
                    aria-describedby="ac-note"
                    className={`inline-flex min-h-11 min-w-[5.5rem] shrink-0 items-center justify-end whitespace-nowrap text-xs font-semibold text-accent underline-offset-2 hover:text-ink hover:underline ${pressCls}`}
                  >
                    {note === 'emptied' ? 'Undo' : 'Start again'}
                  </button>
                )}
              </div>
            )}

            <fieldset className="space-y-4">
              <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                About you
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="ac-name" error={errors.name} required>
                  <input
                    id="ac-name"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    autoComplete="name"
                    required
                    {...flagged('ac-name', errors.name)}
                    className={inputClass(errors.name)}
                  />
                </Field>
                <Field label="Email" htmlFor="ac-email" error={errors.email} required>
                  <input
                    id="ac-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    onBlur={() => {
                      // An empty field is not a slip until the form is sent.
                      const typed = form.email.trim()
                      if (typed && !EMAIL.test(typed)) {
                        setErrors((old) => ({ ...old, email: 'Please enter a valid email address.' }))
                      }
                    }}
                    autoComplete="email"
                    required
                    {...flagged('ac-email', errors.email)}
                    className={inputClass(errors.email)}
                  />
                </Field>
                <Field label="Phone" htmlFor="ac-phone">
                  <input
                    id="ac-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => update('phone', e.target.value)}
                    autoComplete="tel"
                    placeholder="Optional"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Academic year" htmlFor="ac-year">
                  <input
                    id="ac-year"
                    value={form.year}
                    onChange={(e) => update('year', e.target.value)}
                    placeholder="Optional, e.g. 3rd year"
                    className={inputClass()}
                  />
                </Field>
              </div>
            </fieldset>

            {positions.length > 0 && (
              <fieldset id="ac-positions" aria-describedby={errors.positions ? 'ac-positions-error' : undefined}>
                <legend className="mb-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-soft/70">
                  Position(s) you&rsquo;re applying for
                  <span className="text-accent"> *</span>
                </legend>
                <p className="mb-3 text-xs text-soft/45">Pick as many as you like.</p>
                <div className="space-y-2">
                  {positions.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-line/10 bg-page p-3.5 transition-colors hover:border-line/25"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(p.id)}
                        onChange={() => togglePosition(p.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-medical"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">
                          {p.title}
                          {p.slots && (
                            <span className="font-normal text-soft/50"> · {p.slots}</span>
                          )}
                        </span>
                        {p.blurb && (
                          <span className="mt-0.5 block text-xs leading-relaxed text-soft/60">
                            {p.blurb}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {errors.positions && (
                  <p id="ac-positions-error" role="alert" className="mt-1.5 text-xs text-danger">
                    {errors.positions}
                  </p>
                )}
              </fieldset>
            )}

            <Field
              label="Why do you want to join?"
              htmlFor="ac-motivation"
              error={errors.motivation}
              required
            >
              <textarea
                id="ac-motivation"
                rows={5}
                value={form.motivation}
                onChange={(e) => update('motivation', e.target.value)}
                placeholder="What draws you to this, and what would you bring to it?"
                required
                {...flagged('ac-motivation', errors.motivation)}
                className={`${inputClass(errors.motivation)} resize-y`}
              />
            </Field>

            {questions.length > 0 && (
              <fieldset className="space-y-4">
                <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                  A few more questions
                </legend>
                {questions.map((q) => {
                  const id = `ac-q-${q.id}`
                  const error = errors[`q-${q.id}`]
                  return (
                    <Field
                      key={q.id}
                      label={q.label}
                      htmlFor={id}
                      error={error}
                      required={q.required}
                    >
                      {q.type === 'long' ? (
                        <textarea
                          id={id}
                          rows={4}
                          value={answers[q.id] || ''}
                          onChange={(e) => setAnswer(q.id, e.target.value)}
                          required={Boolean(q.required)}
                          {...flagged(id, error)}
                          className={`${inputClass(error)} resize-y`}
                        />
                      ) : q.type === 'select' ? (
                        <select
                          id={id}
                          value={answers[q.id] || ''}
                          onChange={(e) => setAnswer(q.id, e.target.value)}
                          required={Boolean(q.required)}
                          {...flagged(id, error)}
                          className={inputClass(error)}
                        >
                          <option value="">Choose one…</option>
                          {(q.options || []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={id}
                          value={answers[q.id] || ''}
                          onChange={(e) => setAnswer(q.id, e.target.value)}
                          required={Boolean(q.required)}
                          {...flagged(id, error)}
                          className={inputClass(error)}
                        />
                      )}
                    </Field>
                  )
                })}
              </fieldset>
            )}

            {/* Honeypot. Hidden from people, irresistible to bots. */}
            <div aria-hidden="true" className="absolute h-px w-px overflow-hidden opacity-0">
              <label htmlFor="ac-website">Website</label>
              <input
                id="ac-website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              />
            </div>

            {submitError && (
              <p role="alert" className="text-sm text-danger">
                {submitError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line/10 pt-6">
              <button type="button" onClick={onClose} className={quietBtn}>
                Cancel
              </button>
              {/* Not `disabled` while sending: the browser takes the focus
                  away from a button that is switched off and leaves it on the
                  page behind, where the focus trap hears neither Tab nor
                  Escape, and a failed send would strand a keyboard there. It
                  says it is unavailable, and onSubmit ignores a second press. */}
              <button
                type="submit"
                aria-disabled={state === 'busy'}
                className="inline-flex min-h-11 items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-page transition-[opacity,transform] duration-150 ease-out hover:opacity-90 aria-disabled:pointer-events-none aria-disabled:opacity-50 motion-safe:active:scale-[0.97]"
                style={{ background: accent }}
              >
                {state === 'busy' && (
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-page/30 border-t-page"
                  />
                )}
                {state === 'busy' ? 'Sending…' : 'Submit application'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
