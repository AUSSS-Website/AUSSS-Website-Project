import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  useAddMemberNote,
  useAssignRosterMember,
  useCommitteeRoster,
  useDeleteMemberNote,
  useMemberNotes,
  usePositions,
} from '../../rosterQueries.js'
import { PositionOptions } from '../admin/PositionTypesPanel.jsx'
import { ErrorText, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { when } from '../../workUi.jsx'

// The "Members" tab of /portal/committees/:slug: the people the Executive
// Board has linked to this committee on the membership roster, whether or not
// they have ever signed in. An officer can give a member a position in the
// committee (which is what lets them receive tasks) and keep private notes.
// The membership record itself is read-only here: status, joining year and GA
// counts stay with the EB and the Secretary General's sheet, and the database
// enforces that (rpc/committee_roster is the only door to these rows).

const tagCls =
  'inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-silver/60'

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-silver/45">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm text-silver/85">{children || '—'}</dd>
    </div>
  )
}

function Notes({ member, committee }) {
  const { user, isEB } = useAuth()
  const notes = useMemberNotes(member.id, committee.id)
  const add = useAddMemberNote()
  const remove = useDeleteMemberNote()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const onAdd = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await add.mutateAsync({ entryId: member.id, committeeId: committee.id, body })
      setBody('')
    } catch (err) {
      setError(err?.message || 'Could not save the note.')
    }
  }

  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <p className="text-sm font-semibold text-white">
        Officer notes{' '}
        <span className="font-normal text-silver/55">
          · only {committee.abbr}&rsquo;s officers and the Executive Board see these, never the member
        </span>
      </p>
      {notes.isPending ? (
        <Spinner className="mt-3 h-4 w-4" />
      ) : (
        <ul className="mt-3 space-y-3">
          {(notes.data || []).map((n) => (
            <li key={n.id} className="rounded-xl border border-white/10 bg-forest-900 px-4 py-3">
              <p className="whitespace-pre-line text-sm text-silver/85">{n.body}</p>
              <p className="mt-1 flex items-center gap-3 text-xs text-silver/45">
                {when(n.created_at)}
                {(n.author_id === user?.id || isEB) && (
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(n.id)}
                    className="font-semibold text-silver/60 hover:text-red-300"
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
        state === 'assigned'
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
    <form onSubmit={onAssign} className="mt-5 border-t border-white/10 pt-5">
      <p className="text-sm font-semibold text-white">Position in {committee.abbr}</p>
      {locked ? (
        <p className="mt-2 text-sm text-silver/70">
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
            <PositionOptions positions={positions} committeeId={committee.id} current={current} withOfficers={isEB} />
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
        <p className="mt-2 text-xs text-emerald-300" role="status">
          {note}
        </p>
      )}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}

function Member({ member, committee, positions, open, onToggle }) {
  const { user } = useAuth()
  const isSelf = member.profile_id && member.profile_id === user?.id
  return (
    <li className="rounded-2xl border border-white/10 bg-forest-800 p-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-white">{member.full_name}</span>
          <span className="block truncate text-sm text-silver/60">{member.email || 'No email on file'}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-silver/70">
          <span className="font-semibold text-medical-light">{member.status || 'No status'}</span>
          {member.position && <span className={tagCls}>{member.position.title}</span>}
          {member.is_contact_person && <span className={tagCls}>Contact Person</span>}
          {member.notes > 0 && (
            <span className={tagCls}>
              {member.notes} {member.notes === 1 ? 'note' : 'notes'}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="mt-4 border-t border-white/10 pt-5">
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Fact label="Year joined">{member.joined_year}</Fact>
            <Fact label="Years spent">{member.years_spent}</Fact>
            <Fact label="Local GAs">{member.lgas}</Fact>
            <Fact label="National GAs">{member.ngas}</Fact>
            <div className="col-span-2 sm:col-span-4">
              <Fact label="Position on the membership sheet">{member.current_position}</Fact>
            </div>
          </dl>
          <p className="mt-4 text-xs text-silver/50">
            {member.profile_id ? 'Has signed in to the portal.' : 'Has not signed in to the portal yet.'}{' '}
            {member.positions.length > 0 && (
              <>
                Holds a position here, so they can be given{' '}
                <Link to="/portal/tasks" className="font-semibold text-medical-light hover:text-white">
                  tasks
                </Link>
                .
              </>
            )}
          </p>
          <Assign member={member} committee={committee} positions={positions} />
          {!isSelf && <Notes member={member} committee={committee} />}
        </div>
      )}
    </li>
  )
}

export default function MembersPanel({ committee }) {
  const roster = useCommitteeRoster(committee.id)
  const positions = usePositions().data || []
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)

  const members = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (roster.data || []).filter((m) => {
      const hay = `${m.full_name} ${m.email || ''} ${m.current_position || ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [roster.data, q])

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
        <p className="text-sm text-silver/70">
          Nobody on the membership roster is linked to {committee.abbr} yet. The Executive Board
          sets each member&rsquo;s committee on the Roster page; send the Secretary General your
          members list and they can place everyone at once.
        </p>
      </Panel>
    )
  }

  return (
    <>
      <p className="max-w-2xl pb-5 text-sm text-silver/65">
        Everyone the membership roster places in {committee.abbr}. You can set each member&rsquo;s
        position and keep notes on them; their membership record (status, year joined, GA counts) is kept
        by the Executive Board and cannot be changed here.
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
        <span className="text-xs text-silver/50" aria-live="polite">
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </span>
        {roster.isFetching && <Spinner className="h-4 w-4" />}
      </div>
      {members.length === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">Nobody matches that.</p>
        </Panel>
      ) : (
        <ul className="space-y-3">
          {members.map((m) => (
            <Member
              key={m.id}
              member={m}
              committee={committee}
              positions={positions}
              open={openId === m.id}
              onToggle={() => setOpenId(openId === m.id ? null : m.id)}
            />
          ))}
        </ul>
      )}
    </>
  )
}
