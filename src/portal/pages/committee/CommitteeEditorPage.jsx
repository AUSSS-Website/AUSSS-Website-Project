import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { committeeBySlug } from '../../../data/society.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useCommittee } from '../../officerQueries.js'
import { Centered, ErrorText, PageHeader, Panel, Spinner } from '../../portalUi.jsx'
import PageEditor from './PageEditor.jsx'
import CallsPanel from './CallsPanel.jsx'

// /portal/committees/:slug. Two things an officer manages for their
// committee: the public page itself, and the recruitment calls running on
// it. The database decides what is allowed (save_committee_page and the
// calls policies); this page only decides what to show, so a member who
// types the URL sees a polite refusal instead of a broken editor.

const TABS = [
  ['page', 'Committee page'],
  ['calls', 'Open calls'],
]

export default function CommitteeEditorPage() {
  const { slug } = useParams()
  const { officerOf } = useAuth()
  const committee = useCommittee(slug)
  const staticCommittee = committeeBySlug(slug)
  const [tab, setTab] = useState('page')
  usePageTitle(staticCommittee ? `Edit ${staticCommittee.abbr}` : 'Edit committee')

  if (committee.isPending) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  if (committee.error) {
    return (
      <Panel>
        <ErrorText>Couldn’t load this committee: {committee.error.message}</ErrorText>
      </Panel>
    )
  }
  if (!committee.data || !staticCommittee) {
    return (
      <Panel>
        <p className="text-sm text-silver/70">Unknown committee ({slug}).</p>
        <Link
          to="/portal/committees"
          className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white"
        >
          &larr; Choose another committee
        </Link>
      </Panel>
    )
  }
  if (!officerOf(slug)) {
    return (
      <Panel>
        <p className="text-sm text-silver/70">
          Only {committee.data.abbr}&rsquo;s officers and the Executive Board can
          edit this page. If you think you should have access, ask the webmaster
          to check your assignment for this term.
        </p>
        <Link
          to="/portal"
          className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white"
        >
          &larr; Back to your dashboard
        </Link>
      </Panel>
    )
  }

  const c = committee.data

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/portal/committees" className="hover:text-white">
            &larr; Your committees
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {c.logo && (
              <span
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-forest-950 p-1"
                style={{ borderColor: c.color || 'rgba(255,255,255,0.15)' }}
              >
                <img src={c.logo} alt="" className="h-full w-full object-contain" />
              </span>
            )}
            {c.abbr}
          </span>
        }
        subtitle={c.name}
        action={
          <Link
            to={`/committees/${c.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
          >
            View public page &nearr;
          </Link>
        }
      />

      <div role="tablist" aria-label="Committee editor" className="mb-8 flex gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              tab === key
                ? 'bg-medical text-forest-950'
                : 'border border-white/15 text-silver/70 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The page editor stays mounted (hidden) so switching tabs never
          loses an in-progress edit; the calls panel is cheap to remount. */}
      <div className={tab === 'page' ? '' : 'hidden'}>
        <PageEditor key={c.id} committee={c} staticCommittee={staticCommittee} />
      </div>
      {tab === 'calls' && <CallsPanel committee={c} />}
    </>
  )
}
