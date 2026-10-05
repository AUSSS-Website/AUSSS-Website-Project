import { openCartDrawer, useCartCount } from '../lib/cart.js'

// `tone` mirrors the Navbar's solid/transparent state so the button reads
// against both the dark hero and the solid bar.
export default function CartButton({ tone = 'solid', className = '' }) {
  const count = useCartCount()

  const base =
    'relative grid h-10 w-10 place-items-center rounded-full border transition-colors'
  const skin =
    tone === 'solid'
      ? 'border-forest-600/20 text-forest hover:bg-forest/5 dark:border-white/15 dark:text-silver dark:hover:bg-white/5'
      : 'border-forest-600/20 text-forest hover:bg-forest/5 dark:border-white/25 dark:text-white dark:hover:bg-white/10'

  return (
    <button
      type="button"
      onClick={openCartDrawer}
      aria-label={count > 0 ? `Open cart, ${count} items` : 'Open cart'}
      className={`${base} ${skin} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path
          d="M3 6h2l2 12h12l2-9H7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9" cy="20" r="1" />
        <circle cx="17" cy="20" r="1" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-medical px-1 text-[10px] font-bold text-forest-950">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
