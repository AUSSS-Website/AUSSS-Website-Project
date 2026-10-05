import { useMemo, useState } from 'react'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  useCommitteePositions,
  useInviteToPosition,
  usePositions,
  useRemovePosition,
  useSetWorkEmail,
  useSocietyPositions,
  useWithdrawInvite,
  useWorkEmails,
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
// For the Executive Board there is a fourth: the work email of each officer's
// and board position, the one address such a position can be given to.
// A position that the membership roster gave (the Members tab) is shown but
// changed there, never here; the database refuses it either way.

const NO_EMAILS = {}

const tagCls =
  'inline-flex shrink-0 items-center rounded-full border border-line/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-soft/60'
const textBtnCls = 'text-xs font-semibold transition-colors disabled:opacity-40'

// A two-step inline confirm, the portal's usual shape for anything destructive.
function ConfirmButton({ label, confirmLabel, busy, onConfirm }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={`${textBtnCls} text-soft/60 hover:text-ink`}>
        {label}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-3">
      <button type="button" disabled={busy} onClick={onConfirm} className={`${textBtnCls} text-danger hover:text-danger`}>
        {busy ? 'Working…' : confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className={`${textBtnCls} text-soft/60 hover:text-ink`}>
        Keep
      </button>
    </span>
  )
}

// An officer's, a board member's or the webmaster's position: it opens editors
// and admin pages, so it has one work email and goes to no other address.
const isPrivileged = (p) => p?.level === 'officer' || p?.level === 'eb' || p?.level === 'webmaster'

function InviteForm({ committee, positions, workEmails }) {
  const { isEB } = useAuth()
  const invite = useInviteToPosition()
  const [typed, setTyped] = useState('')
  const [position, setPosition] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // what the picker offers: a committee's unit positions, or the society-level ones
  const offered = committee
    ? unitPositions(positions, { id: committee.homeId, ids: committee.ids })
    : positions
  const chosen = offered.find((p) => p.id === position)
  // such a position is not typed an address: it has one, or cannot be given yet
  const fixed = isPrivileged(chosen)
  const workEmail = fixed ? workEmails[position] || '' : ''
  const email = fixed ? workEmail : typed

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setNote('')
    try {
      const state = await invite.mutateAsync({ email, position })
      setNote(
        state === 'assigned'
          ? `${email.trim()} already has an account, so the position is on it now.`
          : `Saved. ${email.trim()} gets the position the first time it signs in. No email is sent, so let them know.`,
      )
      setTyped('')
    } catch (err) {
      setError(err?.message || 'Could not save the invite.')
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          required
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          aria-label="Position"
          className={`${inputCls} max-w-xs`}
        >
          <option value="">Choose a position</option>
          {committee ? (
            <PositionOptions positions={offered} committeeIds={committee.ids} withOfficers={isEB} />
          ) : (
            positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))
          )}
        </select>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setTyped(e.target.value)}
          readOnly={fixed}
          placeholder={fixed ? 'No work email set' : 'name@example.com'}
          aria-label={fixed ? 'The position’s work email' : 'Email address to invite'}
          autoComplete="off"
          className={`${inputCls} max-w-xs ${fixed ? 'cursor-not-allowed opacity-70' : ''}`}
        />
        <button
          type="submit"
          disabled={invite.isPending || (fixed && !workEmail)}
          className={`${primaryBtnCls} px-5 py-2 text-xs`}
        >
          {invite.isPending ? 'Saving…' : 'Invite'}
        </button>
      </div>
      {fixed && (
        <p className="mt-3 text-xs text-soft/60">
          {workEmail
            ? 'This position opens editors and admin pages, so it only ever goes to its work email.'
            : 'This position has no work email yet. Set it under “Work emails” below; it can only be given to that address.'}
        </p>
      )}
      {note && (
        <p className="mt-3 text-xs text-ok" role="status">
          {note}
        </p>
      )}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}

function WorkEmailRow({ position, email, locked }) {
  const save = useSetWorkEmail()
  const [value, setValue] = useState(email)
  const [saved, setSaved] = useState(false)
  const changed = value.trim().toLowerCase() !== email

  const submit = async (e) => {
    e.preventDefault()
    setSaved(false)
    try {
      await save.mutateAsync({ position_id: position.id, email: value })
      setSaved(true)
    } catch {
      // save.error is rendered below
    }
  }

  return (
    <li>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 py-2.5">
        <span className="w-full text-sm font-semibold text-ink sm:w-64">{position.title}</span>
        <input
          type="email"
          required
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
          readOnly={locked}
          placeholder="role@example.com"
          aria-label={`Work email of ${position.title}`}
          autoComplete="off"
          className={`${inputCls} max-w-xs ${locked ? 'cursor-not-allowed opacity-70' : ''}`}
        />
        {!locked && changed && value.trim() && (
          <button type="submit" disabled={save.isPending} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
        {saved && !changed && <span className="text-xs text-ok">Saved.</span>}
        {locked && <span className="text-xs text-soft/45">Only the webmaster changes this one</span>}
        {save.error && (
          <span className="w-full">
            <ErrorText>{save.error.message}</ErrorText>
          </span>
        )}
      </form>
    </li>
  )
}

// The Executive Board's list of which address each officer's or board position
// belongs to. The database gives such a position to that address and to no
// other (migration 20261005180001).
function WorkEmails({ positions, workEmails }) {
  const { isWebmaster } = useAuth()
  return (
    <Panel title="Work emails">
      <p className="mt-3 text-sm text-soft/65">
        Each of these positions belongs to one work email, the only address that can hold it and
        open its pages. A personal email is never given one. Changing an address here does not
        move anybody&rsquo;s access: remove the current holder below, then invite the new address.
      </p>
      <ul className="mt-3 divide-y divide-line/5">
        {positions.map((p) => (
          <WorkEmailRow
            key={`${p.id}-${workEmails[p.id] || ''}`}
            position={p}
            email={workEmails[p.id] || ''}
            locked={p.level === 'webmaster' && !isWebmaster}
          />
        ))}
      </ul>
    </Panel>
  )
}

function InviteRow({ invite }) {
  const withdraw = useWithdrawInvite()
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{invite.email}</span>
        <span className="block text-xs text-soft/50">
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
        <span className="block truncate text-sm font-semibold text-ink">
          {holder.full_name || 'No name yet'}
          {isSelf && <span className="font-normal text-soft/50"> (you)</span>}
        </span>
        <span className="block truncate text-xs text-soft/50">{holder.email}</span>
      </span>
      <span className={tagCls}>{holder.position.title}</span>
      {holder.from_roster ? (
        <span className="text-xs text-soft/45">{rosterHint}</span>
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
  const { isEB } = useAuth()
  const workEmails = useWorkEmails(isEB).data || NO_EMAILS
  // the positions here that have a work email: a committee's officers, or the
  // board's own and the webmaster's
  const privileged = (
    committee ? unitPositions(positions, { id: committee.homeId, ids: committee.ids }) : positions
  ).filter(isPrivileged)

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
        <p className="mt-3 text-sm text-soft/65">
          {committee
            ? `For someone who is not on ${committee.abbr}’s members list yet. Choose the position they should hold; they get it the first time they sign in with that address. An officer’s position opens the committee’s editors, so it goes to its work email and no other address.`
            : 'Gives a board position, and with it the board’s access to the portal, to its work email. No other address can be given one. It holds the position from its first sign-in, and the public pages follow.'}
        </p>
        <InviteForm committee={committee} positions={positions} workEmails={workEmails} />
      </Panel>

      {isEB && privileged.length > 0 && <WorkEmails positions={privileged} workEmails={workEmails} />}

      <Panel title={`Waiting for a first sign-in (${direct.length + fromRoster.length})`}>
        {direct.length === 0 && fromRoster.length === 0 ? (
          <p className="mt-4 text-sm text-soft/60">Nothing is waiting.</p>
        ) : (
          <>
            {direct.length > 0 && (
              <ul className="mt-2 divide-y divide-line/5">
                {direct.map((i) => (
                  <InviteRow key={i.id} invite={i} />
                ))}
              </ul>
            )}
            {fromRoster.length > 0 && (
              <div className={direct.length > 0 ? 'mt-3 border-t border-line/10 pt-4' : 'mt-4'}>
                <p className="text-sm text-soft/65">
                  {fromRoster.length} {fromRoster.length === 1 ? 'member' : 'members'} on the
                  members list {fromRoster.length === 1 ? 'has' : 'have'} not signed in yet. Their
                  position is set on the Members tab and reaches them when they do.{' '}
                  <button
                    type="button"
                    aria-expanded={showRoster}
                    onClick={() => setShowRoster((v) => !v)}
                    className={`${textBtnCls} text-accent hover:text-ink`}
                  >
                    {showRoster ? 'Hide' : 'Show them'}
                  </button>
                </p>
                {showRoster && (
                  <ul className="mt-2 divide-y divide-line/5">
                    {fromRoster.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-sm text-soft/85">{i.email}</span>
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
          <p className="mt-4 text-sm text-soft/60">Nobody with an account holds a position here yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/5">
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
