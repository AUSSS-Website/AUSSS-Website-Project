import { useId, useState } from 'react'
import { submitSignup } from '../lib/signups.js'

// Reusable email-capture form for the recruitment waitlist and the newsletter.
// Variants:
//   layout="stacked": full card (name + email [+ phone]), used on /join
//   layout="inline": single email row, used in the footer/magazine
export default function SignupForm({
  kind,
  layout = 'stacked',
  withName = layout === 'stacked',
  withPhone = false,
  submitLabel = 'Notify me',
  successText = 'You’re on the list. We’ll be in touch.',
}) {
  const uid = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState('idle') // idle | busy | done | error
  const [error, setError] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Please enter your email.')
      return
    }
    setState('busy')
    setError('')
    const res = await submitSignup({ kind, name, email, phone })
    if (res.ok) {
      setState('done')
    } else {
      setState('error')
      setError(res.error || 'Something went wrong. Please try again.')
    }
  }

  if (state === 'done') {
    return (
      <p
        role="status"
        className="rounded-2xl border border-medical/30 bg-medical/10 px-5 py-4 text-center text-sm text-medical-light"
      >
        {successText}
      </p>
    )
  }

  const inputCls =
    'w-full rounded-xl border border-white/15 bg-forest-950 px-4 py-3 text-sm text-white placeholder:text-silver/40 focus-visible:border-medical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60'

  if (layout === 'inline') {
    return (
      <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <label htmlFor={`${uid}-email`} className="sr-only">
          Email address
        </label>
        <input
          id={`${uid}-email`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          aria-invalid={state === 'error'}
          aria-describedby={error ? `${uid}-error` : undefined}
          className={inputCls}
        />
        <button
          type="submit"
          disabled={state === 'busy'}
          className="shrink-0 rounded-full bg-medical px-5 py-3 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light disabled:opacity-50"
        >
          {state === 'busy' ? 'Sending…' : submitLabel}
        </button>
        {error && (
          <span id={`${uid}-error`} role="alert" className="text-xs text-red-300 sm:sr-only">
            {error}
          </span>
        )}
      </form>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-3 text-left">
      {withName && (
        <div>
          <label htmlFor={`${uid}-name`} className="sr-only">
            Your name
          </label>
          <input
            id={`${uid}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className={inputCls}
          />
        </div>
      )}
      <div>
        <label htmlFor={`${uid}-email2`} className="sr-only">
          Email address
        </label>
        <input
          id={`${uid}-email2`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          autoComplete="email"
          aria-invalid={state === 'error'}
          aria-describedby={error ? `${uid}-error2` : undefined}
          className={inputCls}
        />
      </div>
      {withPhone && (
        <div>
          <label htmlFor={`${uid}-phone`} className="sr-only">
            Phone (optional)
          </label>
          <input
            id={`${uid}-phone`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            autoComplete="tel"
            className={inputCls}
          />
        </div>
      )}
      {error && (
        <p id={`${uid}-error2`} role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'busy'}
        className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-colors hover:bg-silver-light disabled:opacity-50"
      >
        {state === 'busy' ? 'Sending…' : submitLabel}
      </button>
    </form>
  )
}
