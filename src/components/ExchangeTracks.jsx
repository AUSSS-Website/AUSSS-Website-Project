import { Link } from 'react-router-dom'
import { exchange } from '../data/society.js'
import { rgba } from '../lib/color.js'

// SCOPE and SCORE, the two committees exchange runs through. This applies
// whichever direction you're travelling in, so it renders on both
// /exchange/outgoings and /exchange/incomings rather than on the chooser.
export default function ExchangeTracks() {
  return (
    <section className="reveal mx-auto max-w-5xl">
      <h2 className="heading-serif text-center text-3xl text-white">
        Two tracks
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-silver/65">
        Every exchange runs through one of two standing committees: a clinical
        clerkship, or a research project.
      </p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {exchange.tracks.map((t) => (
          <Link
            key={t.abbr}
            to={`/committees/${t.slug}`}
            className="group relative overflow-hidden rounded-3xl border border-white/10 bg-forest-800 p-8 transition-colors hover:border-white/25"
          >
            <span
              className="absolute -right-12 -top-12 h-40 w-40 rounded-full blur-3xl"
              style={{ background: rgba(t.color, 0.25) }}
            />
            <p
              className="relative text-xs font-bold uppercase tracking-[0.2em]"
              style={{ color: t.color }}
            >
              {t.abbr}
            </p>
            <h3 className="relative mt-2 heading-serif text-2xl text-white">
              {t.name}
            </h3>
            <p className="relative mt-3 text-sm leading-relaxed text-silver/70">
              {t.blurb}
            </p>
            <span className="relative mt-5 inline-flex items-center gap-2 text-sm font-semibold text-medical-light">
              Explore {t.abbr}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
