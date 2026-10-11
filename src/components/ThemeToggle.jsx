import { useTheme } from '../lib/theme.js'
import { pressCls } from '../lib/motion.js'

// `tone` matches the Navbar's `solid` state: the bar is clear over the home
// hero and solid once scrolled. Both tones follow the theme.
//
// The circle is 40px, 36px in the phone row and smaller still on a 320px
// phone, where the root size shrinks. An unseen ::after, 44px square and in px
// for that reason, sits centred on it, so a finger gets the full target
// without the bar's row growing (the portal header does the same).
//
// The keyboard's ring is the theme's blue, set off from the circle by a gap,
// so it shows on the clear bar over the hero as well as on the solid one. A
// caller that brings a ring of its own (the exam's header) draws it in the
// same place, and the two read as one.
export default function ThemeToggle({ tone = 'solid', className = '' }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  const base = `relative grid h-10 w-10 place-items-center rounded-full border after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${pressCls}`
  // Each tone has a fill for the moment it is pressed, a step past the one it
  // takes under the pointer: a phone has no hover to show, and with reduced
  // motion the circle does not sink.
  const skin =
    tone === 'solid'
      ? 'border-forest-600/20 text-forest hover:bg-forest/5 active:bg-forest/10 dark:border-white/15 dark:text-silver dark:hover:bg-white/5 dark:active:bg-white/10'
      : 'border-forest-600/20 text-forest hover:bg-forest/5 active:bg-forest/10 dark:border-white/25 dark:text-white dark:hover:bg-white/10 dark:active:bg-white/20'

  // The label names what a press will do, so the button is not also marked as
  // pressed: "Switch to light mode, pressed" says two things at once.
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`${base} ${skin} ${className}`}
    >
      {isDark ? (
        // Sun
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // Moon
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
