import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'
import NavCartButton, { FloatingCartPill } from './NavCartButton.jsx'
import BackButton from './BackButton.jsx'
import { useSiteSettings } from '../hooks/useSiteSettings.js'
import { useOrderSectionInView } from '../lib/orderSectionView.js'
import { committees, slugFor } from '../data/society.js'
import { pressCls } from '../lib/motion.js'
import { lockPageScroll } from './ScrollManager.jsx'

// `to` may be a route ("/ifmsa") or a home-section hash ("/#about").
// A `groups` array turns the item into a menu instead of a link, its links in
// labelled groups. Committees offers every committee and division page, with
// exchange split into its three pages (exchange forks three ways and has no
// single page worth landing on first). `match` lists the paths that mark the
// menu as the current section.
const committeeLinks = (group) =>
  committees
    .filter((c) => c.group === group)
    .map((c) => ({ to: `/committees/${slugFor(c)}`, label: c.abbr, hint: c.name }))

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/ifmsa', label: 'IFMSA' },
  {
    to: '/committees',
    label: 'Committees',
    match: ['/committees', '/exchange'],
    groups: [
      {
        label: 'Exchange',
        links: [
          { to: '/exchange/outgoings', label: 'Outgoings', hint: 'Our students going abroad' },
          { to: '/exchange/incomings', label: 'Incomings', hint: 'Coming to Ain Shams on exchange' },
          { to: '/exchange/join', label: 'Join the exchange team', hint: 'Officer and assistant roles' },
        ],
      },
      { label: 'Standing committees', links: committeeLinks('Standing Committee') },
      { label: 'Support divisions', links: committeeLinks('Support Division') },
    ],
  },
  { to: '/events', label: 'Events' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/merch', label: 'Merch' },
  { to: '/contact', label: 'Contact' },
]

// Catchy CTA for the magazine, shown as a highlighted pill. The bar only has
// room for the long wording from 1600px; below that the pill says a shorter
// one, and below 1280px the shortest, or the links would push the membership
// button out of the bar (measured at every width from 1024px to 2560px with
// "Check membership" in the bar, 2026-10-11).
const MAGAZINE_CTA = 'Read the latest issue of the AUSSS Magazine'
const MAGAZINE_CTA_SHORT = 'AUSSS Magazine'
const MAGAZINE_CTA_SHORTEST = 'Magazine'

// The pill is the site's blue button (the cta tokens) with a soft glow of its
// own colour under it.
const MAGAZINE_PILL =
  'bg-cta text-on-cta shadow-md shadow-cta/30 hover:bg-cta-hover dark:shadow-lg dark:shadow-cta/20'

// The desktop bar is also what a tablet on its side and a touch laptop get. A
// link there is one line of text to the eye and a pill is 36px, so each
// carries an unseen ::after 44px high, centred on it, for a finger (in px,
// because the root size is not always 16). A link's reaches 6px past it on
// each side, half the narrowest gap in the row, so two targets meet without
// crossing; a pill's is as wide as the pill.
const TAP =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
const LINK_TAP = `${TAP} after:w-[calc(100%+0.75rem)]`
const PILL_TAP = `${TAP} after:w-full`

// "You are here" for a pill: a ring in the blue of the bar's underlines, set
// off from the pill by the page colour. A pill is only ever current on its own
// page, where the bar is solid, so the gap never shows over the home hero.
const PILL_HERE = 'ring-2 ring-medical ring-offset-2 ring-offset-page'

// The thin blue line under a link in the bar: there on the current page, and
// drawn in from the left under the pointer or the keyboard's focus anywhere
// else. It is scaled, not made wider, so nothing is laid out again while it
// moves; with reduced motion it fades in where it stands.
const underlineCls = (here) =>
  `absolute -bottom-1.5 left-0 h-px w-full origin-left bg-medical transition-[transform,opacity] duration-300 ease-out ${
    here
      ? ''
      : 'motion-safe:scale-x-0 motion-safe:group-hover:scale-x-100 motion-safe:group-focus-visible:scale-x-100 motion-reduce:opacity-0 motion-reduce:group-hover:opacity-100 motion-reduce:group-focus-visible:opacity-100'
  }`

function parseTo(to) {
  const [pathname, hash] = to.split('#')
  return { pathname: pathname || '/', hash: hash ? `#${hash}` : '' }
}

// A top-level nav item that forks. A mouse opens it by hovering and closes it
// by leaving; a finger and the keyboard open and close it with a tap or Enter.
// It also closes on Escape, on an outside click, and whenever the route
// changes.
//
// The two ways in must be told apart. A tap also sends the browser's stand-in
// mouse events, and a mouse is over the button before it clicks, so with a
// plain mouse-enter and a plain toggle the menu opened and shut again in the
// same instant for both. Hovering is therefore taken from the pointer events
// of a real mouse only, and a click from a hovering mouse leaves the menu open.
//
// Tabbing on past its last link closes it too: it would otherwise stay open
// over the page with the focus somewhere else. Not while a mouse is over it,
// which holds it open by itself.
function NavMenu({ item, solid }) {
  const [open, setOpen] = useState(false)
  const { pathname, key } = useLocation()
  const wrapRef = useRef(null)
  const hovering = useRef(false)
  const active = (item.match || [item.to]).some((m) => pathname.startsWith(m))

  // Any navigation closes it, by the entry's key and not by the path: the
  // link to the page the reader is already on changes no path, and the menu
  // stayed open after it.
  useEffect(() => {
    setOpen(false)
  }, [key])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <li
      ref={wrapRef}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        hovering.current = true
        setOpen(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return
        hovering.current = false
        setOpen(false)
      }}
      onBlur={(e) => {
        if (hovering.current) return
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        onClick={() => (hovering.current ? setOpen(true) : setOpen((v) => !v))}
        aria-expanded={open}
        aria-haspopup="true"
        className={`group flex items-center gap-1.5 text-sm font-medium transition-colors min-[1920px]:text-base ${LINK_TAP} ${
          solid
            ? 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
            : 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
        }`}
      >
        {item.label}
        {/* The arrow flips at once with reduced motion; its turn is movement. */}
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 motion-safe:transition-transform motion-safe:duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={underlineCls(active)} />
      </button>

      {/* The gap between the trigger and the panel would drop the hover, so the
          panel's wrapper starts flush against the header and pads inward. One
          column per group, side by side. It fades in while it drops 4px from
          the bar; with reduced motion it only fades. */}
      <div
        className={`absolute -left-4 top-full z-50 w-[46rem] max-w-[calc(100vw-2rem)] pt-4 transition-[opacity,transform,visibility] duration-200 ease-out ${
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible opacity-0 motion-safe:-translate-y-1'
        }`}
      >
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-line/10 bg-cream p-2 shadow-xl shadow-forest-950/10 dark:bg-forest-800 dark:shadow-black/40">
          {item.groups.map((g) => (
            <div key={g.label}>
              <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.18em] text-soft/50">
                {g.label}
              </p>
              <ul>
                {g.links.map((c) => (
                  <li key={c.to}>
                    <NavLink
                      to={c.to}
                      tabIndex={open ? undefined : -1}
                      className={({ isActive }) =>
                        `block rounded-xl px-3 py-2 transition-colors ${
                          isActive
                            ? 'bg-medical/10 text-accent'
                            : 'text-forest-900 hover:bg-forest-600/5 dark:text-silver dark:hover:bg-white/5'
                        }`
                      }
                    >
                      <span className="block text-sm font-semibold">{c.label}</span>
                      {c.hint && (
                        <span className="mt-0.5 block text-xs leading-snug text-soft/55">
                          {c.hint}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </li>
  )
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { pathname, key } = useLocation()
  const { settings } = useSiteSettings()
  // Dev/EB can hide the Magazine CTA site-wide; default (and fallback) is shown.
  const showMagazine = settings.magazineInHeader !== false
  const isHome = pathname === '/'
  // Inner pages have no dark hero behind the bar → always solid. So is the bar
  // over the open mobile menu, which then reads as one sheet with it.
  const solid = scrolled || !isHome || open
  // True while the phone row's cart button is grown into its pill, which is
  // while the order section of /merch is on screen (NavCartButton.jsx).
  const cartGrown = useOrderSectionInView()

  const barRef = useRef(null)
  useEffect(() => {
    const onScroll = () => {
      // On home the bar stays clear over the hero and only goes
      // solid once the hero scrolls out and the green sections reach the bar.
      // The bar's height is read off the bar: it is 6rem, and the root size
      // follows the screen, so that is 90px on a small phone and 108px on a
      // wide monitor. Other pages are always solid via !isHome.
      const hero = document.getElementById('home')
      const bar = barRef.current?.offsetHeight ?? 0
      const threshold = hero ? hero.offsetHeight - bar : 24
      setScrolled(window.scrollY > threshold)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Any navigation closes the mobile menu, "Home" tapped on the home page
  // included (see NavMenu above).
  useEffect(() => {
    setOpen(false)
  }, [key])

  // Keyboard users: entering the drawer lands on its first link; closing it
  // returns focus to the toggle so they aren't dropped at the page top. Not
  // when the menu closed because focus left the header on purpose (into the
  // cart, or on to the page after the last link): it stays where it went.
  const firstMobileLinkRef = useRef(null)
  const menuToggleRef = useRef(null)
  const drawerWasOpen = useRef(false)
  const focusLeft = useRef(false)
  useEffect(() => {
    if (open) {
      firstMobileLinkRef.current?.focus()
      drawerWasOpen.current = true
    } else if (drawerWasOpen.current) {
      if (!focusLeft.current) menuToggleRef.current?.focus()
      drawerWasOpen.current = false
    }
    focusLeft.current = false
  }, [open])

  // Lock background scroll while the mobile menu is open so the page
  // behind the drawer can't move under the touch gesture. Escape closes the
  // menu, as it closes the Committees menu and the cart. So does the window
  // growing into the desktop bar (a tablet turned on its side), where the menu
  // is not shown: the page would stay locked with nothing to close.
  // The lock is counted (ScrollManager.jsx): the cart opens over the menu and
  // the menu then closes under it, so neither may undo the other's lock.
  useEffect(() => {
    if (!open) return
    const unlock = lockPageScroll()
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const desktop = window.matchMedia('(min-width: 1024px)')
    const onDesktop = () => {
      if (desktop.matches) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    desktop.addEventListener('change', onDesktop)
    return () => {
      unlock()
      document.removeEventListener('keydown', onKey)
      desktop.removeEventListener('change', onDesktop)
    }
  }, [open])

  return (
    <>
    {/* One edge under the solid bar, a hairline: it had a shadow as well. The
        hairline is a `line` token, so it grows stronger by itself for a reader
        who asked for more contrast. Only colours ease here, at the pace the
        page itself changes theme. */}
    <header
      // Tabbing past the last link of the open mobile menu would carry focus
      // to the page behind it, where it cannot be seen. The menu closes
      // instead, as it does when the cart opens over it and takes the focus.
      // A tap on empty space moves focus nowhere and changes nothing.
      onBlur={(e) => {
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) {
          focusLeft.current = true
          setOpen(false)
        }
      }}
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        solid ? 'border-line/10 bg-page' : 'border-transparent bg-transparent'
      }`}
    >
      <nav
        ref={barRef}
        aria-label="Main navigation"
        // Full-bleed, not container-prose: on a wide monitor the bar should
        // reach the screen edges instead of sitting in the 96rem content box.
        // Padding matches container-prose from 1100px, so the logo lines up
        // with page content on laptops, then grows on very large screens.
        // Between 1024 and 1099px the bar keeps the tablet's padding: the row
        // of links is at its fullest there and needs the room.
        className="flex h-24 w-full items-center justify-between px-6 sm:px-10 min-[1100px]:px-16 min-[1920px]:px-24"
      >
        {/* Back comes first on an inner page below lg, where the bar is this
            short row (BackButton.jsx says why it is in the bar). The home page
            has no Back, and from lg up it floats under the bar, so in both the
            logo stands alone here as it did. */}
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <BackButton placement="bar" />
          {/* Under 360px the bar cannot hold Back, the logo and the grown
              cart pill together, so the logo steps aside for as long as the
              pill is out. The menu still has Home. */}
          <Link
            to="/"
            className={`group flex shrink-0 items-center ${cartGrown ? 'max-[359px]:hidden' : ''}`}
            aria-label="AUSSS home"
          >
            {/* Black logo on the light theme, white on the dark one: the hero
                behind the clear bar follows the theme too. */}
            <img
              src="/assets/brand/ausss-icon-black.png"
              alt="AUSSS, Ain Shams University Students' Scientific Society"
              className={`h-14 w-auto transition-opacity sm:h-16 min-[1920px]:h-[4.5rem] ${
                'block dark:hidden'
              }`}
            />
            <img
              src="/assets/brand/ausss-icon-white.png"
              alt=""
              aria-hidden="true"
              className={`h-14 w-auto transition-opacity sm:h-16 min-[1920px]:h-[4.5rem] ${
                'hidden dark:block'
              }`}
            />
          </Link>
        </div>

        {/* Between 1024 and 1279px the bar is at its fullest: the gaps are
            narrower there, widen from 1280px and again from 1536px. The larger
            type, pills and logo wait for 1920px: with the long magazine
            wording they do not fit under it (the root size already grows with
            the screen from 1280px, so the type is never small). */}
        <ul className="ml-4 hidden items-center gap-3 lg:flex xl:ml-8 xl:gap-6 2xl:gap-8">
          {LINKS.map((l) =>
            l.groups ? (
              <NavMenu key={l.to} item={l} solid={solid} />
            ) : (
            <li key={l.to}>
              <NavLink
                to={parseTo(l.to)}
                end={l.to === '/'}
                className={`group text-sm font-medium transition-colors min-[1920px]:text-base ${LINK_TAP} ${
                  solid
                    ? 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
                    : 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
                }`}
              >
                {({ isActive }) => (
                  <>
                    {l.label}
                    {/* Underline: full width on the active page, grows on hover elsewhere. */}
                    <span className={underlineCls(isActive)} />
                  </>
                )}
              </NavLink>
            </li>
            ),
          )}
          {showMagazine && (
            <li>
              <NavLink
                to="/magazine"
                aria-label={MAGAZINE_CTA}
                className={({ isActive }) =>
                  `block whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold min-[1920px]:px-6 min-[1920px]:py-2.5 min-[1920px]:text-base ${PILL_TAP} ${pressCls} ${MAGAZINE_PILL} ${
                    isActive ? PILL_HERE : ''
                  }`
                }
              >
                <span className="xl:hidden">{MAGAZINE_CTA_SHORTEST}</span>
                <span className="hidden xl:inline min-[1600px]:hidden">{MAGAZINE_CTA_SHORT}</span>
                <span className="hidden min-[1600px]:inline">{MAGAZINE_CTA}</span>
              </NavLink>
            </li>
          )}
          <li className="flex items-center gap-2">
            <NavCartButton tone={solid ? 'solid' : 'transparent'} />
            <ThemeToggle tone={solid ? 'solid' : 'transparent'} />
          </li>
          <li>
            {/* It opens the membership lookup, and says so: as "Members" it
                read as the way in to the portal, which is a different page. */}
            <NavLink
              to="/members"
              className={({ isActive }) =>
                `block whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold min-[1920px]:px-6 min-[1920px]:py-2.5 min-[1920px]:text-base ${PILL_TAP} ${pressCls} ${
                  solid
                    ? 'bg-leaf text-white hover:bg-leaf-hover dark:bg-forest-600 dark:text-silver-light dark:hover:bg-forest-500'
                    : 'bg-leaf text-white hover:bg-leaf-hover dark:bg-white dark:text-forest dark:hover:bg-silver-light'
                } ${isActive ? PILL_HERE : ''}`
              }
            >
              Check membership
            </NavLink>
          </li>
        </ul>

        {/* Each of the three is smaller than a fingertip to the eye and carries
            an unseen 44px target centred on it (see ThemeToggle.jsx). The gaps
            are wide enough that two targets never cross, down to 320px. */}
        <div className="flex items-center gap-3 lg:hidden">
          <NavCartButton tone={solid ? 'solid' : 'transparent'} compact />
          <ThemeToggle tone={solid ? 'solid' : 'transparent'} className="h-9 w-9" />
        <button
          ref={menuToggleRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`relative ml-1 rounded-md after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] ${pressCls} ${
            solid ? 'text-forest dark:text-silver' : 'text-forest dark:text-white'
          }`}
          aria-label="Toggle menu"
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
        </div>
      </nav>

      {/* Mobile menu. It hangs under the bar and opens with a short fade and
          an 8px drop from it (opacity and transform only, so nothing is laid
          out again while it moves), and leaves the same way. With reduced
          motion it only fades. Closed, it is hidden outright once the fade is
          over: `visibility` joins the transition on the way out alone, since
          on the way in it would keep the first link from taking focus. Its
          smaller links and its two pills are held to 44px in px, so they do
          not shrink with the root size on a small phone. */}
      <div
        id="mobile-nav"
        aria-label="Mobile navigation"
        aria-hidden={!open}
        inert={!open ? '' : undefined}
        className={`absolute inset-x-0 top-full max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain border-y border-line/10 bg-page duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] lg:hidden ${
          open
            ? 'visible translate-y-0 opacity-100 transition-[opacity,transform]'
            : 'pointer-events-none invisible opacity-0 transition-[opacity,transform,visibility] motion-safe:-translate-y-2'
        }`}
      >
        <ul className="container-prose flex flex-col py-4">
          {LINKS.map((l, i) =>
            l.groups ? (
              // No disclosure toggle here: the drawer is already a list, and
              // hiding the links behind an extra tap helps nobody. Each group
              // is a small heading over its links.
              <li key={l.to} className="border-b border-forest-600/10 py-3 dark:border-white/10">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-soft/50">
                  {l.label}
                </p>
                {l.groups.map((g) => (
                  <div key={g.label} className="mt-3">
                    <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-accent">{g.label}</p>
                    <ul className="grid grid-cols-2 gap-x-4">
                      {g.links.map((c) => (
                        <li key={c.to} className={g.label === 'Exchange' ? 'col-span-2' : ''}>
                          <NavLink
                            to={c.to}
                            className={({ isActive }) =>
                              `block min-h-[44px] w-full py-2.5 text-left text-base ${
                                isActive
                                  ? 'font-semibold text-accent'
                                  : 'font-medium text-forest-900 dark:text-silver'
                              }`
                            }
                          >
                            {c.label}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </li>
            ) : (
            <li key={l.to}>
              <NavLink
                to={parseTo(l.to)}
                end={l.to === '/'}
                ref={i === 0 ? firstMobileLinkRef : undefined}
                className={({ isActive }) =>
                  `block w-full border-b border-forest-600/10 py-4 text-left text-base dark:border-white/10 ${
                    isActive
                      ? 'font-semibold text-accent'
                      : 'font-medium text-forest-900 dark:text-silver'
                  }`
                }
              >
                {l.label}
              </NavLink>
            </li>
            ),
          )}
          {showMagazine && (
            <li className="pt-4">
              <NavLink
                to="/magazine"
                className={({ isActive }) =>
                  `flex min-h-[44px] w-full items-center justify-center rounded-full py-3 text-center text-sm font-semibold ${pressCls} ${MAGAZINE_PILL} ${
                    isActive ? PILL_HERE : ''
                  }`
                }
              >
                {MAGAZINE_CTA}
              </NavLink>
            </li>
          )}
          <li className="pt-3">
            <NavLink
              to="/members"
              className={({ isActive }) =>
                `flex min-h-[44px] w-full items-center justify-center rounded-full bg-leaf py-3 text-center text-sm font-semibold text-white hover:bg-leaf-hover dark:bg-forest-600 dark:text-silver-light dark:hover:bg-forest-500 ${pressCls} ${
                  isActive ? PILL_HERE : ''
                }`
              }
            >
              Check membership
            </NavLink>
          </li>
        </ul>
      </div>
    </header>
    {/* The desktop cart pill for the shop section of /merch; outside the
        header so it floats over the page, not inside the bar. */}
    <FloatingCartPill />
    </>
  )
}
