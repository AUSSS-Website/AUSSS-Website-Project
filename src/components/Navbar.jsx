import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'
import NavCartButton, { FloatingCartPill } from './NavCartButton.jsx'
import { useSiteSettings } from '../hooks/useSiteSettings.js'
import { committees, slugFor } from '../data/society.js'

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
  { to: '/gallery', label: 'Gallery' },
  { to: '/merch', label: 'Merch' },
  { to: '/contact', label: 'Contact' },
]

// Catchy CTA for the magazine, shown as a highlighted pill. The bar only has
// room for the long wording from 1440px; below that the pill says the short
// one, or the links would push the logo out of the bar.
const MAGAZINE_CTA = 'Read the latest issue of the AUSSS Magazine'
const MAGAZINE_CTA_SHORT = 'AUSSS Magazine'

// The pill is the site's blue button (the cta tokens) with a soft glow of its
// own colour under it.
const MAGAZINE_PILL =
  'bg-cta text-on-cta shadow-md shadow-cta/30 hover:bg-cta-hover dark:shadow-lg dark:shadow-cta/20'

function parseTo(to) {
  const [pathname, hash] = to.split('#')
  return { pathname: pathname || '/', hash: hash ? `#${hash}` : '' }
}

// A top-level nav item that forks. Opens on hover (pointer) and on click or
// Enter (keyboard and touch, where hover never fires), closes on Escape, on an
// outside click, and whenever the route changes.
function NavMenu({ item, solid }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const wrapRef = useRef(null)
  const active = (item.match || [item.to]).some((m) => pathname.startsWith(m))

  useEffect(() => {
    setOpen(false)
  }, [pathname])

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
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`group relative flex items-center gap-1.5 text-sm font-medium transition-colors 2xl:text-base ${
          solid
            ? 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
            : 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
        }`}
      >
        {item.label}
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className={`absolute -bottom-1.5 left-0 h-px bg-medical transition-all duration-300 ${
            active ? 'w-full' : 'w-0 group-hover:w-full'
          }`}
        />
      </button>

      {/* The gap between the trigger and the panel would drop the hover, so the
          panel's wrapper starts flush against the header and pads inward. One
          column per group, side by side. */}
      <div
        className={`absolute -left-4 top-full z-50 w-[46rem] max-w-[calc(100vw-2rem)] pt-4 transition-all duration-200 ${
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible -translate-y-1 opacity-0'
        }`}
      >
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-forest-600/15 bg-cream p-2 shadow-xl shadow-forest-950/10 dark:border-white/10 dark:bg-forest-800 dark:shadow-black/40">
          {item.groups.map((g) => (
            <div key={g.label}>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-forest-900/50 dark:text-silver/45">
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
                        <span className="mt-0.5 block text-xs leading-snug text-forest-900/55 dark:text-silver/50">
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
  const { pathname } = useLocation()
  const { settings } = useSiteSettings()
  // Dev/EB can hide the Magazine CTA site-wide; default (and fallback) is shown.
  const showMagazine = settings.magazineInHeader !== false
  const isHome = pathname === '/'
  // Inner pages have no dark hero behind the bar → always solid.
  const solid = scrolled || !isHome

  useEffect(() => {
    const onScroll = () => {
      // On home the bar stays clear over the hero and only goes
      // solid once the hero scrolls out and the green sections reach the bar
      // (96px = the h-24 header). Other pages are always solid via !isHome.
      const hero = document.getElementById('home')
      const threshold = hero ? hero.offsetHeight - 96 : 24
      setScrolled(window.scrollY > threshold)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Keyboard users: entering the drawer lands on its first link; closing it
  // returns focus to the toggle so they aren't dropped at the page top.
  const firstMobileLinkRef = useRef(null)
  const menuToggleRef = useRef(null)
  const drawerWasOpen = useRef(false)
  useEffect(() => {
    if (open) {
      firstMobileLinkRef.current?.focus()
      drawerWasOpen.current = true
    } else if (drawerWasOpen.current) {
      menuToggleRef.current?.focus()
      drawerWasOpen.current = false
    }
  }, [open])

  // Lock background scroll while the mobile menu is open so the page
  // behind the drawer can't move under the touch gesture.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        solid
          ? 'border-b border-forest-600/20 bg-cream shadow-sm dark:border-white/10 dark:bg-forest-950'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <nav
        aria-label="Main navigation"
        // Full-bleed, not container-prose: on a wide monitor the bar should
        // reach the screen edges instead of sitting in the 96rem content box.
        // Padding matches container-prose up to lg so the logo still lines up
        // with page content on laptops, then grows on very large screens.
        className="flex h-24 w-full items-center justify-between px-6 sm:px-10 lg:px-16 min-[1920px]:px-24"
      >
        <Link to="/" className="group flex shrink-0 items-center" aria-label="AUSSS home">
          {/* Black logo on the light theme, white on the dark one: the hero
              behind the clear bar follows the theme too. */}
          <img
            src="/assets/brand/ausss-icon-black.png"
            alt="AUSSS, Ain Shams University Students' Scientific Society"
            className={`h-14 w-auto transition-opacity sm:h-16 2xl:h-[4.5rem] ${
              'block dark:hidden'
            }`}
          />
          <img
            src="/assets/brand/ausss-icon-white.png"
            alt=""
            aria-hidden="true"
            className={`h-14 w-auto transition-opacity sm:h-16 2xl:h-[4.5rem] ${
              'hidden dark:block'
            }`}
          />
        </Link>

        <ul className="ml-8 hidden items-center gap-5 lg:flex xl:gap-8 2xl:gap-10">
          {LINKS.map((l) =>
            l.groups ? (
              <NavMenu key={l.to} item={l} solid={solid} />
            ) : (
            <li key={l.to}>
              <NavLink
                to={parseTo(l.to)}
                end={l.to === '/'}
                className={`group relative text-sm font-medium transition-colors 2xl:text-base ${
                  solid
                    ? 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
                    : 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
                }`}
              >
                {({ isActive }) => (
                  <>
                    {l.label}
                    {/* Underline: full width on the active page, grows on hover elsewhere. */}
                    <span
                      className={`absolute -bottom-1.5 left-0 h-px bg-medical transition-all duration-300 ${
                        isActive ? 'w-full' : 'w-0 group-hover:w-full'
                      }`}
                    />
                  </>
                )}
              </NavLink>
            </li>
            ),
          )}
          {showMagazine && (
            <li>
              <Link
                to="/magazine"
                aria-label={MAGAZINE_CTA}
                className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-300 2xl:px-6 2xl:py-2.5 2xl:text-base ${
                  MAGAZINE_PILL
                }`}
              >
                <span className="min-[1440px]:hidden">{MAGAZINE_CTA_SHORT}</span>
                <span className="hidden min-[1440px]:inline">{MAGAZINE_CTA}</span>
              </Link>
            </li>
          )}
          <li className="flex items-center gap-2">
            <NavCartButton tone={solid ? 'solid' : 'transparent'} />
            <ThemeToggle tone={solid ? 'solid' : 'transparent'} />
          </li>
          <li>
            <Link
              to="/members"
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300 2xl:px-6 2xl:py-2.5 2xl:text-base ${
                solid
                  ? 'bg-leaf text-white hover:bg-leaf-hover dark:bg-forest-600 dark:text-silver-light dark:hover:bg-forest-500'
                  : 'bg-leaf text-white hover:bg-leaf-hover dark:bg-white dark:text-forest dark:hover:bg-silver-light'
              }`}
            >
              Members
            </Link>
          </li>
        </ul>

        <div className="flex items-center gap-2 lg:hidden">
          <NavCartButton tone={solid ? 'solid' : 'transparent'} compact />
          <ThemeToggle tone={solid ? 'solid' : 'transparent'} className="h-9 w-9" />
        <button
          ref={menuToggleRef}
          onClick={() => setOpen((v) => !v)}
          className={solid ? 'text-forest dark:text-silver' : 'text-forest dark:text-white'}
          aria-label="Toggle menu"
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {/* border-t only while open: a border isn't clipped by max-h-0, so a
          closed drawer would paint a stray 1px line under the header. */}
      <div
        id="mobile-nav"
        aria-label="Mobile navigation"
        aria-hidden={!open}
        inert={!open ? '' : undefined}
        className={`overflow-hidden bg-cream transition-[max-height] duration-500 lg:hidden dark:bg-forest-950 ${
          open
            ? 'max-h-[calc(100dvh-6rem)] border-t border-forest-600/10 dark:border-white/10'
            : 'max-h-0'
        }`}
      >
        <ul className="container-prose flex max-h-[calc(100dvh-6rem)] flex-col overflow-y-auto overscroll-contain py-4">
          {LINKS.map((l, i) =>
            l.groups ? (
              // No disclosure toggle here: the drawer is already a list, and
              // hiding the links behind an extra tap helps nobody. Each group
              // is a small heading over its links.
              <li key={l.to} className="border-b border-forest-600/10 py-3 dark:border-white/10">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-forest-900/50 dark:text-silver/40">
                  {l.label}
                </p>
                {l.groups.map((g) => (
                  <div key={g.label} className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{g.label}</p>
                    <ul className="grid grid-cols-2 gap-x-4">
                      {g.links.map((c) => (
                        <li key={c.to} className={g.label === 'Exchange' ? 'col-span-2' : ''}>
                          <NavLink
                            to={c.to}
                            className={({ isActive }) =>
                              `block w-full py-2 text-left text-base ${
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
              <Link
                to="/magazine"
                className={`block w-full rounded-full py-3 text-center text-sm font-semibold transition-colors ${MAGAZINE_PILL}`}
              >
                {MAGAZINE_CTA}
              </Link>
            </li>
          )}
          <li className="pt-3">
            <Link
              to="/members"
              className="block w-full rounded-full bg-leaf py-3 text-center text-sm font-semibold text-white dark:bg-forest-600 dark:text-silver-light"
            >
              Members
            </Link>
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
