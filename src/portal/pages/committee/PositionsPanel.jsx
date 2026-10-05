import { useMemo, useState } from 'react'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  useCommitteePositions,
  useInviteToPosition,
  usePositions,
  useRemovePosition,
  useSocietyPositions,
  useWithdrawInvite,
} from '../../rosterQueries.js'
import { PositionOptions } from '../admin/PositionTypesPanel.jsx'
import { ErrorText, Panel, Spinner, inputCls, primaryBtnCls } from '../../portalUi.jsx'
import { when } from '../../workUi.jsx'
import { Avatar } from '../../Avatar.jsx'
import { unitPositions, useRosterUnit } from '../../rosterUnits.js'

// The invites screen. For a committee it is the "Invites" tab of
// /portal/committees/:slug; with no committee it is the Executive Board panel
// of the Roster page, which is how the board itself is changed.
//
// Three things live here: offering a position to an email address, the offers
// still waiting for a first sign-in, and the people who hold a position now.
// A position that the membership roster gave (the Members tab) is shown but
// changed there, never here; the database refuses it either way.

const tagCls =
  'inline-flex shrink-0 items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-silver/60'
const textBtnCls = 'text-xs font-semibold transition-colors disabled:opacity-40'

// A two-step inline confirm, the portal's usual shape for anything destructive.
function ConfirmButton({ label, confirmLabel, busy, onConfirm }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={`${textBtnCls} text-silver/60 hover:text-white`}>
        {label}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-3">
      <button type="button" disabled={busy} onClick={onConfirm} className={`${textBtnCls} text-red-300 hover:text-red-200`}>
        {busy ? 'Working…' : confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className={`${textBtnCls} text-silver/60 hover:text-white`}>
        Keep
      </button>
    </span>
  )
}

function InviteForm({ committee, positions }) {
  const { isEB } = useAuth()
  const invite = useInviteToPosition()
  const [email, setEmail] = useState('')
  const [position, setPosition] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setNote('')
    try {
      const state = await invite.mutateAsync({ email, position })
      setNote(
        state === 'assigned'
          ? `${email.trim()} already has an account, so the position is on it now.`
          : `Saved. ${email.trim()} gets the position the first time they sign in with that address. No email is sent, so let them know.`,
      )
      setEmail('')
    } catch (err) {
      setError(err?.message || 'Could not save the invite.')
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address to invite"
          autoComplete="off"
          className={`${inputCls} max-w-xs`}
        />
        <select
          required
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          aria-label="Position"
          className={`${inputCls} max-w-xs`}
        >
          <option value="">Choose a position</option>
          {committee ? (
            <PositionOptions
              positions={unitPositions(positions, { id: committee.homeId, ids: committee.ids })}
              committeeIds={committee.ids}
              withOfficers={isEB}
            />
          ) : (
            positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))
          )}
        </select>
        <button type="submit" disabled={invite.isPending} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
          {invite.isPending ? 'Saving…' : 'Invite'}
        </button>
      </div>
      {note && (
        <p className="mt-3 text-xs text-emerald-300" role="status">
          {note}
        </p>
      )}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}

function InviteRow({ invite }) {
  const withdraw = useWithdrawInvite()
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">{invite.email}</span>
        <span className="block text-xs text-silver/50">
          {invite.invited_by ? `Invited by ${invite.invited_by} · ` : ''}
          {when(invite.created_at)}
        </span>
      </span>
      <span className={tagCls}>{invite.position.title}</span>
      {invite.can_withdraw && (
        <ConfirmButton
          label="Withdraw"
          confirmLabel="Yes, withdraw"
          busy={withdraw.isPending}
          onConfirm={() => withdraw.mutate(invite.id)}
        />
      )}
      {withdraw.error && (
        <span className="w-full">
          <ErrorText>{withdraw.error.message}</ErrorText>
        </span>
      )}
    </li>
  )
}

function HolderRow({ holder, rosterHint }) {
  const { user } = useAuth()
  const remove = useRemovePosition()
  const isSelf = holder.profile_id === user?.id
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <Avatar name={holder.full_name} src={holder.avatar_url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {holder.full_name || 'No name yet'}
          {isSelf && <span className="font-normal text-silver/50"> (you)</span>}
        </span>
        <span className="block truncate text-xs text-silver/50">{holder.email}</span>
      </span>
      <span className={tagCls}>{holder.position.title}</span>
      {holder.from_roster ? (
        <span className="text-xs text-silver/45">{rosterHint}</span>
      ) : (
        holder.can_remove && (
          <ConfirmButton
            label="Remove"
            confirmLabel="Yes, remove"
            busy={remove.isPending}
            onConfirm={() => remove.mutate(holder.assignment_id)}
          />
        )
      )}
      {remove.error && (
        <span className="w-full">
          <ErrorText>{remove.error.message}</ErrorText>
        </span>
      )}
    </li>
  )
}

// committee: the row from `committees`, or null for the society-level positions.
export default function PositionsPanel({ committee: opened = null }) {
  // SCOPE and SCORE share their positions and invites (rosterUnits.js)
  const committee = useRosterUnit(opened)
  const held = useCommitteePositions(committee?.id || null)
  const committeePositions = usePositions()
  const societyPositions = useSocietyPositions(!committee)
  const positions = (committee ? committeePositions.data : societyPositions.data) || []
  const [showRoster, setShowRoster] = useState(false)

  const { direct, fromRoster } = useMemo(() => {
    const invites = held.data?.invites || []
    return {
      direct: invites.filter((i) => !i.from_roster),
      fromRoster: invites.filter((i) => i.from_roster),
    }
  }, [held.data])

  if (held.isPending) {
    return (
      <div className="py-16 text-center">
        <Spinner />
      </div>
    )
  }
  if (held.error) {
    return (
      <Panel>
        <ErrorText>Couldn’t load the positions: {held.error.message}</ErrorText>
      </Panel>
    )
  }

  const holders = held.data.holders || []
  const where = committee ? committee.abbr : 'the Executive Board'

  return (
    <div className="max-w-3xl space-y-5">
      <Panel title="Invite by email">
        <p className="mt-3 text-sm text-silver/65">
          {committee
            ? `For someone who is not on ${committee.abbr}’s members list yet. Choose the position they should hold; they get it the first time they sign in with that address. An officer’s position opens the committee’s editors, so it goes to the position’s work email, never a personal one.`
            : 'Gives a board position, and with it the board’s access to the portal, to an address. Use the position’s work email, never a personal one: it holds the position from its first sign-in, and the public pages follow.'}
        </p>
        <InviteForm committee={committee} positions={positions} />
      </Panel>

      <Panel title={`Waiting for a first sign-in (${direct.length + fromRoster.length})`}>
        {direct.length === 0 && fromRoster.length === 0 ? (
          <p className="mt-4 text-sm text-silver/60">Nothing is waiting.</p>
        ) : (
          <>
            {direct.length > 0 && (
              <ul className="mt-2 divide-y divide-white/5">
                {direct.map((i) => (
                  <InviteRow key={i.id} invite={i} />
                ))}
              </ul>
            )}
            {fromRoster.length > 0 && (
              <div className={direct.length > 0 ? 'mt-3 border-t border-white/10 pt-4' : 'mt-4'}>
                <p className="text-sm text-silver/65">
                  {fromRoster.length} {fromRoster.length === 1 ? 'member' : 'members'} on the
                  members list {fromRoster.length === 1 ? 'has' : 'have'} not signed in yet. Their
                  position is set on the Members tab and reaches them when they do.{' '}
                  <button
                    type="button"
                    aria-expanded={showRoster}
                    onClick={() => setShowRoster((v) => !v)}
                    className={`${textBtnCls} text-medical-light hover:text-white`}
                  >
                    {showRoster ? 'Hide' : 'Show them'}
                  </button>
                </p>
                {showRoster && (
                  <ul className="mt-2 divide-y divide-white/5">
                    {fromRoster.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-sm text-silver/85">{i.email}</span>
                        <span className={tagCls}>{i.position.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel title={`Holding a position in ${where} (${holders.length})`}>
        {holders.length === 0 ? (
          <p className="mt-4 text-sm text-silver/60">Nobody with an account holds a position here yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {holders.map((h) => (
              <HolderRow
                key={h.assignment_id}
                holder={h}
                rosterHint={committee ? 'Set on the Members tab' : 'Set on the roster below'}
              />
            ))}
          </ul>
        )}
        {held.isFetching && <Spinner className="mt-3 h-4 w-4" />}
      </Panel>
    </div>
  )
}
