import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useNames, useTasks, useWorkScopes } from '../../workQueries.js'
import { ErrorText, PageHeader, PageLoading, Panel, panelTitleCls, primaryBtnCls } from '../../portalUi.jsx'
import {
  CommitteeTag,
  DueLabel,
  PRIORITY_RANK,
  PriorityPill,
  TASK_STATUSES,
  TaskStatusPill,
  chipBtnCls,
  personName,
} from '../../workUi.jsx'
import TaskEditor from './TaskEditor.jsx'
import { byPortalOrder } from '../../officerQueries.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'

// /portal/tasks. Everything the database lets this person see: tasks assigned
// to them, tasks they created, and (officers, EB) their committees' tasks.
// Filters are client-side; a committee runs tens of tasks a term, not
// thousands.
//
// What is on screen is kept in the address: the new-task form (?tab=new), and
// each filter that is not where this person usually has it (?show=, ?view=,
// ?committee=, ?done=). So Back from a task returns to the same list, a reload
// keeps it, and a link sent to a colleague opens it.

const EMPTY = []

const SCOPES = [
  ['mine', 'Assigned to me'],
  ['created', 'Created by me'],
  ['all', 'Everything I can see'],
]

const LAYOUTS = [
  ['list', 'List'],
  ['board', 'Board'],
]

// The page itself, or the form that takes its place.
const VIEWS = ['tasks', 'new']

// Whether the finished tasks under the list are folded away.
const DONE = ['hidden', 'shown']

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps the portal's small pill. In px and not rem, because the root size
// shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// The choice this browser last made, when it is still one of `choices`.
function remember(key, choices, fallback) {
  try {
    const saved = localStorage.getItem(key)
    return choices.some(([value]) => value === saved) ? saved : fallback
  } catch {
    return fallback
  }
}
function persist(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode: the choice just doesn't stick
  }
}

// Open work first by due date (undated last), then by priority.
function byUrgency(a, b) {
  if (a.due_on !== b.due_on) {
    if (!a.due_on) return 1
    if (!b.due_on) return -1
    return a.due_on < b.due_on ? -1 : 1
  }
  return (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
}

function TaskCard({ task, names, compact }) {
  const people = task.assignees.map((a) => personName(names, a.profile_id, '…'))
  return (
    <li>
      <Link
        to={`/portal/tasks/${task.id}`}
        className="block rounded-2xl border border-line/10 bg-card p-4 transition-colors hover:border-line/25 active:border-line/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          <CommitteeTag committee={task.committee} />
          {!compact && <TaskStatusPill status={task.status} />}
          <PriorityPill priority={task.priority} />
        </div>
        <p
          className={`mt-2.5 text-sm font-semibold ${
            task.status === 'done' ? 'text-soft/50 line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 truncate text-xs text-soft/55">
            {people.length ? people.join(', ') : 'Nobody assigned'}
          </span>
          <DueLabel task={task} />
        </div>
      </Link>
    </li>
  )
}

export default function TasksPage() {
  usePageTitle('Tasks')
  const { user } = useAuth()
  const navigate = useNavigate()
  const scopes = useWorkScopes()
  const tasks = useTasks()
  const canCreate = scopes.society || scopes.task.length > 0

  const [tab, setTab] = useTabParam(VIEWS, 'tasks')
  // The form says when it holds typed work. While it does it stays open
  // whatever the address says, and the address is put back: the Tasks link in
  // the header leads to this same page without ?tab=new, and would otherwise
  // close a half-written task without a word. Cancel is the way out, and asks.
  const [holding, setHolding] = useState(false)
  useEffect(() => {
    if (holding && tab !== 'new') setTab('new')
  }, [holding, tab, setTab])
  const creating = (tab === 'new' || holding) && canCreate
  // What this person last chose here, read once as the page opens. The address
  // can say otherwise (Back from a task, a link from a colleague) and then it
  // wins; only a choice made on this page is remembered.
  const [usual] = useState(() => ({
    scope: remember('ausss-tasks-scope', SCOPES, ''),
    view: remember('ausss-tasks-view', LAYOUTS, 'list'),
  }))
  // people who only ever receive tasks start on theirs; officers start wide
  const [activeScope, setScope] = useTabParam(SCOPES, usual.scope || (canCreate ? 'all' : 'mine'), 'show')
  const [view, setView] = useTabParam(LAYOUTS, usual.view, 'view')
  const [done, setDone] = useTabParam(DONE, 'hidden', 'done')
  const showDone = done === 'shown'

  const rows = tasks.data || EMPTY
  const committees = useMemo(() => {
    const map = new Map()
    for (const t of rows) if (t.committee) map.set(t.committee.id, t.committee)
    return [...map.values()].sort(byPortalOrder)
  }, [rows])
  // Named by its slug in the address. Until the tasks have loaded there is no
  // committee to match, and the filter waits for them.
  const committeeSlugs = useMemo(() => committees.map((c) => c.slug), [committees])
  const [committee, setCommittee] = useTabParam(committeeSlugs, '', 'committee')

  const visible = useMemo(
    () =>
      rows
        .filter((t) => {
          if (activeScope === 'mine' && !t.assignees.some((a) => a.profile_id === user.id)) return false
          if (activeScope === 'created' && t.created_by !== user.id) return false
          if (committee && t.committee?.slug !== committee) return false
          return true
        })
        .sort(byUrgency),
    [rows, activeScope, committee, user.id],
  )
  const open = visible.filter((t) => t.status !== 'done')
  const finished = visible.filter((t) => t.status === 'done')

  const names = useNames(useMemo(() => rows.flatMap((t) => t.assignees.map((a) => a.profile_id)), [rows]))

  if (creating) {
    return (
      <>
        <PageHeader eyebrow="Tasks" title="New task" subtitle="Hand out a piece of work and follow it to done." />
        <TaskEditor
          scopes={scopes}
          onHold={setHolding}
          onCancel={() => {
            setHolding(false)
            setTab('tasks')
          }}
          onDone={(id, notice) => {
            setHolding(false)
            // The form leaves the address first, so Back from the new task
            // returns to the list and not to an empty form.
            setTab('tasks')
            navigate(`/portal/tasks/${id}`, notice ? { state: { notice } } : undefined)
          }}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Tasks"
        title="Tasks"
        subtitle={
          canCreate
            ? 'Work you’ve handed out and work handed to you.'
            : 'Work your officers have handed to you.'
        }
        action={
          canCreate && (
            <button type="button" onClick={() => setTab('new')} className={`${primaryBtnCls} ${tapCls}`}>
              New task
            </button>
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which tasks">
          {SCOPES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeScope === value}
              onClick={() => {
                setScope(value)
                persist('ausss-tasks-scope', value)
              }}
              className={`${chipBtnCls(activeScope === value)} ${tapCls}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Layout">
          {LAYOUTS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                setView(value)
                persist('ausss-tasks-view', value)
              }}
              className={`${chipBtnCls(view === value)} ${tapCls}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {committees.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Committee">
          <button
            type="button"
            aria-pressed={!committee}
            onClick={() => setCommittee('')}
            className={`${chipBtnCls(!committee)} ${tapCls}`}
          >
            All committees
          </button>
          {committees.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={committee === c.slug}
              onClick={() => setCommittee(c.slug)}
              className={`${chipBtnCls(committee === c.slug)} ${tapCls}`}
            >
              {c.abbr}
            </button>
          ))}
        </div>
      )}

      {tasks.isPending ? (
        <PageLoading />
      ) : tasks.error ? (
        <Panel>
          <ErrorText>{errorText(tasks.error, 'Couldn’t load the tasks.')}</ErrorText>
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">
            {rows.length === 0
              ? canCreate
                ? 'No tasks yet. Create the first one.'
                : 'Nothing has been assigned to you yet.'
              : 'No tasks match these filters.'}
          </p>
        </Panel>
      ) : view === 'board' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TASK_STATUSES.map(([status, label]) => {
            const column = visible.filter((t) => t.status === status)
            return (
              <section key={status} aria-label={label} className="rounded-2xl border border-line/10 bg-sunk/60 p-3">
                <p className={`px-1 pb-3 ${panelTitleCls}`}>
                  {label} <span className="text-soft/40">{column.length}</span>
                </p>
                {column.length === 0 ? (
                  <p className="px-1 pb-2 text-xs text-soft/40">Nothing here.</p>
                ) : (
                  <ul className="space-y-3">
                    {column.map((t) => (
                      <TaskCard key={t.id} task={t} names={names} compact />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <>
          {open.length === 0 ? (
            <Panel>
              <p className="text-sm text-soft/70">Nothing open. Nice.</p>
            </Panel>
          ) : (
            <ul className="space-y-3">
              {open.map((t) => (
                <TaskCard key={t.id} task={t} names={names} />
              ))}
            </ul>
          )}
          {finished.length > 0 && (
            // The button is one line of small type with a thumb's 44px to land
            // on; the margins here take its extra 14px above and below away.
            <div className="mt-[18px]">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setDone(showDone ? 'hidden' : 'shown')}
                className={`inline-flex min-h-[44px] items-center text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 ${pressCls} hover:text-ink`}
              >
                {showDone ? 'Hide' : 'Show'} done ({finished.length})
              </button>
              {showDone && (
                <ul className="mt-0.5 space-y-3">
                  {finished.map((t) => (
                    <TaskCard key={t.id} task={t} names={names} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
