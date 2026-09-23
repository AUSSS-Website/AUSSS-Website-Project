import { useDeferredValue, useMemo, useRef, useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import {
  PAGE_SIZE,
  useDeleteRosterEntry,
  useImportRoster,
  useReleaseRosterEntry,
  useRevokeToken,
  usePositions,
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
import { ROSTER_STATUSES as STATUSES } from '../../constants.js'
import { useCommittees } from '../../officerQueries.js'
import { when } from '../../workUi.jsx'
import RosterBulkPanel from './RosterBulkPanel.jsx'
import RosterUpgradesPanel from './RosterUpgradesPanel.jsx'
import PositionTypesPanel, { PositionOptions, localMemberOf } from './PositionTypesPanel.jsx'
import {
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  inputCls,
  outlineBtnCls,
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
  'inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-silver/60'

function toForm(row) {
  const f = {}
  for (const k of Object.keys(BLANK)) f[k] = row?.[k] == null ? '' : String(row[k])
  f.is_contact_person = Boolean(row?.is_contact_person)
  return f
}

function Editor({ row, committees, positions, onClose }) {
  const save = useSaveRosterEntry()
  const remove = useDeleteRosterEntry()
  const release = useReleaseRosterEntry()
  const [form, setForm] = useState(() => (row ? toForm(row) : BLANK))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const busy = save.isPending || remove.isPending || release.isPending
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // A status typed into the sheet that isn't one of ours still has to show.
  const statusOptions =
    form.status && !STATUSES.includes(form.status) ? [form.status, ...STATUSES] : STATUSES

  const run = async (fn) => {
    setError('')
    try {
      await fn()
      onClose()
    } catch (e) {
      setError(e?.message || 'Could not save.')
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => save.mutateAsync({ id: row?.id, values: form }))
      }}
      className="mt-4 space-y-5 border-t border-white/10 pt-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="r-name">
          <input id="r-name" required value={form.full_name} onChange={set('full_name')} className={inputCls} />
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
              title="Counted from the year joined; goes up by itself every 1 September"
              className={`${inputCls} cursor-default opacity-60`}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Local GAs" htmlFor="r-lgas">
            <input id="r-lgas" value={form.lgas} onChange={set('lgas')} placeholder="0, 2, >2" className={inputCls} />
          </Field>
          <Field label="National GAs" htmlFor="r-ngas">
            <input id="r-ngas" value={form.ngas} onChange={set('ngas')} placeholder="0, 3, >2" className={inputCls} />
          </Field>
        </div>
        <Field label="Current position" htmlFor="r-pos">
          <textarea
            id="r-pos"
            rows={2}
            value={form.current_position}
            onChange={set('current_position')}
            placeholder="One per line. Empty means General Member."
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
            value={form.committee_id}
            onChange={(e) => {
              // a new committee starts them as its Local Member; the position is then theirs to change
              const committee_id = e.target.value
              setForm((f) => ({ ...f, committee_id, position_id: localMemberOf(positions, committee_id) }))
            }}
            className={inputCls}
          >
            <option value="">No committee</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>
                {c.abbr}
              </option>
            ))}
          </select>
          <label className="mt-3 flex items-center gap-2 text-sm text-silver/75">
            <input
              type="checkbox"
              checked={form.is_contact_person}
              onChange={(e) => setForm((f) => ({ ...f, is_contact_person: e.target.checked }))}
            />
            Exchange contact person (held alongside their committee)
          </label>
        </Field>
        {form.committee_id && (
          <Field
            label="Position in the committee"
            hint="Reaches their portal account by itself: at once if they have signed in, otherwise at their first sign-in."
            htmlFor="r-position"
          >
            <select id="r-position" value={form.position_id} onChange={set('position_id')} className={inputCls}>
              <PositionOptions
                positions={positions}
                committeeId={form.committee_id}
                current={row?.position_id}
                withOfficers
              />
            </select>
          </Field>
        )}
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {row &&
            (confirmDelete ? (
              <>
                <button type="button" disabled={busy} onClick={() => run(() => remove.mutateAsync(row.id))} className={`${outlineBtnCls} border-red-400/50 text-red-300`}>
                  Yes, remove {row.full_name}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className={outlineBtnCls}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className={outlineBtnCls}>
                Remove from roster
              </button>
            ))}
          {row?.portal_edited_at && row.origin === 'sheet' && !confirmDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => release.mutateAsync(row.id))}
              className={outlineBtnCls}
              title="The next spreadsheet import may overwrite this row again"
            >
              Follow the spreadsheet again
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
    </form>
  )
}

function Row({ row, committees, positions, open, onToggle }) {
  const committee = committees.find((c) => c.id === row.committee_id)
  const position = positions.find((p) => p.id === row.position_id)
  return (
    <li className="rounded-2xl border border-white/10 bg-forest-800 p-5">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 text-left">
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-white">{row.full_name}</span>
          <span className="block truncate text-sm text-silver/60">{row.email || 'No email on file'}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-silver/70">
          <span className="font-semibold text-medical-light">{row.status || 'No status'}</span>
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
      {open && <Editor row={row} committees={committees} positions={positions} onClose={onToggle} />}
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
    <div className="text-sm text-silver/75">
      <p>{parts.map(([n, l]) => `${n} ${l}`).join(' · ') || 'Nothing to do.'}</p>
      {result.missing_from_sheet > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-amber-200">
            {result.missing_from_sheet} on the roster but not in this file (nothing was removed)
          </summary>
          <p className="mt-2 text-xs text-silver/60">
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

  const run = async (fn) => {
    onError('')
    onResult(null)
    try {
      const out = await fn()
      if (out && typeof out === 'object' && 'inserted' in out) onResult(out)
    } catch (e) {
      onError(e?.message || 'That did not work.')
    }
  }

  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-white">
        Google Sheet{' '}
        <span className="font-normal text-silver/60">
          {info.isPending
            ? ''
            : active
              ? `· connected (${info.data.hint}), checked every hour`
              : '· not connected'}
        </span>
      </p>
      {active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => run(() => syncNow.mutateAsync())} className={outlineBtnCls}>
            {syncNow.isPending ? 'Syncing…' : 'Sync now'}
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => setSheet.mutateAsync(null))} className={outlineBtnCls}>
            Disconnect
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              await setSheet.mutateAsync(link)
              setLink('')
            })
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
  const [copied, setCopied] = useState(false)

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
      setError(err?.message || 'Could not import that file.')
    }
  }

  const issue = async () => {
    setError('')
    setCopied(false)
    try {
      setNewToken(await rotate.mutateAsync())
    } catch (err) {
      setError(err?.message || 'Could not issue a token.')
    }
  }

  const active = token.data?.active

  return (
    <Panel title="Spreadsheet" className="mt-10">
      <p className="mt-3 text-sm text-silver/65">
        While the membership Google Sheet is still being edited, bring its changes in here. Rows
        edited in the portal are never overwritten, and nobody is removed by an import.
      </p>

      <SheetConnection onResult={setLast} onError={setError} />

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 pt-5">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
        <button type="button" disabled={importRoster.isPending} onClick={() => fileRef.current?.click()} className={outlineBtnCls}>
          {importRoster.isPending ? 'Importing…' : 'Import an .xlsx or .csv'}
        </button>
        <span className="text-xs text-silver/50">In the sheet: File → Download → Microsoft Excel.</span>
      </div>
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
        <RunSummary result={last} />
      </div>

      <div className="mt-6 border-t border-white/10 pt-5">
        <p className="text-sm font-semibold text-white">
          Push from the sheet instead{' '}
          <span className="font-normal text-silver/60">
            {token.isPending ? '' : active ? `· on since ${when(token.data.created_at)}` : '· off'}
          </span>
        </p>
        <p className="mt-1 text-xs text-silver/55">
          For a sheet the server cannot read: its owner installs the script in
          apps-script/roster-sync.gs, which sends the roster here every hour using this token.
          Issuing a new token switches the old one off.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={rotate.isPending} onClick={issue} className={outlineBtnCls}>
            {active ? 'Issue a new token' : 'Turn on: issue a token'}
          </button>
          {active && (
            <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate()} className={outlineBtnCls}>
              Turn off
            </button>
          )}
        </div>
        {newToken && (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-forest-900 p-4">
            <p className="text-xs text-amber-200">
              Copy this now and paste it into the script’s SYNC_TOKEN property. It is not shown again.
            </p>
            <code className="mt-2 block break-all text-xs text-white">{newToken}</code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(newToken)
                  setCopied(true)
                } catch {
                  setCopied(false)
                }
              }}
              className={`${outlineBtnCls} mt-3`}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {runs.data?.length > 0 && (
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-sm font-semibold text-white">Recent imports</p>
          <ul className="mt-3 space-y-3">
            {runs.data.map((r) => (
              <li key={r.id}>
                <p className="text-xs text-silver/50">
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

  // The whole roster is loaded once and searched in the browser
  // (rosterSearch.js), so the list follows every letter with no request and no
  // debounce. useDeferredValue keeps typing smooth if a render ever lags.
  const roster = useRoster()
  const prepared = useMemo(() => prepareRoster(roster.data || []), [roster.data])
  const term = useDeferredValue(q)
  const committees = useCommittees().data || []
  const positions = usePositions().data || []
  const [showTypes, setShowTypes] = useState(false)
  const matches = useMemo(() => {
    const found = searchRoster(prepared, term, status)
    if (!committee) return found
    if (committee === 'none') return found.filter((r) => !r.committee_id)
    if (committee === 'contact') return found.filter((r) => r.is_contact_person)
    return found.filter((r) => r.committee_id === committee)
  }, [prepared, term, status, committee])
  const total = matches.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const visible = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

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
              aria-expanded={showTypes}
              onClick={() => setShowTypes((v) => !v)}
              className={`${outlineBtnCls} px-5 py-2`}
            >
              Position types
            </button>
            <button
              type="button"
              aria-expanded={openId === 'new'}
              onClick={() => setOpenId(openId === 'new' ? null : 'new')}
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

      {openId === 'new' && (
        <Panel title="New member" className="mb-6">
          <Editor row={null} committees={committees} positions={positions} onClose={() => setOpenId(null)} />
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-3 pb-5">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
          placeholder="Search by name, email or position"
          aria-label="Search the roster"
          className={`${inputCls} max-w-sm`}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(0)
          }}
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
          onChange={(e) => {
            setCommittee(e.target.value)
            setPage(0)
          }}
          aria-label="Filter by committee"
          className={`${inputCls} sm:w-auto`}
        >
          <option value="">All committees</option>
          {committees.map((c) => (
            <option key={c.id} value={c.id}>
              {c.abbr}
            </option>
          ))}
          <option value="none">No committee</option>
          <option value="contact">Contact persons</option>
        </select>
        <span className="text-xs text-silver/50" aria-live="polite">
          {roster.isPending ? '' : `${total.toLocaleString()} ${total === 1 ? 'member' : 'members'}`}
        </span>
        {roster.isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {roster.error ? (
        <Panel>
          <ErrorText>Couldn’t load the roster: {roster.error.message}</ErrorText>
        </Panel>
      ) : roster.isPending ? (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      ) : total === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">
            {term || status || committee
              ? 'Nobody matches that.'
              : 'The roster is empty. Import the membership spreadsheet below to fill it.'}
          </p>
        </Panel>
      ) : (
        <>
          <ul className="space-y-3">
            {visible.map((row) => (
              <Row key={row.id} row={row} committees={committees} positions={positions} open={openId === row.id} onToggle={() => setOpenId(openId === row.id ? null : row.id)} />
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-6 text-xs text-silver/60">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={outlineBtnCls}>
                Previous
              </button>
              <span>
                Page {page + 1} of {pages}
              </span>
              <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className={outlineBtnCls}>
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
