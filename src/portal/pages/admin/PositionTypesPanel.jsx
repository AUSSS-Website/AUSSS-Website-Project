import { useState } from 'react'
import { useAddPosition, usePositions, useUpdatePosition } from '../../rosterQueries.js'
import { ErrorText, Field, Panel, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// The positions a committee can hand out, below its officer: Local Member, Core
// Team Member, the assistants and the coordinators. Seeded from the titles the
// membership sheet uses; the Executive Board adds, renames or retires them here
// so the list never needs a developer. A retired position stays on whoever
// holds it and simply stops being offered.

export const POSITION_GROUPS = [
  ['member', 'Members'],
  ['assistant', 'Assistants and coordinators'],
  ['officer', 'Officers'],
]

// <optgroup>s for one committee's positions. Officers are offered only when
// `withOfficers` (the Executive Board); retired ones only if currently held.
export function PositionOptions({ positions, committeeId, current, withOfficers = false }) {
  const mine = positions.filter(
    (p) => p.committee_id === committeeId && (p.active || p.id === current),
  )
  return POSITION_GROUPS.filter(([level]) => withOfficers || level !== 'officer').map(([level, label]) => {
    const group = mine.filter((p) => p.level === level)
    if (group.length === 0) return null
    return (
      <optgroup key={level} label={label}>
        {group.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
            {p.short_title && p.short_title !== p.title ? ` (${p.short_title})` : ''}
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

function TypeRow({ position }) {
  const update = useUpdatePosition()
  const [title, setTitle] = useState(position.title)
  const [error, setError] = useState('')
  const isDefault = position.key.endsWith('.member')

  const run = async (patch) => {
    setError('')
    try {
      await update.mutateAsync({ id: position.id, patch })
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
        <button type="button" disabled={update.isPending} onClick={() => run({ title })} className={outlineBtnCls}>
          Rename
        </button>
      )}
      {isDefault ? (
        <span className="text-xs text-silver/50">given to every new member of the committee</span>
      ) : (
        <button
          type="button"
          disabled={update.isPending}
          onClick={() => run({ active: !position.active })}
          className={outlineBtnCls}
        >
          {position.active ? 'Retire' : 'Bring back'}
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </li>
  )
}

export default function PositionTypesPanel({ committees, onClose }) {
  const positions = usePositions()
  const add = useAddPosition()
  const [committeeId, setCommitteeId] = useState('')
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('assistant')
  const [error, setError] = useState('')
  const committee = committees.find((c) => c.id === committeeId)
  const mine = (positions.data || []).filter((p) => p.committee_id === committeeId && p.level !== 'officer')

  const onAdd = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await add.mutateAsync({ committee_id: committeeId, title, level })
      setTitle('')
    } catch (err) {
      setError(
        err?.code === '23505' ? `${committee?.abbr} already has a position with that title.` : err?.message || 'Could not add it.',
      )
    }
  }

  return (
    <Panel title="Position types" className="mb-6">
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-silver/65">
          The positions each committee can give its members. Assistants and coordinators receive
          tasks like any member; only the committee&rsquo;s officer and the Executive Board assign
          them.
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

      {committee && (
        <>
          {POSITION_GROUPS.filter(([lvl]) => lvl !== 'officer').map(([lvl, label]) => (
            <div key={lvl} className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">{label}</p>
              <ul className="mt-3 space-y-2">
                {mine
                  .filter((p) => p.level === lvl)
                  .map((p) => (
                    <TypeRow key={p.id} position={p} />
                  ))}
              </ul>
            </div>
          ))}

          <form onSubmit={onAdd} className="mt-6 flex flex-wrap items-end gap-3 border-t border-white/10 pt-5">
            <div className="w-full max-w-sm">
              <Field label={`New position in ${committee.abbr}`} htmlFor="pt-title">
                <input
                  id="pt-title"
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Peer Education Coordinator"
                  className={inputCls}
                />
              </Field>
            </div>
            <div>
              <Field label="Kind" htmlFor="pt-level">
                <select id="pt-level" value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls}>
                  <option value="assistant">Assistant or coordinator</option>
                  <option value="member">Member</option>
                </select>
              </Field>
            </div>
            <button type="submit" disabled={add.isPending || !title.trim()} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
              {add.isPending ? 'Adding…' : 'Add'}
            </button>
          </form>
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
        </>
      )}
    </Panel>
  )
}
