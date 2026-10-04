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

// Google's "G" in its four standard colours, as the sign-in branding
// guidelines require (developers.google.com/identity/branding-guidelines):
// never one colour, never recoloured, on the light button (white fill,
// #747775 outline, #1F1F1F label).
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
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
            className="mt-6 w-full border border-[#747775] !font-medium !text-[#1F1F1F]"
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
