import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { Link } from 'react-router-dom'
import { ifmsa, ifmsaScale } from '../data/society.js'
import CountUp from '../components/CountUp.jsx'

function StatBand({ title, items }) {
  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
        {title}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] sm:grid-cols-4">
        {items.map((s) => (
          <div
            key={s.label}
            className="bg-forest-900/40 px-4 py-6 text-center backdrop-blur-sm"
          >
            <div className="heading-serif text-2xl text-white sm:text-3xl">
              <CountUp value={s.value} />
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-widest text-silver/70">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function IFMSAPage() {
  usePageTitle(
    'IFMSA',
    'AUSSS in the International Federation of Medical Students’ Associations: standing committees, exchanges, and a worldwide network of medical students.',
  )
  useReveal()

  return (
    <article className="bg-forest-950">
      <header className="relative overflow-hidden pb-16 pt-32 sm:pt-40">
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
            Our global network
            <span className="h-px w-8 bg-medical" />
          </span>
          <img
            src="/assets/ifmsa/ifmsa-horizontal-white.png"
            alt="IFMSA, International Federation of Medical Students' Associations"
            className="mx-auto mt-8 h-16 w-auto opacity-95 sm:h-20"
          />
          <h1 className="heading-serif mt-8 text-4xl text-white sm:text-6xl">
            What is IFMSA?
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-light leading-relaxed text-silver/75">
            {ifmsa.intro}
          </p>
        </div>
      </header>

      <div className="container-prose space-y-20 pb-28 sm:pb-36">
        {/* Full-member highlight */}
        <section className="reveal mx-auto max-w-3xl">
          <div className="relative overflow-hidden rounded-3xl border border-medical/30 bg-gradient-to-br from-forest-800 to-forest-900 p-8 sm:p-12 text-center">
            <span className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-medical/10 blur-3xl" />
            <p className="relative text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
              AUSSS × IFMSA
            </p>
            <p className="relative mt-4 font-serif text-2xl leading-relaxed text-white sm:text-3xl">
              AUSSS is an{' '}
              <span className="text-medical-light">
                autonomous affiliate member
              </span>{' '}
              of IFMSA-Egypt.
            </p>
            <p className="relative mx-auto mt-5 max-w-2xl text-base leading-relaxed text-silver/75">
              {ifmsa.membership}
            </p>
            <img
              src="/assets/ifmsa/ifmsa-egypt-horizontal-white.png"
              alt="IFMSA-Egypt"
              loading="lazy"
              decoding="async"
              className="relative mx-auto mt-8 h-12 w-auto sm:h-14"
            />
          </div>
        </section>

        {/* Scale */}
        <section className="reveal mx-auto max-w-5xl space-y-12">
          <StatBand title="IFMSA worldwide" items={ifmsaScale.ifmsa} />
          <StatBand title="IFMSA-Egypt" items={ifmsaScale.egypt} />
        </section>

        {/* Lineage */}
        <section className="reveal mx-auto max-w-5xl">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
            Where AUSSS sits
          </p>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {ifmsaScale.lineage.map((node, idx) => (
              <div key={node.name} className="relative">
                <a
                  href={node.href}
                  target={node.href.startsWith('http') ? '_blank' : undefined}
                  rel={
                    node.href.startsWith('http')
                      ? 'noopener noreferrer'
                      : undefined
                  }
                  className="flex h-44 w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-forest-800 px-4 py-4 text-center transition-colors hover:border-white/25"
                >
                  <img
                    src={node.logo}
                    alt={node.name}
                    loading="lazy"
                    decoding="async"
                    className={`w-auto max-w-full object-contain ${
                      node.name === 'IFMSA-Egypt'
                        ? 'h-16 sm:h-20'
                        : 'h-20 sm:h-24'
                    }`}
                  />
                  <span className="mt-3 text-xs leading-relaxed text-silver/60">
                    {node.note}
                  </span>
                </a>
                {idx < ifmsaScale.lineage.length - 1 && (
                  <svg
                    viewBox="0 0 24 24"
                    className="absolute left-full top-1/2 hidden h-6 w-6 -translate-y-1/2 text-medical-light sm:block"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 12h14M13 6l6 6-6 6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Points */}
        <section className="reveal mx-auto max-w-5xl">
          <div className="grid gap-6 md:grid-cols-3">
            {ifmsa.points.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-white/10 bg-forest-800 p-7"
              >
                <h3 className="heading-serif text-xl text-white">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-silver/70">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* History subpage CTA */}
        <section className="reveal mx-auto max-w-3xl">
          <Link
            to="/ifmsa/history"
            className="group flex flex-col items-start gap-4 rounded-3xl border border-white/10 bg-forest-800 p-7 transition-colors hover:border-medical/40 sm:flex-row sm:items-center sm:justify-between sm:p-8"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
                The IFMSA story
              </p>
              <h3 className="heading-serif mt-2 text-2xl text-white">
                A history in six committees
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-silver/70">
                IFMSA grew committee by committee from 1951. Trace each standing
                committee’s founding year and name changes on a single timeline.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-medical-light transition-colors group-hover:text-white">
              View the timeline
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>
        </section>

        {/* Links */}
        <section className="reveal text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-silver/50">
            Learn more
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-4">
            {ifmsa.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                {l.label}
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            ))}
          </div>
          <div className="mt-12">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-medical-light transition-colors hover:text-white"
            >
              ← Back to AUSSS home
            </Link>
          </div>
        </section>
      </div>
    </article>
  )
}
