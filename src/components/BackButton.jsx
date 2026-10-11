import { useLocation, useNavigate } from 'react-router-dom'
import { pressCls } from '../lib/motion.js'

/**
 * The "back" control on every non-home page. Goes to the previous page in
 * history; if there is none (e.g. opened via a direct link or a new tab),
 * falls back to the AUSSS home page.
 *
 * It has two places, and CSS shows one of them at a time, so the pre-rendered
 * page is right before any script runs.
 *
 * Below lg it is in the header bar, ahead of the logo (`placement="bar"`,
 * drawn by Navbar.jsx). It used to float under the bar at every width. A page
 * fills a phone from edge to edge, so the button sat on the first line of
 * most pages, and on whatever scrolled under it afterwards; a few pages made
 * room for it one by one. Nothing passes under the bar, so in the bar it
 * covers nothing and no page has to think of it.
 *
 * From lg up the bar is full of links, and a page keeps a margin at its left,
 * so there it floats under the bar as it always has (drawn by Layout.jsx).
 *
 * The green is solid in both themes. It used to be 90% on the dark theme with
 * a blur behind it, which nobody could see through a fill that dense and
 * which the browser still had to redo on every frame of a scroll.
 */

// What both places share. The pressed colour is for a finger: nothing hovers
// on a phone, and with reduced motion the button does not sink. The
// keyboard's ring is the one every button on the site has.
const SKIN =
  'items-center justify-center gap-2 rounded-full border border-white/15 bg-leaf text-sm font-semibold text-white hover:bg-leaf-hover active:bg-leaf-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

// In the bar it is the size of the cart and theme buttons beside it, with an
// unseen ::after 44px square for a finger (in px, because the root size
// shrinks on a small phone). On a phone it is the arrow alone and stands 8px
// out into the bar's side padding, which puts the arrow in line with the
// page's left edge and leaves the logo room beside the cart when that grows
// into its pill. From sm up it has the word as well.
const BAR =
  "relative -ml-2 inline-flex h-9 w-9 shrink-0 after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-full after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:ml-0 sm:w-auto sm:px-4 lg:hidden"

// Floating, it is a pill a little under 44px high; the ::after gives it that
// height for a finger on a touch laptop.
const FLOATING =
  "fixed left-6 top-[7rem] z-40 hidden px-4 py-2 shadow-lg shadow-forest-950/30 after:absolute after:left-0 after:top-1/2 after:h-[44px] after:w-full after:-translate-y-1/2 after:content-[''] lg:inline-flex"

export default function BackButton({ placement = 'floating' }) {
  const navigate = useNavigate()
  const location = useLocation()

  if (location.pathname === '/') return null

  // react-router sets key 'default' for the first entry, i.e. nothing
  // earlier in this tab's history to go back to.
  const canGoBack = location.key !== 'default'

  return (
    <button
      type="button"
      onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}
      aria-label="Go back to the previous page"
      className={`${placement === 'bar' ? BAR : FLOATING} ${SKIN} ${pressCls}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          d="M19 12H5M11 18l-6-6 6-6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* A phone shows the arrow alone: the bar there has no room for the
          word beside the logo and the three controls. */}
      <span className="hidden sm:inline">Back</span>
    </button>
  )
}
