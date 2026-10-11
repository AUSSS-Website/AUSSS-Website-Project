import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { errorText } from '../../../lib/errorText.js'
import { scrollBehavior } from '../../../lib/motion.js'
import ExportButtons from '../../ExportButtons.jsx'
import {
  PAGE_SIZE,
  useDeleteRosterEntry,
  useImportRoster,
  useReleaseRosterEntry,
  useRevokeToken,
  usePositions,
  useSocietyPositions,
  useRoster,
  useRotateToken,
  useSaveRosterEntry,
  useSetSheet,
  useSheetInfo,
  useSyncRuns,
  useSyncSheetNow,
  useTokenInfo,
} from '../../rosterQueries.js'
import { parseRosterFile } from '../../rosterFile.js'
import { prepareRoster, searchRoster } from '../../rosterSearch.js'
import { ROSTER_STATUSES as STATUSES, MEMBERSHIP_LABELS } from '../../constants.js'
import { useCommittees } from '../../officerQueries.js'
import { when } from '../../workUi.jsx'
import RosterBulkPanel from './RosterBulkPanel.jsx'
import RosterUpgradesPanel from './RosterUpgradesPanel.jsx'
import PositionTypesPanel, { PositionOptions, localMemberOf } from './PositionTypesPanel.jsx'
import PositionsPanel from '../committee/PositionsPanel.jsx'
import { BOARD, BOARD_LABEL, boardPositions, rosterUnits, unitOf, unitPositions } from '../../rosterUnits.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// /portal/admin/roster (EB only, gated by RequireEB). The roster in Supabase
// is the working copy of the membership database: the public "Check your
// membership" page and sign-in claiming both read it.
//
// Two editors can feed it, and the rule between them is one line: a row edited
// here belongs to the portal from then on, and spreadsheet imports leave it
// alone (they report it as "kept"). Everything else follows the spreadsheet.

const FILTERS = [
  ['', 'All statuses'],
  ['candidate', 'Candidate'],
  ['associate', 'Associate'],
  ['full', 'Full'],
  ['none', 'No status'],
  ['portal', 'Edited in the portal'],
]

const BLANK = {
  full_name: '',
  email: '',
  status: 'Candidate Member',
  joined_year: '',
  years_spent: '',
  lgas: '',
  ngas: '',
  current_position: '',
  committee_id: '',
  position_id: '',
  is_contact_person: false,
}

const tagCls =
  'inline-flex items-center rounded-full border border-line/15 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wider text-soft/70'

function toForm(row) {
  const f = {}
  for (const k of Object.keys(BLANK)) f[k] = row?.[k] == null ? '' : String(row[k])
  f.is_contact_person = Boolean(row?.is_contact_person)
  return f
}

// `committees` here and below are roster units (rosterUnits.js): one entry per
// committee, except SCOPE and SCORE, which are one entry.
// Shown under an officer's or a board position on a member. The roster lists
// people under their personal emails; access to the editors and the board's
// pages belongs to each position's work email and is given by invite, never by
// what a roster row says (migration 20261005170001).
function RecordOnlyNote({ what }) {
  return (
    <p className="mt-2 text-xs text-soft/60" role="note">
      A title only. This member&rsquo;s own email stays a normal member&rsquo;s: access to {what}
      belongs to the position&rsquo;s work email and can be given to no other address.
    </p>
  )
}

// What the page says once an editor has closed, by what it did. `row` stands
// on the row itself, under the member's name; `full` names the member, for a
// row that is no longer in the list and for a screen reader.
const DONE = {
  saved: { row: 'Saved.', full: (name) => `Saved ${name}.` },
  added: { row: 'Added to the roster.', full: (name) => `Added ${name} to the roster.` },
  released: { row: 'Follows the spreadsheet again.', full: (name) => `${name} follows the spreadsheet again.` },
  removed: { row: '', full: (name) => `Removed ${name} from the roster.` },
}

// The id of a row's own button, which the page scrolls to and focuses.
const rowId = (id) => `roster-row-${id}`

// `board` are the Executive Board's positions; a member of the board has no
// committee and one of them. `onDone(what, row)` closes the editor once it
// has saved, added, removed or handed back a row (the keys of DONE), so the
// page can say which; `onClose` closes it with nothing done.
function Editor({ row, committees, positions, board, onClose, onDone }) {
  const save = useSaveRosterEntry()
  const remove = useDeleteRosterEntry()
  const release = useReleaseRosterEntry()
  const [form, setForm] = useState(() => (row ? toForm(row) : BLANK))
  const [opened] = useState(form)
  // the unit the member is in: SCOPE/SCORE for either of the two committees
  const unit = unitOf(committees, form.committee_id)
  // "Executive Board" was picked, or the member already holds one of its positions
  const [pickedBoard, setPickedBoard] = useState(false)
  const boardPosition = board.find((p) => p.id === form.position_id)
  const onBoard = !unit && (pickedBoard || Boolean(boardPosition))
  const [error, setError] = useState('')
  const busy = save.isPending || remove.isPending || release.isPending
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // A status typed into the sheet that isn't one of ours still has to show.
  const statusOptions =
    form.status && !STATUSES.includes(form.status) ? [form.status, ...STATUSES] : STATUSES
  // A sheet row edited here belongs to the portal; this hands it back.
  const canRelease = Boolean(row?.portal_edited_at) && row.origin === 'sheet'

  // The browser asks before a reload or a closed tab loses what was typed.
  useLeaveWarning(form !== opened || busy)

  // `done` is handed what the server answered. `otherwise` are the words for
  // a failure the server gave no sentence for.
  const run = async (fn, done, otherwise = 'Could not save.') => {
    setError('')
    try {
      done(await fn())
    } catch (e) {
      setError(errorText(e, otherwise))
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (onBoard && !form.position_id) {
          setError('Choose their position on the Executive Board, or pick "No committee".')
          return
        }
        run(
          () => save.mutateAsync({ id: row?.id, values: form }),
          (saved) => onDone(row ? 'saved' : 'added', saved || row),
        )
      }}
      className="mt-4 space-y-5 border-t border-line/10 pt-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="r-name">
          {/* A new member's form opens with the keyboard in its first field. */}
          <input id="r-name" required autoFocus={!row} value={form.full_name} onChange={set('full_name')} className={inputCls} />
        </Field>
        <Field label="Email" htmlFor="r-email">
          <input id="r-email" type="email" value={form.email} onChange={set('email')} className={inputCls} />
        </Field>
        <Field label="Status" htmlFor="r-status">
          <select id="r-status" value={form.status} onChange={set('status')} className={inputCls}>
            <option value="">No status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Year joined" htmlFor="r-joined">
            <input id="r-joined" type="number" min="1990" max="2100" value={form.joined_year} onChange={set('joined_year')} className={inputCls} />
          </Field>
          <Field label="Years spent" htmlFor="r-years">
            <input
              id="r-years"
              readOnly
              value={form.years_spent}
              aria-describedby="r-years-note"
              className={`${inputCls} cursor-default !text-soft/70`}
            />
          </Field>
          {/* On the page and not in a tooltip, which a phone never shows. */}
          <p id="r-years-note" className="col-span-2 -mt-3 text-xs text-soft/50">
            Years spent is counted from the year joined and goes up by itself every 1 September.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Local GAs" htmlFor="r-lgas">
            <input id="r-lgas" value={form.lgas} onChange={set('lgas')} placeholder="0, 2, >2" className={inputCls} />
          </Field>
          <Field label="National GAs" htmlFor="r-ngas">
            <input id="r-ngas" value={form.ngas} onChange={set('ngas')} placeholder="0, 3, >2" className={inputCls} />
          </Field>
        </div>
        <Field
          label="Other positions"
          hint="Anything they hold beyond their committee position below: national teams, a second role."
          htmlFor="r-pos"
        >
          <textarea
            id="r-pos"
            rows={2}
            value={form.current_position}
            onChange={set('current_position')}
            placeholder="One per line."
            className={inputCls}
          />
        </Field>
        <Field
          label="Committee"
          hint="One committee per member. Its officers see this member on their committee roster."
          htmlFor="r-committee"
        >
          <select
            id="r-committee"
            value={onBoard ? BOARD : unit?.id || ''}
            onChange={(e) => {
              if (e.target.value === BOARD) {
                // the board has no starting position: which one is chosen below
                setPickedBoard(true)
                setForm((f) => ({ ...f, committee_id: '', position_id: '' }))
                return
              }
              setPickedBoard(false)
              // a new committee starts them as its Local Member; the position is then theirs to change
              const committee_id = e.target.value
              setForm((f) => ({ ...f, committee_id, position_id: localMemberOf(positions, committee_id) }))
            }}
            className={inputCls}
          >
            <option value="">No committee</option>
            <option value={BOARD}>{BOARD_LABEL}</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>
                {c.abbr}
              </option>
            ))}
          </select>
          <CheckField
            checked={form.is_contact_person}
            onChange={(on) => setForm((f) => ({ ...f, is_contact_person: on }))}
            label="Exchange contact person (held alongside their committee)"
          />
        </Field>
        {onBoard && (
          <Field
            label="Position on the Executive Board"
            hint="A board position is recorded here and gives this member's own email no access. An assistant's position reaches their portal account by itself."
            htmlFor="r-board-position"
          >
            <select
              id="r-board-position"
              value={form.position_id}
              onChange={set('position_id')}
              className={inputCls}
            >
              <option value="">Choose a position</option>
              <optgroup label="Executive Board">
                {board
                  .filter((p) => p.level === 'eb')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Assistants">
                {board
                  .filter((p) => p.level === 'assistant')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </optgroup>
            </select>
            {boardPosition?.level === 'eb' && <RecordOnlyNote what="the board’s pages" />}
          </Field>
        )}
        {form.committee_id && (
          <Field
            label="Position in the committee"
            hint="A position below officer reaches their portal account by itself: at once if they have signed in, otherwise at their first sign-in."
            htmlFor="r-position"
          >
            <select
              id="r-position"
              value={form.position_id}
              onChange={(e) => {
                // an officer position belongs to its own committee (LORE to
                // SCORE), so the member is filed where the position lives
                const position = positions.find((p) => p.id === e.target.value)
                setForm((f) => ({
                  ...f,
                  position_id: e.target.value,
                  committee_id: position?.committee_id || f.committee_id,
                }))
              }}
              className={inputCls}
            >
              <PositionOptions
                positions={unitPositions(positions, unit, row?.position_id)}
                committeeIds={unit?.ids}
                current={row?.position_id}
                withOfficers
              />
            </select>
            {positions.find((p) => p.id === form.position_id)?.level === 'officer' && (
              <RecordOnlyNote what="the committee’s editors" />
            )}
          </Field>
        )}
      </div>

      <ErrorText>{error}</ErrorText>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Removing is for good, so it is the portal's two-click button:
                a second click that is half of a double-click does not count. */}
            {row && (
              <ConfirmButton
                label="Remove from roster"
                busyLabel="Removing…"
                busy={remove.isPending}
                disabled={busy}
                onConfirm={() =>
                  run(
                    () => remove.mutateAsync(row.id),
                    () => onDone('removed', row),
                    'Could not remove this member.',
                  )
                }
              />
            )}
            {canRelease && (
              <button
                type="button"
                disabled={busy}
                aria-describedby="r-release-note"
                onClick={() =>
                  run(
                    () => release.mutateAsync(row.id),
                    (saved) => onDone('released', saved || row),
                  )
                }
                className={outlineBtnCls}
              >
                {release.isPending ? 'Handing back…' : 'Follow the spreadsheet again'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={onClose} className={outlineBtnCls}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={`${primaryBtnCls} px-5 py-1.5 text-xs`}>
              {save.isPending ? 'Saving…' : row ? 'Save' : 'Add member'}
            </button>
          </div>
        </div>
        {/* What the button does, on the page: it was only in its tooltip. */}
        {canRelease && (
          <p id="r-release-note" className="mt-3 text-xs text-soft/50">
            After “Follow the spreadsheet again”, the next spreadsheet import may overwrite this row.
          </p>
        )}
      </div>
    </form>
  )
}

// `note` is what the last editor did to this row ("Saved."), shown while the
// row is closed.
function Row({ row, committees, positions, board, open, note, onToggle, onDone }) {
  const boardPosition = board.find((p) => p.id === row.position_id)
  const committee = boardPosition ? { abbr: BOARD_LABEL } : unitOf(committees, row.committee_id)
  const position = boardPosition || positions.find((p) => p.id === row.position_id)
  return (
    <li className="rounded-2xl border border-line/10 bg-card p-5">
      {/* The whole header opens the row, so it answers a pointer and a press
          with a tint. Its negative margin lets the tint reach a little past
          the text without moving anything. */}
      <button
        type="button"
        id={rowId(row.id)}
        onClick={onToggle}
        aria-expanded={open}
        className="-m-2 flex w-[calc(100%+1rem)] flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl p-2 text-left transition-colors duration-150 ease-out hover:bg-veil/5 active:bg-veil/10"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-ink">{row.full_name}</span>
          <span className="block truncate text-sm text-soft/70">{row.email || 'No email on file'}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-soft/70">
          {/* The status as people word it: a sheet that holds the bare code
              ("active") shows its label, as the export and a committee's
              Members tab do. */}
          <span className="font-semibold text-accent">
            {MEMBERSHIP_LABELS[row.status] || row.status || 'No status'}
          </span>
          {committee && (
            <span className={tagCls}>
              {committee.abbr}
              {position ? ` · ${position.short_title || position.title}` : ''}
            </span>
          )}
          {row.is_contact_person && <span className={tagCls}>Contact person</span>}
          {row.profile_id && <span className={tagCls}>Signed in</span>}
          {row.portal_edited_at && <span className={tagCls}>Portal</span>}
        </span>
      </button>
      {note && !open && <p className="mt-3 text-xs text-ok">{note}</p>}
      {open && (
        <Editor row={row} committees={committees} positions={positions} board={board} onClose={onToggle} onDone={onDone} />
      )}
    </li>
  )
}

function RunSummary({ result }) {
  if (!result) return null
  const parts = [
    [result.inserted, 'added'],
    [result.updated, 'updated'],
    [result.unchanged, 'unchanged'],
    [result.kept_portal_edits, 'kept (edited in the portal)'],
    [result.skipped_duplicates, 'duplicate rows skipped'],
    [result.skipped_invalid, 'rows without a name skipped'],
  ].filter(([n]) => n > 0)
  return (
    <div className="text-sm text-soft/75">
      <p>{parts.map(([n, l]) => `${n} ${l}`).join(' · ') || 'Nothing to do.'}</p>
      {result.missing_from_sheet > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-warn">
            {result.missing_from_sheet} on the roster but not in this file (nothing was removed)
          </summary>
          <p className="mt-2 text-xs text-soft/60">
            {(result.missing_names || []).join(', ')}
            {result.missing_from_sheet > (result.missing_names || []).length ? ' …' : ''}
          </p>
        </details>
      )}
    </div>
  )
}

// The hourly pull: the server downloads the connected Google Sheet by itself,
// so nothing has to be installed on the sheet.
function SheetConnection({ onResult, onError }) {
  const info = useSheetInfo()
  const setSheet = useSetSheet()
  const syncNow = useSyncSheetNow()
  const [link, setLink] = useState('')
  const busy = setSheet.isPending || syncNow.isPending
  const active = info.data?.active

  // `otherwise` are the words for a failure that came with no sentence.
  const run = async (fn, otherwise) => {
    onError('')
    onResult(null)
    try {
      const out = await fn()
      if (out && typeof out === 'object' && 'inserted' in out) onResult(out)
    } catch (e) {
      onError(errorText(e, otherwise))
    }
  }

  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-ink">
        Google Sheet{' '}
        <span className="font-normal text-soft/60">
          {info.isPending
            ? ''
            : active
              ? `· connected (${info.data.hint}), checked every hour`
              : '· not connected'}
        </span>
      </p>
      {active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => syncNow.mutateAsync(), 'The sync did not run.')}
            className={outlineBtnCls}
          >
            {syncNow.isPending ? 'Syncing…' : 'Sync now'}
          </button>
          {/* It stops the hourly check, and connecting again needs the
              sheet's link to hand: two clicks, like every removal here. */}
          <ConfirmButton
            label="Disconnect"
            busyLabel="Disconnecting…"
            busy={setSheet.isPending}
            disabled={busy}
            onConfirm={() => run(() => setSheet.mutateAsync(null), 'Could not disconnect the sheet.')}
          />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              await setSheet.mutateAsync(link)
              setLink('')
            }, 'Could not connect that sheet.')
          }}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            required
            placeholder="Paste the sheet’s link"
            aria-label="Google Sheets link"
            className={`${inputCls} max-w-md`}
          />
          <button type="submit" disabled={busy} className={outlineBtnCls}>
            Connect
          </button>
        </form>
      )}
    </div>
  )
}

function SpreadsheetPanel() {
  const fileRef = useRef(null)
  const importRoster = useImportRoster()
  const runs = useSyncRuns()
  const token = useTokenInfo()
  const rotate = useRotateToken()
  const revoke = useRevokeToken()
  const [error, setError] = useState('')
  const [last, setLast] = useState(null)
  const [newToken, setNewToken] = useState('')
  // '' until Copy is pressed, then 'yes' or 'no': whether the token reached the clipboard
  const [copied, setCopied] = useState('')
  // The token's own errors, shown under its own buttons.
  const [tokenError, setTokenError] = useState('')
  const copyRef = useRef(null)

  // A token that has just been issued hands the keyboard to Copy, which is
  // the next step. The button that issued it cannot keep it: turning on swaps
  // that button for the two-click pair, and the keyboard would be left nowhere.
  useEffect(() => {
    if (newToken) copyRef.current?.focus()
  }, [newToken])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setLast(null)
    try {
      const { rows, batch } = await parseRosterFile(file)
      setLast(await importRoster.mutateAsync({ rows, batch }))
    } catch (err) {
      // rosterFile.js's own sentences ("Couldn’t find the header row…") come
      // through as written: it marks them for errorText.
      setError(errorText(err, 'Could not import that file.'))
    }
  }

  const issue = async () => {
    setTokenError('')
    setCopied('')
    try {
      setNewToken(await rotate.mutateAsync())
    } catch (err) {
      setTokenError(errorText(err, 'Could not issue a token.'))
    }
  }

  const turnOff = async () => {
    setTokenError('')
    try {
      await revoke.mutateAsync()
      // a token still on screen would be one that no longer works
      setNewToken('')
    } catch (err) {
      setTokenError(errorText(err, 'Could not turn the token off.'))
    }
  }

  const active = token.data?.active
  const tokenBusy = rotate.isPending || revoke.isPending

  return (
    <Panel title="Spreadsheet" className="mt-10">
      <p className="mt-3 text-sm text-soft/65">
        While the membership Google Sheet is still being edited, bring its changes in here. Rows
        edited in the portal are never overwritten, and nobody is removed by an import.
      </p>

      <SheetConnection onResult={setLast} onError={setError} />

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line/10 pt-5">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
        <button type="button" disabled={importRoster.isPending} onClick={() => fileRef.current?.click()} className={outlineBtnCls}>
          {importRoster.isPending ? 'Importing…' : 'Import an .xlsx or .csv'}
        </button>
        <span className="text-xs text-soft/50">In the sheet: File → Download → Microsoft Excel.</span>
      </div>
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
        <RunSummary result={last} />
      </div>

      <div className="mt-6 border-t border-line/10 pt-5">
        <p className="text-sm font-semibold text-ink">
          Push from the sheet instead{' '}
          <span className="font-normal text-soft/60">
            {token.isPending ? '' : active ? `· on since ${when(token.data.created_at)}` : '· off'}
          </span>
        </p>
        <p className="mt-1 text-xs text-soft/55">
          For a sheet the server cannot read: its owner installs the script in
          apps-script/roster-sync.gs, which sends the roster here every hour using this token.
          Issuing a new token switches the old one off.
        </p>
        {/* While a token is in use both buttons take two clicks: either one
            stops the script on the sheet until a new token is pasted into it. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active ? (
            <>
              <ConfirmButton
                label="Issue a new token"
                confirmLabel="Click again to replace the token"
                busyLabel="Issuing…"
                busy={rotate.isPending}
                disabled={tokenBusy}
                onConfirm={issue}
              />
              <ConfirmButton
                label="Turn off"
                busyLabel="Turning off…"
                busy={revoke.isPending}
                disabled={tokenBusy}
                onConfirm={turnOff}
              />
            </>
          ) : (
            // Off until it is known whether a token is in use: pressed in the
            // moment before that, this one click would replace one that is.
            <button type="button" disabled={tokenBusy || token.isPending} onClick={issue} className={outlineBtnCls}>
              {rotate.isPending ? 'Issuing…' : 'Turn on: issue a token'}
            </button>
          )}
        </div>
        {tokenError && (
          <div className="mt-3">
            <ErrorText>{tokenError}</ErrorText>
          </div>
        )}
        {newToken && (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-sunk p-4">
            <p id="roster-token-note" className="text-xs text-warn">
              Copy this now and paste it into the script’s SYNC_TOKEN property. It is not shown again.
            </p>
            <code className="mt-2 block break-all text-xs text-ink">{newToken}</code>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* The sentence above is read with the button, for a screen
                  reader that arrives here without having passed it. */}
              <button
                ref={copyRef}
                type="button"
                aria-describedby="roster-token-note"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newToken)
                    setCopied('yes')
                  } catch {
                    setCopied('no')
                  }
                }}
                className={outlineBtnCls}
              >
                {copied === 'yes' ? 'Copied' : 'Copy'}
              </button>
              {/* Kept in the page so that a screen reader says it when it comes. */}
              <p role="status" className={copied === 'no' ? 'text-xs text-warn' : 'sr-only'}>
                {copied === 'yes'
                  ? 'Copied.'
                  : copied === 'no'
                    ? 'Couldn’t copy it. Select the token above and copy it by hand.'
                    : ''}
              </p>
            </div>
          </div>
        )}
      </div>

      {runs.data?.length > 0 && (
        <div className="mt-6 border-t border-line/10 pt-5">
          <p className="text-sm font-semibold text-ink">Recent imports</p>
          <ul className="mt-3 space-y-3">
            {runs.data.map((r) => (
              <li key={r.id}>
                <p className="text-xs text-soft/50">
                  {when(r.at)} ·{' '}
                  {r.source === 'sheet' ? 'Google Sheet' : r.source === 'upload' ? 'file upload' : 'script'}
                  {r.batch ? ` · ${r.batch}` : ''}
                </p>
                <RunSummary result={r.result} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

export default function RosterPage() {
  usePageTitle('Roster')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [committee, setCommittee] = useState('') // committee id, 'none', 'contact', or '' for all
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState(null) // row id, or 'new'
  // Its own switch: opening a member below must not close the panel and lose a pasted list.
  const [bulk, setBulk] = useState('') // '', 'lga' or 'committee': which bulk update is open
  // What the editor that has just closed did: { what, id, name, before, after },
  // with `what` a key of DONE. `before` is the row that stood under it, so that
  // a sentence about a row which has left the list can stand where the row was;
  // `after` is the row that stood over it. A removed row hands the keyboard to
  // the first of the two that there is.
  const [notice, setNotice] = useState(null)
  // The id of a member just added, until their row has been brought into view.
  const [reveal, setReveal] = useState(null)
  const listRef = useRef(null)
  const departedRef = useRef(null)

  // The whole roster is loaded once and searched in the browser
  // (rosterSearch.js), so the list follows every letter with no request and no
  // debounce. useDeferredValue keeps typing smooth if a render ever lags.
  const roster = useRoster()
  const prepared = useMemo(() => prepareRoster(roster.data || []), [roster.data])
  const term = useDeferredValue(q)
  const allCommittees = useCommittees().data
  const committees = useMemo(() => rosterUnits(allCommittees || []), [allCommittees])
  const positions = usePositions().data || []
  const societyPositions = useSocietyPositions().data
  const board = useMemo(() => boardPositions(societyPositions || []), [societyPositions])
  const [showTypes, setShowTypes] = useState(false)
  const [showBoard, setShowBoard] = useState(false)
  // A member just removed leaves the list at once, ahead of the roster being read again.
  const removedId = notice?.what === 'removed' ? notice.id : null
  const matches = useMemo(() => {
    const all = searchRoster(prepared, term, status)
    const found = removedId ? all.filter((r) => r.id !== removedId) : all
    if (!committee) return found
    if (committee === 'none') return found.filter((r) => !r.committee_id)
    if (committee === 'contact') return found.filter((r) => r.is_contact_person)
    if (committee === BOARD) return found.filter((r) => board.some((p) => p.id === r.position_id))
    const unit = committees.find((c) => c.id === committee)
    return found.filter((r) => (unit ? unit.ids.includes(r.committee_id) : r.committee_id === committee))
  }, [prepared, term, status, committee, committees, board, removedId])
  const total = matches.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // A removal or a narrower search can leave the page number past the last page.
  const at = Math.min(page, pages - 1)
  const committeeAbbr = useMemo(
    () => Object.fromEntries(committees.flatMap((c) => c.ids.map((id) => [id, c.abbr]))),
    [committees],
  )
  const exportColumns = useMemo(
    () => [
      { label: 'Name', value: (r) => r.full_name },
      { label: 'Email', value: (r) => r.email },
      { label: 'Status', value: (r) => MEMBERSHIP_LABELS[r.status] || r.status },
      { label: 'Joined', value: (r) => r.joined_year },
      { label: 'Years', value: (r) => r.years_spent },
      { label: 'LGAs', value: (r) => r.lgas },
      { label: 'NGAs', value: (r) => r.ngas },
      {
        label: 'Committee',
        value: (r) =>
          board.some((p) => p.id === r.position_id) ? BOARD_LABEL : committeeAbbr[r.committee_id] || '',
      },
      { label: 'Other positions', value: (r) => r.current_position },
      { label: 'Contact person', value: (r) => (r.is_contact_person ? 'yes' : '') },
    ],
    [committeeAbbr, board],
  )
  const exportSubtitle = [
    term ? `matching “${term}”` : '',
    status ? `status ${MEMBERSHIP_LABELS[status] || status}` : '',
    committee === 'none'
      ? 'no committee'
      : committee === 'contact'
        ? 'contact persons'
        : committee === BOARD
          ? BOARD_LABEL
          : committee
            ? committeeAbbr[committee]
            : '',
  ]
    .filter(Boolean)
    .join(', ')
  const visible = matches.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE)

  // A new member is shown: once the roster has been read again their row is
  // found (the search and the filters are cleared if they would hide it, and
  // the list turns to its page), scrolled to and given the keyboard.
  useEffect(() => {
    if (!reveal) return
    if (roster.error) {
      setReveal(null)
      return
    }
    if (!(roster.data || []).some((r) => r.id === reveal)) return
    const index = matches.findIndex((r) => r.id === reveal)
    if (index === -1) {
      if (q || status || committee) {
        setQ('')
        setStatus('')
        setCommittee('')
      } else if (!term) {
        // nothing narrows the list and they are not in it: nothing more to try
        setReveal(null)
      }
      return
    }
    const theirs = Math.floor(index / PAGE_SIZE)
    if (theirs !== at) {
      setPage(theirs)
      return
    }
    const el = document.getElementById(rowId(reveal))
    if (!el) return
    setReveal(null)
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
  }, [reveal, roster.data, roster.error, matches, at, q, status, committee, term])

  // Opening a row, searching or turning the page moves on from whatever the
  // last editor did, so its sentence goes.
  const open = (id) => {
    setNotice(null)
    setOpenId(id)
  }
  // The search box and the two filters: each starts the list at its first page.
  const narrow = (set) => (e) => {
    set(e.target.value)
    setPage(0)
    setNotice(null)
  }
  // Previous and Next sit at the foot of a long list: the new page starts at
  // its top.
  const turn = (to) => {
    setPage(to)
    setNotice(null)
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }

  // A removed row leaves at once, and the editor that closed with it may have
  // been taller than the screen. Once the list has been drawn without it, the
  // sentence that stands in its place is brought into view and the keyboard
  // goes to the row beside it, so that it is not left at the top of the page.
  useEffect(() => {
    if (notice?.what !== 'removed') return
    const beside = notice.before ?? notice.after
    if (beside) document.getElementById(rowId(beside))?.focus({ preventScroll: true })
    departedRef.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [notice])

  // An editor has finished (`what` is a key of DONE): close it and say so.
  const onDone = (what, row) => {
    setOpenId(null)
    if (!row?.id) return
    // The rows on either side in the whole list, not only on this page: the
    // one under a page's last row is drawn on this page once that row has gone.
    const index = matches.findIndex((r) => r.id === row.id)
    setNotice({
      what,
      id: row.id,
      name: row.full_name,
      before: index === -1 ? null : matches[index + 1]?.id ?? null,
      after: index < 1 ? null : matches[index - 1].id,
    })
    if (what === 'added') setReveal(row.id)
    else if (what !== 'removed') {
      // The keyboard goes back to the row's own button, and the row comes
      // back into view when its editor was taller than the screen.
      const el = document.getElementById(rowId(row.id))
      el?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
    }
  }

  // A row that has left the list (removed, or saved out of the search, a
  // filter or this page) has its sentence where it stood.
  const gone = notice && notice.what !== 'added' && !visible.some((r) => r.id === notice.id) ? notice : null
  const goneAt = gone ? visible.findIndex((r) => r.id === gone.before) : -1
  const departed = gone ? (
    <li ref={departedRef} className="rounded-2xl border border-dashed border-line/20 px-5 py-3 text-xs text-soft/70">
      {DONE[gone.what].full(gone.name)}
    </li>
  ) : null

  return (
    <>
      <PageHeader
        eyebrow="Executive Board"
        title="Membership roster"
        subtitle="The live membership database. The public status check and sign-in both read from here."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-expanded={bulk === 'lga'}
              onClick={() => setBulk(bulk === 'lga' ? '' : 'lga')}
              className={`${outlineBtnCls} px-5 py-2`}
            >
              Register a GA
            </button>
            <button
              type="button"
              aria-expanded={bulk === 'committee'}
              onClick={() => setBulk(bulk === 'committee' ? '' : 'committee')}
              className={`${outlineBtnCls} px-5 py-2`}
            >
              Set committees
            </button>
            <button
              type="button"
              aria-expanded={showBoard}
              onClick={() => setShowBoard((v) => !v)}
              className={`${outlineBtnCls} px-5 py-2`}
            >
              Executive Board
            </button>
            <button
              type="button"
              aria-expanded={showTypes}
              onClick={() => setShowTypes((v) => !v)}
              className={`${outlineBtnCls} px-5 py-2`}
            >
              Position types
            </button>
            <button
              type="button"
              aria-expanded={openId === 'new'}
              onClick={() => open(openId === 'new' ? null : 'new')}
              className={`${primaryBtnCls} px-5 py-2 text-xs`}
            >
              Add a member
            </button>
          </div>
        }
      />

      <RosterUpgradesPanel />

      {bulk && <RosterBulkPanel key={bulk} initialAction={bulk} committees={committees} onClose={() => setBulk('')} />}

      {showTypes && <PositionTypesPanel committees={committees} onClose={() => setShowTypes(false)} />}

      {/* The board is not on anybody's committee roster: its positions are
          handed out here, by address, the same way a committee invites. */}
      {showBoard && (
        <div className="mb-8">
          <p className={`pb-4 ${panelTitleCls}`}>Executive Board and webmaster</p>
          <PositionsPanel />
        </div>
      )}

      {openId === 'new' && (
        <Panel title="New member" className="mb-6">
          <Editor row={null} committees={committees} positions={positions} board={board} onClose={() => setOpenId(null)} onDone={onDone} />
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-3 pb-5">
        <input
          type="search"
          value={q}
          onChange={narrow(setQ)}
          placeholder="Search by name, email or position"
          aria-label="Search the roster"
          className={`${inputCls} max-w-sm`}
        />
        <select
          value={status}
          onChange={narrow(setStatus)}
          aria-label="Filter by status"
          className={`${inputCls} sm:w-auto`}
        >
          {FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={committee}
          onChange={narrow(setCommittee)}
          aria-label="Filter by committee"
          className={`${inputCls} sm:w-auto`}
        >
          <option value="">All committees</option>
          <option value={BOARD}>{BOARD_LABEL}</option>
          {committees.map((c) => (
            <option key={c.id} value={c.id}>
              {c.abbr}
            </option>
          ))}
          <option value="none">No committee</option>
          <option value="contact">Contact persons</option>
        </select>
        <span className="text-xs text-soft/50" aria-live="polite">
          {roster.isPending ? '' : `${total.toLocaleString()} ${total === 1 ? 'member' : 'members'}`}
        </span>
        {roster.isFetching && <Spinner className="h-4 w-4" />}
        <span className="ml-auto">
          <ExportButtons
            title="Membership roster"
            subtitle={exportSubtitle ? `Members ${exportSubtitle}.` : 'The whole membership roster.'}
            filename="ausss-roster"
            columns={exportColumns}
            rows={matches}
            landscape
          />
        </span>
      </div>

      {/* What the last editor did, for a screen reader: the sentence a sighted
          reader finds on the row, or where the row was. Always in the page, so
          that it is said when it comes. */}
      <p role="status" className="sr-only">
        {notice ? DONE[notice.what].full(notice.name) : ''}
      </p>

      {roster.error ? (
        <Panel>
          <ErrorText>{errorText(roster.error, 'Couldn’t load the roster.')}</ErrorText>
        </Panel>
      ) : roster.isPending ? (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      ) : total === 0 ? (
        <>
          {departed && <ul className="pb-3">{departed}</ul>}
          <Panel>
            <p className="text-sm text-soft/70">
              {term || status || committee
                ? 'Nobody matches that.'
                : 'The roster is empty. Import the membership spreadsheet below to fill it.'}
            </p>
          </Panel>
        </>
      ) : (
        <>
          <ul ref={listRef} className="space-y-3">
            {visible.map((row, i) => (
              <Fragment key={row.id}>
                {i === goneAt && departed}
                <Row
                  row={row}
                  committees={committees}
                  positions={positions}
                  board={board}
                  open={openId === row.id}
                  note={notice?.id === row.id ? DONE[notice.what].row : ''}
                  onToggle={() => open(openId === row.id ? null : row.id)}
                  onDone={onDone}
                />
              </Fragment>
            ))}
            {goneAt === -1 && departed}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-6 text-xs text-soft/60">
              <button type="button" disabled={at === 0} onClick={() => turn(at - 1)} className={outlineBtnCls}>
                Previous
              </button>
              <span>
                Page {at + 1} of {pages}
              </span>
              <button type="button" disabled={at + 1 >= pages} onClick={() => turn(at + 1)} className={outlineBtnCls}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      <SpreadsheetPanel />
    </>
  )
}
