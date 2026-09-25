import { useId, useState } from 'react'
import { submitSignup } from '../lib/signups.js'

// The recruitment waitlist form on /join: name (optional) and email.
export default function SignupForm({
  submitLabel = 'Notify me',
  successText = 'You’re on the list. We’ll be in touch.',
}) {
  const uid = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot: hidden, stays blank for people
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
    const res = await submitSignup({ name, email, website })
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

  return (
    <form onSubmit={onSubmit} className="relative mx-auto flex w-full max-w-sm flex-col gap-3 text-left">
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
      <div>
        <label htmlFor={`${uid}-email`} className="sr-only">
          Email address
        </label>
        <input
          id={`${uid}-email`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          autoComplete="email"
          aria-invalid={state === 'error'}
          aria-describedby={error ? `${uid}-error` : undefined}
          className={inputCls}
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
        <p id={`${uid}-error`} role="alert" className="text-xs text-red-300">
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
