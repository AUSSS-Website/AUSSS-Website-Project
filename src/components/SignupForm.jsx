import { useEffect, useId, useRef, useState } from 'react'
import { submitSignup } from '../lib/signups.js'
import { pressCls } from '../lib/motion.js'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// What is wrong with the email as typed, or '' when it will do.
function emailProblem(value) {
  const typed = value.trim()
  if (!typed) return 'Please enter your email.'
  if (!EMAIL.test(typed)) return 'Please enter a valid email address.'
  return ''
}

// The recruitment waitlist form on /join: name (optional) and email.
//
// The form checks the email itself (`noValidate`), so the message is ours and
// looks the same in every browser: said under the field when it is left with
// a slip in it, again when the form is sent, and gone as soon as the field is
// edited.
export default function SignupForm({
  submitLabel = 'Notify me',
  successText = 'You’re on the list. We’ll be in touch.',
}) {
  const uid = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot: hidden, stays blank for people
  const [state, setState] = useState('idle') // idle | busy | done
  const [error, setError] = useState('')
  // True when `error` is about the email as typed, false when the list could
  // not be reached: only the first marks the field as wrong.
  const [invalid, setInvalid] = useState(false)
  const emailRef = useRef(null)
  const doneRef = useRef(null)

  // The button that had the focus is gone once the form is: hand the focus to
  // the confirmation, so it is read out and a keyboard keeps its place.
  useEffect(() => {
    if (state === 'done') doneRef.current?.focus()
  }, [state])

  const clearError = () => {
    if (!error) return
    setError('')
    setInvalid(false)
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (state === 'busy') return
    const problem = emailProblem(email)
    if (problem) {
      setError(problem)
      setInvalid(true)
      emailRef.current?.focus()
      return
    }
    setState('busy')
    setError('')
    setInvalid(false)
    const res = await submitSignup({ name, email, website })
    if (res.ok) {
      setState('done')
    } else {
      setState('idle')
      setError(res.error)
    }
  }

  if (state === 'done') {
    return (
      <p
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className="rounded-2xl border border-medical/30 bg-medical/10 px-5 py-4 text-center text-sm text-accent"
      >
        {successText}
      </p>
    )
  }

  const inputCls =
    'w-full rounded-xl border bg-page px-4 py-3 text-sm text-ink placeholder:text-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60'

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="relative mx-auto flex w-full max-w-sm flex-col gap-3 text-left"
    >
      <div>
        <label htmlFor={`${uid}-name`} className="sr-only">
          Your name
        </label>
        <input
          id={`${uid}-name`}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            // A failed send is answered by trying again, so its message goes
            // with any edit; a slip in the email stays until the email changes.
            if (!invalid) clearError()
          }}
          placeholder="Your name"
          autoComplete="name"
          className={`${inputCls} border-line/15 focus-visible:border-medical`}
        />
      </div>
      <div>
        <label htmlFor={`${uid}-email`} className="sr-only">
          Email address
        </label>
        <input
          ref={emailRef}
          id={`${uid}-email`}
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            clearError()
          }}
          onBlur={() => {
            // An empty field is not a slip until the form is sent.
            if (!email.trim()) return
            const problem = emailProblem(email)
            if (problem) {
              setError(problem)
              setInvalid(true)
            }
          }}
          placeholder="Email address"
          autoComplete="email"
          aria-invalid={invalid}
          aria-describedby={error ? `${uid}-error` : undefined}
          className={`${inputCls} ${invalid ? 'border-danger/70' : 'border-line/15 focus-visible:border-medical'}`}
        />
      </div>
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input
          id={`${uid}-website`}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      {error && (
        <p id={`${uid}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {/* Not `disabled` while sending: the browser takes the focus away from a
          button that is switched off and leaves it on the page itself, so
          after a failed send a keyboard would start again from the top of
          the page. It says it is unavailable, and onSubmit ignores a second
          press. */}
      <button
        type="submit"
        aria-disabled={state === 'busy'}
        className={`min-h-11 rounded-full bg-solid px-6 py-3 text-sm font-semibold text-on-solid hover:bg-solid-hover aria-disabled:pointer-events-none aria-disabled:opacity-50 ${pressCls}`}
      >
        {state === 'busy' ? 'Sending…' : submitLabel}
      </button>
    </form>
  )
}
