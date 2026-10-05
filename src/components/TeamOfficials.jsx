import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { committees, slugFor } from '../data/society.js'
import { readableAccent, rgba } from '../lib/color.js'
import { initials } from '../lib/text.js'
import { useOfficerOverrides } from '../hooks/useOfficerOverrides.js'
import { committeeOfficers, usePeople } from '../lib/people.js'

const isSupport = (g) => /support|division|psd|pnsd|cbsd/i.test(g || '')

// Support divisions: force "Support Division" onto its own second line so
// all the headings line up uniformly.
function splitName(name) {
  const m = /^(.*?)\s*Support Division\s*$/i.exec(name || '')
  return m ? [m[1].trim(), 'Support Division'] : [name, null]
}

function Connector() {
  return (
    <div className="mx-auto my-6 h-12 w-px bg-gradient-to-b from-line/30 to-transparent" />
  )
}

function TierLabel({ children }) {
  return (
    <div className="flex items-center justify-center gap-4">
      <span className="h-px w-10 bg-medical/50" />
      <span className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
        {children}
      </span>
      <span className="h-px w-10 bg-medical/50" />
    </div>
  )
}

// Officer avatar with a Drive-friendly fallback to initials.
function Avatar({ person, color }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-page text-sm font-semibold text-soft ring-2 sm:h-16 sm:w-16"
      style={{ '--tw-ring-color': rgba(color, 0.55) }}
    >
      {person.photo && !failed ? (
        <img
          src={person.photo}
          alt={person.name || person.abbr}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(person.name)
      )}
    </div>
  )
}

function CommitteeCard({ c, i, ov, holders }) {
  // The full title is shown once as a header. Each person below it shows
  // just name + abbreviation: whoever holds the position this term, with
  // society.js as the fallback and the committee page's officer photo applied
  // to the lead officer (src/lib/people.js).
  const people = committeeOfficers(c, holders, ov && ov.photo)

  const accent = readableAccent(c.color)

  return (
    <Link
      to={`/committees/${slugFor(c)}`}
      className="reveal group flex h-full flex-col rounded-2xl border border-line/10 bg-card p-3 text-center transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-forest-950/40 sm:p-6"
      style={{
        transitionDelay: `${(i % 5) * 70}ms`,
        '--brandGlow': c.color ? rgba(c.color, 0.22) : 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = accent
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = ''
      }}
    >
      <div className="relative mx-auto flex h-14 w-full items-center justify-center sm:h-20">
        <div
          className="absolute h-16 w-16 rounded-full blur-2xl sm:h-20 sm:w-20"
          style={{ background: 'var(--brandGlow)' }}
          aria-hidden="true"
        />
        {c.logo ? (
          <img
            src={c.logo}
            alt={`${c.abbr} logo`}
            loading="lazy"
            className="logo-ink relative max-h-14 w-auto object-contain drop-shadow sm:max-h-20"
          />
        ) : (
          <span className="heading-serif relative text-2xl tracking-wide text-accent sm:text-3xl">
            {c.abbr}
          </span>
        )}
      </div>

      <h3 className="heading-serif mt-3 text-sm leading-snug text-ink sm:mt-4 sm:text-lg">
        {(() => {
          const [top, bottom] = splitName(c.name)
          return bottom ? (
            <>
              <span className="block">{top}</span>
              <span className="block">{bottom}</span>
            </>
          ) : (
            c.name
          )
        })()}
      </h3>
      <span
        className="mx-auto mt-2 block h-0.5 w-8 rounded-full"
        style={{ background: accent }}
        aria-hidden="true"
      />
      {c.officer && (
        <p
          className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: accent }}
        >
          {c.officer}
        </p>
      )}
      <ul className="mt-4 flex flex-wrap items-start justify-center gap-x-3 gap-y-3 sm:gap-x-6 sm:gap-y-4">
        {people.map((o, idx) => (
          <li
            key={o.abbr || idx}
            className="flex w-20 flex-col items-center text-center sm:w-28"
          >
            <Avatar person={o} color={c.color} />
            <span
              className={`mt-2 block text-sm font-medium leading-tight ${
                o.name?.trim() ? 'text-soft' : 'italic text-soft/35'
              }`}
            >
              {o.name?.trim() || 'Name TBA'}
            </span>
            {o.abbr && (
              <span
                className="mt-0.5 block text-xs font-bold tracking-[0.2em]"
                style={{ color: accent }}
              >
                {o.abbr}
              </span>
            )}
          </li>
        ))}
      </ul>
      {c.description && (
        <p className="mt-4 text-xs leading-relaxed text-soft/65 sm:text-sm">
          {c.description}
        </p>
      )}
      <span
        className="mt-5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-soft/50 transition-colors group-hover:text-ink"
      >
        View page
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  )
}

export default function TeamOfficials() {
  const { overrides } = useOfficerOverrides()
  const holders = usePeople()
  const { standing, support } = useMemo(() => {
    return {
      standing: committees.filter((c) => !isSupport(c.group)),
      support: committees.filter((c) => isSupport(c.group)),
    }
  }, [])

  return (
    <section
      id="officials"
      className="relative overflow-hidden bg-page pb-28 pt-4 sm:pb-36"
    >
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--c-soft)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-soft)) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="container-prose relative">
        {/* Continues the hierarchy from the Executive Board above */}
        <Connector />

        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Team of Officials
            <span className="h-px w-8 bg-medical" />
          </span>
          <h2 className="heading-serif mt-5 text-4xl text-ink sm:text-5xl">
            Committees and support divisions
          </h2>
          <p className="mt-4 text-lg font-light text-soft/70">
            The teams that carry out the society&rsquo;s work. Open any of them
            to see who they are and what they do.
          </p>
        </div>

        {/* Tier, Standing Committees */}
        {standing.length > 0 && (
          <>
            <Connector />
            <div className="reveal">
              <TierLabel>Standing committees</TierLabel>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
              {standing.map((c, i) => (
                <CommitteeCard
                  key={`${c.abbr}-${i}`}
                  c={c}
                  i={i}
                  ov={overrides[slugFor(c)]}
                  holders={holders}
                />
              ))}
            </div>
          </>
        )}

        {/* Tier, Support Divisions */}
        {support.length > 0 && (
          <>
            <Connector />
            <div className="reveal">
              <TierLabel>Support divisions</TierLabel>
            </div>
            <div className="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {support.map((c, i) => (
                <CommitteeCard
                  key={`${c.abbr}-${i}`}
                  c={c}
                  i={i}
                  ov={overrides[slugFor(c)]}
                  holders={holders}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
