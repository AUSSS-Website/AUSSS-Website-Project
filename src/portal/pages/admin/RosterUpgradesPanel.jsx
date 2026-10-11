import { useEffect, useMemo, useState } from 'react'
import {
  useApproveUpgrades,
  useDismissUpgrades,
  useUndoApproveUpgrades,
  useUndoDismissUpgrades,
  useUpgradeCandidates,
} from '../../rosterQueries.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'
import { ErrorText, Panel, UndoLine, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// "Eligible for an upgrade" on /portal/admin/roster. The database works out who
// has reached the next membership tier from their GA counts (Bylaws 2.5.1,
// 2.6.1: Candidate -> Associate at 1 Local or 2 National GAs; Associate -> Full
// at 2 Local and 3 National). It never changes a status by itself: the Bylaws
// have the Executive Board grant one, after an evaluation that also weighs the
// activity score the roster does not hold. So the EB ticks who to approve here;
// "Not now" hides a member from this list until next September.
//
// Approvals go through the bulk update (logged, undoable from Register a GA).
// Either button can also be taken back at once, from the line that says what
// it did: an approval by undoing its bulk updates, "Not now" by giving each
// member back the answer they had before, which no other screen can do.
// Renders nothing when nobody is eligible.

const STEP = {
  'Associate Member': 'Candidate → Associate',
  'Full Member': 'Associate → Full',
}

const many = (n) => `${n} ${n === 1 ? 'member' : 'members'}`

// "Tick all" and "Clear" are one short word each: the row they stand in gives
// a finger its 44px of height, and "Clear" is given the same in width (both in
// px, since the root size shrinks on a small phone). The negative margin keeps
// the words where they stood.
const tickBtnCls = `-mx-2 inline-flex min-h-[44px] min-w-[44px] items-center rounded px-2 font-semibold text-accent ${pressCls} hover:text-ink`

export default function RosterUpgradesPanel() {
  const candidates = useUpgradeCandidates()
  const approve = useApproveUpgrades()
  const dismiss = useDismissUpgrades()
  const undoApprove = useUndoApproveUpgrades()
  const undoDismiss = useUndoDismissUpgrades()
  const [picked, setPicked] = useState(() => new Set())
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  // What the last button did and what takes it back: { text, count, logs }
  // after an approval, { text, count, before } after "Not now".
  const [last, setLast] = useState(null)
  // What an undo did, which has no undo of its own, or why it could not.
  const [undone, setUndone] = useState('')
  const [undoError, setUndoError] = useState('')

  const rows = useMemo(() => candidates.data || [], [candidates.data])
  // Nobody is pre-ticked: approving is the EB's decision, not a default.
  useEffect(() => {
    setPicked((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))))
  }, [rows])

  if (!rows.length && !last && !undone) return null

  const undoing = undoApprove.isPending || undoDismiss.isPending
  const busy = approve.isPending || dismiss.isPending || undoing
  const chosen = rows.filter((r) => picked.has(r.id))
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = async (fn, fallback) => {
    setError('')
    setUndoError('')
    setLast(null)
    setUndone('')
    try {
      await fn()
      setPicked(new Set())
    } catch (e) {
      setError(errorText(e, fallback))
    }
  }

  const onApprove = () =>
    run(async () => {
      const done = await approve.mutateAsync(chosen)
      setLast({ text: `${many(done.updated)} upgraded.`, count: done.updated, logs: done.logs })
    }, 'Could not approve them.')

  const onDismiss = () =>
    run(async () => {
      const before = await dismiss.mutateAsync(chosen)
      setLast({ text: `${many(chosen.length)} set aside until next September.`, count: chosen.length, before })
    }, 'Could not set them aside.')

  // Nothing to take back when no status changed, or when the earlier answers
  // could not be read.
  const canUndo = Boolean(last?.logs?.length || last?.before?.length)
  const onUndo = async () => {
    setUndoError('')
    try {
      let count = last.count
      if (last.logs) count = await undoApprove.mutateAsync(last.logs)
      else await undoDismiss.mutateAsync(last.before)
      setLast(null)
      setUndone(`${many(count)} back on the list.`)
    } catch (e) {
      setUndoError(errorText(e, 'Could not undo that.'))
    }
  }

  return (
    <Panel className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink">
          <span className="font-semibold">
            {rows.length} {rows.length === 1 ? 'member has' : 'members have'} the attendance for a higher status
          </span>
          <span className="text-soft/60"> · only the Executive Board can grant it</span>
        </p>
        {rows.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={outlineBtnCls}>
            {open ? 'Hide' : 'Review'}
          </button>
        )}
      </div>
      {/* Always in the page, so that a screen reader says the line when it
          comes. Its padding keeps Undo's 44px clear of the button above. */}
      <UndoLine onUndo={canUndo ? onUndo : undefined} busy={undoing} className="mt-1 py-2 text-sm">
        {last?.text || undone || null}
      </UndoLine>
      <ErrorText>{undoError}</ErrorText>

      {open && rows.length > 0 && (
        <>
          <p className="mt-3 text-xs text-soft/55">
            Based on GA counts only. Tick the members whose activity score also qualifies, then
            approve. “Not now” hides the ticked members from this list until next September.
          </p>
          <div className="flex items-center gap-4 text-xs">
            <button type="button" onClick={() => setPicked(new Set(rows.map((r) => r.id)))} className={tickBtnCls}>
              Tick all
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className={tickBtnCls}>
              Clear
            </button>
          </div>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-line/10 bg-sunk px-4 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={picked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 shrink-0 accent-medical"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{r.full_name}</span>
                      <span className="block truncate text-xs text-soft/55">{r.email || 'No email on file'}</span>
                    </span>
                  </span>
                  <span className="text-xs text-soft/70">
                    <span className="font-semibold text-warn">{STEP[r.next] || r.next}</span> · {r.lgas} Local,{' '}
                    {r.ngas} National
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <ErrorText>{error}</ErrorText>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || chosen.length === 0} onClick={onApprove} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
              {approve.isPending ? 'Approving…' : `Approve ${chosen.length || ''}`.trim()}
            </button>
            <button type="button" disabled={busy || chosen.length === 0} onClick={onDismiss} className={outlineBtnCls}>
              {dismiss.isPending ? 'Setting aside…' : 'Not now'}
            </button>
          </div>
        </>
      )}
    </Panel>
  )
}
