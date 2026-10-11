import { Link } from 'react-router-dom'
import { pressCls } from '../../lib/motion.js'

// Single source of truth for button styling, so the dozen hand-typed CTAs
// across the site stop drifting (different padding, hover scales, colours).
// Renders as a React Router <Link> (when `to` is set), an <a> (`href`), or a
// <button>. New UI should reach for this; existing call sites can migrate over.
//
//   <Button to="/join">Join</Button>
//   <Button variant="accent" size="lg" type="submit">Sign in</Button>
//   <Button variant="outline" onClick={…}>Cancel</Button>
//
// It grows a little under the pointer and sinks a little when pressed
// (pressCls), and its colours ease between states. With reduced motion it
// stays the same size and only the colours ease.
//
// Each variant also has a colour for the moment it is pressed, the one it
// takes under the pointer. On a phone nothing hovers, and with reduced motion
// nothing sinks, so without it a press there showed nothing at all.

const VARIANTS = {
  // White pill, forest text, the primary site CTA (hero, product add).
  primary: 'bg-solid text-on-solid hover:bg-solid-hover active:bg-solid-hover',
  // Scientific-blue pill, secondary emphasis (magazine, auth, quiz).
  accent: 'bg-cta text-on-cta hover:bg-cta-hover active:bg-cta-hover',
  // Green pill on the light theme, the blue button on the dark one.
  forest:
    'bg-leaf text-white hover:bg-leaf-hover active:bg-leaf-hover dark:bg-cta dark:text-on-cta dark:hover:bg-cta-hover dark:active:bg-cta-hover',
  // Hairline outline, tertiary action over dark/hero backgrounds.
  outline: 'border border-line/25 text-ink hover:bg-veil/10 active:bg-veil/20',
}

// The keyboard's ring is the same on every variant: the theme's blue, set off
// from the button by a gap that shows whatever is behind it. A ring in the
// button's own colour drawn against its edge, as each variant had, could not
// be told from the button: round the white pill on the dark theme it only
// made the pill look 2px larger.
const focusCls = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

// sm is 36px tall, and md is 44px only where the root size is 16px: on a
// 320px phone it is 41px. Both carry an unseen ::after, 44px high (in px for
// that reason) and centred on the button, so a finger has the full target and
// the button looks no bigger.
const reachCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"

const SIZES = {
  sm: `px-5 py-2 text-sm ${reachCls}`,
  md: `px-6 py-3 text-sm ${reachCls}`,
  lg: 'px-8 py-4 text-sm',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  to,
  href,
  className = '',
  children,
  ...rest
}) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-full font-semibold ${pressCls} motion-safe:hover:scale-[1.02] ${focusCls} disabled:pointer-events-none disabled:opacity-40 ${
    VARIANTS[variant] || VARIANTS.primary
  } ${SIZES[size] || SIZES.md} ${className}`

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {children}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  )
}
