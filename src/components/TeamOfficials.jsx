import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { committees, slugFor } from '../data/society.js'
import { readableAccent, rgba } from '../lib/color.js'
import { driveImg } from '../lib/img.js'
import { useOfficerOverrides } from '../hooks/useOfficerOverrides.js'

const isSupport = (g) => /support|division|psd|pnsd|cbsd/i.test(g || '')

const initials = (name) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || ','

// Support divisions: force "Support Division" onto its own second line so
// all the headings line up uniformly.
function splitName(name) {
  const m = /^(.*?)\s*Support Division\s*$/i.exec(name || '')
  return m ? [m[1].trim(), 'Support Division'] : [name, null]
}

function Connector() {
  return (
    <div className="mx-auto my-6 h-12 w-px bg-gradient-to-b from-silver/40 to-transparent" />
  )
}

function TierLabel({ children }) {
  return (
    <div className="flex items-center justify-center gap-4">
      <span className="h-px w-10 bg-medical/50" />
      <span className="text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
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
      className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-forest-950 text-sm font-semibold text-silver ring-2 sm:h-16 sm:w-16"
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

function CommitteeCard({ c, i, ov }) {
  // The full title is shown once as a header. Each person below it shows
  // just name + abbreviation. Multi-officer committees use `officers`;
  // single ones derive a one-entry list from officerAbbr / holder.
  const basePeople =
    Array.isArray(c.officers) && c.officers.length > 0
      ? c.officers
      : [{ name: c.holder, abbr: c.officerAbbr, photo: c.photo }]
  // The officer photo edited in the portal (override keyed by slug) applies to
  // the lead officer, so it shows here on the home page, not just the
  // committee page.
  const people =
    ov && ov.photo
      ? basePeople.map((o, idx) =>
          idx === 0 ? { ...o, photo: driveImg(ov.photo) } : o,
        )
      : basePeople

  const accent = readableAccent(c.color)

  return (
    <Link
      to={`/committees/${slugFor(c)}`}
      className="reveal group flex h-full flex-col rounded-2xl border border-white/10 bg-forest-800 p-3 text-center transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-forest-950/40 sm:p-6"
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
            className="relative max-h-14 w-auto object-contain drop-shadow sm:max-h-20"
          />
        ) : (
          <span className="heading-serif relative text-2xl tracking-wide text-medical-light sm:text-3xl">
            {c.abbr}
          </span>
        )}
      </div>

      <h3 className="heading-serif mt-3 text-sm leading-snug text-white sm:mt-4 sm:text-lg">
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
                o.name?.trim() ? 'text-silver' : 'italic text-silver/35'
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
        <p className="mt-4 text-xs leading-relaxed text-silver/65 sm:text-sm">
          {c.description}
        </p>
      )}
      <span
        className="mt-5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-silver/50 transition-colors group-hover:text-white"
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
  const { standing, support } = useMemo(() => {
    return {
      standing: committees.filter((c) => !isSupport(c.group)),
      support: committees.filter((c) => isSupport(c.group)),
    }
  }, [])

  return (
    <section
      id="officials"
      className="relative overflow-hidden bg-forest-950 pb-28 pt-4 sm:pb-36"
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
        {/* Continues the hierarchy from the Executive Board above */}
        <Connector />

        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Team of Officials
            <span className="h-px w-8 bg-medical" />
          </span>
          <h2 className="heading-serif mt-5 text-4xl text-white sm:text-5xl">
            Committees &amp; Support Divisions
          </h2>
          <p className="mt-4 text-lg font-light text-silver/70">
            The operational arm of the Executive Board. Select any unit to
            explore who they are and what they do.
          </p>
        </div>

        {/* Tier, Standing Committees */}
        {standing.length > 0 && (
          <>
            <Connector />
            <div className="reveal">
              <TierLabel>Standing Committees</TierLabel>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
              {standing.map((c, i) => (
                <CommitteeCard
                  key={`${c.abbr}-${i}`}
                  c={c}
                  i={i}
                  ov={overrides[slugFor(c)]}
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
              <TierLabel>Support Divisions</TierLabel>
            </div>
            <div className="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {support.map((c, i) => (
                <CommitteeCard
                  key={`${c.abbr}-${i}`}
                  c={c}
                  i={i}
                  ov={overrides[slugFor(c)]}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
