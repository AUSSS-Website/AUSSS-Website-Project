import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { exchange } from '../data/society.js'
import { useContentBlock } from '../lib/content.js'
import { pressCls } from '../lib/motion.js'
import incomingsSchema from '../content/schemas/exchangeIncomings.js'
import IncomingsBooklet from '../components/IncomingsBooklet.jsx'
import NationalBooklets from '../components/NationalBooklets.jsx'
import ExchangeTracks from '../components/ExchangeTracks.jsx'
import ExchangeStories from '../components/ExchangeStories.jsx'
import {
  IncomingsAlbum,
  IncomingsContacts,
  IncomingsFacts,
  IncomingsIncludes,
  IncomingsSteps,
  IncomingsTips,
  IncomingsWhy,
} from '../components/IncomingsSections.jsx'

// /exchange/incomings. The reader is a medical student somewhere else in the
// world, choosing which local committee to spend an exchange month with. So
// the whole page is our pitch to them, in our own voice: "we", "our", "us",
// to "you". Nothing here speaks to our own members about hosting (that lives
// on /exchange/join).
//
// Its copy is the block `exchange.incomings`, edited by the exchange officers
// in the portal (Site content). The copy it ships with, drawn from our
// incomings booklet, is in src/content/schemas/exchangeIncomings.js.

// The two pills of this page. Colours ease and the pill sinks a little when
// pressed (pressCls). The least height is in px: the padding is in rem, and
// the root size shrinks on a 320px phone, which left them a little under the
// 44px a thumb needs.
const primaryCls = `inline-flex min-h-[44px] items-center gap-2 rounded-full bg-cta px-6 py-3 text-sm font-semibold text-on-cta hover:bg-cta-hover ${pressCls}`
const quietCls = `inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line/20 px-6 py-3 text-sm font-semibold text-ink hover:bg-veil/10 ${pressCls}`

export default function ExchangeIncomingsPage() {
  const d = exchange.directions.incoming
  const out = exchange.directions.outgoing
  usePageTitle(d.title, d.meta)
  useReveal()
  const doc = useContentBlock(incomingsSchema)

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-14 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            {d.eyebrow}
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-8 text-4xl text-ink sm:text-6xl">{d.title}</h1>
          <p className="mx-auto mt-5 max-w-2xl whitespace-pre-line text-lg font-normal leading-relaxed text-soft/75 dark:font-light">
            {doc.intro}
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href="#incomings-booklet" className={primaryCls}>
              Read our welcome booklet
            </a>
            {doc.showContacts && (
              <a href="#write-to-us" className={quietCls}>
                Write to us
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="container-prose space-y-24 pb-28 sm:space-y-28 sm:pb-36">
        <IncomingsFacts facts={doc.facts} />

        <IncomingsIncludes points={doc.points} />

        <IncomingsWhy sections={doc.sections} />

        <ExchangeTracks audience="incoming" />

        <IncomingsSteps steps={doc.steps} />

        <IncomingsAlbum slug={doc.album} />

        {/* The welcome booklet we send every student before they land. */}
        <IncomingsBooklet />

        {/* And the two the national exchange team writes for every student coming to Egypt. */}
        <NationalBooklets />

        <IncomingsTips tips={doc.tips} />

        {doc.showContacts && <IncomingsContacts />}

        <ExchangeStories audience="incoming" />

        <section className="reveal text-center">
          {doc.links.length > 0 && (
            <>
              <p className="text-sm uppercase tracking-[0.2em] text-soft/50">Find us</p>
              <div className="mt-5 flex flex-wrap justify-center gap-4">
                {doc.links.map((l) => (
                  <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={quietCls}>
                    {l.label}
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                ))}
              </div>
            </>
          )}
          {/* The one line for our own students, who land here from the menu. */}
          <p className="mt-12 text-sm text-soft/60">
            Studying at Ain Shams and want to go abroad?{' '}
            <Link to={`/exchange/${out.slug}`} className="font-semibold text-accent transition-colors hover:text-ink">
              See {out.title} &rarr;
            </Link>
          </p>
        </section>
      </div>
    </article>
  )
}
