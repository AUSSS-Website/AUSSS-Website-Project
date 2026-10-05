import { Link } from 'react-router-dom'
import { MEMBERSHIP_LABELS } from './constants.js'

// Shared dark-chrome primitives for the portal, matching the public site's
// look so the two never drift apart.

// Full-height centred stage (spinners, error cards, empty states).
export function Centered({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 text-center">
      {children}
    </div>
  )
}

export function Spinner({ className = 'h-8 w-8' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`${className} inline-block animate-spin rounded-full border-2 border-line/15 border-t-accent`}
    />
  )
}

// The sign-in surface: dark page, one narrow rounded card.
export function AuthCard({ eyebrow, title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-3xl border border-line/10 bg-sunk p-8">
        <div className="text-center">
          {eyebrow && (
            <span className="eyebrow justify-center">
              <span className="h-px w-8 bg-medical" />
              {eyebrow}
              <span className="h-px w-8 bg-medical" />
            </span>
          )}
          {title && <h1 className="heading-serif mt-4 text-2xl text-ink">{title}</h1>}
          {subtitle && <p className="mt-2 text-sm text-soft/70">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

// Content panel used on the dashboard and profile pages.
export function Panel({ title, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line/10 bg-card p-5 ${className}`}>
      {title && (
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          {title}
        </p>
      )}
      {children}
    </section>
  )
}

// Page header: eyebrow, serif title, one-line intro, optional action on the
// right.
export function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-8">
      <div>
        {eyebrow && (
          <span className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            {eyebrow}
          </span>
        )}
        <h1 className="heading-serif mt-3 text-3xl text-ink sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-soft/65">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

// Compact form input.
export const inputCls =
  'w-full rounded-xl border border-line/15 bg-sunk px-4 py-2.5 text-sm text-ink placeholder:text-soft/40 focus:border-medical focus:outline-none'

// Taller input for the sign-in card.
export const authInputCls =
  'w-full rounded-xl border border-line/15 bg-page px-4 py-3 text-ink placeholder:text-soft/40 focus-visible:border-medical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60'

// Blue primary pill and hairline outline pill.
export const primaryBtnCls =
  'rounded-full bg-medical px-6 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light disabled:opacity-40'
export const outlineBtnCls =
  'rounded-full border border-line/20 px-4 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-veil/10 disabled:opacity-40'

export function Field({ label, hint, htmlFor, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold uppercase tracking-[0.2em] text-accent"
      >
        {label}
      </label>
      {hint && <p className="mb-3 mt-1 text-xs text-soft/50">{hint}</p>}
      {!hint && <div className="mt-3" />}
      {children}
    </div>
  )
}

// Membership badge. Colours are per status; labels come from the contract.
const BADGE = {
  unverified: 'border-line/15 text-soft/70',
  candidate: 'border-medical/60 text-accent',
  active: 'border-emerald-400/50 text-ok',
  alumni: 'border-amber-400/50 text-warn',
}

export function StatusBadge({ status }) {
  const label = MEMBERSHIP_LABELS[status] || status || 'Unknown'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
        BADGE[status] || BADGE.unverified
      }`}
    >
      {label}
    </span>
  )
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-medical' : 'bg-veil/15'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// Inline error line.
export function ErrorText({ id, children }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-sm text-danger">
      {children}
    </p>
  )
}

export function BackLink({ to = '/', children = 'Back to AUSSS home' }) {
  return (
    <Link
      to={to}
      className="mt-6 inline-block w-full text-center text-xs font-semibold text-soft/60 transition-colors hover:text-ink"
    >
      &larr; {children}
    </Link>
  )
}
