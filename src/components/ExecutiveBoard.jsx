import { executiveBoard } from '../data/society.js'
import { initials } from '../lib/text.js'

function Member({ m, size = 'md' }) {
  const ring =
    m.tier === 'patron'
      ? 'ring-medical/50'
      : m.tier === 'lead'
        ? 'ring-white/40'
        : 'ring-forest-600/30'
  // Cards sized ~5% larger than the base layout (avatar, padding, text and
  // container widths scaled by ≈1.4, then taken 25% smaller → ≈1.05).
  const avatar =
    size === 'lg'
      ? 'h-[6.3rem] w-[6.3rem] text-[1.575rem]'
      : 'h-[5.25rem] w-[5.25rem] text-[1.3125rem]'
  const Wrapper = m.candidature ? 'a' : 'article'
  const wrapperProps = m.candidature
    ? {
        href: m.candidature,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `${m.name}, view candidature (PDF)`,
      }
    : {}

  return (
    <Wrapper
      {...wrapperProps}
      className={`reveal flex flex-col items-center rounded-3xl border p-[2.0625rem] text-center transition-all duration-500 hover:-translate-y-1.5 ${
        m.candidature ? 'cursor-pointer' : ''
      } ${
        m.tier === 'lead'
          ? 'border-white/15 bg-forest-800 text-white hover:shadow-2xl hover:shadow-forest-950/40'
          : 'border-forest-600/10 bg-white text-forest-900 hover:border-medical/40 hover:shadow-xl hover:shadow-forest-900/5 dark:border-white/10 dark:bg-forest-900 dark:text-silver dark:hover:border-medical/40'
      }`}
    >
      <div
        className={`grid ${avatar} place-items-center overflow-hidden rounded-full bg-gradient-to-br from-forest to-forest-600 font-serif font-semibold text-silver ring-[3px] ${ring}`}
      >
        {m.photo ? (
          <img
            src={m.photo}
            alt={m.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          initials(m.name)
        )}
      </div>
      <h3
        className={`heading-serif mt-[1.3125rem] text-[1.3125rem] ${
          m.tier === 'lead' ? 'text-white' : 'text-forest dark:text-medical-light'
        }`}
      >
        {m.name}
      </h3>
      <p
        className={`mt-1 text-[0.7875rem] font-semibold uppercase tracking-[0.18em] ${
          m.tier === 'lead' ? 'text-medical-light' : 'text-medical'
        }`}
      >
        {m.role}
      </p>
      <p
        className={`mt-[1.125rem] text-[0.9rem] leading-relaxed ${
          m.tier === 'lead' ? 'text-silver/80' : 'text-forest-900/60 dark:text-silver/65'
        }`}
      >
        {m.blurb}
      </p>
      {m.candidature && (
        <span
          className={`mt-[1.3125rem] inline-flex items-center gap-1.5 text-[0.7875rem] font-semibold uppercase tracking-[0.16em] ${
            m.tier === 'lead' ? 'text-medical-light' : 'text-medical'
          }`}
        >
          View candidature
          <svg
            viewBox="0 0 24 24"
            className="h-[0.9375rem] w-[0.9375rem]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              d="M7 17 17 7M9 7h8v8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </Wrapper>
  )
}

export default function ExecutiveBoard() {
  const patron = executiveBoard.find((m) => m.tier === 'patron')
  const lead = executiveBoard.find((m) => m.tier === 'lead')
  const vps = executiveBoard.filter((m) => m.tier === 'vp')
  const officers = executiveBoard.filter((m) => m.tier === 'officer')

  return (
    <section
      id="board"
      className="relative overflow-hidden bg-forest-950 pb-10 pt-28 sm:pt-36"
    >
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(#C9D6DF 1px, transparent 1px), linear-gradient(90deg, #C9D6DF 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div className="container-prose relative">
        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Leadership
            <span className="h-px w-8 bg-medical" />
          </span>
          <h2 className="heading-serif mt-5 text-4xl text-white sm:text-5xl">
            Executive Board
          </h2>
          <p className="mt-4 text-lg font-light text-silver/70">
            The elected board that sets the society&rsquo;s direction and runs
            its day-to-day.
          </p>
        </div>

        {/* Tier 1, Patron (optional) */}
        {patron && (
          <>
            <div className="mt-16 flex justify-center">
              <div className="w-full max-w-[25.5rem]">
                <Member m={patron} size="lg" />
              </div>
            </div>
            <div className="mx-auto my-2 h-12 w-px bg-gradient-to-b from-silver/40 to-transparent" />
          </>
        )}

        {/* Tier 2, President */}
        {lead && (
          <div className={`flex justify-center ${patron ? '' : 'mt-16'}`}>
            <div className="w-full max-w-[29.25rem]">
              <Member m={lead} size="lg" />
            </div>
          </div>
        )}

        {/* Tier 3, Secretary General (centered, below President) */}
        {officers.length > 0 && (
          <>
            <div className="mx-auto my-2 h-12 w-px bg-gradient-to-b from-silver/40 to-transparent" />
            <div className="mx-auto flex max-w-[25.5rem] flex-col gap-8">
              {officers.map((m) => (
                <Member key={m.role} m={m} />
              ))}
            </div>
          </>
        )}

        {/* Tier 4, Vice Presidents (below Secretary General) */}
        {vps.length > 0 && (
          <>
            <div className="mx-auto my-2 h-12 w-px bg-gradient-to-b from-silver/40 to-transparent" />
            <div className="mx-auto grid max-w-[50.25rem] gap-8 sm:grid-cols-2">
              {vps.map((m) => (
                <Member key={m.role} m={m} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
