import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { committeeBySlug } from '../../../data/society.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useCommittee } from '../../officerQueries.js'
import { Centered, ErrorText, PageHeader, Panel, Spinner } from '../../portalUi.jsx'
import PageEditor from './PageEditor.jsx'
import CallsPanel from './CallsPanel.jsx'
import MembersPanel from './MembersPanel.jsx'
import PositionsPanel from './PositionsPanel.jsx'

// /portal/committees/:slug. What an officer manages for their committee:
// the public page itself, the recruitment calls running on it, the
// committee's own members, and the invites and positions of people who are
// not on its members list. The database decides what is allowed
// (save_committee_page and the calls policies); this page only decides what
// to show, so a member who types the URL sees a polite refusal instead of a
// broken editor.

const TABS = [
  ['page', 'Committee page'],
  ['calls', 'Open calls'],
  ['members', 'Members'],
  ['invites', 'Invites'],
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
        <p className="text-sm text-soft/70">Unknown committee ({slug}).</p>
        <Link
          to="/portal/committees"
          className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink"
        >
          &larr; Choose another committee
        </Link>
      </Panel>
    )
  }
  if (!officerOf(slug)) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">
          Only {committee.data.abbr}&rsquo;s officers and the Executive Board can
          edit this page. If you think you should have access, ask the webmaster
          to check your assignment for this term.
        </p>
        <Link
          to="/portal"
          className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink"
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
          <Link to="/portal/committees" className="hover:text-ink">
            &larr; Your committees
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {c.logo && (
              <span
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-page p-1"
                style={{ borderColor: c.color || 'rgb(var(--c-line) / 0.15)' }}
              >
                <img src={c.logo} alt="" className="logo-ink h-full w-full object-contain" />
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
            className="rounded-full border border-line/20 px-4 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-veil/10"
          >
            View public page ↗
          </Link>
        }
      />

      <div role="tablist" aria-label="Committee editor" className="mb-8 flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              tab === key
                ? 'bg-cta text-on-cta'
                : 'border border-line/15 text-soft/70 hover:text-ink'
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
      {tab === 'members' && <MembersPanel committee={c} />}
      {tab === 'invites' && <PositionsPanel committee={c} />}
    </>
  )
}
