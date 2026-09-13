import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { SIGN_IN_PATH } from './constants.js'

// The portal's own dark chrome. It deliberately does not sit inside the
// public <Layout/> (navbar, footer, theme toggle) so signed-in pages stay
// quiet and the public shell never has to know about auth.

const navCls = ({ isActive }) =>
  `text-sm font-semibold transition-colors ${
    isActive ? 'text-white' : 'text-silver/60 hover:text-white'
  }`

function displayName(profile, user) {
  return (
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    ''
  )
}

export default function PortalLayout() {
  const { user, profile, isEB, signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const handleSignOut = async () => {
    setBusy(true)
    try {
      await signOut()
    } catch {
      // Local session is cleared even if the network call failed.
    }
    navigate(SIGN_IN_PATH, { replace: true })
  }

  const name = displayName(profile, user)

  return (
    <div className="min-h-screen bg-forest-950 text-silver">
      <header className="border-b border-white/10 bg-forest-950/95 backdrop-blur-md">
        <div className="container-prose flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
          <Link to="/portal" className="flex items-center gap-3" aria-label="Portal home">
            <img
              src="/assets/brand/ausss-horizontal-white.png"
              alt="AUSSS"
              decoding="async"
              className="h-10 w-auto"
            />
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.22em] text-silver/55 sm:inline">
              Members portal
            </span>
          </Link>

          <nav aria-label="Portal" className="flex items-center gap-5">
            <NavLink to="/portal" end className={navCls}>
              Dashboard
            </NavLink>
            <NavLink to="/portal/profile" className={navCls}>
              Profile
            </NavLink>
            {isEB && (
              <NavLink to="/portal/admin/verification" className={navCls}>
                Admin
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-4">
            {name && (
              <span className="hidden max-w-[14rem] truncate text-sm text-silver/70 md:inline">
                {name}
              </span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <main className="container-prose pb-24 pt-10 sm:pt-14">
        <Outlet />
      </main>

      <footer className="container-prose border-t border-white/10 py-6 text-xs text-silver/40">
        <Link to="/" className="transition-colors hover:text-white">
          &larr; Back to ausss.org
        </Link>
      </footer>
    </div>
  )
}
