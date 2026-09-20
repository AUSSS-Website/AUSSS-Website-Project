import { useState } from 'react'
import { useAssignable, useTaskMutations } from '../../workQueries.js'
import { ErrorText, Field, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { TASK_PRIORITIES, chipBtnCls } from '../../workUi.jsx'

// Create or edit a task. `scopes` comes from useWorkScopes(): the committees
// this person may hand work out in, plus `society` for the EB. A task never
// changes committee once saved (the database pins it), so the picker is only
// live on create.

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
  const [dueOn, setDueOn] = useState(task?.due_on || '')
  const [assignees, setAssignees] = useState(previousAssignees)
  const [error, setError] = useState('')

  const committeeId = scope === SOCIETY ? null : scope
  const people = useAssignable(committeeId, Boolean(scope))
  const { create, update } = useTaskMutations()
  const busy = create.isPending || update.isPending

  const changeScope = (next) => {
    setScope(next)
    setAssignees([]) // people differ per committee
  }

  const toggle = (id) =>
    setAssignees((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Give the task a title.')
      return
    }
    const fields = { title, body, priority, due_on: dueOn || null }
    try {
      if (editing) {
        await update.mutateAsync({ id: task.id, ...fields, assignees, previousAssignees })
        onDone(task.id)
      } else {
        const row = await create.mutateAsync({ committee_id: committeeId, ...fields, assignees })
        onDone(row.id)
      }
    } catch (err) {
      setError(err?.message || 'Could not save the task.')
    }
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
            onChange={(e) => setTitle(e.target.value)}
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
                    <span className="min-w-0 flex-1 truncate">{p.full_name || 'No name yet'}</span>
                    <span className="shrink-0 text-xs text-silver/50">{p.position_title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </Panel>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primaryBtnCls}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={outlineBtnCls}>
          Cancel
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}
