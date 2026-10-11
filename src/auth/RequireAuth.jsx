import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider.jsx'
import { Centered, Panel, Spinner } from '../portal/portalUi.jsx'
import { SIGN_IN_PATH } from '../portal/constants.js'

// Route guards. Signed-out visitors go to sign-in with ?next= so a deep link
// (/portal/profile from an email) lands where it was aimed after auth.

export function RequireAuth({ children }) {
  const { loading, session } = useAuth()
  const location = useLocation()
  // The session check has the whole screen: nothing of the portal is drawn
  // until it is known who is asking.
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

// The refusal is shown inside the portal layout, under its header, as the
// other pages word theirs (the merch shop, the gallery): a panel where the
// page would have begun, not a message half a screen down.
function EBGate({ children }) {
  const { isEB } = useAuth()
  if (isEB) return children
  return (
    <Panel>
      <p className="text-sm text-soft/70">
        This page is for the Executive Board. If you think you should have
        access, ask the webmaster to check your assignment for this term.
      </p>
      {/* It sits where the other refusals put theirs, a line under the words,
          with a finger's 44px of height round it: the margins take back what
          that adds above and below. */}
      <Link
        to="/portal"
        className="-mb-3 mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent transition-colors hover:text-ink"
      >
        &larr; Back to your dashboard
      </Link>
    </Panel>
  )
}
