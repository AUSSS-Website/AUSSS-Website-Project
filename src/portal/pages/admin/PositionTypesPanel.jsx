import { useRef, useState } from 'react'
import { useAddPosition, useDeletePosition, usePositions, useUpdatePosition } from '../../rosterQueries.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'
import {
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// The positions a committee can hand out, below its officer: Local Member, Core
// Team Member, the assistants and the coordinators. Seeded from the titles the
// membership sheet uses; the Executive Board adds, renames or removes them here
// so the list never needs a developer. Removing a position deletes it: whoever
// held it falls back to the committee's default position, the one keyed
// `<slug>.member` (the roster does that by itself when the position goes). A few positions were "retired" before removing existed; they
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
// quiet by default. It answers a press at once, by its fill.
const roundBtnCls = `flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line/20 text-sm font-semibold leading-none text-ink ${pressCls} hover:bg-veil/10 active:bg-veil/20 disabled:opacity-40`

// The circle is drawn 24px across and a finger needs 44. An ::after, centred
// on the button, carries the rest of the target. In px and not rem, because
// the root size shrinks on a 320px phone.
const hitAreaCls =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"

// The same for the minus, which is a ConfirmButton: once red it wears classes
// of its own, so the target is given from the element around it, to whichever
// button is inside. The element also keeps 44px of the row for it, so the
// target never lies over the field or the button beside it.
const hitAreaAroundCls =
  "inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center [&>button]:relative [&>button]:after:absolute [&>button]:after:left-1/2 [&>button]:after:top-1/2 [&>button]:after:h-[44px] [&>button]:after:w-full [&>button]:after:min-w-[44px] [&>button]:after:-translate-x-1/2 [&>button]:after:-translate-y-1/2 [&>button]:after:content-['']"

// `fallback` is the title of the committee's default position, the one every
// new member gets and holders of a removed position fall back to; `abbr` is
// the committee's short name, for the sentence about a title it already has.
// `onRemoved(title)` tells the section that this position has been removed,
// since the row that could say so is about to leave the list.
function TypeRow({ position, fallback, abbr, onRemoved }) {
  const update = useUpdatePosition()
  const remove = useDeletePosition()
  const [title, setTitle] = useState(position.title)
  const [error, setError] = useState('')
  const isDefault = position.key.endsWith('.member')
  const busy = update.isPending || remove.isPending

  const run = async (fn, otherwise = 'Could not save.') => {
    setError('')
    try {
      await fn()
    } catch (e) {
      // 23505: the committee has that title already (positions_committee_id_title_key)
      setError(e?.code === '23505' ? `${abbr} already has a position with that title.` : errorText(e, otherwise))
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        aria-label={`Title of ${position.title}`}
        className={`${inputCls} max-w-sm ${position.active ? '' : 'line-through !text-soft/70'}`}
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
        <span className="text-xs text-soft/50">Given to every new member of the committee</span>
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
          {/* The portal's own two-click button: the first click turns the
              minus into a red "Click again to remove", the second removes.
              What removing does is said on the page, above the lists. */}
          <span className={hitAreaAroundCls}>
            <ConfirmButton
              variant="text"
              className={roundBtnCls}
              label="Remove"
              ariaLabel={`Remove ${position.title}`}
              title={`Remove this position. Anyone who holds it becomes a ${fallback}.`}
              disabled={busy}
              onConfirm={() =>
                run(async () => {
                  await remove.mutateAsync(position.id)
                  onRemoved(position.title)
                }, 'Could not remove it.')
              }
            >
              &minus;
            </ConfirmButton>
          </span>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </li>
  )
}

// One level of a committee's positions ("Members", "Assistants and
// coordinators"): its rows, and a plus beside the heading that opens a field
// to add another at that level.
function TypeSection({ committee, level, label, positions, fallback }) {
  const add = useAddPosition()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  // The title of the position last removed from this level, for the line
  // under the list. It goes when the plus is next pressed.
  const [removed, setRemoved] = useState('')
  const plusRef = useRef(null)

  const close = () => {
    setAdding(false)
    setTitle('')
    setError('')
  }

  // A removed position's row leaves the list and takes the button that was
  // pressed with it, so the keyboard is handed to the plus, the one control of
  // this level that always stays. It is not scrolled to: a finger that tapped
  // the minus further down a long list should not see the page move.
  const onRemoved = (was) => {
    setRemoved(was)
    plusRef.current?.focus({ preventScroll: true })
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
          : errorText(err, 'Could not add it.'),
      )
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <p className={panelTitleCls}>{label}</p>
        <button
          ref={plusRef}
          type="button"
          aria-expanded={adding}
          aria-label={`Add a position under ${label} in ${committee.abbr}`}
          title="Add a position here"
          onClick={() => {
            setRemoved('')
            if (adding) close()
            else setAdding(true)
          }}
          className={`${roundBtnCls} ${hitAreaCls}`}
        >
          +
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {positions.map((p) => (
          <TypeRow key={p.id} position={p} fallback={fallback} abbr={committee.abbr} onRemoved={onRemoved} />
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
      {/* What was removed, under the list its row has left. Kept in the page
          while it has nothing to say, so that a screen reader says it when it
          comes. */}
      <p role="status" className={removed ? 'mt-3 text-xs text-soft/70' : 'sr-only'}>
        {removed ? `Removed ${removed}.` : ''}
      </p>
    </div>
  )
}

export default function PositionTypesPanel({ committees, onClose }) {
  const positions = usePositions()
  const [committeeId, setCommitteeId] = useState('')
  const committee = committees.find((c) => c.id === committeeId)
  const mine = (positions.data || []).filter((p) => p.committee_id === committeeId && p.level !== 'officer')
  // the default position can be renamed (SCOPE/SCORE calls it Contact Person)
  const fallback = mine.find((p) => p.key.endsWith('.member'))?.title || 'Local Member'

  return (
    <Panel title="Position types" className="mb-6">
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-soft/65">
          The positions each committee can give its members. Assistants and coordinators receive
          tasks like any member; only the committee&rsquo;s officer and the Executive Board assign
          them. Use the plus beside a heading to add one there. The minus beside a position removes
          it: the first click turns it red, the second removes it, and anyone who held it gets the
          committee&rsquo;s default position (the one without a minus).
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

      {/* What removing does, with this committee's own default position named.
          It used to be said only in the minus's tooltip, which a phone never shows. */}
      {committee && (
        <p className="mt-4 max-w-2xl text-xs text-soft/55">
          Anyone who holds a position you remove from {committee.abbr} becomes a {fallback}.
        </p>
      )}

      {committee &&
        POSITION_GROUPS.filter(([lvl]) => lvl !== 'officer').map(([lvl, label]) => (
          <TypeSection
            key={`${committee.id}-${lvl}`}
            committee={committee}
            level={lvl}
            label={label}
            positions={mine.filter((p) => p.level === lvl)}
            fallback={fallback}
          />
        ))}
    </Panel>
  )
}
