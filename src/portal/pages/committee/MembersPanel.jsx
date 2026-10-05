import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  useAddMemberNote,
  useAssignRosterMember,
  useCommitteePositions,
  useCommitteeRoster,
  useDeleteMemberNote,
  useMemberNotes,
  usePositions,
  useRemovePosition,
} from '../../rosterQueries.js'
import { PositionOptions } from '../admin/PositionTypesPanel.jsx'
import { ErrorText, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { when } from '../../workUi.jsx'
import { MEMBERSHIP_LABELS } from '../../constants.js'
import ExportButtons from '../../ExportButtons.jsx'
import { unitPositions, useRosterUnit } from '../../rosterUnits.js'

// The "Members" tab of /portal/committees/:slug: the people the Executive
// Board has linked to this committee on the membership roster, whether or not
// they have ever signed in. An officer can give a member a position in the
// committee (which is what lets them receive tasks) and keep private notes.
// The membership record itself is read-only here: status, joining year and GA
// counts stay with the EB and the Secretary General's sheet, and the database
// enforces that (rpc/committee_roster is the only door to these rows).
//
// SCOPE and SCORE share one members list (rosterUnits.js): opened from either
// committee this tab shows the same people under the name SCOPE/SCORE, with
// the positions and notes of both.

const tagCls =
  'inline-flex items-center rounded-full border border-line/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-soft/60'

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-soft/45">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm text-soft/85">{children || '–'}</dd>
    </div>
  )
}

function Notes({ member, committee }) {
  const { user, isEB } = useAuth()
  const notes = useMemberNotes(member.id, committee.ids)
  const add = useAddMemberNote()
  const remove = useDeleteMemberNote()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const onAdd = async (e) => {
    e.preventDefault()
    setError('')
    try {
      // filed under the committee the member is filed under
      await add.mutateAsync({ entryId: member.id, committeeId: member.committee_id || committee.id, body })
      setBody('')
    } catch (err) {
      setError(err?.message || 'Could not save the note.')
    }
  }

  return (
    <div className="mt-5 border-t border-line/10 pt-5">
      <p className="text-sm font-semibold text-ink">
        Officer notes{' '}
        <span className="font-normal text-soft/55">
          · only {committee.abbr}&rsquo;s officers and the Executive Board see these, never the member
        </span>
      </p>
      {notes.isPending ? (
        <Spinner className="mt-3 h-4 w-4" />
      ) : (
        <ul className="mt-3 space-y-3">
          {(notes.data || []).map((n) => (
            <li key={n.id} className="rounded-xl border border-line/10 bg-sunk px-4 py-3">
              <p className="whitespace-pre-line text-sm text-soft/85">{n.body}</p>
              <p className="mt-1 flex items-center gap-3 text-xs text-soft/45">
                {when(n.created_at)}
                {(n.author_id === user?.id || isEB) && (
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(n.id)}
                    className="font-semibold text-soft/60 hover:text-danger"
                  >
                    Delete
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onAdd} className="mt-3 space-y-2">
        <textarea
          rows={2}
          required
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`A note about ${member.full_name.split(' ')[0]}`}
          aria-label={`New note about ${member.full_name}`}
          className={inputCls}
        />
        <ErrorText>{error || notes.error?.message}</ErrorText>
        <button type="submit" disabled={add.isPending || !body.trim()} className={outlineBtnCls}>
          {add.isPending ? 'Saving…' : 'Add note'}
        </button>
      </form>
    </div>
  )
}

function Assign({ member, committee, positions }) {
  const { isEB } = useAuth()
  const assign = useAssignRosterMember()
  const current = member.position?.id || ''
  const [position, setPosition] = useState(current)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  // An officer moves members between the positions below their own; a member who
  // already holds a senior one is the Executive Board's to change.
  const locked = !isEB && member.position?.level === 'officer'

  const onAssign = async (e) => {
    e.preventDefault()
    setError('')
    setNote('')
    try {
      const state = await assign.mutateAsync({ entry: member.id, position })
      setNote(
        state === 'recorded'
          ? 'Saved on the roster. An officer’s access belongs to the position’s work email, so this member’s own account is unchanged.'
          : state === 'assigned'
            ? 'Saved. It is on their portal account now.'
            : state === 'invited'
              ? 'Saved. It reaches their account the first time they sign in with this email.'
              : 'Saved. The roster has no email for them, so it cannot reach an account yet.',
      )
    } catch (err) {
      setError(err?.message || 'Could not save that position.')
    }
  }

  return (
    <form onSubmit={onAssign} className="mt-5 border-t border-line/10 pt-5">
      <p className="text-sm font-semibold text-ink">Position in {committee.abbr}</p>
      {locked ? (
        <p className="mt-2 text-sm text-soft/70">
          {member.position.title}. Only the Executive Board changes an officer&rsquo;s position.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            required
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            aria-label={`Position for ${member.full_name}`}
            className={`${inputCls} max-w-xs`}
          >
            <PositionOptions
              positions={unitPositions(positions, { id: committee.homeId, ids: committee.ids }, current)}
              committeeIds={committee.ids}
              current={current}
              withOfficers={isEB}
            />
          </select>
          <button
            type="submit"
            disabled={assign.isPending || !position || position === current}
            className={`${primaryBtnCls} px-5 py-1.5 text-xs`}
          >
            {assign.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {note && (
        <p className="mt-2 text-xs text-ok" role="status">
          {note}
        </p>
      )}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}

// Positions the member holds here beyond the one the roster gives them: an
// invite accepted from the Invites tab, or one left from before the roster kept
// positions. These are the ones that can be taken away; the roster's own is
// changed with the picker above.
function ExtraPositions({ extras, committee }) {
  const remove = useRemovePosition()
  const [asking, setAsking] = useState('')
  if (extras.length === 0) return null
  return (
    <div className="mt-5 border-t border-line/10 pt-5">
      <p className="text-sm font-semibold text-ink">Also holds in {committee.abbr}</p>
      <ul className="mt-3 space-y-2">
        {extras.map((h) => (
          <li key={h.assignment_id} className="flex flex-wrap items-center gap-3 text-sm text-soft/85">
            <span>{h.position.title}</span>
            {h.can_remove &&
              (asking === h.assignment_id ? (
                <span className="flex items-center gap-3 text-xs font-semibold">
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(h.assignment_id)}
                    className="text-danger hover:text-danger disabled:opacity-40"
                  >
                    {remove.isPending ? 'Removing…' : 'Yes, remove'}
                  </button>
                  <button type="button" onClick={() => setAsking('')} className="text-soft/60 hover:text-ink">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAsking(h.assignment_id)}
                  className="text-xs font-semibold text-soft/60 hover:text-ink"
                >
                  Remove
                </button>
              ))}
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <ErrorText>{remove.error?.message}</ErrorText>
      </div>
    </div>
  )
}

function Member({ member, committee, positions, extras, open, onToggle }) {
  const { user } = useAuth()
  const isSelf = member.profile_id && member.profile_id === user?.id
  return (
    <li className="rounded-2xl border border-line/10 bg-card p-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-ink">{member.full_name}</span>
          <span className="block truncate text-sm text-soft/60">{member.email || 'No email on file'}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-soft/70">
          <span className="font-semibold text-accent">{member.status || 'No status'}</span>
          {member.position && <span className={tagCls}>{member.position.title}</span>}
          {member.is_contact_person && <span className={tagCls}>Contact person</span>}
          {member.notes > 0 && (
            <span className={tagCls}>
              {member.notes} {member.notes === 1 ? 'note' : 'notes'}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="mt-4 border-t border-line/10 pt-5">
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Fact label="Year joined">{member.joined_year}</Fact>
            <Fact label="Years spent">{member.years_spent}</Fact>
            <Fact label="Local GAs">{member.lgas}</Fact>
            <Fact label="National GAs">{member.ngas}</Fact>
            <div className="col-span-2 sm:col-span-4">
              <Fact label="Other positions">{member.current_position}</Fact>
            </div>
          </dl>
          <p className="mt-4 text-xs text-soft/50">
            {member.profile_id ? 'Has signed in to the portal.' : 'Has not signed in to the portal yet.'}{' '}
            {member.positions.length > 0 && (
              <>
                Holds a position here, so they can be given{' '}
                <Link to="/portal/tasks" className="font-semibold text-accent hover:text-ink">
                  tasks
                </Link>
                .
              </>
            )}
          </p>
          <Assign member={member} committee={committee} positions={positions} />
          <ExtraPositions extras={extras} committee={committee} />
          {!isSelf && <Notes member={member} committee={committee} />}
        </div>
      )}
    </li>
  )
}

const NO_EXTRAS = []

const MEMBER_COLUMNS = [
  { label: 'Name', value: (m) => m.full_name },
  { label: 'Email', value: (m) => m.email },
  { label: 'Status', value: (m) => MEMBERSHIP_LABELS[m.status] || m.status },
  { label: 'Joined', value: (m) => m.joined_year },
  { label: 'LGAs', value: (m) => m.lgas },
  { label: 'NGAs', value: (m) => m.ngas },
  { label: 'Position', value: (m) => m.position?.title || m.current_position || '' },
  { label: 'Contact person', value: (m) => (m.is_contact_person ? 'yes' : '') },
  { label: 'Signed in', value: (m) => (m.profile_id ? 'yes' : '') },
]

export default function MembersPanel({ committee: opened }) {
  const committee = useRosterUnit(opened)
  const roster = useCommitteeRoster(committee.id)
  const positions = usePositions().data || []
  const held = useCommitteePositions(committee.id)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)

  const members = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (roster.data || []).filter((m) => {
      const hay = `${m.full_name} ${m.email || ''} ${m.current_position || ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [roster.data, q])

  // profile id -> the positions that person holds here which the roster did not give
  const extrasByProfile = useMemo(() => {
    const map = new Map()
    for (const h of held.data?.holders || []) {
      if (h.from_roster) continue
      if (!map.has(h.profile_id)) map.set(h.profile_id, [])
      map.get(h.profile_id).push(h)
    }
    return map
  }, [held.data])

  if (roster.isPending) {
    return (
      <div className="py-16 text-center">
        <Spinner />
      </div>
    )
  }
  if (roster.error) {
    return (
      <Panel>
        <ErrorText>Couldn’t load the members: {roster.error.message}</ErrorText>
      </Panel>
    )
  }
  if (roster.data.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">
          Nobody on the membership roster is linked to {committee.abbr} yet. The Executive Board
          sets each member&rsquo;s committee on the Roster page; send the Secretary General your
          members list and they can place everyone at once.
        </p>
      </Panel>
    )
  }

  return (
    <>
      <p className="max-w-2xl pb-5 text-sm text-soft/65">
        Everyone the membership roster places in {committee.abbr}. You can set each member&rsquo;s
        position and keep notes on them; someone who is not on this list yet is invited from the
        Invites tab. Their membership record (status, year joined, GA counts) is
        kept by the Executive Board and cannot be changed here.
      </p>
      <div className="flex flex-wrap items-center gap-3 pb-5">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email or position"
          aria-label={`Search ${committee.abbr}'s members`}
          className={`${inputCls} max-w-sm`}
        />
        <span className="text-xs text-soft/50" aria-live="polite">
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </span>
        {roster.isFetching && <Spinner className="h-4 w-4" />}
        <span className="ml-auto">
          <ExportButtons
            title={`${committee.abbr} members`}
            subtitle={`${committee.abbr}: everyone the membership roster places in the committee${q ? `, matching “${q}”` : ''}.`}
            filename={`ausss-${committee.slug}-members`}
            columns={MEMBER_COLUMNS}
            rows={members}
            landscape
          />
        </span>
      </div>
      {members.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">Nobody matches that.</p>
        </Panel>
      ) : (
        <ul className="space-y-3">
          {members.map((m) => (
            <Member
              key={m.id}
              member={m}
              committee={committee}
              positions={positions}
              extras={(m.profile_id && extrasByProfile.get(m.profile_id)) || NO_EXTRAS}
              open={openId === m.id}
              onToggle={() => setOpenId(openId === m.id ? null : m.id)}
            />
          ))}
        </ul>
      )}
    </>
  )
}
