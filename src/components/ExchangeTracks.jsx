import { Link } from 'react-router-dom'
import { exchange } from '../data/society.js'
import { readableAccent, rgba } from '../lib/color.js'

// SCOPE and SCORE, the two committees exchange runs through. This applies
// whichever direction you're travelling in, so it renders on both
// /exchange/outgoings and /exchange/incomings rather than on the chooser.
// `audience="incoming"` words it for a student coming to us (our voice, their
// month here); the default speaks to our own students going abroad
// (/exchange/outgoings).
export default function ExchangeTracks({ audience = 'outgoing' }) {
  const incoming = audience === 'incoming'
  return (
    <section className="reveal mx-auto max-w-5xl">
      <h2 className="heading-serif text-center text-3xl text-ink sm:text-4xl">
        {incoming ? 'Two ways to come to us' : 'Two ways to go'}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-soft/65">
        {incoming
          ? 'You come to us through one of IFMSA’s two exchange committees: for a clinical clerkship, or for a research project.'
          : 'You go abroad through one of IFMSA’s two exchange committees: for a clinical clerkship, or for a research project.'}
      </p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {exchange.tracks.map((t) => (
          <Link
            key={t.abbr}
            to={`/committees/${t.slug}`}
            className="group relative overflow-hidden rounded-3xl border border-line/10 bg-card p-8 transition-colors hover:border-line/25"
          >
            <span
              className="absolute -right-12 -top-12 h-40 w-40 rounded-full blur-3xl"
              style={{ background: rgba(t.color, 0.25) }}
            />
            <p
              className="relative text-xs font-bold uppercase tracking-[0.2em]"
              style={{ color: readableAccent(t.color) }}
            >
              {t.abbr}
            </p>
            <h3 className="relative mt-2 heading-serif text-2xl text-ink">
              {t.name}
            </h3>
            <p className="relative mt-3 text-sm leading-relaxed text-soft/70">
              {incoming ? t.incomingBlurb || t.blurb : t.blurb}
            </p>
            <span className="relative mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent">
              {incoming ? `Meet our ${t.abbr} committee` : `Explore ${t.abbr}`}
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
