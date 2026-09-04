import { useState, useCallback, useEffect } from 'react'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { merchPages, merchPdf } from '../data/merch.js'
import { availableProducts } from '../data/merchProducts.js'
import ProductCard from '../components/ProductCard.jsx'

function BookletThumb({ page, idx, onOpen }) {
  return (
    <button
      onClick={() => onOpen(idx)}
      className="reveal group block w-full overflow-hidden rounded-xl ring-1 ring-white/10 transition-all duration-500 hover:ring-medical/50"
      aria-label={`Open page ${idx + 1} full screen`}
    >
      <img
        src={page.src}
        alt={`Merch booklet page ${idx + 1}`}
        width={page.w}
        height={page.h}
        loading={idx < 2 ? 'eager' : 'lazy'}
        className="w-full transition-transform duration-700 group-hover:scale-[1.01]"
      />
    </button>
  )
}

function Lightbox({ index, onClose, onPrev, onNext }) {
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-forest-950/95 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onPrev()
        }}
        aria-label="Previous page"
        className="absolute left-3 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-6"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <img
        src={page.src}
        alt={`Merch booklet page ${index + 1}`}
        className="max-h-[90vh] w-auto rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNext()
        }}
        aria-label="Next page"
        className="absolute right-3 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-6"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1 text-xs font-medium text-white">
        {index + 1} / {merchPages.length}
      </span>
    </div>
  )
}

function SizeChartModal({ product, onClose }) {
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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-forest-950/95 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close size chart"
        className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
      <figure className="max-h-[90vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <img
          src={product.sizeChart}
          alt={`${product.name} size chart`}
          className="max-h-[80vh] w-auto rounded-lg bg-white p-4 shadow-2xl"
        />
        <figcaption className="mt-3 text-center text-xs text-silver/70">
          {product.name} · measurements in cm
        </figcaption>
      </figure>
    </div>
  )
}

export default function MerchPage() {
  usePageTitle(
    'Merch',
    'Official AUSSS 55th-edition merch: tees, the varsity jacket, bucket hats and notebooks. Pre-order to support the society.',
  )
  useReveal()
  const [openPage, setOpenPage] = useState(null)
  const [chartFor, setChartFor] = useState(null)

  const closePage = useCallback(() => setOpenPage(null), [])
  const prevPage = useCallback(
    () => setOpenPage((i) => (i <= 0 ? merchPages.length - 1 : i - 1)),
    [],
  )
  const nextPage = useCallback(
    () => setOpenPage((i) => (i >= merchPages.length - 1 ? 0 : i + 1)),
    [],
  )

  return (
    <article className="bg-forest-950">
      <header className="relative overflow-hidden pb-12 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, #C9D6DF 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Shop AUSSS
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-white sm:text-6xl">
            Merch 2025–26
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg font-light text-silver/75">
            Life Savers, Change Makers. Every piece in this drop is{' '}
            <strong className="text-white">pre-order only</strong>: we collect
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
            <h2 className="heading-serif mt-5 text-3xl text-white sm:text-4xl">
              Flip through the 25–26 booklet
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base font-light text-silver/70">
              Designs, photoshoots, and the story behind the 55th anniversary
              drop.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href={merchPdf}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-transform hover:scale-[1.03] sm:w-auto"
              >
                Open full booklet (PDF)
              </a>
              <a
                href={merchPdf}
                download
                className="w-full rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
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

          {/* Desktop: two-column staggered zigzag, right column is offset
              down by half a page height so pages weave between each other. */}
          <div className="mx-auto mt-12 hidden max-w-4xl gap-6 sm:grid sm:grid-cols-2 lg:gap-10">
            <div className="flex flex-col gap-6 lg:gap-10">
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
            <div className="flex flex-col gap-6 pt-20 lg:gap-10 lg:pt-28">
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
        </div>
      </section>

      {/* Order cards, the real shop, at the bottom */}
      <section className="border-t border-white/10 bg-forest-950 py-20">
        <div className="container-prose">
          <div className="reveal mx-auto mb-12 max-w-2xl text-center">
            <span className="eyebrow justify-center">
              <span className="h-px w-8 bg-medical" />
              Place your pre-order
              <span className="h-px w-8 bg-medical" />
            </span>
            <h2 className="heading-serif mt-5 text-3xl text-white sm:text-4xl">
              Order what you love
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base font-light text-silver/70">
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
      {chartFor && (
        <SizeChartModal product={chartFor} onClose={() => setChartFor(null)} />
      )}
    </article>
  )
}
