import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import { SIGN_IN_PATH } from './constants.js'
import NotificationBell from './NotificationBell.jsx'
import { Avatar } from './Avatar.jsx'
import { contentSchemas } from '../content/index.js'

// The portal's own chrome. It deliberately does not sit inside the public
// <Layout/> (navbar, footer) so signed-in pages stay quiet and the public
// shell never has to know about auth. The top bar keeps the public navbar's
// dimensions (height, logo, type, side padding), so moving between the site
// and the portal does not feel like changing product.

// One portal link, in the navbar's type, with its underline: full under the
// page you are on, growing on hover elsewhere.
function PortalLink({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className="group relative shrink-0 py-1 text-sm font-medium text-ink transition-colors 2xl:text-base"
    >
      {({ isActive }) => (
        <>
          {children}
          <span
            className={`absolute -bottom-0.5 left-0 h-px bg-medical transition-all duration-300 ${
              isActive ? 'w-full' : 'w-0 group-hover:w-full'
            }`}
          />
        </>
      )}
    </NavLink>
  )
}

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
  const { user, profile, isEB, isWebmaster, assignments, officerOf, signOut } = useAuth()
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
  // Site content: the EB edits every part; an officer sees the link when some
  // part names their committee.
  const canEditContent = isEB || contentSchemas.some((s) => s.editors.some((slug) => officerOf(slug)))
  const navigate = useNavigate()
  const { pathname } = useLocation()
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
      canEditContent && { to: '/portal/content', label: 'Site content' },
      canTriage && { to: '/portal/submissions', label: 'Submissions' },
    ],
    [
      isEB && { to: '/portal/admin/roster', label: 'Roster' },
      isEB && { to: '/portal/admin/verification', label: 'Verification' },
      isEB && { to: '/portal/admin/settings', label: 'Site settings' },
      isWebmaster && { to: '/portal/admin/audit', label: 'Audit log' },
    ],
  ]
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length > 0)

  // On a phone the links sit on one line that scrolls sideways; bring the
  // current page's link into view so it is never off screen.
  const linksRef = useRef(null)
  useEffect(() => {
    const row = linksRef.current
    const current = row?.querySelector('[aria-current="page"]')
    if (!row || !current) return
    const target = current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2
    row.scrollLeft = Math.max(0, target)
  }, [pathname])

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
  const logoCls = 'h-14 w-auto sm:h-16 2xl:h-[4.5rem]'

  return (
    <div className="min-h-screen bg-page text-soft">
      <header className="border-b border-line/10 bg-page">
        {/* The bar: full width with the navbar's height and side padding. */}
        <div className="flex h-24 w-full items-center justify-between gap-3 px-6 sm:px-10 lg:px-16 min-[1920px]:px-24">
          <Link to="/portal" className="flex min-w-0 items-center gap-4" aria-label="Portal home">
            <img
              src="/assets/brand/ausss-icon-black.png"
              alt="AUSSS"
              decoding="async"
              className={`${logoCls} dark:hidden`}
            />
            <img
              src="/assets/brand/ausss-icon-white.png"
              alt=""
              aria-hidden="true"
              decoding="async"
              className={`${logoCls} hidden dark:block`}
            />
            <span className="hidden text-xs font-semibold uppercase tracking-[0.22em] text-soft/60 sm:inline 2xl:text-sm">
              Members portal
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <NotificationBell />
            <ThemeToggle />
            <NavLink
              to="/portal/profile"
              title="Your profile"
              aria-label="Your profile"
              className={({ isActive }) =>
                `flex min-w-0 items-center gap-2.5 rounded-full text-sm font-medium transition-colors 2xl:text-base ${
                  isActive ? 'text-ink' : 'text-soft/80 hover:text-ink'
                }`
              }
            >
              <Avatar name={name} src={profile?.avatar_url} size="nav" />
              {name && <span className="hidden max-w-[12rem] truncate lg:inline">{name}</span>}
            </NavLink>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              className="hidden rounded-full border border-line/20 px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-veil/10 disabled:opacity-40 sm:block 2xl:px-6 2xl:py-2.5 2xl:text-base"
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
            {/* A phone has no room for the words: the same action as a round
                button the size of the others. */}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              aria-label="Sign out"
              title="Sign out"
              className="grid h-10 w-10 place-items-center rounded-full border border-line/20 text-soft/80 transition-colors hover:bg-veil/10 hover:text-ink disabled:opacity-40 sm:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* The links, in the order people work: everyone's pages, then the
            editing pages a person's positions give them, then the EB's admin
            pages. They have a row of their own, so the bell, profile and sign
            out stay at the top right however many links a person has. On a
            phone the row is one line that scrolls sideways (its right edge
            fades to show there is more); from a tablet up it wraps. */}
        <nav aria-label="Portal" className="border-t border-line/10">
          <div
            ref={linksRef}
            className="flex items-center gap-x-6 overflow-x-auto whitespace-nowrap px-6 py-4 [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:px-10 md:flex-wrap md:gap-y-3 md:overflow-visible lg:gap-x-7 lg:px-16 xl:gap-x-8 2xl:gap-x-10 min-[1920px]:px-24 [&::-webkit-scrollbar]:hidden"
          >
            {groups.map((group, i) => (
              <div
                key={group[0].to}
                className={`flex items-center gap-x-6 md:flex-wrap md:gap-y-3 lg:gap-x-7 xl:gap-x-8 2xl:gap-x-10 ${
                  i > 0 ? 'border-l border-line/15 pl-6 lg:pl-7 xl:pl-8 2xl:pl-10' : ''
                }`}
              >
                {group.map((item) => (
                  <PortalLink key={item.to} to={item.to} end={item.end}>
                    {item.label}
                  </PortalLink>
                ))}
              </div>
            ))}
            {/* Room past the last link, so the fade never sits on it. */}
            <span className="w-6 shrink-0 md:hidden" aria-hidden="true" />
          </div>
        </nav>
      </header>

      <main className="container-prose pb-24 pt-10 sm:pt-14">
        <Outlet />
      </main>

      <footer className="container-prose border-t border-line/10 py-6 text-xs text-soft/40">
        <Link to="/" className="transition-colors hover:text-ink">
          &larr; Back to ausss-ainshams.org
        </Link>
      </footer>
    </div>
  )
}
