import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useNames, useTask, useTaskMutations, useWorkScopes } from '../../workQueries.js'
import { Centered, ConfirmButton, ErrorText, PageHeader, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import {
  CommitteeTag,
  DueLabel,
  PriorityPill,
  RichText,
  STATUS_LABEL,
  TASK_STATUSES,
  chipBtnCls,
  personName,
  when,
} from '../../workUi.jsx'
import TaskEditor from './TaskEditor.jsx'
import { FileChooser, FileLinks } from './TaskFiles.jsx'
import { Avatar } from '../../Avatar.jsx'

// /portal/tasks/:id. The task, who has it, a status control for anyone
// involved, and the timeline (comments plus what the triggers recorded).
// "Manager" here mirrors app.can_manage_task: a committee officer / the EB, or
// the creator while they may still assign there. The database enforces it; a
// non-manager's edit of anything but the status is simply pinned back.

const FIELD_LABEL = { title: 'the title', body: 'the details', priority: 'the priority', due_on: 'the due date' }

function eventText(u, names) {
  const who = personName(names, u.author_id, 'Someone')
  switch (u.kind) {
    case 'created':
      return `${who} created the task`
    case 'status':
      return `${who} moved it from ${STATUS_LABEL[u.meta?.from] || u.meta?.from} to ${
        STATUS_LABEL[u.meta?.to] || u.meta?.to
      }`
    case 'assigned':
      return u.meta?.profile_id === u.author_id
        ? `${who} took the task`
        : `${who} assigned ${personName(names, u.meta?.profile_id, 'someone')}`
    case 'unassigned':
      return `${who} removed ${personName(names, u.meta?.profile_id, 'someone')}`
    case 'edited':
      return `${who} changed ${(u.meta?.fields || []).map((f) => FIELD_LABEL[f] || f).join(', ')}`
    case 'files': {
      const n = Number(u.meta?.files) || 1
      return `${who} attached ${n === 1 ? 'a file' : `${n} files`}`
    }
    default:
      return who
  }
}

// `files` are the task's files; each belongs to the timeline row it came with.
function Timeline({ updates, names, files, fileProps }) {
  const byUpdate = new Map()
  for (const f of files) {
    if (!byUpdate.has(f.update_id)) byUpdate.set(f.update_id, [])
    byUpdate.get(f.update_id).push(f)
  }
  return (
    <ol className="space-y-4">
      {updates.map((u) => {
        const own = byUpdate.get(u.id) || []
        return u.kind === 'comment' ? (
          <li key={u.id} className="rounded-2xl border border-line/10 bg-card p-4">
            <p className="flex items-center gap-2 text-xs text-soft/50">
              <Avatar name={personName(names, u.author_id)} src={names[u.author_id]?.avatar_url} size="sm" />
              <span>
                <span className="font-semibold text-ink">{personName(names, u.author_id)}</span>
                {' · '}
                {when(u.created_at)}
              </span>
            </p>
            <RichText text={u.body} className="mt-2 text-sm text-soft/85" />
            <FileLinks files={own} {...fileProps} className="mt-3" />
          </li>
        ) : (
          <li key={u.id} className="pl-4 text-xs text-soft/50">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span>{eventText(u, names)}</span>
              <span className="text-soft/35">{when(u.created_at)}</span>
            </p>
            {u.kind === 'files' &&
              (own.length ? (
                <FileLinks files={own} {...fileProps} className="mt-2 max-w-xl" />
              ) : (
                <p className="mt-1 text-soft/35">Removed since.</p>
              ))}
          </li>
        )
      })}
    </ol>
  )
}

export default function TaskPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const scopes = useWorkScopes()
  const task = useTask(id)
  const { update, remove, comment, removeFile } = useTaskMutations()
  const notice = useLocation().state?.notice
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftFiles, setDraftFiles] = useState([])
  const [error, setError] = useState('')
  usePageTitle(task.data?.title || 'Task')

  const t = task.data
  const ids = useMemo(() => {
    if (!t) return []
    return [
      t.created_by,
      ...t.assignees.map((a) => a.profile_id),
      ...t.updates.flatMap((u) => [u.author_id, u.meta?.profile_id]),
    ]
  }, [t])
  const names = useNames(ids)

  if (task.isPending) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  if (task.error || !t) {
    return (
      <>
        <PageHeader eyebrow="Tasks" title="Task not found" />
        <Panel>
          <p className="text-sm text-soft/70">
            {task.error
              ? `Couldn’t load the task: ${task.error.message}`
              : 'It was deleted, or it isn’t shared with you.'}
          </p>
          <Link to="/portal/tasks" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
            &larr; All tasks
          </Link>
        </Panel>
      </>
    )
  }

  const inScope = t.committee_id ? scopes.task.some((c) => c.id === t.committee_id) : scopes.society
  const officer = t.committee_id ? scopes.post.some((c) => c.id === t.committee_id) : scopes.society
  const isManager = officer || (t.created_by === user.id && inScope)
  const isAssignee = t.assignees.some((a) => a.profile_id === user.id)
  const canMove = isManager || isAssignee

  if (editing) {
    return (
      <>
        <PageHeader eyebrow="Tasks" title="Edit task" />
        <TaskEditor task={t} scopes={scopes} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
      </>
    )
  }

  const run = async (fn, fallback) => {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e?.message || fallback)
    }
  }

  const setStatus = (status) =>
    run(() => update.mutateAsync({ id: t.id, status }), 'Could not change the status.')

  const postComment = (e) => {
    e.preventDefault()
    if (!draft.trim() && !draftFiles.length) return
    run(async () => {
      await comment.mutateAsync({ task_id: t.id, body: draft, files: draftFiles })
      setDraft('')
      setDraftFiles([])
    }, 'Could not post the comment.')
  }

  // Whoever attached a file may take it back; so may a manager of the task.
  const fileProps = {
    canRemove: (file) => isManager || file.uploaded_by === user.id,
    onRemove: (file) => run(() => removeFile.mutateAsync(file), 'Could not remove the file.'),
    removing: removeFile.isPending,
  }

  const destroy = () =>
    run(async () => {
      await remove.mutateAsync(t.id)
      navigate('/portal/tasks', { replace: true })
    }, 'Could not delete the task.')

  return (
    <>
      <Link
        to="/portal/tasks"
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 transition-colors hover:text-ink"
      >
        &larr; All tasks
      </Link>

      <PageHeader
        eyebrow="Task"
        title={t.title}
        subtitle={`Created by ${personName(names, t.created_by)} · ${when(t.created_at)}`}
        action={
          isManager && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setEditing(true)} className={outlineBtnCls}>
                Edit
              </button>
              <ConfirmButton label="Delete" busyLabel="Deleting…" busy={remove.isPending} onConfirm={destroy} />
            </div>
          )
        }
      />

      {notice && (
        <p role="alert" className="mb-5 max-w-3xl rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-3 text-sm text-warn">
          {notice}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <CommitteeTag committee={t.committee} />
              <PriorityPill priority={t.priority} />
              <DueLabel task={t} />
            </div>
            {t.body ? (
              <RichText text={t.body} className="mt-4 text-sm text-soft/85" />
            ) : (
              <p className="mt-4 text-sm text-soft/45">No details.</p>
            )}
          </Panel>

          <section aria-label="Activity">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Activity</p>
            <Timeline updates={t.updates} names={names} files={t.files} fileProps={fileProps} />
            <form onSubmit={postComment} className="mt-5">
              <label htmlFor="task-comment" className="sr-only">
                Add a comment
              </label>
              <textarea
                id="task-comment"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Add a comment or a progress note…"
                className={inputCls}
              />
              <div className="mt-3">
                <FileChooser files={draftFiles} onChange={setDraftFiles} disabled={comment.isPending} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  disabled={comment.isPending || (!draft.trim() && !draftFiles.length)}
                  className={`${primaryBtnCls} px-5 py-2 text-xs`}
                >
                  {comment.isPending
                    ? draftFiles.length
                      ? 'Uploading…'
                      : 'Posting…'
                    : draft.trim() || !draftFiles.length
                      ? 'Comment'
                      : 'Attach'}
                </button>
                <ErrorText>{error}</ErrorText>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-5">
          <Panel title="Status">
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Status">
              {TASK_STATUSES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={t.status === value}
                  disabled={!canMove || update.isPending || t.status === value}
                  onClick={() => setStatus(value)}
                  className={`${chipBtnCls(t.status === value)} disabled:cursor-default ${
                    canMove ? '' : 'disabled:opacity-60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {t.completed_at && <p className="mt-3 text-xs text-soft/50">Completed {when(t.completed_at)}</p>}
          </Panel>

          <Panel title="Assigned to">
            {t.assignees.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">Nobody yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {t.assignees.map((a) => (
                  <li key={a.profile_id} className="flex items-center gap-2 text-sm text-ink">
                    <Avatar name={personName(names, a.profile_id, '')} src={names[a.profile_id]?.avatar_url} size="sm" />
                    <span className="min-w-0 truncate">
                      {personName(names, a.profile_id, '…')}
                      {a.profile_id === user.id && <span className="text-soft/50"> (you)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {isManager && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-4 text-sm font-semibold text-accent hover:text-ink"
              >
                Change &rarr;
              </button>
            )}
          </Panel>

          <Panel title={t.files.length ? `Files (${t.files.length})` : 'Files'}>
            {t.files.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">
                None yet. Attach one from the comment box.
              </p>
            ) : (
              <FileLinks files={t.files} {...fileProps} className="mt-4" />
            )}
          </Panel>
        </aside>
      </div>
    </>
  )
}
