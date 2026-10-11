import { useState, useCallback, useEffect, useRef } from 'react'
import useReveal from '../hooks/useReveal.js'
import useFocusTrap from '../hooks/useFocusTrap.js'
import { useWatchOrderSection } from '../lib/orderSectionView.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { merchPages, merchPdf } from '../data/merch.js'
import { useMerchCatalogue } from '../lib/merch.js'
import { pressCls } from '../lib/motion.js'
import ProductCard from '../components/ProductCard.jsx'

// The top offset of each desktop booklet column: alternate columns drop, so
// the four columns keep the two-column zigzag's stagger.
const BOOKLET_COLUMNS = ['', 'pt-24', '', 'pt-24']

// The round buttons laid over the two viewers (close, previous, next). The
// pressed colour is what answers a finger where nothing hovers and, with
// reduced motion, nothing sinks (the gallery's viewer has the same).
const viewerBtnCls = `grid place-items-center rounded-full bg-veil/10 text-ink hover:bg-veil/20 active:bg-veil/20 ${pressCls}`

// The dimming layer of the two viewers. It fades in (enter-scrim), and for a
// reader who asked for fewer see-through surfaces it is solid, with no blur.
const scrimCls =
  'enter-scrim dark fixed inset-0 flex items-center justify-center bg-page/95 p-4 backdrop-blur-sm reduce-transparency:bg-page reduce-transparency:backdrop-filter-none'

function BookletThumb({ page, idx, onOpen }) {
  return (
    // The scroll-in fade (.reveal) is on this wrapper. On the button itself
    // its 0.9 s transition took the place of the button's own, so the ring
    // under the pointer snapped.
    <div className="reveal">
      <button
        type="button"
        onClick={() => onOpen(idx)}
        className="group block w-full overflow-hidden rounded-xl ring-1 ring-line/10 transition-[box-shadow,transform] duration-200 ease-out hover:ring-medical/50 motion-safe:active:scale-[0.98]"
        aria-label={`Open page ${idx + 1} full screen`}
      >
        <img
          src={page.src}
          alt={`Merch booklet page ${idx + 1}`}
          width={page.w}
          height={page.h}
          loading={idx < 2 ? 'eager' : 'lazy'}
          className="w-full transition-transform duration-700 motion-safe:group-hover:scale-[1.01]"
        />
      </button>
    </div>
  )
}

function Lightbox({ index, onClose, onPrev, onNext }) {
  // Focus goes into the viewer and stays there, and returns to the thumbnail
  // that opened it when it closes. Without this the three buttons were at the
  // far end of the page for anyone using the keyboard.
  const trapRef = useFocusTrap(true, onClose)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, onPrev, onNext])

  const page = merchPages[index]
  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Merch booklet, page ${index + 1} of ${merchPages.length}`}
      className={`${scrimCls} z-[60]`}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={`absolute right-5 top-5 z-10 h-11 w-11 ${viewerBtnCls}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onPrev()
        }}
        aria-label="Previous page"
        className={`absolute left-3 z-10 h-12 w-12 sm:left-6 ${viewerBtnCls}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* The page rises into place as the viewer opens (enter-panel). It is
          the same element from page to page, so turning a page does not play
          the entry again. */}
      <img
        src={page.src}
        alt={`Merch booklet page ${index + 1}`}
        className="enter-panel max-h-[90vh] w-auto rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onNext()
        }}
        aria-label="Next page"
        className={`absolute right-3 z-10 h-12 w-12 sm:right-6 ${viewerBtnCls}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Turning a page leaves the focus on the arrow that was pressed, so a
          screen reader hears nothing unless the count says it has changed.
          The words are for it; the figures are what is seen. */}
      <span
        role="status"
        className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-veil/10 px-4 py-1 text-xs font-medium text-ink"
      >
        <span className="sr-only">
          Page {index + 1} of {merchPages.length}
        </span>
        <span aria-hidden="true">
          {index + 1} / {merchPages.length}
        </span>
      </span>
    </div>
  )
}

function SizeChartModal({ product, onClose }) {
  // Focus goes to the close button and returns to "Size chart" on closing.
  const trapRef = useFocusTrap(true, onClose)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${product.name} size chart`}
      className={`${scrimCls} z-[70]`}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close size chart"
        className={`absolute right-5 top-5 z-10 h-11 w-11 ${viewerBtnCls}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
      <figure className="enter-panel max-h-[90vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <img
          src={product.sizeChart}
          alt={`${product.name} size chart`}
          className="max-h-[80vh] w-auto rounded-lg bg-white p-4 shadow-2xl"
        />
        <figcaption className="mt-3 text-center text-xs text-soft/70">
          {product.name} · measurements in cm
        </figcaption>
      </figure>
    </div>
  )
}

export default function MerchPage() {
  usePageTitle(
    'Merch',
    'Official AUSSS 55th-edition merch: tees, the varsity jacket, bucket hats and notebooks. Order to support the society.',
  )
  useReveal()
  const { available: availableProducts } = useMerchCatalogue()
  const [openPage, setOpenPage] = useState(null)
  const [chartFor, setChartFor] = useState(null)
  const orderRef = useRef(null)
  useWatchOrderSection(orderRef)

  const closePage = useCallback(() => setOpenPage(null), [])
  // Kept the same from render to render: the size chart's focus trap starts
  // over whenever its onClose changes.
  const closeChart = useCallback(() => setChartFor(null), [])
  const prevPage = useCallback(
    () => setOpenPage((i) => (i <= 0 ? merchPages.length - 1 : i - 1)),
    [],
  )
  const nextPage = useCallback(
    () => setOpenPage((i) => (i >= merchPages.length - 1 ? 0 : i + 1)),
    [],
  )

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-12 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Shop AUSSS
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-ink sm:text-6xl">
            Merch 2025–26
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg font-normal text-soft/75 dark:font-light">
            Life Savers, Change Makers. Every piece in this drop is{' '}
            <strong className="text-ink">made to order</strong>: we collect
            orders, then run production, then coordinate pickup. What you pay
            for is what you get.
          </p>
        </div>
      </header>

      {/* Catalogue / booklet, comes first so visitors see the story before ordering */}
      <section className="pb-20">
        <div className="container-prose">
          <div className="reveal mx-auto max-w-2xl text-center">
            <span className="eyebrow justify-center">
              <span className="h-px w-8 bg-medical" />
              The catalogue
              <span className="h-px w-8 bg-medical" />
            </span>
            <h2 className="heading-serif mt-5 text-3xl text-ink sm:text-4xl">
              Flip through the 25–26 booklet
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base font-normal text-soft/70 dark:font-light">
              Designs, photoshoots, and the story behind the 55th anniversary
              drop.
            </p>
            {/* The least height is in px: the padding is in rem, and the root
                size shrinks on a 320px phone, which left the two pills a
                little under the 44px a thumb needs. */}
            <div className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href={merchPdf}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-solid px-6 py-3 text-sm font-semibold text-on-solid hover:bg-solid-hover motion-safe:hover:scale-[1.02] sm:w-auto ${pressCls}`}
              >
                Open full booklet (PDF)
              </a>
              <a
                href={merchPdf}
                download
                className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line/25 px-6 py-3 text-sm font-semibold text-ink hover:bg-veil/10 sm:w-auto ${pressCls}`}
              >
                Download
              </a>
            </div>
          </div>

          {/* Mobile: two staggered columns (zigzag), like the order cards. */}
          <div className="mx-auto mt-12 grid max-w-md grid-cols-2 gap-3 sm:hidden">
            <div className="flex flex-col gap-3">
              {merchPages.map((p, idx) =>
                idx % 2 === 0 ? (
                  <BookletThumb key={p.src} page={p} idx={idx} onOpen={setOpenPage} />
                ) : null,
              )}
            </div>
            <div className="flex flex-col gap-3 pt-10">
              {merchPages.map((p, idx) =>
                idx % 2 === 1 ? (
                  <BookletThumb key={p.src} page={p} idx={idx} onOpen={setOpenPage} />
                ) : null,
              )}
            </div>
          </div>

          {/* Tablet: two-column staggered zigzag, right column is offset
              down so pages weave between each other. */}
          <div className="mx-auto mt-12 hidden max-w-4xl grid-cols-2 gap-6 sm:grid lg:hidden">
            <div className="flex flex-col gap-6">
              {merchPages.map((p, idx) =>
                idx % 2 === 0 ? (
                  <BookletThumb
                    key={p.src}
                    page={p}
                    idx={idx}
                    onOpen={setOpenPage}
                  />
                ) : null,
              )}
            </div>
            <div className="flex flex-col gap-6 pt-20">
              {merchPages.map((p, idx) =>
                idx % 2 === 1 ? (
                  <BookletThumb
                    key={p.src}
                    page={p}
                    idx={idx}
                    onOpen={setOpenPage}
                  />
                ) : null,
              )}
            </div>
          </div>

          {/* Desktop: the same zigzag over four columns, so the booklet fills
              the width instead of running twice as long. Pages still read left
              to right, top to bottom (page 1 in column 1, page 2 in column 2),
              and every other column sits lower. */}
          <div className="mx-auto mt-12 hidden max-w-7xl grid-cols-4 gap-6 lg:grid xl:gap-8">
            {BOOKLET_COLUMNS.map((offset, col) => (
              <div key={offset + col} className={`flex flex-col gap-6 xl:gap-8 ${offset}`}>
                {merchPages.map((p, idx) =>
                  idx % BOOKLET_COLUMNS.length === col ? (
                    <BookletThumb
                      key={p.src}
                      page={p}
                      idx={idx}
                      onOpen={setOpenPage}
                    />
                  ) : null,
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Order cards, the real shop, at the bottom. While it is on screen the
          navbar's cart button opens into a pill with the count and subtotal. */}
      <section
        id="place-your-order"
        ref={orderRef}
        className="border-t border-line/10 bg-page py-20"
      >
        <div className="container-prose">
          <div className="reveal mx-auto mb-12 max-w-2xl text-center">
            <span className="eyebrow justify-center">
              <span className="h-px w-8 bg-medical" />
              Place your order
              <span className="h-px w-8 bg-medical" />
            </span>
            <h2 className="heading-serif mt-5 text-3xl text-ink sm:text-4xl">
              Order what you love
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base font-normal text-soft/70 dark:font-light">
              Pick your size, drop it in the cart, and we&rsquo;ll confirm
              pickup once production wraps.
            </p>
          </div>
          {/* Mobile: two staggered columns (zigzag), matching the booklet. */}
          <div className="grid grid-cols-2 gap-3 sm:hidden">
            <div className="flex flex-col gap-3">
              {availableProducts.map((p, idx) =>
                idx % 2 === 0 ? (
                  <ProductCard key={p.id} product={p} onOpenSizeChart={setChartFor} />
                ) : null,
              )}
            </div>
            <div className="flex flex-col gap-3 pt-10">
              {availableProducts.map((p, idx) =>
                idx % 2 === 1 ? (
                  <ProductCard key={p.id} product={p} onOpenSizeChart={setChartFor} />
                ) : null,
              )}
            </div>
          </div>

          {/* Desktop: even grid. */}
          <div className="hidden gap-6 sm:grid sm:grid-cols-2 lg:grid-cols-3">
            {availableProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onOpenSizeChart={setChartFor}
              />
            ))}
          </div>
        </div>
      </section>

      {openPage !== null && (
        <Lightbox
          index={openPage}
          onClose={closePage}
          onPrev={prevPage}
          onNext={nextPage}
        />
      )}
      {chartFor && <SizeChartModal product={chartFor} onClose={closeChart} />}
    </article>
  )
}
