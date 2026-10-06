import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { Link } from 'react-router-dom'
import { ifmsaLineage } from '../data/society.js'
import { useContentBlock } from '../lib/content.js'
import ifmsaPage from '../content/schemas/ifmsaPage.js'
import { IfmsaLinks, IfmsaPoints, StatBand } from '../components/IfmsaSections.jsx'

export default function IFMSAPage() {
  usePageTitle(
    'IFMSA Ain Shams',
    'IFMSA at Ain Shams University: AUSSS is the IFMSA-Egypt affiliate at the Faculty of Medicine, with the six standing committees, the SCOPE and SCORE exchanges, and a worldwide network of medical students.',
  )
  useReveal()
  // The words and figures: the block `ifmsa.page`, edited by the EB in the portal.
  const ifmsa = useContentBlock(ifmsaPage)

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-16 pt-32 sm:pt-40">
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
            Our global network
            <span className="h-px w-8 bg-medical" />
          </span>
          <img
            src="/assets/ifmsa/ifmsa-horizontal-white.png"
            alt="IFMSA, International Federation of Medical Students' Associations"
            className="logo-ink mx-auto mt-8 h-16 w-auto opacity-95 sm:h-20"
          />
          <h1 className="heading-serif mt-8 text-4xl text-ink sm:text-6xl">
            IFMSA at Ain Shams
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-light leading-relaxed text-soft/75">
            {ifmsa.intro}
          </p>
        </div>
      </header>

      <div className="container-prose space-y-20 pb-28 sm:pb-36">
        {/* Full-member highlight */}
        <section className="reveal mx-auto max-w-3xl">
          <div className="relative overflow-hidden rounded-3xl border border-medical/30 bg-gradient-to-br from-card to-sunk p-8 sm:p-12 text-center">
            <span className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-medical/10 blur-3xl" />
            <p className="relative text-xs font-semibold uppercase tracking-[0.24em] text-accent">
              AUSSS × IFMSA
            </p>
            <p className="relative mt-4 font-serif text-2xl leading-relaxed text-ink sm:text-3xl">
              AUSSS is an{' '}
              <span className="text-accent">
                autonomous affiliate member
              </span>{' '}
              of IFMSA-Egypt.
            </p>
            <p className="relative mx-auto mt-5 max-w-2xl text-base leading-relaxed text-soft/75">
              {ifmsa.membership}
            </p>
            <img
              src="/assets/ifmsa/ifmsa-egypt-horizontal-white.png"
              alt="IFMSA-Egypt"
              loading="lazy"
              decoding="async"
              className="logo-ink relative mx-auto mt-8 h-12 w-auto sm:h-14"
            />
          </div>
        </section>

        {/* Scale */}
        <section className="reveal mx-auto max-w-5xl space-y-12">
          <StatBand title="IFMSA worldwide" items={ifmsa.worldwide} />
          <StatBand title="IFMSA-Egypt" items={ifmsa.egypt} />
        </section>

        {/* Lineage */}
        <section className="reveal mx-auto max-w-5xl">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-accent">
            Where AUSSS sits
          </p>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {ifmsaLineage.map((node, idx) => (
              <div key={node.name} className="relative">
                <a
                  href={node.href}
                  target={node.href.startsWith('http') ? '_blank' : undefined}
                  rel={
                    node.href.startsWith('http')
                      ? 'noopener noreferrer'
                      : undefined
                  }
                  className="flex h-44 w-full flex-col items-center justify-center rounded-2xl border border-line/10 bg-card px-4 py-4 text-center transition-colors hover:border-line/25"
                >
                  <img
                    src={node.logo}
                    alt={node.name}
                    loading="lazy"
                    decoding="async"
                    className={`logo-ink w-auto max-w-full object-contain ${
                      node.name === 'IFMSA-Egypt'
                        ? 'h-16 sm:h-20'
                        : 'h-20 sm:h-24'
                    }`}
                  />
                  <span className="mt-3 text-xs leading-relaxed text-soft/60">
                    {node.note}
                  </span>
                </a>
                {idx < ifmsaLineage.length - 1 && (
                  <svg
                    viewBox="0 0 24 24"
                    className="absolute left-full top-1/2 hidden h-6 w-6 -translate-y-1/2 text-accent sm:block"
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
          <IfmsaPoints points={ifmsa.points} />
        </section>

        {/* History subpage CTA */}
        <section className="reveal mx-auto max-w-3xl">
          <Link
            to="/ifmsa/history"
            className="group flex flex-col items-start gap-4 rounded-3xl border border-line/10 bg-card p-7 transition-colors hover:border-medical/40 sm:flex-row sm:items-center sm:justify-between sm:p-8"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
                The IFMSA story
              </p>
              <h3 className="heading-serif mt-2 text-2xl text-ink">
                A history in six committees
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-soft/70">
                IFMSA grew committee by committee from 1951. Follow each
                standing committee’s founding year and name changes on one
                timeline.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-accent transition-colors group-hover:text-ink">
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
          <IfmsaLinks links={ifmsa.links} />
          <div className="mt-12">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors hover:text-ink"
            >
              ← Back to AUSSS home
            </Link>
          </div>
        </section>
      </div>
    </article>
  )
}
