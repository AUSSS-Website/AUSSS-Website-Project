// Accessible FAQ accordion built on native <details>/<summary>, keyboard- and
// screen-reader-friendly with zero JS, and still works if scripts fail. Pass an
// array of { q, a } items.
export default function FAQ({ items, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {items.map((item, i) => (
        <details
          key={i}
          className="group rounded-2xl border border-white/10 bg-forest-800 px-5 open:border-medical/30 sm:px-6"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-semibold text-white marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60">
            <span>{item.q}</span>
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 text-medical-light transition-transform duration-300 group-open:rotate-45"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </summary>
          <p className="pb-5 text-sm leading-relaxed text-silver/75">{item.a}</p>
        </details>
      ))}
    </div>
  )
}
