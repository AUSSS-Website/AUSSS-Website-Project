import { Link } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import Button from '../../components/ui/Button.jsx'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useMyVerification, usePendingVerifications } from '../queries.js'
import { isPostLive, usePosts, useTasks } from '../workQueries.js'
import { useSubmissionCounts } from '../submissionsQueries.js'
import { PageHeader, Panel, StatusBadge } from '../portalUi.jsx'
import { CommitteeTag, DueLabel, PriorityPill, UnreadDot } from '../workUi.jsx'

// /portal. One glance: the work waiting on you, the updates you haven't read,
// who you are, whether you're verified, what you hold this term, and (EB
// only) how many verification requests are waiting.

const moreLinkCls = 'mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white'

// Open tasks assigned to this person, soonest due first (the query's order).
function MyTasksPanel({ uid }) {
  const tasks = useTasks()
  const mine = (tasks.data || []).filter(
    (t) => t.status !== 'done' && t.assignees.some((a) => a.profile_id === uid),
  )
  return (
    <Panel title="Your tasks">
      {tasks.isPending ? (
        <p className="mt-4 text-sm text-silver/60">Loading…</p>
      ) : tasks.error ? (
        <p className="mt-4 text-sm text-silver/60">Couldn’t load your tasks.</p>
      ) : mine.length === 0 ? (
        <p className="mt-4 text-sm text-silver/60">Nothing open is assigned to you.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/10">
          {mine.slice(0, 5).map((t) => (
            <li key={t.id}>
              <Link
                to={`/portal/tasks/${t.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm text-white hover:text-medical-light"
              >
                <CommitteeTag committee={t.committee} />
                <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                <PriorityPill priority={t.priority} />
                <DueLabel task={t} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/portal/tasks" className={moreLinkCls}>
        {mine.length > 5 ? `All ${mine.length} open tasks` : 'All tasks'} &rarr;
      </Link>
    </Panel>
  )
}

function UpdatesPanel({ uid }) {
  const posts = usePosts()
  const unread = (posts.data || []).filter(
    (p) => isPostLive(p) && !p.reads.some((r) => r.profile_id === uid),
  )
  return (
    <Panel title="Updates">
      {posts.isPending ? (
        <p className="mt-4 text-sm text-silver/60">Loading…</p>
      ) : posts.error ? (
        <p className="mt-4 text-sm text-silver/60">Couldn’t load updates.</p>
      ) : unread.length === 0 ? (
        <p className="mt-4 text-sm text-silver/60">You’re all caught up.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {unread.slice(0, 4).map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 text-sm text-white">
              <UnreadDot />
              <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
              <CommitteeTag committee={p.committee} />
            </li>
          ))}
        </ul>
      )}
      <Link to="/portal/updates" className={moreLinkCls}>
        {unread.length > 0 ? `Read ${unread.length} unread` : 'All updates'} &rarr;
      </Link>
    </Panel>
  )
}

// New orders, stories and sign-ups waiting for a first look. Stories only for
// the exchange officers; everything for the EB.
function SubmissionsPanel({ isEB, canStories }) {
  const counts = useSubmissionCounts()
  const c = counts.data
  const parts = c
    ? [
        isEB && c.orders > 0 && `${c.orders} new order${c.orders === 1 ? '' : 's'}`,
        canStories && c.stories > 0 && `${c.stories} new stor${c.stories === 1 ? 'y' : 'ies'}`,
        isEB && c.signups > 0 && `${c.signups} new sign-up${c.signups === 1 ? '' : 's'}`,
      ].filter(Boolean)
    : []
  return (
    <Panel title="Submissions">
      <p className="mt-4 text-sm text-silver/70">
        {counts.isPending
          ? 'Checking what came in…'
          : counts.error
            ? 'Couldn’t load the submissions.'
            : parts.length === 0
              ? 'Nothing new from the website forms.'
              : `${parts.join(', ')} waiting for a first look.`}
      </p>
      <Link to="/portal/submissions" className={moreLinkCls}>
        Open submissions &rarr;
      </Link>
    </Panel>
  )
}

const STATUS_BLURB = {
  unverified:
    'We haven’t matched you to the membership roster yet. Request verification and an EB member will confirm you.',
  candidate: 'You’re a candidate member. Complete your candidacy to become a full member.',
  active: 'You’re an active member of AUSSS. Welcome back.',
  alumni: 'You’re AUSSS alumni. Thank you for everything you gave the society.',
}

function firstName(profile, user) {
  const full =
    profile?.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  return full.trim().split(/\s+/)[0] || ''
}

// Committee colour as a translucent fill; falls back to a hairline when the
// committee has no colour (society-wide EB positions).
function chipStyle(color) {
  if (!color) return undefined
  const hex6 = /^#[0-9a-f]{6}$/i.test(color)
  return {
    borderColor: color,
    backgroundColor: hex6 ? `${color}22` : undefined,
  }
}

function PositionChip({ assignment }) {
  const pos = assignment.position || {}
  const c = pos.committee
  const label = c ? `${c.abbr} · ${pos.short_title || pos.title}` : `AUSSS · ${pos.title}`
  return (
    <li
      className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white"
      style={chipStyle(c?.color)}
      title={c ? `${c.name} · ${pos.title}` : pos.title}
    >
      {c?.logo && <img src={c.logo} alt="" className="h-4 w-4 object-contain" />}
      {label}
    </li>
  )
}

export default function DashboardPage() {
  usePageTitle('Members portal')
  const { user, profile, assignments, isEB, officerOf, profileError } = useAuth()
  // Committees this person can edit: officers see theirs, the EB sees all.
  const officerCommittees = assignments
    .filter((a) => a.position?.level === 'officer' && a.position?.committee)
    .map((a) => a.position.committee)
  const canEditCommittees = isEB || officerCommittees.length > 0
  const canStories = isEB || officerOf('scope') || officerOf('score')
  const myVer = useMyVerification(user.id)
  const pending = usePendingVerifications(isEB)

  const status = profile?.membership_status || 'unverified'
  const requestPending = myVer.data?.status === 'pending'
  const showVerifyCta = status === 'unverified' && !myVer.isPending && !requestPending
  const name = firstName(profile, user)

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title={name ? `Hi, ${name}` : 'Welcome'}
        subtitle={user.email}
      />

      {profileError && (
        <p role="alert" className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          We couldn’t load your profile ({profileError.message}). Try again in a moment.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <MyTasksPanel uid={user.id} />
        <UpdatesPanel uid={user.id} />

        <Panel title="Membership">
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <StatusBadge status={status} />
            {profile?.membership_tier && (
              <span className="text-xs text-silver/55">{profile.membership_tier}</span>
            )}
            {profile?.joined_year && (
              <span className="text-xs text-silver/55">Joined {profile.joined_year}</span>
            )}
          </div>
          <p className="mt-3 text-sm text-silver/70">{STATUS_BLURB[status] || ''}</p>
          {showVerifyCta && (
            <Button to="/portal/verify" variant="accent" size="sm" className="mt-4">
              Request verification
            </Button>
          )}
          {requestPending && (
            <p className="mt-4 text-xs font-semibold text-medical-light">
              Verification requested. An EB member will review it soon.
            </p>
          )}
        </Panel>

        <Panel title="Positions this term">
          {assignments.length === 0 ? (
            <p className="mt-4 text-sm text-silver/60">
              No positions on record for this term. If you hold one, ask your
              officer or the EB to add you.
            </p>
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {assignments.map((a) => (
                <PositionChip key={a.id} assignment={a} />
              ))}
            </ul>
          )}
          {assignments[0]?.term?.label && (
            <p className="mt-4 text-xs text-silver/45">Term {assignments[0].term.label}</p>
          )}
        </Panel>

        <Panel title="Your details">
          <p className="mt-4 text-sm text-silver/70">
            Keep your name, phone and year current so officers can reach you.
          </p>
          <Link
            to="/portal/profile"
            className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white"
          >
            Edit profile &rarr;
          </Link>
        </Panel>

        {canEditCommittees && (
          <Panel title="Your committees">
            <p className="mt-4 text-sm text-silver/70">
              {isEB
                ? 'Edit any committee page, its open calls and applications.'
                : `Edit the ${officerCommittees.map((c) => c.abbr).join(', ')} page, open calls and applications.`}
            </p>
            <Link
              to={
                !isEB && officerCommittees.length === 1
                  ? `/portal/committees/${officerCommittees[0].slug}`
                  : '/portal/committees'
              }
              className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white"
            >
              Open the editor &rarr;
            </Link>
          </Panel>
        )}

        {officerOf('pnsd') && (
          <Panel title="Gallery">
            <p className="mt-4 text-sm text-silver/70">
              Add albums and photos to the public gallery. Changes are live as soon as they are saved.
            </p>
            <Link to="/portal/gallery" className={moreLinkCls}>
              Open the gallery editor &rarr;
            </Link>
          </Panel>
        )}

        {officerOf('cbsd') && (
          <Panel title="Magazine">
            <p className="mt-4 text-sm text-silver/70">
              Add an edition from its PDF, pick its cover page and write its description.
            </p>
            <Link to="/portal/magazine" className={moreLinkCls}>
              Open the magazine editor &rarr;
            </Link>
          </Panel>
        )}

        {canStories && <SubmissionsPanel isEB={isEB} canStories={canStories} />}

        {isEB && (
          <Panel title="Executive Board">
            <p className="mt-4 text-sm text-silver/70">
              {pending.isPending
                ? 'Checking the verification queue…'
                : pending.error
                  ? 'Couldn’t load the verification queue.'
                  : pending.data.length === 0
                    ? 'No verification requests waiting.'
                    : `${pending.data.length} verification request${
                        pending.data.length === 1 ? '' : 's'
                      } waiting for a decision.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <Link
                to="/portal/admin/verification"
                className="text-sm font-semibold text-medical-light hover:text-white"
              >
                Open the queue &rarr;
              </Link>
              <Link
                to="/portal/admin/settings"
                className="text-sm font-semibold text-medical-light hover:text-white"
              >
                Site settings &rarr;
              </Link>
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}
