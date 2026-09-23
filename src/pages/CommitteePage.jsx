import { useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { committeeBySlug, slugFor } from '../data/society.js'
import { readableAccent, rgba } from '../lib/color.js'
import { driveImg } from '../lib/img.js'
import { useOfficerOverrides } from '../hooks/useOfficerOverrides.js'
import { useCalls } from '../hooks/useCalls.js'
import { PersonCard, SectionLabel } from '../components/committeeUi.jsx'
import CallCard from '../components/CallCard.jsx'
import ApplyModal from '../components/ApplyModal.jsx'

export default function CommitteePage() {
  const { slug } = useParams()
  const c = committeeBySlug(slug)
  usePageTitle(c?.name || 'Committees')
  const { overrides } = useOfficerOverrides()
  const { calls } = useCalls()
  // The call whose application form is open, if any.
  const [applyingTo, setApplyingTo] = useState(null)
  useReveal()

  if (!c) return <Navigate to="/" replace />

  // Live officer edits (photo, tagline, bio, what-we-do, members) merged on
  // top of the static society.js committee. Empty when there is no override.
  const ov = overrides[slugFor(c)] || {}

  const accent = readableAccent(c.color)
  // Live recruitment calls for this committee. The backend only ever returns
  // ones that are open and inside their deadline, so there's nothing to filter
  // here, and an empty list simply hides the section.
  const openCalls = calls[slugFor(c)] || []
  const tagline = ov.tagline || c.tagline
  const baseOfficers =
    Array.isArray(c.officers) && c.officers.length > 0
      ? c.officers
      : [{ name: c.holder, abbr: c.officerAbbr, photo: c.photo }]
  // The editable officer photo applies to the lead officer.
  const officers = ov.photo
    ? baseOfficers.map((o, i) => (i === 0 ? { ...o, photo: driveImg(ov.photo) } : o))
    : baseOfficers
  // Members: section is opt-in. When enabled, the officer-managed list
  // replaces the static one; when explicitly disabled, no member cards show.
  const membersHidden = ov.membersEnabled === false
  const members = ov.membersEnabled
    ? (Array.isArray(ov.members) ? ov.members : []).map((m) => ({
        name: m.name,
        photo: driveImg(m.photo),
        role: m.title,
      }))
    : membersHidden
      ? []
      : Array.isArray(c.members)
        ? c.members
        : []
  const about =
    Array.isArray(ov.about) && ov.about.length
      ? ov.about
      : Array.isArray(c.about)
        ? c.about
        : c.about
          ? [c.about]
          : c.description
            ? [c.description]
            : []
  // "What we do" is opt-in and OFF by default. Officers turn it on in the
  // editor; when enabled their edited list shows, falling back to the
  // society.js presets. Off → empty array → the section is hidden.
  const whatWeDo = ov.whatWeDoEnabled
    ? Array.isArray(ov.whatWeDo) && ov.whatWeDo.length
      ? ov.whatWeDo
      : Array.isArray(c.whatWeDo)
        ? c.whatWeDo
        : []
    : []

  return (
    <article className="bg-forest-950">
      {/* Brand hero */}
      <header className="relative overflow-hidden pb-20 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(#C9D6DF 1px, transparent 1px), linear-gradient(90deg, #C9D6DF 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        <div className="container-prose relative text-center">
          <Link
            to="/#officials"
            className="mb-8 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-silver/60 transition-colors hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All committees and divisions
          </Link>

          <div className="mx-auto mb-6 flex h-28 items-center justify-center">
            {c.logo ? (
              <img
                src={c.logo}
                alt={`${c.abbr} logo`}
                className="max-h-28 w-auto object-contain drop-shadow"
              />
            ) : (
              <span className="heading-serif text-5xl text-white">
                {c.abbr}
              </span>
            )}
          </div>

          <p
            className="text-xs font-semibold uppercase tracking-[0.24em]"
            style={{ color: accent }}
          >
            {c.group}
            {c.abbr ? ` · ${c.abbr}` : ''}
          </p>
          {/* Title shows the committee's informal nickname (e.g. SCOPEnguins)
              when one exists, with the formal name kept as a subtitle. */}
          <h1 className="heading-serif mt-3 text-4xl text-white sm:text-6xl">
            {c.nickname || c.name}
          </h1>
          {c.nickname && (
            <p className="heading-serif mt-2 text-xl text-silver/80 sm:text-2xl">
              {c.name}
            </p>
          )}
          {(tagline || c.officer) && (
            <p className="mx-auto mt-4 max-w-2xl text-lg font-light text-silver/75">
              {tagline || c.officer}
            </p>
          )}
        </div>
      </header>

      <div className="container-prose space-y-24 pb-28 sm:pb-36">
        {/* Who they are */}
        {about.length > 0 && (
          <section className="reveal mx-auto max-w-5xl">
            <SectionLabel accent={accent}>Who we are</SectionLabel>
            <div className="mt-6 space-y-5 text-lg leading-relaxed text-silver/80">
              {about.map((p, idx) => (
                <p key={idx}>{p}</p>
              ))}
            </div>
          </section>
        )}

        {/* Open Calls, officer-published recruitment (small working groups,
            campaigns, …). Sits above the static material because it's the
            time-sensitive, actionable part of the page, and disappears
            entirely once a committee has nothing open. */}
        {openCalls.length > 0 && (
          <section className="reveal mx-auto max-w-5xl">
            <SectionLabel accent={accent}>Open Calls</SectionLabel>
            <p className="mt-6 max-w-2xl text-sm leading-relaxed text-silver/60">
              Opportunities {c.abbr} is recruiting for right now. Applications go
              straight to the team running them.
            </p>
            <ul className="mt-8 grid gap-5 lg:grid-cols-2">
              {openCalls.map((call) => (
                <CallCard
                  key={call.id}
                  call={call}
                  color={c.color}
                  onApply={setApplyingTo}
                />
              ))}
            </ul>
          </section>
        )}

        {/* IFMSA mission & pillars, read-only, straight from the official
            standing-committee page on ifmsa.org. Deliberately NOT merged with
            officer overrides (`ov`), so officers can edit their own copy above
            but never this canonical IFMSA framing. */}
        {c.ifmsa && (
          <section className="reveal mx-auto max-w-5xl">
            <SectionLabel accent={accent}>From IFMSA · mission and pillars</SectionLabel>
            <div
              className="mt-8 rounded-3xl border bg-forest-900/60 p-8 sm:p-10"
              style={{ borderColor: rgba(c.color, 0.3) }}
            >
              <blockquote>
                <span
                  className="heading-serif block text-5xl leading-none"
                  style={{ color: accent }}
                  aria-hidden="true"
                >
                  &ldquo;
                </span>
                <p className="-mt-3 text-xl font-light italic leading-relaxed text-silver/90 sm:text-2xl">
                  {c.ifmsa.mission}
                </p>
              </blockquote>

              {c.ifmsa.pillars?.length > 0 && (
                <>
                  <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-silver/45">
                    Objectives and focus areas
                  </p>
                  <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {c.ifmsa.pillars.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex gap-3 text-sm leading-relaxed text-silver/80"
                      >
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: accent }}
                          aria-hidden="true"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <a
                href={c.ifmsa.source}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-silver/50 transition-colors hover:text-white"
              >
                Mission and objectives as published by IFMSA
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </a>
            </div>
          </section>
        )}

        {/* What they do */}
        {whatWeDo.length > 0 && (
          <section className="reveal mx-auto max-w-5xl">
            <SectionLabel accent={accent}>What we do</SectionLabel>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {whatWeDo.map((item, idx) => (
                <li
                  key={idx}
                  className="flex gap-4 rounded-2xl border border-white/10 bg-forest-800 p-6"
                >
                  <span
                    className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold"
                    style={{ background: rgba(c.color, 0.18), color: accent }}
                  >
                    {idx + 1}
                  </span>
                  <p className="min-w-0 break-words text-sm leading-relaxed text-silver/80">
                    {item}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Mascot & nickname, the committee's informal identity, pulled from
            official IFMSA / NMO sources. Read-only (not an officer override).
            Sits just before the team as a light, human note on the community. */}
        {c.mascot && (
          <section className="reveal mx-auto max-w-3xl">
            <SectionLabel accent={accent} noRule>Our mascot</SectionLabel>
            <div className="mt-8 flex flex-col items-center gap-6 rounded-3xl border border-white/10 bg-forest-800 p-8 text-center sm:flex-row sm:items-start sm:gap-8 sm:p-10 sm:text-left">
              <div
                className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl text-5xl"
                style={{ background: rgba(c.color, 0.16) }}
                aria-hidden="true"
              >
                {c.mascot.emoji}
              </div>
              <div className="min-w-0">
                <h3 className="heading-serif text-2xl text-white">
                  {c.nickname}
                  {c.mascot.animal && (
                    <span className="text-silver/50"> · the {c.mascot.animal}</span>
                  )}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-silver/80">
                  {c.mascot.body}
                </p>
                {c.mascot.sources?.length > 0 && (
                  <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-silver/45">
                    {c.mascot.sources.map((s) => (
                      <a
                        key={s.href}
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 transition-colors hover:text-white"
                      >
                        {s.label}
                      </a>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Team */}
        <section className="reveal mx-auto max-w-5xl text-center">
          <SectionLabel accent={accent} center noRule>
            The team
          </SectionLabel>
          {/* Officer(s) / director on their own row */}
          <div className="mt-10 flex flex-wrap justify-center gap-x-10 gap-y-10">
            {officers.map((o, idx) => (
              <PersonCard key={o.abbr || idx} person={o} color={c.color} />
            ))}
          </div>
          {/* The rest of the team, below */}
          {members.length > 0 && (
            <div className="mx-auto mt-12 max-w-3xl border-t border-white/10 pt-12">
              <div className="flex flex-wrap justify-center gap-x-10 gap-y-10">
                {members.map((m, idx) => (
                  <PersonCard key={`m-${idx}`} person={m} color={c.color} />
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="reveal text-center">
          <Link
            to="/#officials"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Back to all committees and divisions
          </Link>
        </div>
      </div>

      {applyingTo && (
        <ApplyModal
          call={applyingTo}
          color={c.color}
          onClose={() => setApplyingTo(null)}
        />
      )}
    </article>
  )
}

