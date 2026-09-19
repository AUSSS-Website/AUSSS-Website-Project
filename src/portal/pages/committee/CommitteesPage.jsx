import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useCommittees } from '../../officerQueries.js'
import { Centered, ErrorText, PageHeader, Panel, Spinner } from '../../portalUi.jsx'

// /portal/committees. The committees this person may edit: every one for the
// EB and webmaster, otherwise the committees where they hold an officer-level
// position this term. Replaces the EB "Picker" from the old /account page.

function CommitteeTile({ c }) {
  return (
    <li>
      <Link
        to={`/portal/committees/${c.slug}`}
        className="group flex h-full w-full flex-col items-center gap-3 rounded-2xl border border-white/10 bg-forest-800 p-5 text-center transition-colors hover:border-medical/40"
      >
        {/* Committee logo PNGs are solid white, show them on a dark chip
            (accent border), not a white one, so they're visible. */}
        <span
          className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl border bg-forest-950 p-1.5"
          style={{ borderColor: c.color || 'rgba(255,255,255,0.15)' }}
        >
          {c.logo ? (
            <img src={c.logo} alt={c.abbr} className="h-full w-full object-contain" />
          ) : (
            <span className="heading-serif text-lg text-white">{c.abbr}</span>
          )}
        </span>
        <span className="heading-serif text-base text-white">{c.abbr}</span>
        <span className="text-xs leading-snug text-silver/55">{c.name}</span>
        {c.page && Object.keys(c.page).length > 0 && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-medical-light">
            Customised
          </span>
        )}
      </Link>
    </li>
  )
}

export default function CommitteesPage() {
  usePageTitle('Your committees')
  const { isEB, officerOf } = useAuth()
  const all = useCommittees(true)

  const mine = (all.data || []).filter((c) => isEB || officerOf(c.slug))

  return (
    <>
      <PageHeader
        eyebrow={isEB ? 'Executive Board' : 'Officer'}
        title="Your committees"
        subtitle={
          isEB
            ? 'Pick a committee or division to edit. You have access to all of them.'
            : 'The committees you hold an officer position in this term.'
        }
      />

      {all.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : all.error ? (
        <Panel>
          <ErrorText>Couldn’t load committees: {all.error.message}</ErrorText>
        </Panel>
      ) : mine.length === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">
            No committee to edit. Officer access follows your position for this
            term: if you hold one, ask the EB or the webmaster to add you.
          </p>
        </Panel>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {mine.map((c) => (
            <CommitteeTile key={c.id} c={c} />
          ))}
        </ul>
      )}
    </>
  )
}
