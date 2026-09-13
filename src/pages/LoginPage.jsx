import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useOfficerAuth } from '../hooks/useOfficerAuth.js'
import usePageTitle from '../hooks/usePageTitle.js'

// Officer sign-in (/login). On success the token + committee slug land in
// sessionStorage and we route to /account. Styling mirrors the centered key
// gate in GalleryAdminPage.
export default function LoginPage() {
  usePageTitle('Officer login')
  const { login, liveEnabled } = useOfficerAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError('')
    const res = await login(email, password)
    setBusy(false)
    if (res.ok) navigate('/account')
    else setError(res.error || 'Login failed')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-forest-950 px-4">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-forest-900 p-8">
        <div className="text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Officers
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-4 text-2xl text-white">Officer login</h1>
          <p className="mt-2 text-sm text-silver/70">
            Sign in to edit your committee’s page.
          </p>
        </div>

        {!liveEnabled ? (
          <p className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center text-sm text-silver/60">
            The officer editor isn’t set up yet. Check back soon.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <label htmlFor="officer-email" className="sr-only">
              Email
            </label>
            <input
              id="officer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="username"
              autoFocus
              aria-invalid={!!error}
              className="w-full rounded-xl border border-white/15 bg-forest-950 px-4 py-3 text-white placeholder:text-silver/40 focus-visible:border-medical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60"
            />
            <label htmlFor="officer-password" className="sr-only">
              Password
            </label>
            <input
              id="officer-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              className="w-full rounded-xl border border-white/15 bg-forest-950 px-4 py-3 text-white placeholder:text-silver/40 focus-visible:border-medical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60"
            />
            {error && (
              <p id="login-error" role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !email.trim() || !password}
              className="w-full rounded-full bg-medical px-4 py-3 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light disabled:opacity-40"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-silver/50">
          Looking for the members portal?{' '}
          <Link to="/portal/sign-in" className="font-semibold text-silver/70 hover:text-white">
            Sign in here
          </Link>
        </p>

        <Link
          to="/"
          className="mt-4 inline-block w-full text-center text-xs font-semibold text-silver/60 transition-colors hover:text-white"
        >
          ← Back to AUSSS home
        </Link>
      </div>
    </div>
  )
}
