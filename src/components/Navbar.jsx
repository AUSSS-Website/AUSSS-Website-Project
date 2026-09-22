import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'
import CartButton from './CartButton.jsx'
import { useSiteSettings } from '../hooks/useSiteSettings.js'

// `to` may be a route ("/ifmsa") or a home-section hash ("/#about").
// A `children` array turns the item into a menu instead of a link: Exchange
// forks three ways and there's no single page worth landing on first, so
// clicking it offers the three destinations rather than a page about them.
const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/ifmsa', label: 'IFMSA' },
  {
    to: '/exchange',
    label: 'Exchange',
    children: [
      { to: '/exchange/outgoings', label: 'Going abroad', hint: 'Clerkship overseas' },
      { to: '/exchange/incomings', label: 'Hosting in Cairo', hint: 'Students arriving at Ain Shams' },
      { to: '/exchange/join', label: 'Join the exchange team', hint: 'Officer and assistant roles' },
    ],
  },
  { to: '/gallery', label: 'Gallery' },
  { to: '/merch', label: 'Merch' },
  { to: '/contact', label: 'Contact' },
]

// Catchy CTA for the magazine, shown as a highlighted pill.
const MAGAZINE_CTA = 'Read the latest issue of the AUSSS Magazine'

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
  const active = pathname.startsWith(item.to)

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
            : 'text-white hover:text-white'
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
          panel's wrapper starts flush against the header and pads inward. */}
      <div
        className={`absolute left-1/2 top-full z-50 w-[19rem] -translate-x-1/2 pt-4 transition-all duration-200 ${
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible -translate-y-1 opacity-0'
        }`}
      >
        <ul className="overflow-hidden rounded-2xl border border-forest-600/15 bg-cream p-1.5 shadow-xl shadow-forest-950/10 dark:border-white/10 dark:bg-forest-800 dark:shadow-black/40">
          {item.children.map((c) => (
            <li key={c.to}>
              <NavLink
                to={c.to}
                tabIndex={open ? undefined : -1}
                className={({ isActive }) =>
                  `block rounded-xl px-4 py-3 transition-colors ${
                    isActive
                      ? 'bg-medical/10 text-medical dark:text-medical-light'
                      : 'text-forest-900 hover:bg-forest-600/5 dark:text-silver dark:hover:bg-white/5'
                  }`
                }
              >
                <span className="block text-sm font-semibold">{c.label}</span>
                {c.hint && (
                  <span className="mt-0.5 block text-xs text-forest-900/55 dark:text-silver/50">
                    {c.hint}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
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
      // On home the bar stays transparent over the black hero and only goes
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
        <Link to="/" className="group flex items-center" aria-label="AUSSS home">
          {/* Black logo only when bar is solid AND light mode; white otherwise. */}
          <img
            src="/assets/brand/ausss-icon-black.png"
            alt="AUSSS, Ain Shams University Students' Scientific Society"
            className={`h-14 w-auto transition-opacity sm:h-16 2xl:h-[4.5rem] ${
              solid ? 'block dark:hidden' : 'hidden'
            }`}
          />
          <img
            src="/assets/brand/ausss-icon-white.png"
            alt=""
            aria-hidden="true"
            className={`h-14 w-auto transition-opacity sm:h-16 2xl:h-[4.5rem] ${
              solid ? 'hidden dark:block' : 'block'
            }`}
          />
        </Link>

        <ul className="hidden items-center gap-6 md:flex lg:gap-7 xl:gap-8 2xl:gap-10">
          {LINKS.map((l) =>
            l.children ? (
              <NavMenu key={l.to} item={l} solid={solid} />
            ) : (
            <li key={l.to}>
              <NavLink
                to={parseTo(l.to)}
                end={l.to === '/'}
                className={`group relative text-sm font-medium transition-colors 2xl:text-base ${
                  solid
                    ? 'text-forest-900 hover:text-forest dark:text-white dark:hover:text-white'
                    : 'text-white hover:text-white'
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
                className="whitespace-nowrap rounded-full bg-medical px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-medical/20 transition-colors duration-300 hover:bg-medical-light 2xl:px-6 2xl:py-2.5 2xl:text-base"
              >
                {MAGAZINE_CTA}
              </Link>
            </li>
          )}
          <li className="flex items-center gap-2">
            <CartButton tone={solid ? 'solid' : 'transparent'} />
            <ThemeToggle tone={solid ? 'solid' : 'transparent'} />
          </li>
          <li>
            <Link
              to="/members"
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300 2xl:px-6 2xl:py-2.5 2xl:text-base ${
                solid
                  ? 'bg-forest-600 text-silver-light hover:bg-forest-500'
                  : 'bg-white text-forest hover:bg-silver-light'
              }`}
            >
              Members
            </Link>
          </li>
        </ul>

        <div className="flex items-center gap-2 md:hidden">
          <CartButton tone={solid ? 'solid' : 'transparent'} className="h-9 w-9" />
          <ThemeToggle tone={solid ? 'solid' : 'transparent'} className="h-9 w-9" />
        <button
          ref={menuToggleRef}
          onClick={() => setOpen((v) => !v)}
          className={solid ? 'text-forest dark:text-silver' : 'text-white'}
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
        className={`overflow-hidden bg-cream transition-[max-height] duration-500 md:hidden dark:bg-forest-950 ${
          open
            ? 'max-h-[calc(100dvh-6rem)] border-t border-forest-600/10 dark:border-white/10'
            : 'max-h-0'
        }`}
      >
        <ul className="container-prose flex max-h-[calc(100dvh-6rem)] flex-col overflow-y-auto overscroll-contain py-4">
          {LINKS.map((l, i) =>
            l.children ? (
              // No disclosure toggle here: the drawer is already a list, and
              // hiding three links behind an extra tap helps nobody.
              <li key={l.to} className="border-b border-forest-600/10 py-3 dark:border-white/10">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-forest-900/50 dark:text-silver/40">
                  {l.label}
                </p>
                <ul>
                  {l.children.map((c) => (
                    <li key={c.to}>
                      <NavLink
                        to={c.to}
                        className={({ isActive }) =>
                          `block w-full py-2.5 text-left text-base ${
                            isActive
                              ? 'font-semibold text-medical dark:text-medical-light'
                              : 'font-medium text-forest-900 dark:text-silver'
                          }`
                        }
                      >
                        {c.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
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
                      ? 'font-semibold text-medical dark:text-medical-light'
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
                className="block w-full rounded-full bg-medical py-3 text-center text-sm font-semibold text-white"
              >
                {MAGAZINE_CTA}
              </Link>
            </li>
          )}
          <li className="pt-3">
            <Link
              to="/members"
              className="block w-full rounded-full bg-forest-600 py-3 text-center text-sm font-semibold text-silver-light"
            >
              Members
            </Link>
          </li>
        </ul>
      </div>
    </header>
  )
}
