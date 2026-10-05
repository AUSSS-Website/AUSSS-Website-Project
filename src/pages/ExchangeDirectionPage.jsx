import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { exchange } from '../data/society.js'
import ExchangeTracks from '../components/ExchangeTracks.jsx'
import ExchangeStories from '../components/ExchangeStories.jsx'

// /exchange/outgoings: going abroad, for our own students. It renders from
// `exchange.directions.outgoing`. The other direction has a page of its own,
// written for a different reader (src/pages/ExchangeIncomingsPage.jsx); the
// switcher under the title links the two. /exchange stays as the hub that
// points at both.
export default function ExchangeDirectionPage({ dir }) {
  const d = exchange.directions[dir]
  const other = exchange.directions[dir === 'outgoing' ? 'incoming' : 'outgoing']
  usePageTitle(d.title, d.meta)
  useReveal()

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-12 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            {d.eyebrow}
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-8 text-4xl text-ink sm:text-6xl">
            {d.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-light leading-relaxed text-soft/75">
            {d.intro}
          </p>
          <DirectionTabs current={dir} />
        </div>
      </header>

      <div className="container-prose space-y-24 pb-28 sm:pb-36">
        {/* What this direction involves */}
        <section className="reveal mx-auto max-w-3xl">
          <ul className="space-y-3">
            {d.points.map((p, idx) => (
              <li
                key={idx}
                className="flex gap-4 rounded-2xl border border-line/10 bg-card p-5"
              >
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-medical/20 text-xs font-bold text-accent">
                  ✓
                </span>
                <p className="text-sm leading-relaxed text-soft/80">{p}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* The application flow only describes going abroad. */}
        {dir === 'outgoing' && (
          <section className="reveal mx-auto max-w-4xl">
            <h2 className="heading-serif text-center text-3xl text-ink">
              How it works
            </h2>
            <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {exchange.timeline.map((s, idx) => (
                <li
                  key={idx}
                  className="rounded-2xl border border-line/10 bg-card p-6"
                >
                  <span className="heading-serif text-3xl text-accent">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-2 text-base font-semibold text-ink">
                    {s.step}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-soft/65">
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <ExchangeTracks />

        <ExchangeStories />

        {/* Links + a way back to the hub */}
        <section className="reveal text-center">
          {d.links?.length > 0 && (
            <>
              <p className="text-sm uppercase tracking-[0.2em] text-soft/50">
                Start exploring
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-4">
                {d.links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-line/20 px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-veil/10"
                  >
                    {l.label}
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                ))}
              </div>
            </>
          )}
          <div className="mt-12">
            <Link
              to={`/exchange/${other.slug}`}
              className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors hover:text-ink"
            >
              {other.title} instead
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </section>
      </div>
    </article>
  )
}

// The old in-page toggle, now two real links, so each direction keeps its own
// URL while readers can still flip between them in one click.
function DirectionTabs({ current }) {
  return (
    <nav
      aria-label="Exchange direction"
      className="mx-auto mt-9 flex w-full max-w-md rounded-full border border-line/15 bg-veil/5 p-1"
    >
      {Object.entries(exchange.directions).map(([key, d]) => {
        const active = key === current
        return (
          <Link
            key={key}
            to={`/exchange/${d.slug}`}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 rounded-full px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
              active
                ? 'bg-solid text-on-solid'
                : 'text-soft/70 hover:text-ink'
            }`}
          >
            {d.tab}
          </Link>
        )
      })}
    </nav>
  )
}
