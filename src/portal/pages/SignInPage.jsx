import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import Button from '../../components/ui/Button.jsx'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { safeNext } from '../constants.js'
import {
  AuthCard,
  BackLink,
  Centered,
  ErrorText,
  Spinner,
  authInputCls,
} from '../portalUi.jsx'

// /portal/sign-in. Google is the primary path (works the moment the OAuth
// client exists); the magic link needs custom SMTP before members can use
// it, so it sits second. Both land on /portal/callback.

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.7-5.5 3.7-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.5C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12Z"
      />
    </svg>
  )
}

export default function SignInPage() {
  usePageTitle('Members portal sign-in')
  const { loading, session, signInWithGoogle, signInWithMagicLink } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState('') // '' | 'google' | 'email'
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(params.get('error') || '')

  if (loading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  if (session) return <Navigate to={next} replace />

  const google = async () => {
    setBusy('google')
    setError('')
    try {
      await signInWithGoogle(next)
      // The browser is now leaving for Google; nothing else to do.
    } catch (e) {
      setError(e?.message || 'Google sign-in failed. Try again.')
      setBusy('')
    }
  }

  const magic = async (e) => {
    e.preventDefault()
    const addr = email.trim()
    if (!addr) return
    setBusy('email')
    setError('')
    try {
      await signInWithMagicLink(addr, next)
      setSent(true)
    } catch (err) {
      setError(err?.message || 'Could not send the link. Try again in a minute.')
    } finally {
      setBusy('')
    }
  }

  return (
    <AuthCard
      eyebrow="Members"
      title="Sign in to the portal"
      subtitle="Your membership, positions and details, in one place."
    >
      {sent ? (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center">
          <p className="text-sm font-semibold text-white">Check your inbox</p>
          <p className="mt-1 text-sm text-silver/70">
            We sent a sign-in link to <span className="text-white">{email.trim()}</span>.
            It works on any device and expires in an hour.
          </p>
          <button
            type="button"
            onClick={() => {
              setSent(false)
              setError('')
            }}
            className="mt-3 text-xs font-semibold text-medical-light hover:text-white"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="primary"
            className="mt-6 w-full"
            onClick={google}
            disabled={Boolean(busy)}
          >
            <GoogleMark />
            {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </Button>

          <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-silver/40">
            <span className="h-px flex-1 bg-white/10" />
            or
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={magic} className="space-y-3">
            <label htmlFor="portal-email" className="sr-only">
              Email
            </label>
            <input
              id="portal-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              aria-invalid={!!error}
              aria-describedby={error ? 'portal-signin-error' : undefined}
              className={authInputCls}
            />
            <ErrorText id="portal-signin-error">{error}</ErrorText>
            <button
              type="submit"
              disabled={Boolean(busy) || !email.trim()}
              className="w-full rounded-full bg-medical px-4 py-3 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light disabled:opacity-40"
            >
              {busy === 'email' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        </>
      )}

      <p className="mt-6 text-center text-xs text-silver/50">
        Officers: sign in here to edit your committee page and open calls.
      </p>
      <BackLink />
    </AuthCard>
  )
}
