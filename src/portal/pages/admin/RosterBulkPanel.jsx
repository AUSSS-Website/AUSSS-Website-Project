import { useMemo, useRef, useState } from 'react'
import {
  matchRosterLines,
  useBulkUpdateRoster,
  useBulkUpdates,
  useUndoBulkUpdate,
} from '../../rosterQueries.js'
import { parseCsv } from '../../rosterFile.js'
import { ROSTER_STATUSES } from '../../constants.js'
import { ErrorText, Field, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// Bulk updates on /portal/admin/roster: paste an attendance list (names and/or
// emails, one person per line), review how each line was matched to the
// roster, then apply ONE change to everyone confirmed: +1 Local GA, +1
// National GA, or a new status.
//
// Nothing is written until the last button. The database does the matching
// (rpc/match_roster_lines, the same matcher as the search box) and sorts every
// line into: matched (email or exact name), likely (one clear winner; selected
// but shown for a glance), ambiguous (pick one or skip) and not found. Each
// applied update is logged with before/after values, so it can be undone, and
// the same event name cannot be applied twice.

const ACTIONS = {
  lga: { label: 'Attended a Local GA (+1)', field: 'Local GAs', hint: 'e.g. LGA October 2026' },
  nga: { label: 'Attended a National GA (+1)', field: 'National GAs', hint: 'e.g. NGA Alexandria, Feb 2027' },
  status: { label: 'Set membership status to…', field: 'Status', hint: 'e.g. Upgrades approved before LGA Oct 2026' },
}

const STATE_LABEL = {
  likely: 'Likely',
  ambiguous: 'Pick one',
  none: 'Not found',
}

function when(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

const describe = (r) => [r.full_name, r.email, r.status].filter(Boolean).join(' · ')

// A spreadsheet or CSV becomes one line per row (all cells joined), so a sheet
// with a name column and an email column matches on both.
async function fileToLines(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
    return grid.map((r) => r.map((c) => String(c).trim()).filter(Boolean).join(' '))
  }
  const text = await file.text()
  if (name.endsWith('.csv')) {
    return parseCsv(text).map((r) => r.map((c) => c.trim()).filter(Boolean).join(' '))
  }
  return text.split(/\r?\n/)
}

function ReviewRow({ item, choice, onChoose }) {
  const options = item.match ? [item.match, ...item.candidates.filter((c) => c.id !== item.match.id)] : item.candidates
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-forest-900 px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate text-sm text-white">{item.line}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${item.state === 'none' ? 'text-red-300' : 'text-amber-200'}`}>
          {STATE_LABEL[item.state]}
        </span>
      </span>
      {options.length > 0 ? (
        <select
          value={choice}
          onChange={(e) => onChoose(e.target.value)}
          aria-label={`Roster match for ${item.line}`}
          className={`${inputCls} w-auto max-w-full sm:max-w-md`}
        >
          <option value="">Skip this line</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {describe(c)}
              {c.close ? ' (similar spelling)' : ''}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-silver/50">Nobody close on the roster. Add them first, or fix the spelling.</span>
      )}
    </li>
  )
}

function History() {
  const log = useBulkUpdates()
  const undo = useUndoBulkUpdate()
  const [confirmId, setConfirmId] = useState(null)
  const [note, setNote] = useState(null) // { id, text }
  if (!log.data?.length) return null

  const onUndo = async (id) => {
    setNote(null)
    try {
      const r = await undo.mutateAsync(id)
      const kept = r.skipped?.length || 0
      setNote({
        id,
        text: `${r.restored} put back${kept ? `, ${kept} left alone (${r.skipped.map((s) => `${s.full_name}: ${s.reason}`).join('; ')})` : ''}.`,
      })
    } catch (e) {
      setNote({ id, text: e?.message || 'Could not undo.' })
    } finally {
      setConfirmId(null)
    }
  }

  return (
    <div className="mt-6 border-t border-white/10 pt-5">
      <p className="text-sm font-semibold text-white">Recent bulk updates</p>
      <ul className="mt-3 space-y-3">
        {log.data.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm text-silver/75">
              <p className={b.undone_at ? 'line-through opacity-60' : ''}>
                <span className="font-semibold text-white">{b.label}</span> · {b.changes.length}{' '}
                {b.changes.length === 1 ? 'member' : 'members'} ·{' '}
                {b.action === 'status' ? `status → ${b.value}` : `${ACTIONS[b.action].field} +1`}
              </p>
              <p className="text-xs text-silver/50">
                {when(b.at)}
                {b.undone_at ? ` · undone ${when(b.undone_at)}` : ''}
              </p>
              {note?.id === b.id && <p className="mt-1 text-xs text-amber-200">{note.text}</p>}
            </div>
            {!b.undone_at &&
              (confirmId === b.id ? (
                <span className="flex items-center gap-2">
                  <button type="button" disabled={undo.isPending} onClick={() => onUndo(b.id)} className={`${outlineBtnCls} border-red-400/50 text-red-300`}>
                    {undo.isPending ? 'Undoing…' : `Yes, undo for ${b.changes.length}`}
                  </button>
                  <button type="button" disabled={undo.isPending} onClick={() => setConfirmId(null)} className={outlineBtnCls}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmId(b.id)} className={outlineBtnCls}>
                  Undo
                </button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function RosterBulkPanel() {
  const fileRef = useRef(null)
  const apply = useBulkUpdateRoster()
  const [action, setAction] = useState('lga')
  const [label, setLabel] = useState('')
  const [status, setStatus] = useState('Associate Member')
  const [text, setText] = useState('')
  const [matching, setMatching] = useState(false)
  const [items, setItems] = useState(null) // match results, or null while composing
  const [choices, setChoices] = useState({}) // item index -> roster id ('' = skip)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  const lines = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [text])
  const selectedIds = useMemo(() => [...new Set(Object.values(choices).filter(Boolean))], [choices])
  const counts = useMemo(() => {
    const c = { matched: 0, likely: 0, ambiguous: 0, none: 0 }
    for (const it of items || []) c[it.state]++
    return c
  }, [items])
  const repeats = Object.values(choices).filter(Boolean).length - selectedIds.length

  const reset = () => {
    setItems(null)
    setChoices({})
    setError('')
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const fromFile = (await fileToLines(file)).map((l) => l.trim()).filter(Boolean)
      setText((t) => [t.trim(), ...fromFile].filter(Boolean).join('\n'))
    } catch (err) {
      setError(err?.message || 'Could not read that file.')
    }
  }

  const onMatch = async (e) => {
    e.preventDefault()
    setError('')
    setDone(null)
    setMatching(true)
    try {
      const res = await matchRosterLines(lines)
      setItems(res)
      // Certain and likely matches start selected; the rest start as "skip".
      setChoices(Object.fromEntries(res.map((it, i) => [i, it.match?.id || ''])))
    } catch (err) {
      setError(err?.message || 'Could not match the list.')
    } finally {
      setMatching(false)
    }
  }

  const onApply = async () => {
    setError('')
    try {
      const r = await apply.mutateAsync({
        ids: selectedIds,
        action,
        label,
        value: action === 'status' ? status : null,
      })
      setDone(r)
      setItems(null)
      setChoices({})
      setText('')
      setLabel('')
    } catch (err) {
      setError(err?.message || 'Could not apply the update.')
    }
  }

  const review = (items || []).map((it, i) => ({ it, i })).filter(({ it }) => it.state !== 'matched')
  const certain = (items || []).map((it, i) => ({ it, i })).filter(({ it }) => it.state === 'matched')

  return (
    <Panel title="Bulk update" className="mt-10">
      <p className="mt-3 text-sm text-silver/65">
        Paste an attendance list and update everyone on it at once. You review every match before
        anything changes, and each update can be undone.
      </p>

      {!items ? (
        <form onSubmit={onMatch} className="mt-5 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="What happened" htmlFor="b-action">
              <select id="b-action" value={action} onChange={(e) => setAction(e.target.value)} className={inputCls}>
                {Object.entries(ACTIONS).map(([k, a]) => (
                  <option key={k} value={k}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            {action === 'status' ? (
              <Field label="New status" htmlFor="b-status">
                <select id="b-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                  {ROSTER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>
          <Field
            label={action === 'status' ? 'Reason' : 'Event'}
            hint="Names this update in the history. The same name can’t be applied twice, which is what stops a list being counted again."
            htmlFor="b-label"
          >
            <input id="b-label" required maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={ACTIONS[action].hint} className={inputCls} />
          </Field>
          <Field label="Who" hint="One person per line: a name, an email, or both. Spelling variants are fine." htmlFor="b-lines">
            <textarea
              id="b-lines"
              required
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Sara Mohamed Ali\nomar.nabil@gmail.com\nMona Adel <mona.adel@gmail.com>'}
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          {done && (
            <p className="text-sm text-emerald-300" role="status">
              Updated {done.updated} {done.updated === 1 ? 'member' : 'members'}.
              {done.skipped?.length > 0 &&
                ` Left alone: ${done.skipped.map((s) => `${s.full_name} (${s.reason})`).join('; ')}.`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={matching || lines.length === 0} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
              {matching ? 'Matching…' : `Match ${lines.length || ''} ${lines.length === 1 ? 'line' : 'lines'} to the roster`}
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" onChange={onFile} className="hidden" />
            <button type="button" onClick={() => fileRef.current?.click()} className={outlineBtnCls}>
              Load from a file
            </button>
            {matching && <Spinner className="h-4 w-4" />}
          </div>
        </form>
      ) : (
        <div className="mt-5">
          <p className="text-sm text-white">
            <span className="font-semibold">{label}</span> ·{' '}
            {action === 'status' ? `status → ${status}` : `${ACTIONS[action].field} +1`}
          </p>
          <p className="mt-1 text-xs text-silver/60" aria-live="polite">
            {counts.matched} matched · {counts.likely} likely · {counts.ambiguous} to pick · {counts.none} not found
            {repeats > 0 ? ` · ${repeats} repeated ${repeats === 1 ? 'person' : 'people'} counted once` : ''}
          </p>

          {review.length > 0 && (
            <>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">Needs a look</p>
              <ul className="mt-3 space-y-2">
                {review.map(({ it, i }) => (
                  <ReviewRow key={i} item={it} choice={choices[i] || ''} onChoose={(id) => setChoices((c) => ({ ...c, [i]: id }))} />
                ))}
              </ul>
            </>
          )}

          {certain.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-silver/75">
                {certain.length} matched exactly (by email or full name)
              </summary>
              <ul className="mt-3 space-y-1 text-xs text-silver/60">
                {certain.map(({ it, i }) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {it.line} → <span className="text-silver/85">{describe(it.match)}</span>
                    </span>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(choices[i])}
                        onChange={(e) => setChoices((c) => ({ ...c, [i]: e.target.checked ? it.match.id : '' }))}
                      />
                      include
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-5">
            <ErrorText>{error}</ErrorText>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" disabled={apply.isPending || selectedIds.length === 0} onClick={onApply} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
              {apply.isPending ? 'Updating…' : `Update ${selectedIds.length} ${selectedIds.length === 1 ? 'member' : 'members'}`}
            </button>
            <button type="button" disabled={apply.isPending} onClick={reset} className={outlineBtnCls}>
              Back to the list
            </button>
          </div>
        </div>
      )}

      <History />
    </Panel>
  )
}
