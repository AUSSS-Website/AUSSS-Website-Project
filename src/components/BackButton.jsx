import { useLocation, useNavigate } from 'react-router-dom'
import { pressCls } from '../lib/motion.js'

/**
 * Floating "back" control on every non-home page. Goes to the previous
 * page in history; if there is none (e.g. opened via a direct link or a
 * new tab), falls back to the AUSSS home page.
 *
 * The green is solid in both themes. It used to be 90% on the dark theme with
 * a blur behind it, which nobody could see through a fill that dense and
 * which the browser still had to redo on every frame of a scroll. On a phone
 * it is a 44px circle; from sm up an unseen ::after gives the lower pill the
 * same height for a finger.
 */
export default function BackButton() {
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
      className={`fixed left-4 top-[7rem] z-40 inline-flex h-[44px] w-[44px] items-center justify-center gap-2 rounded-full border border-white/15 bg-leaf text-sm font-semibold text-white shadow-lg shadow-forest-950/30 after:absolute after:left-0 after:top-1/2 after:h-[44px] after:w-full after:-translate-y-1/2 after:content-[''] hover:bg-leaf-hover sm:left-6 sm:h-auto sm:w-auto sm:px-4 sm:py-2 ${pressCls}`}
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
      {/* A phone shows the arrow alone, so the button clears the centred
          heading it floats beside. */}
      <span className="hidden sm:inline">Back</span>
    </button>
  )
}
