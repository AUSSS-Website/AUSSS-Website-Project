import { useState, useRef, useEffect, lazy, Suspense, Component } from 'react'
import {
  incomingsBooklet,
  bookletPageUrls,
  bookletCover,
} from '../data/incomingsBooklet.js'

// The flipbook drags in react-pageflip and eagerly preloads every page image
// (~4 MB), so it is both code-split AND only mounted once the reader is opened.
// Until then /exchange/incomings pays for one cover thumbnail.
const Flipbook = lazy(() => import('./Flipbook.jsx'))

// The welcome booklet for students coming to Ain Shams on exchange, read in
// the same page-flipping reader as the magazine. Collapsed to a cover card by
// default; "Read the booklet" expands it in place.
export default function IncomingsBooklet() {
  const [open, setOpen] = useState(false)
  const readerRef = useRef(null)
  const booklet = incomingsBooklet
  const pages = bookletPageUrls(booklet)

  // The reader opens *below* the card, which on a page this long can land
  // entirely off-screen, so bring it into view once it has mounted.
  useEffect(() => {
    if (!open) return
    readerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [open])

  if (pages.length === 0) return null

  return (
    <section id="incomings-booklet" className="reveal mx-auto max-w-4xl scroll-mt-24">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-forest-800">
        <div className="grid gap-0 sm:grid-cols-[minmax(0,15rem)_1fr]">
          {/* The cover is a busy collage, show it whole rather than cropping
              the wordmark off, on a slightly darker panel so it reads as a
              cover sitting in the card. */}
          <div className="flex items-center justify-center bg-forest-950/50 p-6">
            <img
              src={bookletCover(booklet)}
              alt={`${booklet.title} cover`}
              loading="lazy"
              decoding="async"
              className="w-full max-w-[11rem] rounded-lg shadow-lg shadow-black/40 ring-1 ring-white/10 sm:max-w-none"
            />
          </div>
          <div className="p-7 sm:p-9">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-medical-light">
              {booklet.eyebrow}
            </p>
            <h2 className="heading-serif mt-2 text-2xl text-white sm:text-3xl">
              {booklet.title}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-silver/70">
              {booklet.blurb}
            </p>
            <ul className="mt-5 space-y-1.5">
              {booklet.contents.map((c) => (
                <li key={c} className="flex gap-2.5 text-sm text-silver/60">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-medical-light" />
                  {c}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="incomings-booklet-reader"
                className="inline-flex items-center gap-2 rounded-full bg-medical px-5 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light"
              >
                {open ? 'Close the booklet' : 'Read the booklet'}
                <span aria-hidden="true">{open ? '×' : '›'}</span>
              </button>
              {booklet.download && (
                <a
                  href={booklet.download}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Download (full quality)
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {open && (
        <div id="incomings-booklet-reader" ref={readerRef} className="mt-8 scroll-mt-24">
          <ReaderBoundary pages={pages}>
            <Suspense fallback={<ReaderLoading />}>
              <Flipbook pages={pages} title={booklet.title} />
            </Suspense>
          </ReaderBoundary>
        </div>
      )}
    </section>
  )
}

function ReaderLoading() {
  return (
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-forest-800">
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-medical-light"
      />
      <p className="mt-4 text-sm text-silver/60">Opening the booklet…</p>
    </div>
  )
}

// If react-pageflip throws, fall back to the plain page images rather than
// blanking the whole exchange page.
class ReaderBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    console.error('Incomings booklet reader failed:', error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="space-y-4">
        <p className="text-center text-sm text-silver/60">
          The page-flip reader couldn’t start in this browser. Here are the
          pages instead.
        </p>
        {this.props.pages.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`Incomings booklet, page ${i + 1}`}
            loading="lazy"
            className="mx-auto w-full max-w-[720px] rounded-xl border border-white/10"
          />
        ))}
      </div>
    )
  }
}
