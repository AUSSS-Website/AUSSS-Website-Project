import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Floating "back" control on every non-home page. Goes to the previous
 * page in history; if there is none (e.g. opened via a direct link or a
 * new tab), falls back to the AUSSS home page.
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
      className="fixed left-4 top-[7rem] z-40 inline-flex items-center gap-2 rounded-full border border-white/15 bg-leaf p-3 dark:bg-leaf/90 text-sm font-semibold text-white shadow-lg shadow-forest-950/30 backdrop-blur-md transition-colors hover:bg-leaf-hover sm:left-6 sm:px-4 sm:py-2"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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
