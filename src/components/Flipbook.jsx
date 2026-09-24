import { useEffect, useRef, useState } from 'react'
import HTMLFlipBook from 'react-pageflip'
import useMediaQuery from '../hooks/useMediaQuery.js'

// A page-flipping reader: the magazine's pre-rendered page images turned into a
// book with a real page-curl, a two-page spread on desktop, a single page on
// mobile. Images are pre-built from the full-quality PDF (see
// _source/build-magazine.mjs), so there's no big download and no client pdf.js.
// `onPage(n)` (optional) reports the furthest page now visible, 1-based: the
// right-hand page of a spread on desktop, the single page on a phone. The
// magazine uses it to record how far readers get.
export default function Flipbook({ pages, title, onPage }) {
  const [ratio, setRatio] = useState(null) // page height ÷ width
  const [page, setPage] = useState(0)
  const isMobile = useMediaQuery('(max-width: 767px)')
  const bookRef = useRef(null)

  useEffect(() => {
    if (!onPage || !ratio) return
    // Page 0 is the cover alone; from then on a desktop spread shows two pages.
    const visible = isMobile || page === 0 ? page + 1 : Math.min(pages.length, page + 2)
    onPage(visible)
  }, [onPage, page, isMobile, pages.length, ratio])

  // Lock the book's proportions to the real page shape before rendering it.
  useEffect(() => {
    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) setRatio(probe.naturalHeight / probe.naturalWidth || 1.4142)
    }
    probe.onerror = () => {
      if (!cancelled) setRatio(1.4142)
    }
    probe.src = pages[0]
    return () => {
      cancelled = true
    }
  }, [pages])

  // Preload + decode every page up front. Without this, flipping to a page
  // whose image hasn't downloaded/decoded yet exposes the bare white page for a
  // frame, a white flash on every flip. Decoding ahead of time keeps each flip
  // landing on a ready image.
  useEffect(() => {
    for (const url of pages) {
      const img = new Image()
      img.src = url
      img.decode?.().catch(() => {})
    }
  }, [pages])

  // Left/right arrow keys flip the book, but not while the user is typing in a
  // field elsewhere on the page.
  useEffect(() => {
    if (!ratio) return
    const onKey = (e) => {
      const t = e.target
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      if (e.key === 'ArrowLeft') bookRef.current?.pageFlip()?.flipPrev()
      else if (e.key === 'ArrowRight') bookRef.current?.pageFlip()?.flipNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ratio])

  if (!ratio) {
    return (
      <div
        role="status"
        className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-forest-800"
      >
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-medical-light"
        />
        <p className="mt-4 text-sm text-silver/60">Opening the magazine…</p>
      </div>
    )
  }

  const baseW = 582
  // On phones the frame is full-bleed, so let a single portrait page stretch
  // wide enough to fill it (no parchment showing at the sides). Desktop keeps
  // its exact two-page sizing.
  const maxW = isMobile ? 1200 : 728

  return (
    <div className="flex w-full flex-col items-center">
      <div className="magazine-frame mx-auto w-full max-w-[717px] md:max-w-[1496px]">
        <HTMLFlipBook
          ref={bookRef}
          width={baseW}
          height={Math.round(baseW * ratio)}
          size="stretch"
          minWidth={300}
          maxWidth={maxW}
          minHeight={Math.round(300 * ratio)}
          maxHeight={Math.round(maxW * ratio)}
          maxShadowOpacity={0.5}
          showCover
          mobileScrollSupport
          usePortrait={isMobile}
          drawShadow
          flippingTime={700}
          onFlip={(e) => setPage(e.data)}
          className="mx-auto"
        >
          {pages.map((url, i) => {
            const isCover = i === 0 || i === pages.length - 1
            return (
              <div
                key={i}
                className="overflow-hidden rounded-[10px] bg-white"
                data-density={isCover ? 'hard' : 'soft'}
              >
                <img
                  src={url}
                  alt={`${title}, page ${i + 1}`}
                  className="h-full w-full select-none"
                  draggable={false}
                  loading="eager"
                  decoding="sync"
                />
              </div>
            )
          })}
        </HTMLFlipBook>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => bookRef.current?.pageFlip()?.flipPrev()}
          aria-label="Previous page"
          className={navBtn}
        >
          ‹ Prev
        </button>
        <button
          type="button"
          onClick={() => bookRef.current?.pageFlip()?.flipNext()}
          aria-label="Next page"
          className={navBtn}
        >
          Next ›
        </button>
      </div>
      <p className="mt-3 text-xs text-silver/60">
        Drag a corner or use the arrows to flip.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        Page {page + 1} of {pages.length}
      </p>
    </div>
  )
}

const navBtn =
  'inline-flex items-center gap-2 rounded-full border border-white/15 bg-forest-800 px-4 py-2 text-sm font-medium text-silver/80 transition-colors hover:border-medical/40 hover:text-white'
