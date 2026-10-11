import { useEffect, useRef, useState } from 'react'
import { addToCart, formatEGP } from '../lib/cart.js'
import { pressCls } from '../lib/motion.js'

// A size or a design to pick. Under a finger it is at least 44px each way (in
// px, not rem, since the root size shrinks on a 320px phone); under a mouse it
// stays the small pill it was.
const choiceCls = `rounded-full border text-xs font-semibold ${pressCls} [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]`
const chosenCls = 'border-medical bg-cta text-on-cta'
const unchosenCls = 'border-line/15 text-soft/80 hover:border-line/30 hover:text-ink'

export default function ProductCard({ product, onOpenSizeChart }) {
  const needsSize = product.sizes.length > 1
  const needsDesign = product.designs.length > 0

  const [size, setSize] = useState(
    product.sizes.length === 1 ? product.sizes[0] : '',
  )
  const [design, setDesign] = useState('')
  const [feedback, setFeedback] = useState('')
  // Reset on every add so rapid re-adds don't cut the message short.
  const feedbackTimer = useRef()
  useEffect(() => () => clearTimeout(feedbackTimer.current), [])

  const canAdd = (!needsSize || size) && (!needsDesign || design)

  const onAdd = () => {
    clearTimeout(feedbackTimer.current)
    if (!canAdd) {
      if (needsSize && !size) setFeedback('Pick a size first')
      else if (needsDesign && !design) setFeedback('Pick a design first')
      return
    }
    addToCart({ productId: product.id, size, design })
    setFeedback('Added to cart')
    feedbackTimer.current = setTimeout(() => setFeedback(''), 1500)
  }

  // A pick answers "Pick a size first", so the button goes back to "Add to
  // cart" at once and does not keep asking for what it has just been given.
  const pick = (set, value) => {
    set(value)
    clearTimeout(feedbackTimer.current)
    setFeedback('')
  }

  return (
    // The scroll-in fade (.reveal) is on this wrapper. On the card itself its
    // 0.9 s transition took the place of the card's own, so the lift under
    // the pointer dragged and the border snapped.
    <div className="reveal h-full">
      <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line/10 bg-card transition-[transform,border-color] duration-300 ease-out hover:border-medical/40 motion-safe:hover:-translate-y-1">
        <div className="relative aspect-[5/7] w-full overflow-hidden bg-sunk">
          {product.image && (
            <img
              src={product.image}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-contain transition-transform duration-700 motion-safe:group-hover:scale-[1.02]"
            />
          )}
        </div>

        <div className="flex flex-1 flex-col p-4 sm:p-6">
          <h3 className="heading-serif text-base text-ink sm:text-xl">{product.name}</h3>
          {product.tagline && (
            <p className="mt-1 text-3xs font-semibold uppercase tracking-[0.18em] text-accent sm:text-xs">
              {product.tagline}
            </p>
          )}
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-soft/70 sm:mt-3 sm:line-clamp-none sm:text-sm">
            {product.description}
          </p>

          <div className="mt-4 flex items-center justify-between gap-2 sm:mt-5 sm:gap-3">
            <span className="heading-serif text-xl text-ink sm:text-2xl">
              {formatEGP(product.price)}
            </span>
            <span className="hidden rounded-full border border-medical/40 bg-medical/10 px-3 py-1 text-3xs font-semibold uppercase tracking-[0.18em] text-accent sm:inline-block">
              Made to order
            </span>
          </div>

          {needsSize && (
            <div className="mt-4 sm:mt-5" role="group" aria-labelledby={`size-label-${product.id}`}>
              <div className="flex items-center justify-between">
                <span
                  id={`size-label-${product.id}`}
                  className="text-xs font-semibold uppercase tracking-[0.16em] text-soft/60"
                >
                  Size
                </span>
                {product.sizeChart && (
                  // Small words with a thumb's 44px to land on: an unseen
                  // ::after reaches up into the empty space above them, and
                  // only as far down as the gap before the sizes.
                  <button
                    type="button"
                    onClick={() => onOpenSizeChart?.(product)}
                    className={`relative text-2xs font-semibold uppercase tracking-[0.14em] text-accent after:absolute after:-inset-x-[8px] after:-bottom-[8px] after:-top-[20px] after:content-[''] hover:text-ink ${pressCls}`}
                  >
                    Size chart
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pick(setSize, s)}
                    aria-pressed={size === s}
                    className={`min-w-[2.5rem] px-2.5 py-1.5 sm:min-w-[3rem] sm:px-3 ${choiceCls} ${
                      size === s ? chosenCls : unchosenCls
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsDesign && (
            <div className="mt-4 sm:mt-5" role="group" aria-labelledby={`design-label-${product.id}`}>
              <span
                id={`design-label-${product.id}`}
                className="text-xs font-semibold uppercase tracking-[0.16em] text-soft/60"
              >
                Design
              </span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {product.designs.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => pick(setDesign, d)}
                    aria-pressed={design === d}
                    className={`px-3 py-1.5 text-center ${choiceCls} ${
                      product.wideDesigns?.includes(d) ? 'col-span-2' : ''
                    } ${design === d ? chosenCls : unchosenCls}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="sr-only" role="status" aria-live="polite">
            {feedback}
          </p>

          <div className="mt-auto pt-4 sm:pt-6">
            <button
              type="button"
              onClick={onAdd}
              className={`group/btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-solid px-4 py-2.5 text-xs font-semibold text-on-solid hover:bg-solid-hover motion-safe:hover:scale-[1.02] sm:px-5 sm:py-3 sm:text-sm ${pressCls}`}
            >
              {feedback || 'Add to cart'}
              {!feedback && (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 transition-transform motion-safe:group-hover/btn:translate-x-0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    d="M3 6h2l2 12h12l2-9H7M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </article>
    </div>
  )
}
