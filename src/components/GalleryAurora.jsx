import useMediaQuery from '../hooks/useMediaQuery.js'
import { useTheme } from '../lib/theme.js'
import Aurora from './Aurora.jsx'

// Brand-tinted Aurora backdrop shared across the gallery pages (index hero +
// album subpages). Reduce-motion safe, renders nothing when the user prefers
// reduced motion. Fills its nearest positioned ancestor; pass `className` to
// tweak placement/opacity per page.

// The glow is light added to a dark sky. On a light page the same colours
// read as smoke, so the light theme gets a pastel wash of the same hues.
const STOPS = {
  dark: ['#0a5c3e', '#5B8DB8', '#8FB4D4'],
  light: ['#a8dcc2', '#aacbe8', '#d3e4f3'],
}

export default function GalleryAurora({
  className = '',
  opacityClass = 'opacity-90',
  colorStops,
  amplitude = 1.0,
  blend = 0.5,
  speed = 0.4,
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const { theme } = useTheme()
  if (reduceMotion) return null
  const palette = theme === 'light' ? 'light' : 'dark'
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-0 ${opacityClass} ${className}`}
      aria-hidden="true"
    >
      <Aurora
        colorStops={colorStops || STOPS[palette]}
        flat={palette === 'light'}
        amplitude={amplitude}
        blend={blend}
        speed={speed}
      />
    </div>
  )
}
