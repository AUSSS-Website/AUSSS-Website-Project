import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { exchange } from '../data/society.js'
import { useContentBlock } from '../lib/content.js'
import outgoingsSchema from '../content/schemas/exchangeOutgoings.js'
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
  OUTGOING_CONTACTS,
  OUTGOINGS_COPY,
} from '../components/IncomingsSections.jsx'

// /exchange/outgoings. The reader is one of our own students, a medical
// student at Ain Shams thinking of going abroad on exchange. The page has the
// incomings page's shape (src/pages/ExchangeIncomingsPage.jsx) and the same
// voice: "we", "our", "us", to "you".
//
// Its copy is the block `exchange.outgoings`, edited by the exchange officers
// in the portal (Site content). The copy it ships with is in
// src/content/schemas/exchangeOutgoings.js. The section headings are fixed, in
// OUTGOINGS_COPY (src/components/IncomingsSections.jsx).

const primaryCls =
  'inline-flex items-center gap-2 rounded-full bg-cta px-6 py-3 text-sm font-semibold text-on-cta transition-colors hover:bg-cta-hover'
const quietCls =
  'inline-flex items-center gap-2 rounded-full border border-line/20 px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-veil/10'

export default function ExchangeOutgoingsPage() {
  const d = exchange.directions.outgoing
  usePageTitle(d.title, d.meta)
  useReveal()
  const doc = useContentBlock(outgoingsSchema)
  const c = OUTGOINGS_COPY

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
          <p className="mx-auto mt-5 max-w-2xl whitespace-pre-line text-lg font-light leading-relaxed text-soft/75">
            {doc.intro}
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            {doc.steps.length > 0 && (
              <a href="#how-to-apply" className={primaryCls}>
                {d.cta}
              </a>
            )}
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

        <IncomingsIncludes points={doc.points} heading={c.includes} />

        <IncomingsWhy sections={doc.sections} heading={c.whyHeading} lead={c.whyLead} />

        <ExchangeTracks audience="outgoing" />

        <IncomingsSteps steps={doc.steps} heading={c.steps} id="how-to-apply" />

        <IncomingsAlbum slug={doc.album} heading={c.album} />

        <IncomingsTips tips={doc.tips} heading={c.tipsHeading} lead={c.tipsLead} />

        {doc.showContacts && <IncomingsContacts contacts={OUTGOING_CONTACTS} lead={c.contactsLead} />}

        <ExchangeStories audience="outgoing" />

        <section className="reveal text-center">
          {doc.links.length > 0 && (
            <>
              <p className="text-sm uppercase tracking-[0.2em] text-soft/50">Start exploring</p>
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
          {/* Running the exchange rather than travelling on it. */}
          <p className="mt-12 text-sm text-soft/60">
            Would you rather run the exchange than travel on it?{' '}
            <Link to={exchange.joinTeam.to} className="font-semibold text-accent transition-colors hover:text-ink">
              Join the exchange team &rarr;
            </Link>
          </p>
        </section>
      </div>
    </article>
  )
}
