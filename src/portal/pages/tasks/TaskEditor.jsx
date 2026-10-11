import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { findDuplicateTasks, useAssignable, useTaskMutations } from '../../workQueries.js'
import { todayCairo } from '../../officerQueries.js'
import {
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  SaveStatus,
  Spinner,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { DueLabel, TASK_PRIORITIES, chipBtnCls } from '../../workUi.jsx'
import { FileChooser, UploadStatus } from './TaskFiles.jsx'
import { Avatar } from '../../Avatar.jsx'
import { errorText } from '../../../lib/errorText.js'
import { scrollBehavior } from '../../../lib/motion.js'

// Create or edit a task. `scopes` comes from useWorkScopes(): the committees
// this person may hand work out in, plus `society` for the EB. A task never
// changes committee once saved (the database pins it), so the picker is only
// live on create.
//
// A new task opens with today's date (the Cairo day). Before it is created the
// open tasks of that committee are checked for one with the same title and the
// same people; a match is shown with a link and the person decides. It warns
// and never blocks, since a repeat can be deliberate.
//
// The title is checked where it is typed, from the first keystroke in it or
// the first try at saving. Cancel asks before it throws typed work away, and so
// does the browser when the tab is closed or reloaded. `onHold` (optional) is
// told true while the form holds typed work or a save is under way, and false
// once it does not or the form has gone: the page uses it to keep the form open
// when a link changes the address under it.

const SOCIETY = 'society'

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps the portal's small pill. In px and not rem, because the root size
// shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

export default function TaskEditor({ task, scopes, onDone, onCancel, onHold }) {
  const editing = Boolean(task)
  const previousAssignees = task ? task.assignees.map((a) => a.profile_id) : []
  // The form as it opened, to tell whether anything has been typed since.
  const [opened] = useState(() => ({
    scope: task ? task.committee_id || SOCIETY : scopes.society ? SOCIETY : scopes.task[0]?.id || '',
    title: task?.title || '',
    body: task?.body || '',
    priority: task?.priority || 'normal',
    dueOn: task ? task.due_on || '' : todayCairo(),
    assignees: previousAssignees,
  }))
  const [scope, setScope] = useState(opened.scope)
  const [title, setTitle] = useState(opened.title)
  const [body, setBody] = useState(opened.body)
  const [priority, setPriority] = useState(opened.priority)
  const [dueOn, setDueOn] = useState(opened.dueOn)
  const [assignees, setAssignees] = useState(opened.assignees)
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  // The title's own message waits until the title has been typed in, or a save
  // was tried: nobody is told off for a field they have not reached yet. It
  // does not wait for the field to be left, because a line that appears as the
  // pointer goes down on something else moves that thing from under the click.
  const [titleSeen, setTitleSeen] = useState(false)
  // Which file is going up, for the line beside the buttons.
  const [progress, setProgress] = useState(null)
  // Tasks that look like this one; set by the check, cleared by any change to
  // what was checked.
  const [repeats, setRepeats] = useState(null)
  const [checking, setChecking] = useState(false)
  // A second click lands before React has re-rendered the disabled button.
  const saving = useRef(false)
  const titleInput = useRef(null)
  // The warning sits under a long form; bring it to the person, do not make
  // them find it.
  const warning = useRef(null)
  useEffect(() => {
    if (repeats) warning.current?.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
  }, [repeats])

  const committeeId = scope === SOCIETY ? null : scope
  const people = useAssignable(committeeId, Boolean(scope))
  const { create, update } = useTaskMutations()
  const busy = checking || create.isPending || update.isPending

  const dirty =
    scope !== opened.scope ||
    title !== opened.title ||
    body !== opened.body ||
    priority !== opened.priority ||
    dueOn !== opened.dueOn ||
    files.length > 0 ||
    !sameSet(assignees, opened.assignees)
  const holding = dirty || busy
  useLeaveWarning(holding)
  useEffect(() => {
    onHold?.(holding)
    return () => onHold?.(false)
  }, [holding, onHold])

  const titleProblem = title.trim() ? '' : 'Give the task a title.'
  const showTitleProblem = titleSeen && Boolean(titleProblem)
  // Said, never enforced: a task can be written up after its day.
  const dueHasPassed = Boolean(dueOn) && dueOn !== opened.dueOn && dueOn < todayCairo()

  const changeScope = (next) => {
    setScope(next)
    setAssignees([]) // people differ per committee
    setRepeats(null)
  }

  const changeTitle = (next) => {
    setTitle(next)
    setTitleSeen(true)
    setRepeats(null)
  }

  const toggle = (id) => {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
    setRepeats(null)
  }

  const save = async ({ confirmed = false } = {}) => {
    if (saving.current) return
    setError('')
    if (titleProblem) {
      setTitleSeen(true)
      titleInput.current?.focus()
      return
    }
    saving.current = true
    const fields = { title, body, priority, due_on: dueOn || null }
    try {
      if (editing) {
        await update.mutateAsync({ id: task.id, ...fields, assignees, previousAssignees })
        onDone(task.id)
        return
      }
      if (!confirmed) {
        setChecking(true)
        // If the check itself fails the task is still created: the warning is
        // a courtesy, not a gate.
        const found = await findDuplicateTasks({ committee_id: committeeId, title, assignees }).catch(
          () => [],
        )
        setChecking(false)
        if (found.length) {
          setRepeats(found)
          return
        }
      }
      const row = await create.mutateAsync({
        committee_id: committeeId,
        ...fields,
        assignees,
        files,
        onProgress: setProgress,
      })
      onDone(row.id, row.notice)
    } catch (err) {
      setError(errorText(err, 'Could not save the task.'))
    } finally {
      setChecking(false)
      setProgress(null)
      saving.current = false
    }
  }

  const submit = (e) => {
    e.preventDefault()
    save()
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <Panel className="space-y-6">
        {!editing && (scopes.task.length > 1 || scopes.society) && (
          <Field label="For" htmlFor="task-scope">
            <select
              id="task-scope"
              value={scope}
              onChange={(e) => changeScope(e.target.value)}
              className={inputCls}
            >
              {scopes.society && <option value={SOCIETY}>Whole society (EB)</option>}
              {scopes.task.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.abbr} · {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Title" htmlFor="task-title">
          <input
            ref={titleInput}
            id="task-title"
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            maxLength={200}
            required
            aria-invalid={showTitleProblem || undefined}
            aria-describedby={showTitleProblem ? 'task-title-problem' : undefined}
            placeholder="What needs doing?"
            className={`${inputCls} ${tapCls}`}
          />
          {showTitleProblem && (
            <div className="mt-2">
              <ErrorText id="task-title-problem">{titleProblem}</ErrorText>
            </div>
          )}
        </Field>

        <Field label="Details" htmlFor="task-body" hint="Optional. Links become clickable.">
          <textarea
            id="task-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={8000}
            className={inputCls}
          />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Due" htmlFor="task-due">
            <input
              id="task-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              aria-describedby={dueHasPassed ? 'task-due-note' : undefined}
              className={inputCls}
            />
            {dueHasPassed && (
              <p id="task-due-note" className="mt-2 text-xs text-warn">
                That day has passed, so the task will show as overdue.
              </p>
            )}
          </Field>
          <Field label="Priority">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Priority">
              {TASK_PRIORITIES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={priority === value}
                  onClick={() => setPriority(value)}
                  className={`${chipBtnCls(priority === value)} ${tapCls}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field
          label="Assign to"
          hint="People holding a position there this term. They are notified, and can move the status and comment."
        >
          {people.isPending ? (
            <Spinner className="h-5 w-5" />
          ) : people.error ? (
            <ErrorText>{errorText(people.error, 'Couldn’t load the people there.')}</ErrorText>
          ) : people.data.length === 0 ? (
            <p className="text-sm text-soft/60">
              Nobody with an account holds a position there yet. You can save the task and assign
              it later.
            </p>
          ) : (
            // A column that may shrink (grid-cols-1), and the position under
            // the name: side by side, a long position title pushed the row off
            // a phone, and cut the name down to a few letters when held in.
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Assign to">
              {people.data.map((p) => (
                <li key={p.id} className="min-w-0">
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-line/10 bg-sunk px-3 py-2 text-sm text-ink transition-colors hover:border-line/25">
                    <input
                      type="checkbox"
                      checked={assignees.includes(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4 shrink-0 accent-medical"
                    />
                    <Avatar name={p.full_name} src={p.avatar_url} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.full_name || 'No name yet'}</span>
                      <span className="block truncate text-xs text-soft/50">{p.position_title}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>

        {!editing && (
          <Field
            label="Files"
            hint="Optional. Up to 5 files of 10 MB each: documents, sheets, slides, PDFs, images or a zip. Everyone on the task can open them."
          >
            <FileChooser files={files} onChange={setFiles} disabled={busy} />
          </Field>
        )}
      </Panel>

      {repeats && (
        <div
          ref={warning}
          role="alert"
          className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5"
        >
          <p className="text-sm font-semibold text-warn">
            This task already exists. Create it again?
          </p>
          <p className="mt-1 text-xs text-soft/70">
            {repeats.length === 1 ? 'An open task has' : `${repeats.length} open tasks have`} the same
            title and the same people.
          </p>
          <ul className="mt-3 space-y-1.5">
            {repeats.slice(0, 5).map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <Link
                  to={`/portal/tasks/${t.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-accent underline decoration-line/20 underline-offset-2 transition-colors hover:text-ink"
                >
                  {t.title}
                </Link>
                <DueLabel task={t} />
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => save({ confirmed: true })}
              className={`${outlineBtnCls} ${tapCls}`}
            >
              {create.isPending ? 'Creating…' : 'Create it again'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRepeats(null)}
              className={`${outlineBtnCls} ${tapCls}`}
            >
              Keep editing
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || Boolean(repeats)} className={`${primaryBtnCls} ${tapCls}`}>
          {checking ? 'Checking…' : busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
        </button>
        {dirty ? (
          // Typed work is about to go: the button turns red and asks once more.
          <ConfirmButton
            label="Cancel"
            confirmLabel="Discard changes"
            onConfirm={onCancel}
            disabled={busy}
            className={`${outlineBtnCls} ${tapCls}`}
          />
        ) : (
          <button type="button" onClick={onCancel} disabled={busy} className={`${outlineBtnCls} ${tapCls}`}>
            Cancel
          </button>
        )}
        <UploadStatus progress={progress} />
        {editing && <SaveStatus dirty={dirty && !busy} />}
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}
