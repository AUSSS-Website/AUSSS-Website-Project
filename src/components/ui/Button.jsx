import { Link } from 'react-router-dom'

// Single source of truth for button styling, so the dozen hand-typed CTAs
// across the site stop drifting (different padding, hover scales, colours).
// Renders as a React Router <Link> (when `to` is set), an <a> (`href`), or a
// <button>. New UI should reach for this; existing call sites can migrate over.
//
//   <Button to="/join">Join</Button>
//   <Button variant="accent" size="lg" type="submit">Sign in</Button>
//   <Button as="button" variant="outline" onClick={…}>Cancel</Button>

const VARIANTS = {
  // White pill, forest text, the primary site CTA (hero, product add).
  primary:
    'bg-white text-forest hover:bg-silver-light focus-visible:ring-white/70',
  // Scientific-blue pill, secondary emphasis (magazine, auth, quiz).
  accent:
    'bg-medical text-forest-950 hover:bg-medical-light focus-visible:ring-medical/60',
  // Forest pill, used on light surfaces (cart checkout, footer).
  forest:
    'bg-forest text-white hover:bg-forest-600 focus-visible:ring-forest/50 dark:bg-medical dark:text-forest-950 dark:hover:bg-medical-light',
  // Hairline outline, tertiary action over dark/hero backgrounds.
  outline:
    'border border-white/25 text-white hover:bg-white/10 focus-visible:ring-white/50',
}

const SIZES = {
  sm: 'px-5 py-2 text-sm',
  md: 'px-6 py-3 text-sm',
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
  const classes = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40 ${
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
