import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useNames, useTasks, useWorkScopes } from '../../workQueries.js'
import { Centered, ErrorText, PageHeader, Panel, Spinner, primaryBtnCls } from '../../portalUi.jsx'
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

// /portal/tasks. Everything the database lets this person see: tasks assigned
// to them, tasks they created, and (officers, EB) their committees' tasks.
// Filters are client-side; a committee runs tens of tasks a term, not
// thousands.

const EMPTY = []

const SCOPES = [
  ['mine', 'Assigned to me'],
  ['created', 'Created by me'],
  ['all', 'Everything I can see'],
]

function remember(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
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
        className="block rounded-2xl border border-white/10 bg-forest-800 p-4 transition-colors hover:border-white/25"
      >
        <div className="flex flex-wrap items-center gap-2">
          <CommitteeTag committee={task.committee} />
          {!compact && <TaskStatusPill status={task.status} />}
          <PriorityPill priority={task.priority} />
        </div>
        <p
          className={`mt-2.5 text-sm font-semibold ${
            task.status === 'done' ? 'text-silver/50 line-through' : 'text-white'
          }`}
        >
          {task.title}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 truncate text-xs text-silver/55">
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

  const [creating, setCreating] = useState(false)
  // people who only ever receive tasks start on theirs; officers start wide
  const [scope, setScope] = useState(() => remember('ausss-tasks-scope', ''))
  const [view, setView] = useState(() => remember('ausss-tasks-view', 'list'))
  const [committee, setCommittee] = useState('')
  const [showDone, setShowDone] = useState(false)
  const activeScope = scope || (canCreate ? 'all' : 'mine')

  const rows = tasks.data || EMPTY
  const committees = useMemo(() => {
    const map = new Map()
    for (const t of rows) if (t.committee) map.set(t.committee.id, t.committee)
    return [...map.values()].sort((a, b) => a.abbr.localeCompare(b.abbr))
  }, [rows])

  const visible = useMemo(
    () =>
      rows
        .filter((t) => {
          if (activeScope === 'mine' && !t.assignees.some((a) => a.profile_id === user.id)) return false
          if (activeScope === 'created' && t.created_by !== user.id) return false
          if (committee && t.committee_id !== committee) return false
          return true
        })
        .sort(byUrgency),
    [rows, activeScope, committee, user.id],
  )
  const open = visible.filter((t) => t.status !== 'done')
  const done = visible.filter((t) => t.status === 'done')

  const names = useNames(useMemo(() => rows.flatMap((t) => t.assignees.map((a) => a.profile_id)), [rows]))

  if (creating) {
    return (
      <>
        <PageHeader eyebrow="Tasks" title="New task" subtitle="Hand out a piece of work and follow it to done." />
        <TaskEditor
          scopes={scopes}
          onCancel={() => setCreating(false)}
          onDone={(id) => navigate(`/portal/tasks/${id}`)}
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
            <button type="button" onClick={() => setCreating(true)} className={primaryBtnCls}>
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
              className={chipBtnCls(activeScope === value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Layout">
          {[
            ['list', 'List'],
            ['board', 'Board'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                setView(value)
                persist('ausss-tasks-view', value)
              }}
              className={chipBtnCls(view === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {committees.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Committee">
          <button type="button" aria-pressed={!committee} onClick={() => setCommittee('')} className={chipBtnCls(!committee)}>
            All committees
          </button>
          {committees.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={committee === c.id}
              onClick={() => setCommittee(c.id)}
              className={chipBtnCls(committee === c.id)}
            >
              {c.abbr}
            </button>
          ))}
        </div>
      )}

      {tasks.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : tasks.error ? (
        <Panel>
          <ErrorText>Couldn’t load tasks: {tasks.error.message}</ErrorText>
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">
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
              <section key={status} aria-label={label} className="rounded-2xl border border-white/10 bg-forest-900/60 p-3">
                <p className="px-1 pb-3 text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">
                  {label} <span className="text-silver/40">{column.length}</span>
                </p>
                {column.length === 0 ? (
                  <p className="px-1 pb-2 text-xs text-silver/40">Nothing here.</p>
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
              <p className="text-sm text-silver/70">Nothing open. Nice.</p>
            </Panel>
          ) : (
            <ul className="space-y-3">
              {open.map((t) => (
                <TaskCard key={t.id} task={t} names={names} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <div className="mt-8">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone((v) => !v)}
                className="text-xs font-semibold uppercase tracking-[0.18em] text-silver/60 transition-colors hover:text-white"
              >
                {showDone ? 'Hide' : 'Show'} done ({done.length})
              </button>
              {showDone && (
                <ul className="mt-4 space-y-3">
                  {done.map((t) => (
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
