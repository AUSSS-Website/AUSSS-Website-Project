import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider.jsx'
import { Centered, Spinner } from '../portal/portalUi.jsx'
import { SIGN_IN_PATH } from '../portal/constants.js'

// Route guards. Signed-out visitors go to sign-in with ?next= so a deep link
// (/portal/profile from an email) lands where it was aimed after auth.

export function RequireAuth({ children }) {
  const { loading, session } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`${SIGN_IN_PATH}?next=${next}`} replace />
  }
  return children
}

// EB or webmaster only. Wraps RequireAuth so it can be used on its own.
export function RequireEB({ children }) {
  return (
    <RequireAuth>
      <EBGate>{children}</EBGate>
    </RequireAuth>
  )
}

function EBGate({ children }) {
  const { isEB } = useAuth()
  if (isEB) return children
  return (
    <Centered>
      <div className="max-w-sm">
        <p className="text-sm text-silver/70">
          This page is for the Executive Board. If you think you should have
          access, ask the webmaster to check your assignment for this term.
        </p>
        <Link
          to="/portal"
          className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white"
        >
          &larr; Back to your dashboard
        </Link>
      </div>
    </Centered>
  )
}
