import { useEffect, useRef, useState } from 'react'
import { addToCart, formatEGP } from '../lib/cart.js'

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
    if (!canAdd) {
      if (needsSize && !size) setFeedback('Pick a size first')
      else if (needsDesign && !design) setFeedback('Pick a design first')
      return
    }
    addToCart({ productId: product.id, size, design })
    setFeedback('Added to cart')
    clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(''), 1500)
  }

  return (
    <article className="reveal group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-forest-800 transition-all duration-500 hover:-translate-y-1 hover:border-medical/40">
      <div className="relative aspect-[5/7] w-full overflow-hidden bg-forest-900">
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
        />
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-6">
        <h3 className="heading-serif text-base text-white sm:text-xl">{product.name}</h3>
        {product.tagline && (
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-medical-light sm:text-xs">
            {product.tagline}
          </p>
        )}
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-silver/70 sm:mt-3 sm:line-clamp-none sm:text-sm">
          {product.description}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2 sm:mt-5 sm:gap-3">
          <span className="heading-serif text-xl text-white sm:text-2xl">
            {formatEGP(product.price)}
          </span>
          <span className="hidden rounded-full border border-medical/40 bg-medical/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-medical-light sm:inline-block">
            Pre-order
          </span>
        </div>

        {needsSize && (
          <div className="mt-4 sm:mt-5" role="group" aria-labelledby={`size-label-${product.id}`}>
            <div className="flex items-center justify-between">
              <span
                id={`size-label-${product.id}`}
                className="text-xs font-semibold uppercase tracking-[0.16em] text-silver/60"
              >
                Size
              </span>
              {product.sizeChart && (
                <button
                  type="button"
                  onClick={() => onOpenSizeChart?.(product)}
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-medical-light transition-colors hover:text-white"
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
                  onClick={() => setSize(s)}
                  aria-pressed={size === s}
                  className={`min-w-[2.5rem] rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors sm:min-w-[3rem] sm:px-3 ${
                    size === s
                      ? 'border-medical bg-medical text-forest-950'
                      : 'border-white/15 text-silver/80 hover:border-white/30 hover:text-white'
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
              className="text-xs font-semibold uppercase tracking-[0.16em] text-silver/60"
            >
              Design
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {product.designs.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDesign(d)}
                  aria-pressed={design === d}
                  className={`rounded-full border px-3 py-1.5 text-center text-xs font-semibold transition-colors ${
                    product.wideDesigns?.includes(d) ? 'col-span-2' : ''
                  } ${
                    design === d
                      ? 'border-medical bg-medical text-forest-950'
                      : 'border-white/15 text-silver/80 hover:border-white/30 hover:text-white'
                  }`}
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
            className="group/btn flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-xs font-semibold text-forest transition-transform hover:scale-[1.02] sm:px-5 sm:py-3 sm:text-sm"
          >
            {feedback || 'Add to cart'}
            {!feedback && (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
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
  )
}
