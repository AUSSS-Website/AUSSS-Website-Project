import { useEffect, useRef, useState } from 'react'
import PdfReader from './PdfReader.jsx'
import { pressCls, scrollBehavior } from '../lib/motion.js'

// A PDF offered on a page as a card: what it is, then "Read it here", "Open in
// a new tab" and "Download PDF". The reader (PdfReader, with its search bar)
// opens under the card when asked for, so a page never loads a long document
// for people who came for something else.
//
//   id        the card's anchor; the reader's is `${id}-reader`
//   src       the file
//   title     its name: the card's heading and the reader's label
//   meta      one line of facts: date, pages, size
//   logo      an image heading the card, { src, alt }
//   jump      a second way in, { label, page }: opens the reader on that page
//   large     a file of many megabytes (see PdfReader)
//   heading   false when the page already has the title above the card
//   cardWidth, readerWidth   Tailwind max-width classes (the reader reads
//             better wider than the card)
//   children  the words about it

// The pills are at least 44px tall, in px: the root size is 15px on a 320px
// phone, where a height in rem (min-h-11) came to 41px.
const quietCls = `inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line/20 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-veil/10 ${pressCls}`

export default function DocumentCard({
  id,
  src,
  title,
  meta,
  logo,
  jump,
  large = false,
  heading = true,
  cardWidth = 'max-w-4xl',
  readerWidth = 'max-w-6xl',
  children,
}) {
  // The page the reader is open on, or 0 while it is closed.
  const [openAt, setOpenAt] = useState(0)
  // Counts the presses of the `jump` button, so each one opens the reader on
  // that page afresh: pressed again after reading on, or after scrolling back
  // up to the card, it used to do nothing at all.
  const [jumps, setJumps] = useState(0)
  const readerRef = useRef(null)

  // The reader opens below the card: bring it into view once it is there.
  useEffect(() => {
    if (!openAt) return
    readerRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }, [openAt, jumps])

  return (
    <div id={id} className="scroll-mt-28">
      <div className={`reveal mx-auto w-full ${cardWidth} rounded-2xl border border-line/10 bg-card/60 p-6 sm:p-7`}>
        {logo && (
          <img
            src={logo.src}
            alt={logo.alt}
            loading="lazy"
            decoding="async"
            className="logo-ink mb-4 h-9 w-auto max-w-full sm:h-10"
          />
        )}
        {heading && <h3 className="heading-serif text-xl text-ink sm:text-2xl">{title}</h3>}
        {children && <div className={`text-sm leading-relaxed text-soft/75 ${heading ? 'mt-2' : ''}`}>{children}</div>}
        {meta && (
          <p className={`text-xs font-medium uppercase tracking-[0.16em] text-soft/60 ${heading || children ? 'mt-3' : ''}`}>
            {meta}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setOpenAt((at) => (at ? 0 : 1))}
            aria-expanded={Boolean(openAt)}
            aria-controls={`${id}-reader`}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full bg-cta px-5 py-2.5 text-sm font-semibold text-on-cta hover:bg-cta-hover ${pressCls}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 3h7l5 5v13H7V3Z" strokeLinejoin="round" />
              <path d="M14 3v5h5M9 13h6M9 17h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {openAt ? 'Close the document' : 'Read it here'}
          </button>
          {jump && (
            <button
              type="button"
              onClick={() => {
                setOpenAt(jump.page)
                setJumps((n) => n + 1)
              }}
              aria-controls={`${id}-reader`}
              className={quietCls}
            >
              {jump.label}
            </button>
          )}
          <a href={src} target="_blank" rel="noopener noreferrer" className={quietCls}>
            Open in a new tab
          </a>
          <a href={src} download className={quietCls}>
            Download PDF
          </a>
        </div>
      </div>

      <div id={`${id}-reader`} ref={readerRef} className={`mx-auto w-full ${readerWidth} scroll-mt-28 ${openAt ? 'mt-6' : ''}`}>
        {/* Keyed by the page and the press, so "open at our pages" on an open reader starts it there. */}
        {openAt > 0 && (
          <PdfReader
            key={`${openAt}-${jumps}`}
            src={src}
            title={title}
            heightClass="h-[92vh]"
            startPage={openAt}
            large={large}
          />
        )}
      </div>
    </div>
  )
}
