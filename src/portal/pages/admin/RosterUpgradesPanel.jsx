import { useEffect, useMemo, useState } from 'react'
import {
  useApproveUpgrades,
  useDismissUpgrades,
  useUpgradeCandidates,
} from '../../rosterQueries.js'
import { ErrorText, Panel, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// "Eligible for an upgrade" on /portal/admin/roster. The database works out who
// has reached the next membership tier from their GA counts (Bylaws 2.5.1,
// 2.6.1: Candidate -> Associate at 1 Local or 2 National GAs; Associate -> Full
// at 2 Local and 3 National). It never changes a status by itself: the Bylaws
// have the Executive Board grant one, after an evaluation that also weighs the
// activity score the roster does not hold. So the EB ticks who to approve here;
// "Not now" hides a member from this list until next September.
//
// Approvals go through the bulk update (logged, undoable from Register a GA).
// Renders nothing when nobody is eligible.

const STEP = {
  'Associate Member': 'Candidate → Associate',
  'Full Member': 'Associate → Full',
}

export default function RosterUpgradesPanel() {
  const candidates = useUpgradeCandidates()
  const approve = useApproveUpgrades()
  const dismiss = useDismissUpgrades()
  const [picked, setPicked] = useState(() => new Set())
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const rows = useMemo(() => candidates.data || [], [candidates.data])
  // Nobody is pre-ticked: approving is the EB's decision, not a default.
  useEffect(() => {
    setPicked((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))))
  }, [rows])

  if (!rows.length && !note) return null

  const busy = approve.isPending || dismiss.isPending
  const chosen = rows.filter((r) => picked.has(r.id))
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = async (mutation, verb) => {
    setError('')
    setNote('')
    try {
      await mutation.mutateAsync(chosen)
      setNote(`${chosen.length} ${chosen.length === 1 ? 'member' : 'members'} ${verb}.`)
      setPicked(new Set())
    } catch (e) {
      setError(e?.message || 'That did not work.')
    }
  }

  return (
    <Panel className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white">
          <span className="font-semibold">
            {rows.length} {rows.length === 1 ? 'member has' : 'members have'} the attendance for a higher status
          </span>
          <span className="text-silver/60"> · the Executive Board grants it</span>
        </p>
        {rows.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={outlineBtnCls}>
            {open ? 'Hide' : 'Review'}
          </button>
        )}
      </div>
      {note && (
        <p className="mt-2 text-sm text-emerald-300" role="status">
          {note}
        </p>
      )}

      {open && rows.length > 0 && (
        <>
          <p className="mt-3 text-xs text-silver/55">
            Based on GA counts only. Tick the members whose activity score also qualifies, then
            approve. “Not now” hides the ticked members from this list until next September.
          </p>
          <div className="mt-3 flex items-center gap-3 text-xs text-silver/60">
            <button type="button" onClick={() => setPicked(new Set(rows.map((r) => r.id)))} className="font-semibold text-medical-light hover:text-white">
              Tick all
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className="font-semibold text-medical-light hover:text-white">
              Clear
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-forest-900 px-4 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{r.full_name}</span>
                      <span className="block truncate text-xs text-silver/55">{r.email || 'No email on file'}</span>
                    </span>
                  </span>
                  <span className="text-xs text-silver/70">
                    <span className="font-semibold text-amber-200">{STEP[r.next] || r.next}</span> · {r.lgas} Local,{' '}
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
            <button type="button" disabled={busy || chosen.length === 0} onClick={() => run(approve, 'upgraded')} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
              {approve.isPending ? 'Approving…' : `Approve ${chosen.length || ''}`.trim()}
            </button>
            <button type="button" disabled={busy || chosen.length === 0} onClick={() => run(dismiss, 'set aside until next September')} className={outlineBtnCls}>
              Not now
            </button>
          </div>
        </>
      )}
    </Panel>
  )
}
