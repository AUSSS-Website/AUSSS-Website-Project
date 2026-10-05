import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { AUDIT_PAGE_SIZE, useAuditLog } from '../../contentQueries.js'
import { useNames } from '../../workQueries.js'
import { when } from '../../workUi.jsx'
import { ErrorText, PageHeader, Panel, Spinner, inputCls, outlineBtnCls } from '../../portalUi.jsx'

// /portal/admin/audit (webmaster only; the database returns no rows to anyone
// else). The trail app.audit() writes on every change to the main tables: who
// changed which row, when, and what it held before and after. Read-only.

// The audited tables, in the words the portal uses for them.
const TABLES = [
  ['content_blocks', 'Site content'],
  ['site_settings', 'Site settings'],
  ['committees', 'Committees and their pages'],
  ['calls', 'Open calls'],
  ['applications', 'Applications'],
  ['albums', 'Gallery albums'],
  ['gallery_photos', 'Gallery photos'],
  ['magazine_issues', 'Magazine editions'],
  ['orders', 'Merch orders'],
  ['merch_products', 'Merch products'],
  ['stories', 'Exchange stories'],
  ['signups', 'Waitlist sign-ups'],
  ['tasks', 'Tasks'],
  ['task_assignees', 'Task assignees'],
  ['task_files', 'Task files'],
  ['posts', 'Updates'],
  ['profiles', 'Accounts'],
  ['roster_entries', 'Roster'],
  ['member_notes', 'Officer notes on members'],
  ['positions', 'Positions'],
  ['position_work_emails', 'Work emails'],
  ['assignments', 'Who holds a position'],
  ['invites', 'Invites'],
  ['verification_requests', 'Verification requests'],
  ['terms', 'Terms'],
]
const TABLE_LABEL = Object.fromEntries(TABLES)

const ACTIONS = [
  ['INSERT', 'Added'],
  ['UPDATE', 'Changed'],
  ['DELETE', 'Removed'],
]
const ACTION_LABEL = Object.fromEntries(ACTIONS)
const ACTION_CLS = {
  INSERT: 'bg-emerald-400/15 text-ok',
  UPDATE: 'bg-medical/20 text-accent',
  DELETE: 'bg-red-400/15 text-danger',
}

// Bookkeeping columns that change with every write and say nothing.
const QUIET = new Set(['updated_at', 'created_at'])

function show(v) {
  if (v === null || v === undefined) return '(empty)'
  if (typeof v === 'string') return v === '' ? '(empty)' : v
  return JSON.stringify(v, null, 2)
}

// The fields a row of the log is about: the ones that differ for a change,
// every filled one for an addition or a removal.
function changedFields(entry) {
  const before = entry.before || {}
  const after = entry.after || {}
  if (entry.action === 'UPDATE') {
    return Object.keys({ ...before, ...after })
      .filter((k) => !QUIET.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => ({ name: k, before: before[k], after: after[k] }))
  }
  const row = entry.action === 'DELETE' ? before : after
  return Object.keys(row)
    .filter((k) => !QUIET.has(k) && row[k] !== null && row[k] !== '')
    .map((k) => (entry.action === 'DELETE' ? { name: k, before: row[k] } : { name: k, after: row[k] }))
}

const valueCls =
  'max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line/10 bg-sunk px-3 py-2 font-mono text-xs leading-relaxed text-soft/85'

function Entry({ entry, names }) {
  const fields = useMemo(() => changedFields(entry), [entry])
  const actor = entry.actor ? names[entry.actor]?.full_name || 'Someone without a profile' : 'The system'
  return (
    <li>
      <details className="group rounded-2xl border border-line/10 bg-card open:border-medical/30">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60 sm:px-5">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${ACTION_CLS[entry.action] || ''}`}>
            {ACTION_LABEL[entry.action] || entry.action}
          </span>
          <span className="text-sm font-semibold text-ink">{TABLE_LABEL[entry.table_name] || entry.table_name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-soft/55">
            {entry.action === 'UPDATE' && fields.length > 0 ? fields.map((f) => f.name).join(', ') : entry.row_id || ''}
          </span>
          <span className="text-xs text-soft/65">{actor}</span>
          <span className="text-xs tabular-nums text-soft/50">{when(entry.at)}</span>
        </summary>
        <div className="space-y-4 border-t border-line/10 px-4 py-4 sm:px-5">
          {entry.row_id && (
            <p className="break-all text-xs text-soft/55">
              Row <span className="font-mono text-soft/80">{entry.row_id}</span>
            </p>
          )}
          {fields.length === 0 ? (
            <p className="text-xs text-soft/55">Nothing but the timestamps changed.</p>
          ) : (
            fields.map((f) => (
              <div key={f.name}>
                <p className="mb-1.5 font-mono text-xs font-semibold text-accent">{f.name}</p>
                <div className={`grid gap-2 ${'before' in f && 'after' in f ? 'md:grid-cols-2' : ''}`}>
                  {'before' in f && (
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-soft/50">Before</p>
                      <pre className={valueCls}>{show(f.before)}</pre>
                    </div>
                  )}
                  {'after' in f && (
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-soft/50">After</p>
                      <pre className={valueCls}>{show(f.after)}</pre>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </details>
    </li>
  )
}

export default function AuditLogPage() {
  usePageTitle('Audit log')
  const { isWebmaster } = useAuth()
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)
  const log = useAuditLog({ table, action, page })
  const rows = log.data?.rows || []
  const names = useNames(useMemo(() => rows.map((r) => r.actor), [rows]))

  if (!isWebmaster) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">The audit log is for the webmaster.</p>
        <Link to="/portal" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
          &larr; Back to your dashboard
        </Link>
      </Panel>
    )
  }

  const pick = (set) => (e) => {
    set(e.target.value)
    setPage(0)
  }

  return (
    <>
      <PageHeader
        eyebrow="Webmaster"
        title="Audit log"
        subtitle="Every change to the site’s data: who made it, when, and what the row held before and after. Nothing here can be edited."
      />

      <div className="mb-5 grid max-w-2xl gap-3 sm:grid-cols-2">
        <select value={table} onChange={pick(setTable)} aria-label="What was changed" className={inputCls}>
          <option value="">Everything</option>
          {TABLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={action} onChange={pick(setAction)} aria-label="Kind of change" className={inputCls}>
          <option value="">Any kind of change</option>
          {ACTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {log.isPending ? (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      ) : log.error ? (
        <Panel>
          <ErrorText>Couldn’t load the log: {log.error.message}</ErrorText>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">{page > 0 ? 'No older entries.' : 'No entries match.'}</p>
        </Panel>
      ) : (
        <ul className={`space-y-2.5 ${log.isPlaceholderData ? 'opacity-60' : ''}`}>
          {rows.map((entry) => (
            <Entry key={entry.id} entry={entry} names={names} />
          ))}
        </ul>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" className={outlineBtnCls} disabled={page === 0 || log.isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          &larr; Newer
        </button>
        <span className="text-xs text-soft/50">Page {page + 1}</span>
        <button type="button" className={outlineBtnCls} disabled={rows.length < AUDIT_PAGE_SIZE || log.isFetching} onClick={() => setPage((p) => p + 1)}>
          Older &rarr;
        </button>
      </div>
    </>
  )
}
