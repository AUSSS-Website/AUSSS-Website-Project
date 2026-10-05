import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { findDuplicateTasks, useAssignable, useTaskMutations } from '../../workQueries.js'
import { todayCairo } from '../../officerQueries.js'
import { ErrorText, Field, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { DueLabel, TASK_PRIORITIES, chipBtnCls } from '../../workUi.jsx'
import { FileChooser } from './TaskFiles.jsx'
import { Avatar } from '../../Avatar.jsx'

// Create or edit a task. `scopes` comes from useWorkScopes(): the committees
// this person may hand work out in, plus `society` for the EB. A task never
// changes committee once saved (the database pins it), so the picker is only
// live on create.
//
// A new task opens with today's date (the Cairo day). Before it is created the
// open tasks of that committee are checked for one with the same title and the
// same people; a match is shown with a link and the person decides. It warns
// and never blocks, since a repeat can be deliberate.

const SOCIETY = 'society'

export default function TaskEditor({ task, scopes, onDone, onCancel }) {
  const editing = Boolean(task)
  const previousAssignees = task ? task.assignees.map((a) => a.profile_id) : []
  const [scope, setScope] = useState(
    task ? task.committee_id || SOCIETY : scopes.society ? SOCIETY : scopes.task[0]?.id || '',
  )
  const [title, setTitle] = useState(task?.title || '')
  const [body, setBody] = useState(task?.body || '')
  const [priority, setPriority] = useState(task?.priority || 'normal')
  const [dueOn, setDueOn] = useState(task ? task.due_on || '' : todayCairo())
  const [assignees, setAssignees] = useState(previousAssignees)
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  // Tasks that look like this one; set by the check, cleared by any change to
  // what was checked.
  const [repeats, setRepeats] = useState(null)
  const [checking, setChecking] = useState(false)
  // A second click lands before React has re-rendered the disabled button.
  const saving = useRef(false)

  const committeeId = scope === SOCIETY ? null : scope
  const people = useAssignable(committeeId, Boolean(scope))
  const { create, update } = useTaskMutations()
  const busy = checking || create.isPending || update.isPending

  const changeScope = (next) => {
    setScope(next)
    setAssignees([]) // people differ per committee
    setRepeats(null)
  }

  const changeTitle = (next) => {
    setTitle(next)
    setRepeats(null)
  }

  const toggle = (id) => {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
    setRepeats(null)
  }

  const save = async ({ confirmed = false } = {}) => {
    if (saving.current) return
    setError('')
    if (!title.trim()) {
      setError('Give the task a title.')
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
      const row = await create.mutateAsync({ committee_id: committeeId, ...fields, assignees, files })
      onDone(
        row.id,
        row.fileError && `The task was created, but its files were not attached. ${row.fileError}`,
      )
    } catch (err) {
      setError(err?.message || 'Could not save the task.')
    } finally {
      setChecking(false)
      saving.current = false
    }
  }

  const submit = (e) => {
    e.preventDefault()
    save()
  }

  return (
    <form onSubmit={submit} className="max-w-3xl">
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
            id="task-title"
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            maxLength={200}
            placeholder="What needs doing?"
            className={inputCls}
          />
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
              className={inputCls}
            />
          </Field>
          <Field label="Priority">
            <div className="flex flex-wrap gap-2">
              {TASK_PRIORITIES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={priority === value}
                  onClick={() => setPriority(value)}
                  className={chipBtnCls(priority === value)}
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
            <ErrorText>Couldn’t load people: {people.error.message}</ErrorText>
          ) : people.data.length === 0 ? (
            <p className="text-sm text-silver/60">
              Nobody with an account holds a position there yet. You can save the task and assign
              it later.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {people.data.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-forest-900 px-3 py-2 text-sm text-white hover:border-white/25">
                    <input
                      type="checkbox"
                      checked={assignees.includes(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4 accent-medical"
                    />
                    <Avatar name={p.full_name} src={p.avatar_url} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{p.full_name || 'No name yet'}</span>
                    <span className="shrink-0 text-xs text-silver/50">{p.position_title}</span>
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
          role="alert"
          className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5"
        >
          <p className="text-sm font-semibold text-amber-200">
            This task already exists. Create it again?
          </p>
          <p className="mt-1 text-xs text-silver/70">
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
                  className="font-semibold text-medical-light underline decoration-white/20 underline-offset-2 hover:text-white"
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
              className={outlineBtnCls}
            >
              {create.isPending ? 'Creating…' : 'Create it again'}
            </button>
            <button type="button" disabled={busy} onClick={() => setRepeats(null)} className={outlineBtnCls}>
              Keep editing
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || Boolean(repeats)} className={primaryBtnCls}>
          {checking ? 'Checking…' : busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={outlineBtnCls}>
          Cancel
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}
