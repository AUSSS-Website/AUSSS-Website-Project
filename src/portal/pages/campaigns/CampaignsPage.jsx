import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { campaignProgress, useCampaigns, useWorkScopes } from '../../workQueries.js'
import { ErrorText, PageHeader, PageLoading, Panel, primaryBtnCls } from '../../portalUi.jsx'
import {
  CampaignStatusPill,
  CommitteeTag,
  ProgressBar,
  campaignDates,
  chipBtnCls,
  progressText,
} from '../../workUi.jsx'
import CampaignEditor from './CampaignEditor.jsx'
import { byPortalOrder } from '../../officerQueries.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'

// /portal/campaigns. Every campaign the database lets this person see: the
// ones they opened, the ones in committees where they may hand out work, and
// the ones with a subtask they are on. A campaign is split into subtasks and
// working groups on its own page, each with its own people.
//
// What is on screen is kept in the address: the new-campaign form (?tab=new),
// the committee filter (?committee=) and whether the finished campaigns are
// unfolded (?done=). So Back from a campaign returns to the same list.

const EMPTY = []

// The page itself, or the form that takes its place.
const VIEWS = ['campaigns', 'new']

// Whether the finished campaigns under the list are folded away.
const DONE = ['hidden', 'shown']

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps the portal's small pill. In px and not rem, because the root size
// shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

function CampaignCard({ campaign }) {
  const progress = campaignProgress(campaign.tasks)
  const dates = campaignDates(campaign)
  return (
    <li>
      <Link
        to={`/portal/campaigns/${campaign.id}`}
        className="block rounded-2xl border border-line/10 bg-card p-4 transition-colors hover:border-line/25 active:border-line/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          <CommitteeTag committee={campaign.committee} />
          <CampaignStatusPill status={campaign.status} />
          {dates && <span className="text-xs font-semibold text-soft/60">{dates}</span>}
        </div>
        <p className={`mt-2.5 text-base font-semibold ${campaign.status === 'done' ? 'text-soft/60' : 'text-ink'}`}>
          {campaign.title}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ProgressBar {...progress} className="w-32" />
          <span className="text-xs text-soft/55">{progressText(progress)}</span>
        </div>
      </Link>
    </li>
  )
}

export default function CampaignsPage() {
  usePageTitle('Campaigns')
  const navigate = useNavigate()
  const scopes = useWorkScopes()
  const campaigns = useCampaigns()
  const canCreate = scopes.society || scopes.task.length > 0

  const [tab, setTab] = useTabParam(VIEWS, 'campaigns')
  // The form says when it holds typed work. While it does it stays open
  // whatever the address says, and the address is put back: the Campaigns link
  // in the header leads to this same page without ?tab=new, and would
  // otherwise close a half-written campaign without a word.
  const [holding, setHolding] = useState(false)
  useEffect(() => {
    if (holding && tab !== 'new') setTab('new')
  }, [holding, tab, setTab])
  const creating = (tab === 'new' || holding) && canCreate
  const [done, setDone] = useTabParam(DONE, 'hidden', 'done')
  const showDone = done === 'shown'

  const rows = campaigns.data || EMPTY
  const committees = useMemo(() => {
    const map = new Map()
    for (const c of rows) if (c.committee) map.set(c.committee.id, c.committee)
    return [...map.values()].sort(byPortalOrder)
  }, [rows])
  const committeeSlugs = useMemo(() => committees.map((c) => c.slug), [committees])
  const [committee, setCommittee] = useTabParam(committeeSlugs, '', 'committee')

  const visible = useMemo(
    () => rows.filter((c) => !committee || c.committee?.slug === committee),
    [rows, committee],
  )
  const open = visible.filter((c) => c.status !== 'done')
  const finished = visible.filter((c) => c.status === 'done')

  if (creating) {
    return (
      <>
        <PageHeader
          eyebrow="Campaigns"
          title="New campaign"
          subtitle="Open the campaign first. Its subtasks, working groups and people come next."
        />
        <CampaignEditor
          scopes={scopes}
          onHold={setHolding}
          onCancel={() => {
            setHolding(false)
            setTab('campaigns')
          }}
          onDone={(id) => {
            setHolding(false)
            // The form leaves the address first, so Back from the new campaign
            // returns to the list and not to an empty form.
            setTab('campaigns')
            navigate(`/portal/campaigns/${id}`)
          }}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title="Campaigns"
        subtitle={
          canCreate
            ? 'Each campaign is split into subtasks and working groups, with its own people on each.'
            : 'The campaigns you have a part in.'
        }
        action={
          canCreate && (
            <button type="button" onClick={() => setTab('new')} className={`${primaryBtnCls} ${tapCls}`}>
              New campaign
            </button>
          )
        }
      />

      {committees.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Committee">
          <button
            type="button"
            aria-pressed={!committee}
            onClick={() => setCommittee('')}
            className={`${chipBtnCls(!committee)} ${tapCls}`}
          >
            All committees
          </button>
          {committees.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={committee === c.slug}
              onClick={() => setCommittee(c.slug)}
              className={`${chipBtnCls(committee === c.slug)} ${tapCls}`}
            >
              {c.abbr}
            </button>
          ))}
        </div>
      )}

      {campaigns.isPending ? (
        <PageLoading />
      ) : campaigns.error ? (
        <Panel>
          <ErrorText>{errorText(campaigns.error, 'Couldn’t load the campaigns.')}</ErrorText>
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">
            {rows.length === 0
              ? canCreate
                ? 'No campaigns yet. Open the first one.'
                : 'You have not been put on a campaign yet.'
              : 'No campaigns in this committee.'}
          </p>
        </Panel>
      ) : (
        <>
          {open.length === 0 ? (
            <Panel>
              <p className="text-sm text-soft/70">No campaign is open.</p>
            </Panel>
          ) : (
            <ul className="space-y-3">
              {open.map((c) => (
                <CampaignCard key={c.id} campaign={c} />
              ))}
            </ul>
          )}
          {finished.length > 0 && (
            // The button is one line of small type with a thumb's 44px to land
            // on; the margins here take its extra 14px above and below away.
            <div className="mt-[18px]">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setDone(showDone ? 'hidden' : 'shown')}
                className={`inline-flex min-h-[44px] items-center text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 ${pressCls} hover:text-ink`}
              >
                {showDone ? 'Hide' : 'Show'} done ({finished.length})
              </button>
              {showDone && (
                <ul className="mt-0.5 space-y-3">
                  {finished.map((c) => (
                    <CampaignCard key={c.id} campaign={c} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
