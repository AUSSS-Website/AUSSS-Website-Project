import CountUp from './CountUp.jsx'
import { pressCls } from '../lib/motion.js'

// The parts of /ifmsa whose words are the block `ifmsa.page` (edited by the EB
// in the portal), shared with the portal's preview.

// Two columns on a phone; from 640px one row, however many figures there are.
const COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }

export function StatBand({ title, items }) {
  const cols = COLS[items.length] || COLS[4]
  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-accent">
        {title}
      </p>
      {/* The 1px gaps are the dividers: the wrapper's line colour showing
          between cells filled with the page colour. Two faint fills on top of
          each other came out the same shade on the light theme and the
          dividers vanished. */}
      <div className={`mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line/10 bg-line/10 ${cols}`}>
        {items.map((s, i) => (
          // A little of the line colour shows through each cell as a tint; it
          // turns solid for a reader who asked for less transparency or for
          // more contrast. Nothing lies behind the band, so it has no blur. On
          // a phone an odd one out takes the whole last row, or the empty half
          // would show as a block of the line colour.
          <div
            key={i}
            className={`bg-page/80 px-4 py-6 text-center reduce-transparency:bg-page contrast-more:bg-page ${
              items.length % 2 === 1 && i === items.length - 1 ? 'col-span-2 sm:col-span-1' : ''
            }`}
          >
            <div className="heading-serif text-2xl text-ink sm:text-3xl">
              <CountUp value={s.value} />
            </div>
            <div className="mt-1 text-2xs uppercase tracking-widest text-soft/70">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function IfmsaPoints({ points }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {points.map((p, i) => (
        <div key={i} className="rounded-2xl border border-line/10 bg-card p-7">
          <h3 className="heading-serif text-xl text-ink">{p.title}</h3>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-soft/70">{p.body}</p>
        </div>
      ))}
    </div>
  )
}

export function IfmsaLinks({ links }) {
  if (links.length === 0) return null
  return (
    <>
      <p className="text-sm uppercase tracking-[0.2em] text-soft/50">Learn more</p>
      <div className="mt-5 flex flex-wrap justify-center gap-4">
        {links.map((l, i) => (
          <a
            key={i}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            // The minimum is in px: on a 320px phone the root size shrinks and
            // the pill with it.
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line/20 px-6 py-3 text-sm font-semibold text-ink hover:bg-veil/10 ${pressCls}`}
          >
            {l.label}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ))}
      </div>
    </>
  )
}
