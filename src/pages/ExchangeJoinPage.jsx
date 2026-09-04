import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { exchange } from '../data/society.js'
import RoleNode from '../components/RoleNode.jsx'

// /exchange/join, the recruitment page for the exchange team.
//
// The structure is the content: three officers own the three halves of the
// programme, three assistants work the season alongside them, and a contact
// person is paired with every arrival. Each position explains itself in a card
// on hover/focus (RoleNode), so the page stays a readable chart rather than
// seven paragraphs.
//
// Deliberately no application flow yet, the page shows the shape of the team
// and what each seat does; joining gets its own treatment separately.
export default function ExchangeJoinPage() {
  usePageTitle(
    'Join the Exchange Team',
    'The AUSSS exchange team: the LEO-In, LEO-Out and LORE officer roles, their assistants, and the contact persons who host every arrival.',
  )
  useReveal()
  const { officers, assistants, contactPersons } = exchange.team

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
            The exchange team
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-8 text-4xl text-white sm:text-6xl">
            Join the Exchange Team
          </h1>
        </div>
      </header>

      <div className="container-prose space-y-24 pb-28 sm:pb-36">
        {/* ── The hierarchy ─────────────────────────────────────────────── */}
        {/* Three across only from lg: each role's card is ~22rem wide and
            centred on its node, so narrower columns would push it off-screen.
            Below that the tiers stack, which still reads as the same chart.

            `relative z-20` is load-bearing: .reveal sets will-change on opacity,
            which makes every section its own stacking context, so a role card's
            own z-50 can't lift it above a LATER section, the links below were
            punching straight through the card. Raising the whole section fixes
            it for every card at once. */}
        <section className="reveal relative z-20 mx-auto max-w-5xl">
          <TierLabel>Officers</TierLabel>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-silver/60">
            Elected roles. Each one owns a direction of the programme outright.
          </p>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {officers.map((r) => (
              <RoleNode key={r.abbr} role={r} tier="officer" />
            ))}
          </div>

          <Connector />

          <TierLabel>Assistants</TierLabel>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-silver/60">
            One to each side of the clinical programme, and both to the LORE,
            who runs research in either direction.
          </p>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {assistants.map((r) => (
              <RoleNode key={r.abbr} role={r} tier="assistant" />
            ))}
          </div>

          <Connector />

          <TierLabel>Contact Persons</TierLabel>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-silver/60">
            Not one seat but as many as there are arrivals. Open to any member
            each season, and where most people start.
          </p>
          <div className="mx-auto mt-8 max-w-xl">
            <RoleNode role={contactPersons} tier="assistant" />
          </div>
        </section>

        {/* ── Back out ──────────────────────────────────────────────────── */}
        <section className="reveal text-center">
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
            <Link
              to="/exchange/outgoings"
              className="inline-flex items-center gap-2 text-sm font-semibold text-medical-light transition-colors hover:text-white"
            >
              Going abroad instead
            </Link>
            <Link
              to="/exchange/incomings"
              className="inline-flex items-center gap-2 text-sm font-semibold text-medical-light transition-colors hover:text-white"
            >
              Hosting in Cairo instead
            </Link>
          </div>
        </section>
      </div>
    </article>
  )
}

function TierLabel({ children }) {
  return (
    <h2 className="flex items-center justify-center gap-4 text-xs font-bold uppercase tracking-[0.24em] text-medical-light">
      <span className="h-px w-10 bg-medical/40" />
      {children}
      <span className="h-px w-10 bg-medical/40" />
    </h2>
  )
}

// The line between tiers. Decorative, every card below the top tier says who
// it supports in words, so nothing depends on reading the graphic.
function Connector() {
  return (
    <div aria-hidden="true" className="flex justify-center py-10">
      <span className="h-14 w-px bg-gradient-to-b from-medical/50 to-medical/0" />
    </div>
  )
}
