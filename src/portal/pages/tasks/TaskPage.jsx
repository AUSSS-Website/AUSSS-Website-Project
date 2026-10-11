import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useNames, useTask, useTaskMutations, useWorkScopes } from '../../workQueries.js'
import {
  ConfirmButton,
  ErrorText,
  PageHeader,
  PageLoading,
  Panel,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
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
import { FileChooser, FileLinks, UploadStatus } from './TaskFiles.jsx'
import { Avatar } from '../../Avatar.jsx'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'

// /portal/tasks/:id. The task, who has it, a status control for anyone
// involved, and the timeline (comments plus what the triggers recorded).
// "Manager" here mirrors app.can_manage_task: a committee officer / the EB, or
// the creator while they may still assign there. The database enforces it; a
// non-manager's edit of anything but the status is simply pinned back.
//
// Whether the editor is open is kept in the address (?tab=edit), so a reload
// stays in it. Each part of the page that can fail says so itself: the status
// under its chips, a file under the list it is in, the comment under its box
// and the delete under its button.

const FIELD_LABEL = { title: 'the title', body: 'the details', priority: 'the priority', due_on: 'the due date' }

const VIEWS = ['task', 'edit']

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps the portal's small pill. In px and not rem, because the root size
// shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

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

// Each task is a page of its own. Opening another from this one (a notification
// in the header leads straight there) starts it afresh, so a comment half
// written for one task is never posted on the next.
export default function TaskPage() {
  const { id } = useParams()
  return <TaskView key={id} id={id} />
}

function TaskView({ id }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const scopes = useWorkScopes()
  const task = useTask(id)
  const { update, remove, comment, removeFile } = useTaskMutations()
  const notice = useLocation().state?.notice
  const [tab, setTab] = useTabParam(VIEWS, 'task')
  const [draft, setDraft] = useState('')
  const [draftFiles, setDraftFiles] = useState([])
  // Which file of a comment is going up, for the line beside its button.
  const [progress, setProgress] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [commentError, setCommentError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  // A second click lands before React has re-rendered the disabled button,
  // and would post the comment twice.
  const posting = useRef(false)
  usePageTitle(task.data?.title || 'Task')
  // A comment half written, or its files still going up, would be lost with the
  // tab. Opening one of the task's files stands the question down for as long
  // as that takes: to the browser a download begins as if the page were being
  // left, and it would ask "Leave site?" about a file. Counted, since the same
  // file is listed twice on the page and two can be opened one after the other.
  const [filesOpening, setFilesOpening] = useState(0)
  useLeaveWarning(filesOpening === 0 && (draft.trim() !== '' || draftFiles.length > 0 || comment.isPending))

  // The editor says when it holds typed work. While it does it stays open
  // whatever the address says, and the address is put back: a link to this
  // same task (a notification in the header) comes without ?tab=edit, and
  // would otherwise close a half-made edit without a word. Cancel is the way
  // out, and asks.
  const [holding, setHolding] = useState(false)
  useEffect(() => {
    if (holding && tab !== 'edit') setTab('edit')
  }, [holding, tab, setTab])
  const editorAsked = tab === 'edit' || holding
  const closeEditor = () => {
    setHolding(false)
    setTab('task')
  }

  // The editor takes the page's place. It opens from its top, wherever the
  // button that opened it was, and closing it puts the page back where it was.
  // Where that was is noted on the press: once the shorter form is in the page
  // the browser has already pulled the scroll position up to fit it.
  const wasAt = useRef(null)
  const openEditor = () => {
    wasAt.current = window.scrollY
    setTab('edit')
  }
  useLayoutEffect(() => {
    if (editorAsked) {
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else if (wasAt.current !== null) {
      window.scrollTo({ top: wasAt.current, behavior: 'instant' })
      wasAt.current = null
    }
  }, [editorAsked])

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

  // An address that opens the editor waits for the committees too: until they
  // are known nobody counts as a manager, and the task would show first.
  if (task.isPending || (editorAsked && scopes.loading)) return <PageLoading />
  // Only a task that never arrived is "not found". One already on screen stays
  // when reading it again fails (a dropped connection): the form or the comment
  // being typed must not be swept away by a refresh that did not get through.
  if (!t) {
    return (
      <>
        <PageHeader eyebrow="Tasks" title="Task not found" />
        <Panel>
          <p className="text-sm text-soft/70">
            {task.error
              ? errorText(task.error, 'Couldn’t load the task.')
              : 'It was deleted, or it isn’t shared with you.'}
          </p>
          <Link
            to="/portal/tasks"
            className={`-mb-3 mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent ${pressCls} hover:text-ink`}
          >
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

  if (editorAsked && isManager) {
    return (
      <>
        <PageHeader eyebrow="Tasks" title="Edit task" />
        <TaskEditor task={t} scopes={scopes} onHold={setHolding} onCancel={closeEditor} onDone={closeEditor} />
      </>
    )
  }

  const setStatus = async (status) => {
    setStatusError('')
    try {
      await update.mutateAsync({ id: t.id, status })
    } catch (e) {
      setStatusError(errorText(e, 'Could not change the status.'))
    }
  }

  const postComment = async (e) => {
    e.preventDefault()
    if (posting.current || (!draft.trim() && !draftFiles.length)) return
    posting.current = true
    setCommentError('')
    try {
      await comment.mutateAsync({ task_id: t.id, body: draft, files: draftFiles, onProgress: setProgress })
      setDraft('')
      setDraftFiles([])
    } catch (err) {
      setCommentError(errorText(err, 'Could not post the comment.'))
    } finally {
      setProgress(null)
      posting.current = false
    }
  }

  // Whoever attached a file may take it back; so may a manager of the task.
  // A removal that fails is said by the list the file is in (FileLinks).
  const fileProps = {
    canRemove: (file) => isManager || file.uploaded_by === user.id,
    onRemove: (file) => removeFile.mutateAsync(file),
    removing: removeFile.isPending,
    onOpening: (on) => setFilesOpening((n) => Math.max(0, n + (on ? 1 : -1))),
  }

  const destroy = async () => {
    setDeleteError('')
    try {
      await remove.mutateAsync(t.id)
      navigate('/portal/tasks', { replace: true })
    } catch (e) {
      setDeleteError(errorText(e, 'Could not delete the task.'))
    }
  }

  return (
    <>
      <Link
        to="/portal/tasks"
        className="-mt-[14px] mb-[10px] inline-flex min-h-[44px] items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 transition-colors hover:text-ink"
      >
        &larr; All tasks
      </Link>

      <PageHeader
        eyebrow="Task"
        title={t.title}
        subtitle={`Created by ${personName(names, t.created_by)} · ${when(t.created_at)}`}
        action={
          isManager && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <button type="button" onClick={openEditor} className={`${outlineBtnCls} ${tapCls}`}>
                  Edit
                </button>
                <ConfirmButton
                  label="Delete"
                  busyLabel="Deleting…"
                  busy={remove.isPending}
                  onConfirm={destroy}
                  className={`${outlineBtnCls} ${tapCls}`}
                  keepWidth
                />
              </div>
              {deleteError && (
                <div className="max-w-xs text-right">
                  <ErrorText>{deleteError}</ErrorText>
                </div>
              )}
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
            <p className={`mb-4 ${panelTitleCls}`}>Activity</p>
            <Timeline updates={t.updates} names={names} files={t.files} fileProps={fileProps} />
            <form onSubmit={postComment} className="mt-5">
              <label htmlFor="task-comment" className="sr-only">
                Add a comment
              </label>
              <textarea
                id="task-comment"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // Held still while it is sent, so nothing typed meanwhile is
                // cleared away with the comment that went.
                readOnly={comment.isPending}
                rows={3}
                maxLength={4000}
                placeholder="Add a comment or a progress note…"
                className={inputCls}
              />
              <div className="mt-3">
                <FileChooser files={draftFiles} onChange={setDraftFiles} disabled={comment.isPending} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="submit"
                  disabled={comment.isPending || (!draft.trim() && !draftFiles.length)}
                  className={`${primaryBtnCls} ${tapCls} px-5 py-2 text-xs`}
                >
                  {comment.isPending
                    ? progress
                      ? 'Uploading…'
                      : 'Posting…'
                    : draft.trim() || !draftFiles.length
                      ? 'Comment'
                      : 'Attach'}
                </button>
                <UploadStatus progress={progress} />
                <ErrorText>{commentError}</ErrorText>
              </div>
            </form>
          </section>
        </div>

        {/* min-w-0: a long file name is cut short here, and must not widen the page. */}
        <aside className="min-w-0 space-y-5">
          <Panel title="Status">
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Status">
              {TASK_STATUSES.map(([value, label]) => {
                const current = t.status === value
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={current}
                    // The chip in use stays a live button, so the keyboard's
                    // place is not lost on the chip that was just pressed.
                    disabled={!canMove || (update.isPending && !current)}
                    onClick={() => {
                      if (!current) setStatus(value)
                    }}
                    className={`${chipBtnCls(current)} ${tapCls} disabled:cursor-default ${
                      current ? 'cursor-default' : ''
                    } ${canMove ? '' : 'disabled:opacity-60'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {statusError && (
              <div className="mt-3">
                <ErrorText>{statusError}</ErrorText>
              </div>
            )}
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
                onClick={openEditor}
                className={`-mb-3 mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent ${pressCls} hover:text-ink`}
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
