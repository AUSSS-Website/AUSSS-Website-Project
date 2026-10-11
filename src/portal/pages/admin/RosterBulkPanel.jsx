import { useMemo, useRef, useState } from 'react'
import {
  matchRosterLines,
  useBulkUpdateRoster,
  useBulkUpdates,
  useUndoBulkUpdate,
} from '../../rosterQueries.js'
import { parseCsv } from '../../rosterFile.js'
import { ROSTER_STATUSES } from '../../constants.js'
import { errorText } from '../../../lib/errorText.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import {
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  Spinner,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { when } from '../../workUi.jsx'
import { unitLabelForSlug } from '../../rosterUnits.js'

// "Register a GA" on /portal/admin/roster, opened from the page header: paste an
// attendance list (names and/or emails, one person per line), review how each
// line was matched to the roster, then apply ONE change to everyone confirmed:
// +1 Local GA, +1 National GA, a new status, or a committee.
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
  committee: { label: 'Put in a committee…', field: 'Committee', hint: 'e.g. SCORA members 2026-27' },
}

// What a bulk update did, for the review header and the history.
function effect(action, value) {
  if (action === 'status') return `status → ${value}`
  if (action === 'committee') return value ? `committee → ${unitLabelForSlug(value)}` : 'taken out of their committee'
  return `${ACTIONS[action].field} +1`
}

const STATE_LABEL = {
  likely: 'Likely',
  ambiguous: 'Pick one',
  none: 'Not found',
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
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line/10 bg-sunk px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink">{item.line}</span>
        <span className={`text-2xs font-semibold uppercase tracking-wider ${item.state === 'none' ? 'text-danger' : 'text-warn'}`}>
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
        <span className="text-xs text-soft/50">Nobody close to this on the roster. Add them first, or fix the spelling.</span>
      )}
    </li>
  )
}

function History() {
  const log = useBulkUpdates()
  const undo = useUndoBulkUpdate()
  // What the last undo did, under the update it was for: { id, text, tone }.
  // The tone is 'ok' when everything went back, 'warn' when some rows were
  // left alone (a later change must not be destroyed) and 'error' when the
  // undo did not happen. A clean undo is a success, and reads as one.
  const [note, setNote] = useState(null)
  if (!log.data?.length) return null

  const onUndo = async (id) => {
    setNote(null)
    try {
      const r = await undo.mutateAsync(id)
      const kept = r.skipped?.length || 0
      setNote({
        id,
        tone: kept ? 'warn' : 'ok',
        text: `${r.restored} put back${kept ? `, ${kept} left alone (${r.skipped.map((s) => `${s.full_name}: ${s.reason}`).join('; ')})` : ''}.`,
      })
    } catch (e) {
      setNote({ id, tone: 'error', text: errorText(e, 'Could not undo that update.') })
    }
  }

  return (
    <div className="mt-6 border-t border-line/10 pt-5">
      <p className="text-sm font-semibold text-ink">Recent bulk updates</p>
      <ul className="mt-3 space-y-3">
        {log.data.map((b) => {
          const mine = note?.id === b.id ? note : null
          const said = mine && mine.tone !== 'error' ? mine.text : ''
          return (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-sm text-soft/75">
                <p className={b.undone_at ? 'line-through [&>span]:font-normal [&>span]:text-soft/75' : ''}>
                  <span className="font-semibold text-ink">{b.label}</span> · {b.changes.length}{' '}
                  {b.changes.length === 1 ? 'member' : 'members'} ·{' '}
                  {effect(b.action, b.value)}
                </p>
                <p className="text-xs text-soft/50">
                  {when(b.at)}
                  {b.undone_at ? ` · undone ${when(b.undone_at)}` : ''}
                </p>
                {/* Kept in the page while it has nothing to say, so that a
                    screen reader says the sentence when it comes. */}
                <p role="status" className={said ? `mt-1 text-xs ${mine.tone === 'warn' ? 'text-warn' : 'text-ok'}` : 'sr-only'}>
                  {said}
                </p>
                {mine?.tone === 'error' && (
                  <div className="mt-1">
                    <ErrorText>{mine.text}</ErrorText>
                  </div>
                )}
              </div>
              {!b.undone_at && (
                <ConfirmButton
                  label="Undo"
                  busyLabel="Undoing…"
                  busy={undo.isPending && undo.variables === b.id}
                  disabled={undo.isPending}
                  onConfirm={() => onUndo(b.id)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function RosterBulkPanel({ onClose, initialAction = 'lga', committees = [] }) {
  const fileRef = useRef(null)
  const apply = useBulkUpdateRoster()
  const [action, setAction] = useState(initialAction)
  const [committee, setCommittee] = useState('') // slug; '' = no committee
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

  // A review in progress is work: every "pick one" answered by hand. The
  // browser asks before a reload or a closed tab throws it away, and Close
  // below asks twice.
  const reviewing = Boolean(items)
  useLeaveWarning(reviewing || apply.isPending)

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
      setError(errorText(err, 'Could not read that file.'))
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
      setError(errorText(err, 'Could not match the list.'))
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
        value: action === 'status' ? status : action === 'committee' ? committee : null,
      })
      setDone(r)
      setItems(null)
      setChoices({})
      setText('')
      setLabel('')
    } catch (err) {
      setError(errorText(err, 'Could not apply the update.'))
    }
  }

  const review = (items || []).map((it, i) => ({ it, i })).filter(({ it }) => it.state !== 'matched')
  const certain = (items || []).map((it, i) => ({ it, i })).filter(({ it }) => it.state === 'matched')

  return (
    <Panel title={action === 'committee' ? 'Set committees' : 'Register a GA'} className="mb-6">
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-soft/65">
          Paste a list of people and everyone on it gets one change: a GA added to their count, a
          membership status, or their committee. You review every match before anything changes,
          and each update can be undone.
        </p>
        {reviewing ? (
          // It grows to the left when it turns red, so nothing beside it moves.
          <ConfirmButton
            label="Close"
            confirmLabel="Click again to discard the review"
            keepWidth={false}
            disabled={apply.isPending}
            onConfirm={onClose}
          />
        ) : (
          <button type="button" onClick={onClose} className={outlineBtnCls}>
            Close
          </button>
        )}
      </div>

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
            ) : action === 'committee' ? (
              <Field label="Committee" htmlFor="b-committee">
                <select id="b-committee" value={committee} onChange={(e) => setCommittee(e.target.value)} className={inputCls}>
                  <option value="">No committee (take them out)</option>
                  {committees.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.abbr}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>
          <Field
            label={action === 'lga' || action === 'nga' ? 'Event' : 'Reason'}
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
          <p className="text-sm text-ink">
            <span className="font-semibold">{label}</span> ·{' '}
            {effect(action, action === 'status' ? status : committee)}
          </p>
          <p className="mt-1 text-xs text-soft/60" aria-live="polite">
            {counts.matched} matched · {counts.likely} likely · {counts.ambiguous} to pick · {counts.none} not found
            {repeats > 0 ? ` · ${repeats} repeated ${repeats === 1 ? 'person' : 'people'} counted once` : ''}
          </p>

          {review.length > 0 && (
            <>
              <p className={`mt-5 ${panelTitleCls}`}>Needs a look</p>
              <ul className="mt-3 space-y-2">
                {review.map(({ it, i }) => (
                  <ReviewRow key={i} item={it} choice={choices[i] || ''} onChoose={(id) => setChoices((c) => ({ ...c, [i]: id }))} />
                ))}
              </ul>
            </>
          )}

          {certain.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-soft/75">
                {certain.length} matched exactly (by email or full name)
              </summary>
              <ul className="mt-3 space-y-1 text-xs text-soft/60">
                {certain.map(({ it, i }) => (
                  <li key={i}>
                    {/* The whole line is the tick box's label, so each box is
                        named for its person, and on a touch screen the line is
                        44px tall. With a mouse the list stays close-set. */}
                    <label className="flex cursor-pointer flex-wrap items-center justify-between gap-2 [@media(pointer:coarse)]:min-h-[44px]">
                      <span>
                        {it.line} → <span className="text-soft/85">{describe(it.match)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(choices[i])}
                          onChange={(e) => setChoices((c) => ({ ...c, [i]: e.target.checked ? it.match.id : '' }))}
                          className="h-4 w-4 accent-medical"
                        />
                        Include
                      </span>
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

      {/* What the last update did. It stands outside the form, which is put
          back into the page once an update is applied: a status that arrives
          together with its surroundings is not read out. */}
      <p role="status" className={done ? 'mt-5 text-sm text-ok' : 'sr-only'}>
        {done
          ? `Updated ${done.updated} ${done.updated === 1 ? 'member' : 'members'}.${
              done.skipped?.length > 0
                ? ` Left alone: ${done.skipped.map((s) => `${s.full_name} (${s.reason})`).join('; ')}.`
                : ''
            }`
          : ''}
      </p>

      <History />
    </Panel>
  )
}
