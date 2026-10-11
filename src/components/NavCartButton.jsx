import { useSyncExternalStore } from 'react'
import { cartCount, cartSubtotal, formatEGP, openCartDrawer, useCart } from '../lib/cart.js'
import { getCatalogue, subscribeCatalogue } from '../lib/merch.js'
import { useOrderSectionInView } from '../lib/orderSectionView.js'

// The navbar's cart button, and the pill it becomes while the "Place your
// order" section of /merch is on screen: the visitor sees each add land
// (count and subtotal) without leaving the shop. Neither ever opens the
// drawer by itself, since the drawer locks page scrolling.
//
// Where the pill goes depends on the room in the bar:
// - the phone row (below md) has room, so the round button itself grows;
// - the desktop row is already full of links up to very wide screens, so the
//   round button stays and a pill floats at the bottom centre instead.
// The bar is fixed and never hides on scroll, so either one stays in view.

function useCartSummary() {
  const cart = useCart()
  // Prices live in the catalogue, so the subtotal re-reads when it arrives.
  useSyncExternalStore(subscribeCatalogue, getCatalogue, getCatalogue)
  const count = cartCount(cart)
  const subtotal = formatEGP(cartSubtotal(cart))
  const items = `${count} ${count === 1 ? 'item' : 'items'}`
  const label = count > 0 ? `Open cart, ${items}, ${subtotal}` : 'Open cart, it is empty'
  return { count, subtotal, items, label }
}

function CartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M3 6h2l2 12h12l2-9H7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
    </svg>
  )
}

function CountBadge({ count }) {
  return (
    <span className="absolute -right-1 -top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-cta px-1 text-3xs font-bold text-on-cta ring-2 ring-cream dark:ring-forest-950">
      {count > 99 ? '99+' : count}
    </span>
  )
}

const PILL_SKIN =
  'border-transparent bg-cta text-on-cta shadow-md shadow-cta/30 hover:bg-cta-hover dark:shadow-lg dark:shadow-cta/20'

// `tone` mirrors the navbar's solid/transparent state; `compact` is the phone
// row's smaller size, and only that one grows (see above).
export default function NavCartButton({ tone = 'solid', compact = false }) {
  const { count, subtotal, items, label } = useCartSummary()
  const inView = useOrderSectionInView()
  const expanded = compact && inView

  const size = compact ? 'h-9 min-w-[2.25rem]' : 'h-10 min-w-[2.5rem]'
  const pad = expanded ? 'pl-2.5 pr-3.5' : compact ? 'px-[7px]' : 'px-[9px]'
  const skin = expanded
    ? PILL_SKIN
    : tone === 'solid'
      ? 'border-forest-600/20 text-forest hover:bg-forest/5 dark:border-white/15 dark:text-silver dark:hover:bg-white/5'
      : 'border-forest-600/20 text-forest hover:bg-forest/5 dark:border-white/25 dark:text-white dark:hover:bg-white/10'

  // The button's own changes take 150 ms, the pace of every other button, and
  // it sinks a little while pressed; the label inside keeps its slower slide.
  // With reduced motion only the colours ease, and the label fades in without
  // sliding. The round button is under 44px, so an unseen ::after of that
  // height (and at least that width), in px because the root size shrinks on
  // a small phone, takes the finger.
  return (
    <button
      type="button"
      onClick={openCartDrawer}
      aria-label={label}
      data-expanded={expanded ? 'true' : 'false'}
      className={`relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border transition-[padding,background-color,border-color,color,box-shadow,transform] duration-150 ease-out after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-full after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] motion-safe:active:scale-[0.97] motion-reduce:transition-colors ${size} ${pad} ${skin}`}
    >
      <CartIcon />

      {/* The label slides open by its max-width; with reduced motion it fades
          in at its full width. On the narrowest phones it is the subtotal
          alone and the badge keeps the count, so the logo and menu button keep
          their room. aria-hidden: the button's aria-label already says all of
          it. */}
      {compact && (
        <span
          aria-hidden="true"
          className={`overflow-hidden text-xs font-semibold transition-[max-width,opacity,margin] duration-300 motion-reduce:transition-opacity ${
            expanded ? 'ml-2 max-w-[16rem] opacity-100' : 'ml-0 max-w-0 opacity-0'
          }`}
        >
          {count > 0 ? (
            <>
              <span className="hidden sm:inline">
                {items}
                <span className="mx-1.5 opacity-60">·</span>
              </span>
              {subtotal}
            </>
          ) : (
            'Empty'
          )}
          <span className="hidden sm:inline">
            <span className="mx-1.5 opacity-60">·</span>
            View cart
          </span>
        </span>
      )}

      {/* Once the label carries the count (sm and up), the badge steps aside. */}
      {count > 0 && (
        <span className={expanded ? 'sm:hidden' : undefined}>
          <CountBadge count={count} />
        </span>
      )}
    </button>
  )
}

// The desktop pill: floats at the bottom centre while the order section is on
// screen, from lg up (below that the phone row grows its own button). Hidden, it
// is out of the tab order and the accessibility tree. It fades in while it
// rises 12px, and only fades for a reader who asked for less motion.
export function FloatingCartPill() {
  const { count, subtotal, items, label } = useCartSummary()
  const shown = useOrderSectionInView()

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-40 hidden justify-center px-4 lg:flex"
      ref={(el) => {
        if (el) el.inert = !shown
      }}
      aria-hidden={shown ? undefined : 'true'}
    >
      <button
        type="button"
        onClick={openCartDrawer}
        aria-label={label}
        data-floating-cart={shown ? 'shown' : 'hidden'}
        className={`inline-flex h-12 items-center gap-2.5 whitespace-nowrap rounded-full border pl-4 pr-5 text-sm font-semibold transition-[opacity,transform,background-color] duration-200 ease-out motion-safe:active:scale-[0.97] ${PILL_SKIN} ${
          shown
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'opacity-0 motion-safe:translate-y-3'
        }`}
      >
        <CartIcon />
        <span aria-hidden="true">
          {count > 0 ? (
            <>
              {items}
              <span className="mx-2 opacity-60">·</span>
              {subtotal}
            </>
          ) : (
            'Your cart is empty'
          )}
          <span className="mx-2 opacity-60">·</span>
          View cart
        </span>
      </button>
    </div>
  )
}
