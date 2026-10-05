import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { SIGN_IN_PATH } from './constants.js'
import NotificationBell from './NotificationBell.jsx'
import { Avatar } from './Avatar.jsx'

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
  const { user, profile, isEB, assignments, officerOf, signOut } = useAuth()
  // Officers (and the EB) get the committee editor in the nav; members don't.
  const canEditCommittees =
    isEB || assignments.some((a) => a.position?.level === 'officer' && a.position?.committee)
  // The gallery belongs to PNSD (and the EB).
  const canEditGallery = officerOf('pnsd')
  // The magazine belongs to CBSD (and the EB).
  const canEditMagazine = officerOf('cbsd')
  // Submissions: the EB triages orders, stories and the waitlist; the exchange
  // officers (SCOPE, SCORE) see the stories.
  const canTriage = isEB || officerOf('scope') || officerOf('score')
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const groups = [
    [
      { to: '/portal', label: 'Dashboard', end: true },
      { to: '/portal/tasks', label: 'Tasks' },
      { to: '/portal/updates', label: 'Updates' },
      { to: '/portal/directory', label: 'Directory' },
    ],
    [
      canEditCommittees && { to: '/portal/committees', label: 'Committees' },
      canEditGallery && { to: '/portal/gallery', label: 'Gallery' },
      canEditMagazine && { to: '/portal/magazine', label: 'Magazine' },
      canTriage && { to: '/portal/submissions', label: 'Submissions' },
    ],
    [
      isEB && { to: '/portal/admin/roster', label: 'Roster' },
      isEB && { to: '/portal/admin/verification', label: 'Verification' },
      isEB && { to: '/portal/admin/settings', label: 'Site settings' },
    ],
  ]
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length > 0)

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

          {/* In the order people work: everyone's pages, then the editing pages a
              person's positions give them, then the EB's admin pages. They take
              the header's second row (order-3), so the bell, profile and sign
              out stay at the top right however many links a person has. */}
          <nav aria-label="Portal" className="order-3 flex w-full flex-wrap items-center gap-x-5 gap-y-2">
            {groups.map((group, i) => (
              <div
                key={group[0].to}
                className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${
                  i > 0 ? 'border-l border-white/15 pl-5' : ''
                }`}
              >
                {group.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navCls}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="order-2 flex items-center gap-3">
            <NotificationBell />
            <NavLink
              to="/portal/profile"
              title="Your profile"
              className={(state) => `${navCls(state)} flex min-w-0 items-center gap-2`}
            >
              <Avatar name={name} src={profile?.avatar_url} size="sm" />
              <span className="max-w-[11rem] truncate">
                {name ? (
                  <>
                    <span className="hidden md:inline">{name}</span>
                    <span className="md:hidden">Profile</span>
                  </>
                ) : (
                  'Profile'
                )}
              </span>
            </NavLink>
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
          &larr; Back to ausss-ainshams.org
        </Link>
      </footer>
    </div>
  )
}
