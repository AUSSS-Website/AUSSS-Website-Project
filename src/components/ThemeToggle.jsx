import { useTheme } from '../lib/theme.js'

// `tone` matches the Navbar's `solid` state: the bar is clear over the home
// hero and solid once scrolled. Both tones follow the theme.
export default function ThemeToggle({ tone = 'solid', className = '' }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  const base =
    'grid h-10 w-10 place-items-center rounded-full border transition-colors'
  const skin =
    tone === 'solid'
      ? 'border-forest-600/20 text-forest hover:bg-forest/5 dark:border-white/15 dark:text-silver dark:hover:bg-white/5'
      : 'border-forest-600/20 text-forest hover:bg-forest/5 dark:border-white/25 dark:text-white dark:hover:bg-white/10'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
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
