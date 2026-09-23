import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { exchange } from '../data/society.js'

// /exchange is a chooser, not a page about exchange. The navbar's Exchange menu
// offers the same three routes directly, so anyone landing here arrived from a
// bookmark, the home page or a share-story back-link, and all they need is the
// same fork:
//   /exchange/outgoings  going abroad
//   /exchange/incomings  hosting students at Ain Shams
//   /exchange/join       joining the team that runs both
// The shared material (ExchangeTracks.jsx, ExchangeStories.jsx) lives on the
// two direction pages.
export default function ExchangePage() {
  usePageTitle(
    'Exchange',
    'Clinical (SCOPE) and research (SCORE) exchanges with AUSSS: go abroad, host incoming students, or join the exchange team.',
  )
  useReveal()

  const { outgoing, incoming } = exchange.directions
  const options = [
    { key: 'outgoing', to: `/exchange/${outgoing.slug}`, ...outgoing },
    { key: 'incoming', to: `/exchange/${incoming.slug}`, ...incoming },
    { key: 'join', ...exchange.joinTeam },
  ]

  return (
    <article className="flex min-h-svh flex-col bg-forest-950">
      <header className="relative overflow-hidden pt-32 sm:pt-40">
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
            IFMSA flagship programme
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-8 text-4xl text-white sm:text-6xl">
            Exchange the world
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg font-light leading-relaxed text-silver/75">
            Four weeks of medicine somewhere new: our students abroad, or
            theirs here in Cairo. Which one are you here for?
          </p>
        </div>
      </header>

      <div className="container-prose flex flex-1 items-center py-16 sm:py-20">
        <div className="grid w-full gap-6 lg:grid-cols-3">
          {options.map((o) => (
            <Link
              key={o.key}
              to={o.to}
              className="group flex flex-col rounded-3xl border border-white/10 bg-forest-800 p-8 transition-colors hover:border-medical/40"
            >
              <span className="text-medical-light">
                <OptionIcon which={o.key} />
              </span>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-medical-light">
                {o.eyebrow}
              </p>
              <h2 className="heading-serif mt-2 text-2xl text-white">
                {o.title}
              </h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-silver/70">
                {o.blurb}
              </p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-medical-light">
                {o.cta}
                <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </article>
  )
}

// A plane climbing away, a plane coming down, and the badge you wear if you're
// the one arranging both. The icons carry the distinction between the three
// cards rather than decorating them.
function OptionIcon({ which }) {
  if (which === 'outgoing') {
    return (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden="true">
        <path d="M2.5 19h19v2h-19z" />
        <path d="M22.07 9.64c-.21-.8-1.04-1.28-1.84-1.06L14.92 10 8 3.57 6.09 4.08l4.15 7.19-4.99 1.34-1.97-1.54-1.45.39 2.59 4.46s7.12-1.9 16.57-4.43c.81-.23 1.28-1.05 1.07-1.85z" />
      </svg>
    )
  }
  if (which === 'incoming') {
    return (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden="true">
        <path d="M2.5 19h19v2h-19z" />
        <path d="M9.68 13.27l4.35 1.16 5.31 1.42c.8.21 1.62-.26 1.84-1.06.21-.8-.26-1.62-1.06-1.84l-5.31-1.42-2.76-9.02L10.4 2v8.28L5.65 9.01l-.89-2.22-1.45-.39v5.16l1.45.39 4.92 1.32z" />
      </svg>
    )
  }
  // Filled, to sit at the same weight as the two planes.
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden="true">
      <path d="M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z" />
    </svg>
  )
}
