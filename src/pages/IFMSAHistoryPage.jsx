import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { Link } from 'react-router-dom'
import { ifmsaHistory } from '../data/society.js'

// Every card links out to the matching page on the official IFMSA site.
// Renders an <a> when an href is present, otherwise a plain <div> so the
// markup degrades gracefully if a link is ever missing.
function CardLink({ href, className, children }) {
  if (!href) return <div className={className}>{children}</div>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block ${className}`}
    >
      {children}
    </a>
  )
}

// Small "Read on ifmsa.org ↗" affordance shown at the foot of each card.
function ExternalCue() {
  return (
    <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-silver/45 transition-colors group-hover:text-medical-light">
      Read on ifmsa.org
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </span>
  )
}

function TimelineItem({ year, accent, children, isFounding = false }) {
  return (
    <div className="reveal relative pl-14 sm:pl-20">
      {/* Node on the rail */}
      <span
        className="absolute left-[14px] top-1.5 z-10 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full ring-4 ring-forest-950 sm:left-5"
        style={{ backgroundColor: accent }}
      >
        {isFounding && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
      {/* Year on the rail */}
      <span
        className="absolute -top-7 left-[14px] -translate-x-1/2 text-xs font-semibold uppercase tracking-[0.2em] sm:left-5"
        style={{ color: accent }}
      >
        {year}
      </span>
      {children}
    </div>
  )
}

export default function IFMSAHistoryPage() {
  usePageTitle('IFMSA history')
  useReveal()
  const { founded, committees, supportDivisions } = ifmsaHistory

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
            The IFMSA story
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-8 text-4xl text-white sm:text-6xl">
            A history in six committees
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-light leading-relaxed text-silver/75">
            IFMSA grew committee by committee. Each standing committee owns a
            field of global health, and each has its own story, founding year
            and, for some, a trail of name changes. Here is how they came to be.
          </p>
        </div>
      </header>

      <div className="container-prose pb-28 sm:pb-36">
        {/* The rail */}
        <div className="relative mx-auto max-w-3xl space-y-12 pt-8">
          <span
            className="absolute bottom-2 left-[14px] top-2 w-px -translate-x-1/2 bg-gradient-to-b from-medical/50 via-white/15 to-transparent sm:left-5"
            aria-hidden="true"
          />

          {/* Founding of IFMSA */}
          <TimelineItem year={founded.year} accent="#3fb6ab" isFounding>
            <CardLink
              href={founded.href}
              className="rounded-2xl border border-medical/30 bg-gradient-to-br from-forest-800 to-forest-900 p-6 transition-colors hover:border-medical/60 sm:p-7"
            >
              <h2 className="heading-serif text-2xl text-white">
                IFMSA is founded
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-silver/75">
                {founded.body}
              </p>
              <ExternalCue />
            </CardLink>
          </TimelineItem>

          {/* One node per committee, in founding order */}
          {committees.map((c) => (
            <TimelineItem key={c.abbr} year={c.year} accent={c.accent}>
              <CardLink
                href={c.href}
                className="rounded-2xl border border-white/10 bg-forest-800 p-6 transition-colors hover:border-white/25 sm:p-7"
              >
                <div className="flex items-start gap-4">
                  {/* The committee logo PNGs are solid white, so they need a
                      dark chip (not a white one) to be visible. Accent border
                      ties each to its committee colour. */}
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-forest-950 p-1.5"
                    style={{ borderColor: c.accent }}
                  >
                    <img
                      src={c.logo}
                      alt={c.abbr}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain"
                    />
                  </span>
                  <div className="min-w-0">
                    <h3 className="heading-serif text-xl text-white">
                      {c.abbr}
                    </h3>
                    <p className="mt-0.5 text-sm leading-snug text-silver/60">
                      {c.name}
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-silver/75">
                  {c.body}
                </p>

                {c.renames && (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-silver/45">
                      Renamed over the years
                    </p>
                    <ol className="mt-3 space-y-2">
                      {c.renames.map((r) => (
                        <li
                          key={r.year}
                          className="flex gap-3 text-sm text-silver/75"
                        >
                          <span
                            className="shrink-0 font-semibold tabular-nums"
                            style={{ color: c.accent }}
                          >
                            {r.year}
                          </span>
                          <span className="leading-snug">{r.name}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <ExternalCue />
              </CardLink>
            </TimelineItem>
          ))}
        </div>

        {/* Support divisions, not on the rail; they aren't tied to a founding
            year. Operational portfolios that carry IFMSA alongside the six
            standing committees. */}
        {supportDivisions?.length > 0 && (
          <div className="mx-auto mt-24 max-w-5xl">
            <div className="reveal text-center">
              <span className="eyebrow justify-center">
                <span className="h-px w-8 bg-medical" />
                Beyond the committees
                <span className="h-px w-8 bg-medical" />
              </span>
              <h2 className="heading-serif mt-5 text-3xl text-white sm:text-4xl">
                The support divisions
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-base font-light leading-relaxed text-silver/70">
                The six standing committees own IFMSA’s health fields. Carrying
                them is a second set of portfolios: the support divisions, each
                led by a Vice-President, that keep the federation running.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {supportDivisions.map((d) => (
                <CardLink
                  key={d.abbr}
                  href={d.href}
                  className="reveal rounded-2xl border border-white/10 bg-forest-800 p-6 transition-colors hover:border-white/25"
                >
                  <div className="flex items-center gap-4">
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold tracking-wide text-white"
                      style={{ backgroundColor: d.accent }}
                    >
                      {d.abbr}
                    </span>
                    <h3 className="heading-serif text-xl leading-tight text-white">
                      {d.name}
                    </h3>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-silver/75">
                    {d.body}
                  </p>
                  <ExternalCue />
                </CardLink>
              ))}
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div className="mt-20 text-center">
          <Link
            to="/ifmsa"
            className="inline-flex items-center gap-2 text-sm font-semibold text-medical-light transition-colors hover:text-white"
          >
            ← Back to IFMSA at Ain Shams
          </Link>
        </div>
      </div>
    </article>
  )
}
