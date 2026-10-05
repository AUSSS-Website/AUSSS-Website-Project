import { useEffect, useState } from 'react'
import { useAddPosition, useDeletePosition, usePositions, useUpdatePosition } from '../../rosterQueries.js'
import { ErrorText, Field, Panel, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// The positions a committee can hand out, below its officer: Local Member, Core
// Team Member, the assistants and the coordinators. Seeded from the titles the
// membership sheet uses; the Executive Board adds, renames or removes them here
// so the list never needs a developer. Removing a position deletes it: whoever
// held it falls back to Local Member (the roster does that by itself when the
// position goes). A few positions were "retired" before removing existed; they
// show struck through and can be brought back or removed.

const POSITION_GROUPS = [
  ['member', 'Members'],
  ['assistant', 'Assistants and coordinators'],
  ['officer', 'Officers'],
]

// <optgroup>s for one committee's positions. Officers are offered only when
// `withOfficers` (the Executive Board); retired ones only if currently held.
// `committeeIds` widens it to a roster unit of several committees (SCOPE/SCORE,
// see rosterUnits.js); the caller then passes that unit's positions.
export function PositionOptions({ positions, committeeId, committeeIds, current, withOfficers = false }) {
  const ids = committeeIds || [committeeId]
  const mine = positions.filter(
    (p) => ids.includes(p.committee_id) && (p.active || p.id === current),
  )
  return POSITION_GROUPS.filter(([level]) => withOfficers || level !== 'officer').map(([level, label]) => {
    const group = mine.filter((p) => p.level === level)
    if (group.length === 0) return null
    return (
      <optgroup key={level} label={label}>
        {group.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
            {p.short_title && !p.title.includes(p.short_title) ? ` (${p.short_title})` : ''}
            {p.active ? '' : ' · retired'}
          </option>
        ))}
      </optgroup>
    )
  })
}

// The position a member holds the moment they join a committee.
export const localMemberOf = (positions, committeeId) =>
  positions.find((p) => p.committee_id === committeeId && p.key.endsWith('.member'))?.id || ''

// The plus beside a heading and the minus beside a position: one round shape,
// quiet by default, red once the minus is armed.
const roundShape =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-semibold leading-none text-white transition-colors disabled:opacity-40'
const roundBtnCls = `${roundShape} border-white/20 hover:bg-white/10`
const roundArmedCls = `${roundShape} border-red-500 bg-red-500 hover:bg-red-400`

function TypeRow({ position }) {
  const update = useUpdatePosition()
  const remove = useDeletePosition()
  const [title, setTitle] = useState(position.title)
  // The minus takes two clicks: the first arms it (it turns red), the second
  // removes. Moving away from it disarms it, and so does leaving it alone for a
  // few seconds, so a red button is never left waiting for a stray click.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  const [error, setError] = useState('')
  const isDefault = position.key.endsWith('.member')
  const busy = update.isPending || remove.isPending

  const run = async (fn) => {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e?.message || 'Could not save.')
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        aria-label={`Title of ${position.title}`}
        className={`${inputCls} max-w-sm ${position.active ? '' : 'line-through opacity-60'}`}
      />
      {title.trim() && title.trim() !== position.title && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => update.mutateAsync({ id: position.id, patch: { title } }))}
          className={outlineBtnCls}
        >
          Rename
        </button>
      )}
      {isDefault ? (
        <span className="text-xs text-silver/50">Given to every new member of the committee</span>
      ) : (
        <>
          {/* Positions retired before removing existed can still be brought back. */}
          {!position.active && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => update.mutateAsync({ id: position.id, patch: { active: true } }))}
              className={outlineBtnCls}
            >
              Bring back
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => (armed ? run(() => remove.mutateAsync(position.id)) : setArmed(true))}
            onBlur={() => setArmed(false)}
            onKeyDown={(e) => e.key === 'Escape' && setArmed(false)}
            aria-label={armed ? `Click again to remove ${position.title}` : `Remove ${position.title}`}
            title={
              armed
                ? 'Click again to remove it. Anyone who holds it becomes a Local Member.'
                : 'Remove this position'
            }
            className={armed ? roundArmedCls : roundBtnCls}
          >
            &minus;
          </button>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </li>
  )
}

// One level of a committee's positions ("Members", "Assistants and
// coordinators"): its rows, and a plus beside the heading that opens a field
// to add another at that level.
function TypeSection({ committee, level, label, positions }) {
  const add = useAddPosition()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const close = () => {
    setAdding(false)
    setTitle('')
    setError('')
  }

  const onAdd = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await add.mutateAsync({ committee_id: committee.id, title, level })
      close()
    } catch (err) {
      setError(
        err?.code === '23505'
          ? `${committee.abbr} already has a position with that title.`
          : err?.message || 'Could not add it.',
      )
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">{label}</p>
        <button
          type="button"
          aria-expanded={adding}
          aria-label={`Add a position under ${label} in ${committee.abbr}`}
          title="Add a position here"
          onClick={() => (adding ? close() : setAdding(true))}
          className={roundBtnCls}
        >
          +
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {positions.map((p) => (
          <TypeRow key={p.id} position={p} />
        ))}
        {adding && (
          <li>
            <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
              <input
                autoFocus
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={level === 'member' ? 'e.g. Core Team Member' : 'e.g. Peer Education Coordinator'}
                aria-label={`New position under ${label} in ${committee.abbr}`}
                className={`${inputCls} max-w-sm`}
              />
              <button type="submit" disabled={add.isPending || !title.trim()} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
                {add.isPending ? 'Adding…' : 'Add'}
              </button>
              <button type="button" disabled={add.isPending} onClick={close} className={outlineBtnCls}>
                Cancel
              </button>
              <ErrorText>{error}</ErrorText>
            </form>
          </li>
        )}
      </ul>
    </div>
  )
}

export default function PositionTypesPanel({ committees, onClose }) {
  const positions = usePositions()
  const [committeeId, setCommitteeId] = useState('')
  const committee = committees.find((c) => c.id === committeeId)
  const mine = (positions.data || []).filter((p) => p.committee_id === committeeId && p.level !== 'officer')

  return (
    <Panel title="Position types" className="mb-6">
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-silver/65">
          The positions each committee can give its members. Assistants and coordinators receive
          tasks like any member; only the committee&rsquo;s officer and the Executive Board assign
          them. Use the plus beside a heading to add one there. The minus beside a position removes
          it: the first click turns it red, the second removes it, and anyone who held it becomes
          a Local Member.
        </p>
        <button type="button" onClick={onClose} className={outlineBtnCls}>
          Close
        </button>
      </div>

      <div className="mt-5 max-w-xs">
        <Field label="Committee" htmlFor="pt-committee">
          <select id="pt-committee" value={committeeId} onChange={(e) => setCommitteeId(e.target.value)} className={inputCls}>
            <option value="">Choose a committee</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>
                {c.abbr}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {committee &&
        POSITION_GROUPS.filter(([lvl]) => lvl !== 'officer').map(([lvl, label]) => (
          <TypeSection
            key={`${committee.id}-${lvl}`}
            committee={committee}
            level={lvl}
            label={label}
            positions={mine.filter((p) => p.level === lvl)}
          />
        ))}
    </Panel>
  )
}
