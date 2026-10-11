import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import { pressCls } from '../lib/motion.js'
import { SIGN_IN_PATH } from './constants.js'
import NotificationBell from './NotificationBell.jsx'
import { Avatar } from './Avatar.jsx'
import { contentSchemas } from '../content/index.js'

// The portal's own chrome. It deliberately does not sit inside the public
// <Layout/> (navbar, footer) so signed-in pages stay quiet and the public
// shell never has to know about auth. The top bar keeps the public navbar's
// dimensions (height, logo, type, side padding), so moving between the site
// and the portal does not feel like changing product. It steps up where that
// bar does (src/components/Navbar.jsx): the side padding widens at 1100px, and
// the larger type, pill and logo start at 1920px. Between 1024 and 1099px the
// bar therefore stands a little wider than the page under it, as it does on
// the public site.

// The header's controls are 40px to the eye and its links one line of text,
// and both are smaller still on a 320px phone, where the root size shrinks.
// Their ::after gives a finger 44px of height, in px for that reason, centred
// on the control, without changing how anything looks. A control gets the
// same 44px across when it is narrower than that; a link reaches half the gap
// to its neighbour on each side.
const tapBaseCls =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
const tapCls = `${tapBaseCls} after:w-full after:min-w-[44px]`

// One portal link, in the navbar's type. The page you are on is said three
// ways, so it cannot be missed in either theme: its link is in full ink and a
// weight heavier while the others are quieter, and a blue bar lies under it.
// Under the pointer a quieter link takes the ink and a fainter bar grows out
// from the left (it only fades in for a reader who asked for less motion).
// The bar is scaled, never resized, so nothing is laid out again as it moves.
const linkCls = `group grid shrink-0 justify-items-center py-1 text-sm min-[1920px]:text-base ${tapBaseCls} after:w-[calc(100%+1.5rem)]`

function linkFace(label, here) {
  return (
    <>
      {/* The label at its heaviest, unseen. It keeps the link as wide as it is
          on its own page, so the row does not shift when the page changes. */}
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-semibold">
        {label}
      </span>
      <span
        className={`col-start-1 row-start-1 transition-colors duration-150 ease-out ${
          here ? 'font-semibold text-ink' : 'font-medium text-soft/70 group-hover:text-ink'
        }`}
      >
        {label}
      </span>
      {/* Where the system forces its own colours a filled bar would vanish,
          so there it is given the system's colour for a link. */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 -bottom-0.5 h-0.5 origin-left rounded-full bg-accent transition-[transform,opacity] duration-200 ease-out forced-colors:bg-[color:LinkText] ${
          here ? '' : 'opacity-0 group-hover:opacity-40 motion-safe:scale-x-0 motion-safe:group-hover:scale-x-100'
        }`}
      />
    </>
  )
}

// `within` names pages that have no link of their own and are reached from
// this one (New term, from Site settings), so the link stays marked while
// someone is on them. There it is the current item of the menu but not the
// current page, and aria-current says which of the two it is.
//
// It is one plain link on every page, and asks the router's own matcher
// whether the address is its page or, unless `end`, a page under it. NavLink
// writes aria-current only on its own address, and a NavLink on some pages
// with a plain link on others would be a new element each time the two
// changed places: a link pressed with the keyboard would be taken away under
// it, and the next Tab would start from the top of the page.
function PortalLink({ to, end = false, within = [], children }) {
  const { pathname } = useLocation()
  const here = Boolean(matchPath({ path: to, end }, pathname))
  const inside = !here && within.some((p) => matchPath({ path: p, end: false }, pathname))
  return (
    <Link
      to={to}
      aria-current={here ? 'page' : inside ? 'true' : undefined}
      data-within={inside || undefined}
      className={linkCls}
    >
      {linkFace(children, here || inside)}
    </Link>
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
  // The exchange exam is set up, and its results read, by the same people.
  const canSetExam = isEB || officerOf('scope') || officerOf('score')
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
      canEditCommittees && { to: '/portal/events', label: 'Events' },
      canSetExam && { to: '/portal/exam', label: 'Exam' },
      canEditGallery && { to: '/portal/gallery', label: 'Gallery' },
      canEditMagazine && { to: '/portal/magazine', label: 'Magazine' },
      canEditContent && { to: '/portal/content', label: 'Site content' },
      isEB && { to: '/portal/merch', label: 'Merch' },
      canTriage && { to: '/portal/submissions', label: 'Submissions' },
    ],
    [
      isEB && { to: '/portal/admin/roster', label: 'Roster' },
      isEB && { to: '/portal/admin/verification', label: 'Verification' },
      // New term has no link here: it is a button on the Site settings page.
      isEB && { to: '/portal/admin/settings', label: 'Site settings', within: ['/portal/admin/rollover'] },
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
    const current = row?.querySelector('[aria-current="page"], [data-within]')
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
  const logoCls = 'h-14 w-auto sm:h-16 min-[1920px]:h-[4.5rem]'

  return (
    <div className="min-h-screen bg-page text-soft">
      {/* The same link, in the same words, as on the public site (Layout.jsx):
          a keyboard reaches the page without passing every link in the header. */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b border-line/10 bg-page">
        {/* The bar: full width with the navbar's height and side padding. */}
        <div className="flex h-24 w-full items-center justify-between gap-3 px-6 sm:px-10 min-[1100px]:px-16 min-[1920px]:px-24">
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
            <span className="hidden text-xs font-semibold uppercase tracking-[0.22em] text-soft/60 sm:inline min-[1920px]:text-sm">
              Members portal
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <NotificationBell />
            <ThemeToggle className={tapCls} />
            <NavLink
              to="/portal/profile"
              title="Your profile"
              aria-label="Your profile"
              className={({ isActive }) =>
                `flex min-w-0 items-center gap-2.5 rounded-full text-sm font-medium transition-colors min-[1920px]:text-base ${tapCls} ${
                  isActive ? 'text-ink' : 'text-soft/80 hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* On a phone the name is hidden and the photo is all there
                      is, so the profile page is marked on the photo: the same
                      blue as the bar under the current link, as a ring. */}
                  <span
                    className={`grid shrink-0 rounded-full transition-shadow duration-150 ease-out ${
                      isActive ? 'ring-2 ring-accent ring-offset-2 ring-offset-page' : ''
                    }`}
                  >
                    <Avatar name={name} src={profile?.avatar_url} size="nav" />
                  </span>
                  {name && <span className="hidden max-w-[12rem] truncate lg:inline">{name}</span>}
                </>
              )}
            </NavLink>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              className={`hidden rounded-full border border-line/20 px-5 py-2 text-sm font-semibold text-ink ${pressCls} ${tapCls} hover:bg-veil/10 [&:not(:disabled)]:active:bg-veil/20 disabled:opacity-40 sm:block min-[1920px]:px-6 min-[1920px]:py-2.5 min-[1920px]:text-base`}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
            {/* A phone has no room for the words: the same action as a round
                button the size of the others. Both take a fill while pressed,
                as the portal's pills do: a phone has no hover to show, and
                with reduced motion the button does not sink. */}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              aria-label="Sign out"
              title="Sign out"
              className={`grid h-10 w-10 place-items-center rounded-full border border-line/20 text-soft/80 ${pressCls} ${tapCls} hover:bg-veil/10 hover:text-ink [&:not(:disabled)]:active:bg-veil/20 [&:not(:disabled)]:active:text-ink disabled:opacity-40 sm:hidden`}
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
            fades to show there is more); from a tablet up it wraps, with
            enough between two lines that a finger on one link is not also on
            the link above it. */}
        <nav aria-label="Portal" className="border-t border-line/10">
          <div
            ref={linksRef}
            className="flex items-center gap-x-6 overflow-x-auto whitespace-nowrap px-6 py-4 [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:px-10 md:flex-wrap md:gap-y-4 md:overflow-visible lg:gap-x-7 min-[1100px]:px-16 xl:gap-x-8 2xl:gap-x-10 min-[1920px]:px-24 [&::-webkit-scrollbar]:hidden"
          >
            {groups.map((group, i) => (
              <div
                key={group[0].to}
                className={`flex items-center gap-x-6 md:flex-wrap md:gap-y-4 lg:gap-x-7 xl:gap-x-8 2xl:gap-x-10 ${
                  i > 0 ? 'border-l border-line/15 pl-6 lg:pl-7 xl:pl-8 2xl:pl-10' : ''
                }`}
              >
                {group.map((item) => (
                  <PortalLink key={item.to} to={item.to} end={item.end} within={item.within}>
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

      {/* The skip link lands here. The page itself takes no ring for it: the
          ring would run round everything on the page. */}
      <main id="main-content" tabIndex={-1} className="container-prose pb-24 pt-10 focus:outline-none sm:pt-14">
        <Outlet />
      </main>

      {/* The link is one small line with a finger's 44px of height round it;
          the footer's own padding is less by as much, so it stands as tall
          as before. */}
      <footer className="container-prose border-t border-line/10 py-2.5 text-xs text-soft/40">
        <Link to="/" className="inline-flex min-h-[44px] items-center transition-colors hover:text-ink">
          &larr; Back to ausss-ainshams.org
        </Link>
      </footer>
    </div>
  )
}
