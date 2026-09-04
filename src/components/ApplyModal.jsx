import { useEffect, useState } from 'react'
import useFocusTrap from '../hooks/useFocusTrap.js'
import { readableAccent } from '../lib/color.js'
import { submitApplication } from '../lib/calls.js'
import { formatDeadline } from '../hooks/useCalls.js'

// The application form for one Open Call, in a dialog.
//
// Form handling follows ShareStoryPage: one object in a single useState, a
// validate() that returns an errors map, and `noValidate` so our own messages
// show instead of the browser's. Questions are whatever the officer added to
// the call, rendered by type.

const inputBase =
  'w-full rounded-xl border bg-forest-950 px-4 py-2.5 text-sm text-white placeholder:text-silver/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60'

const inputClass = (error) =>
  `${inputBase} ${error ? 'border-red-400/70' : 'border-white/15 focus-visible:border-medical'}`

function Field({ label, htmlFor, error, hint, required, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-silver/70"
      >
        {label}
        {required && <span className="text-medical-light"> *</span>}
      </label>
      {hint && <p className="mb-2 text-xs text-silver/45">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-300">
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

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    year: '',
    motivation: '',
    website: '', // honeypot, real people never see this
  })
  const [chosen, setChosen] = useState([])
  const [answers, setAnswers] = useState({})
  const [errors, setErrors] = useState({})
  const [state, setState] = useState('idle') // idle | busy | done | error
  const [result, setResult] = useState(null)
  const [submitError, setSubmitError] = useState('')

  const ref = useFocusTrap(true, onClose)

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setAnswer = (id, value) => setAnswers((a) => ({ ...a, [id]: value }))
  const togglePosition = (id) =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))

  // Lock the page behind the dialog while it's open.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Please tell us your name.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
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

  const onSubmit = async (e) => {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

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
      setResult(res)
      setState('done')
    } else {
      setState('error')
      setSubmitError(res.error || 'Something went wrong. Please try again.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-forest-950/85 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-title"
        className="my-8 w-full max-w-2xl rounded-3xl border border-white/15 bg-forest-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-6 sm:p-8">
          <div className="min-w-0">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: accent }}
            >
              Applying for
            </p>
            <h2 id="apply-title" className="heading-serif mt-2 text-2xl text-white">
              {call.title}
            </h2>
            {call.deadline && (
              <p className="mt-1 text-xs text-silver/50">
                Applications close {formatDeadline(call.deadline)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-silver/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {state === 'done' ? (
          <div className="p-6 text-center sm:p-10">
            <p className="heading-serif text-2xl text-white">Application sent</p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-silver/75">
              Thanks. The {call.title} team has been notified and will get back to
              you by email.
            </p>
            {result?.ref && (
              <p className="mt-4 text-xs uppercase tracking-[0.18em] text-silver/45">
                Reference {result.ref}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-8 rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-6 p-6 sm:p-8">
            <fieldset className="space-y-4">
              <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">
                About you
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="ac-name" error={errors.name} required>
                  <input
                    id="ac-name"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    autoComplete="name"
                    aria-invalid={Boolean(errors.name)}
                    className={inputClass(errors.name)}
                  />
                </Field>
                <Field label="Email" htmlFor="ac-email" error={errors.email} required>
                  <input
                    id="ac-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    autoComplete="email"
                    aria-invalid={Boolean(errors.email)}
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
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-silver/70">
                  Position(s) you&rsquo;re applying for
                  <span className="text-medical-light"> *</span>
                </legend>
                <p className="mb-3 text-xs text-silver/45">Pick as many as you like.</p>
                <div className="space-y-2">
                  {positions.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-forest-950 p-3.5 transition-colors hover:border-white/25"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(p.id)}
                        onChange={() => togglePosition(p.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-medical"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-white">
                          {p.title}
                          {p.slots && (
                            <span className="font-normal text-silver/50"> · {p.slots}</span>
                          )}
                        </span>
                        {p.blurb && (
                          <span className="mt-0.5 block text-xs leading-relaxed text-silver/60">
                            {p.blurb}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {errors.positions && (
                  <p role="alert" className="mt-1.5 text-xs text-red-300">
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
                aria-invalid={Boolean(errors.motivation)}
                className={`${inputClass(errors.motivation)} resize-y`}
              />
            </Field>

            {questions.length > 0 && (
              <fieldset className="space-y-4">
                <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">
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
                          aria-invalid={Boolean(error)}
                          className={`${inputClass(error)} resize-y`}
                        />
                      ) : q.type === 'select' ? (
                        <select
                          id={id}
                          value={answers[q.id] || ''}
                          onChange={(e) => setAnswer(q.id, e.target.value)}
                          aria-invalid={Boolean(error)}
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
                          aria-invalid={Boolean(error)}
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
                onChange={(e) => update('website', e.target.value)}
              />
            </div>

            {submitError && (
              <p role="alert" className="text-sm text-red-300">
                {submitError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-6">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={state === 'busy'}
                className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-forest-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: accent }}
              >
                {state === 'busy' && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-forest-950/30 border-t-forest-950" />
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
