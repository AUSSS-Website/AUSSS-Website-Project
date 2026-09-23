import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  useCart,
  cartSubtotal,
  cartCount,
  updateQty,
  removeFromCart,
  formatEGP,
} from '../lib/cart.js'
import { productById } from '../data/merchProducts.js'
import useFocusTrap from '../hooks/useFocusTrap.js'

export default function CartDrawer({ open, onClose }) {
  const cart = useCart()
  const count = cartCount(cart)
  const subtotal = cartSubtotal(cart)
  const panelRef = useFocusTrap(open, onClose)

  // Lock background scroll while the drawer is open. (Escape + focus trapping
  // are handled by useFocusTrap.)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <div
      className={`fixed inset-0 z-[60] ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-forest-950/70 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-heading"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-cream text-forest-900 shadow-2xl transition-transform duration-300 dark:bg-forest-900 dark:text-silver ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-forest-600/10 px-6 py-5 dark:border-white/10">
          <h2 id="cart-heading" className="heading-serif text-xl text-forest dark:text-white">
            Your cart
            {count > 0 && (
              <span className="ml-2 text-sm font-normal text-forest-900/60 dark:text-silver/60">
                ({count} item{count === 1 ? '' : 's'})
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="grid h-9 w-9 place-items-center rounded-full text-forest-900/70 transition-colors hover:bg-forest-900/5 dark:text-silver/70 dark:hover:bg-white/5"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {cart.items.length === 0 ? (
          <EmptyState onClose={onClose} />
        ) : (
          <>
            <ul className="flex-1 divide-y divide-forest-600/10 overflow-y-auto px-6 dark:divide-white/10">
              {cart.items.map((it) => {
                const p = productById[it.productId]
                if (!p) return null
                return (
                  <li key={`${it.productId}::${it.size}::${it.design}`} className="flex gap-4 py-5">
                    <img
                      src={p.image}
                      alt={p.name}
                      className="h-20 w-16 flex-shrink-0 rounded-md object-cover"
                    />
                    <div className="flex flex-1 flex-col">
                      <h3 className="text-sm font-semibold text-forest dark:text-white">
                        {p.name}
                      </h3>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.12em] text-forest-900/60 dark:text-silver/60">
                        {it.size && <span>Size: {it.size}</span>}
                        {it.design && <span>Design: {it.design}</span>}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <QtyStepper
                          qty={it.qty}
                          onDec={() =>
                            updateQty({ ...it, qty: it.qty - 1 })
                          }
                          onInc={() =>
                            updateQty({ ...it, qty: it.qty + 1 })
                          }
                          onRemove={() => removeFromCart(it)}
                        />
                        <span className="text-sm font-semibold text-forest dark:text-white">
                          {formatEGP(p.price * it.qty)}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            <footer className="border-t border-forest-600/10 px-6 py-5 dark:border-white/10">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold uppercase tracking-[0.14em] text-forest-900/70 dark:text-silver/70">
                  Subtotal
                </span>
                <span className="heading-serif text-2xl text-forest dark:text-white">
                  {formatEGP(subtotal)}
                </span>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-forest-900/60 dark:text-silver/55">
                Everything is pre-order. We&rsquo;ll WhatsApp you to confirm the
                details and arrange pickup.
              </p>
              <Link
                to="/merch/checkout"
                onClick={onClose}
                className="block w-full rounded-full bg-forest py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-forest-600 dark:bg-medical dark:text-forest-950 dark:hover:bg-medical-light"
              >
                Checkout
              </Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  )
}

function EmptyState({ onClose }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <svg
        viewBox="0 0 24 24"
        className="h-12 w-12 text-forest-900/30 dark:text-silver/30"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path
          d="M3 6h2l2 12h12l2-9H7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9" cy="20" r="1" />
        <circle cx="17" cy="20" r="1" />
      </svg>
      <p className="heading-serif mt-4 text-xl text-forest dark:text-white">
        Your cart is empty
      </p>
      <p className="mt-2 text-sm text-forest-900/60 dark:text-silver/60">
        Browse the merch and add something you like.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-600 dark:bg-medical dark:text-forest-950 dark:hover:bg-medical-light"
      >
        Keep browsing
      </button>
    </div>
  )
}

function QtyStepper({ qty, onDec, onInc, onRemove }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="inline-flex items-center rounded-full border border-forest-600/20 dark:border-white/15">
        <button
          type="button"
          onClick={qty <= 1 ? onRemove : onDec}
          aria-label={qty <= 1 ? 'Remove from cart' : 'Decrease quantity'}
          className="grid h-9 w-9 place-items-center text-forest-900/70 transition-colors hover:text-forest dark:text-silver/70 dark:hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            {qty <= 1 ? (
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M5 12h14" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <span className="min-w-[1.75rem] text-center text-xs font-semibold text-forest dark:text-white">
          {qty}
        </span>
        <button
          type="button"
          onClick={onInc}
          aria-label="Increase quantity"
          className="grid h-9 w-9 place-items-center text-forest-900/70 transition-colors hover:text-forest dark:text-silver/70 dark:hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
