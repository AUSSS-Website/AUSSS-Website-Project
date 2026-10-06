import CountUp from './CountUp.jsx'

// The parts of /ifmsa whose words are the block `ifmsa.page` (edited by the EB
// in the portal), shared with the portal's preview.

export function StatBand({ title, items }) {
  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-accent">
        {title}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line/10 bg-veil/[0.06] sm:grid-cols-4">
        {items.map((s, i) => (
          <div
            key={i}
            className="bg-sunk/40 px-4 py-6 text-center backdrop-blur-sm"
          >
            <div className="heading-serif text-2xl text-ink sm:text-3xl">
              <CountUp value={s.value} />
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-widest text-soft/70">
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
            className="inline-flex items-center gap-2 rounded-full border border-line/20 px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-veil/10"
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
