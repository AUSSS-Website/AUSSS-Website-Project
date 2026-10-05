import { readableAccent, rgba } from '../lib/color.js'
import { driveImg } from '../lib/img.js'
import { PersonCard, SectionLabel } from './committeeUi.jsx'
import { committeeOfficers, usePeople } from '../lib/people.js'

// Live preview of the editable parts of a committee page, fed by the officer
// editor's in-progress form state. It reuses the SAME PersonCard / SectionLabel
// and section markup as CommitteePage, so what officers see here matches what
// publishes. Static sections (logo hero chrome, mascot, IFMSA mission) aren't
// editable, so they're summarised/omitted to keep the focus on the edits.
export default function CommitteePreview({
  committee: c,
  tagline,
  about = [],
  whatWeDo = [],
  whatWeDoEnabled,
  photo,
  members = [],
  membersEnabled,
}) {
  const accent = readableAccent(c.color)

  // Same rule as the live page: this term's holders over society.js, the
  // edited photo on the lead officer unless they chose one on their profile.
  const officers = committeeOfficers(c, usePeople(), photo)

  const memberCards = membersEnabled
    ? members
        .filter((m) => (m.name || '').trim() || m.photo)
        .map((m) => ({ name: m.name, photo: driveImg(m.photo), role: m.title }))
    : []

  const wwd = whatWeDoEnabled ? whatWeDo : []

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-forest-950">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-medical-light">
          Live preview
        </span>
        <span className="text-[11px] text-silver/40">{c.abbr} page</span>
      </div>

      <div className="max-h-[78vh] space-y-10 overflow-y-auto p-6">
        {/* Hero summary */}
        <div className="text-center">
          {c.logo && (
            <img
              src={c.logo}
              alt={`${c.abbr} logo`}
              className="mx-auto h-14 w-auto object-contain drop-shadow"
            />
          )}
          <p
            className="mt-3 text-[10px] font-semibold uppercase tracking-[0.24em]"
            style={{ color: accent }}
          >
            {c.group}
            {c.abbr ? ` · ${c.abbr}` : ''}
          </p>
          <h2 className="heading-serif mt-2 text-2xl text-white">
            {c.nickname || c.name}
          </h2>
          {c.nickname && (
            <p className="heading-serif text-base text-silver/80">{c.name}</p>
          )}
          {(tagline || c.officer) && (
            <p className="mx-auto mt-2 max-w-sm text-sm font-light text-silver/75">
              {tagline || c.officer}
            </p>
          )}
        </div>

        {/* Who we are */}
        {about.length > 0 && (
          <section>
            <SectionLabel accent={accent}>Who we are</SectionLabel>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-silver/80">
              {about.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        )}

        {/* What we do */}
        {wwd.length > 0 && (
          <section>
            <SectionLabel accent={accent}>What we do</SectionLabel>
            <ul className="mt-4 grid gap-3">
              {wwd.map((item, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-2xl border border-white/10 bg-forest-800 p-4"
                >
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold"
                    style={{ background: rgba(c.color, 0.18), color: accent }}
                  >
                    {i + 1}
                  </span>
                  <p className="min-w-0 break-words text-sm leading-relaxed text-silver/80">{item}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Team */}
        <section className="text-center">
          <SectionLabel accent={accent} center noRule>
            The team
          </SectionLabel>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-8">
            {officers.map((o, i) => (
              <PersonCard key={o.abbr || i} person={o} color={c.color} />
            ))}
          </div>
          {memberCards.length > 0 && (
            <div className="mx-auto mt-8 border-t border-white/10 pt-8">
              <div className="flex flex-wrap justify-center gap-x-6 gap-y-8">
                {memberCards.map((m, i) => (
                  <PersonCard key={`m-${i}`} person={m} color={c.color} />
                ))}
              </div>
            </div>
          )}
        </section>

        <p className="border-t border-white/10 pt-4 text-center text-[11px] text-silver/35">
          Preview of your editable sections. The mascot and IFMSA mission
          blocks publish too, but aren’t editable here.
        </p>
      </div>
    </div>
  )
}
