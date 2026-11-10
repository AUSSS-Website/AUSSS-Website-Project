import { useEffect, useRef, useState } from 'react'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { useCampaignMutations } from '../../workQueries.js'
import {
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  SaveStatus,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { CAMPAIGN_STATUSES, chipBtnCls } from '../../workUi.jsx'
import { errorText } from '../../../lib/errorText.js'

// Open or edit a campaign. `scopes` comes from useWorkScopes(): the committees
// this person may hand work out in, plus `society` for the EB. A campaign never
// changes committee once saved (the database pins it), so the picker is only
// live when it is opened.
//
// The form follows the subtask's (TaskEditor.jsx): the title is checked where
// it is typed, Cancel asks before it throws typed work away, and `onHold` is
// told while the form holds typed work so the page can keep it open.

const SOCIETY = 'society'

const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

export default function CampaignEditor({ campaign, scopes, onDone, onCancel, onHold }) {
  const editing = Boolean(campaign)
  // The form as it opened, to tell whether anything has been typed since.
  const [opened] = useState(() => ({
    scope: campaign ? campaign.committee_id || SOCIETY : scopes.society ? SOCIETY : scopes.task[0]?.id || '',
    title: campaign?.title || '',
    body: campaign?.body || '',
    status: campaign?.status || 'planning',
    startsOn: campaign?.starts_on || '',
    endsOn: campaign?.ends_on || '',
  }))
  const [scope, setScope] = useState(opened.scope)
  const [title, setTitle] = useState(opened.title)
  const [body, setBody] = useState(opened.body)
  const [status, setStatus] = useState(opened.status)
  const [startsOn, setStartsOn] = useState(opened.startsOn)
  const [endsOn, setEndsOn] = useState(opened.endsOn)
  const [error, setError] = useState('')
  const [titleSeen, setTitleSeen] = useState(false)
  // A second click lands before React has re-rendered the disabled button.
  const saving = useRef(false)
  const titleInput = useRef(null)
  const endInput = useRef(null)

  const { create, update } = useCampaignMutations()
  const busy = create.isPending || update.isPending

  const dirty =
    scope !== opened.scope ||
    title !== opened.title ||
    body !== opened.body ||
    status !== opened.status ||
    startsOn !== opened.startsOn ||
    endsOn !== opened.endsOn
  const holding = dirty || busy
  useLeaveWarning(holding)
  useEffect(() => {
    onHold?.(holding)
    return () => onHold?.(false)
  }, [holding, onHold])

  const titleProblem = title.trim() ? '' : 'Give the campaign a name.'
  const showTitleProblem = titleSeen && Boolean(titleProblem)
  const datesProblem = startsOn && endsOn && endsOn < startsOn ? 'Pick a last day on or after the first.' : ''

  const submit = async (e) => {
    e.preventDefault()
    if (saving.current) return
    setError('')
    if (titleProblem) {
      setTitleSeen(true)
      titleInput.current?.focus()
      return
    }
    if (datesProblem) {
      endInput.current?.focus()
      return
    }
    saving.current = true
    const fields = { title, body, status, starts_on: startsOn || null, ends_on: endsOn || null }
    try {
      if (editing) {
        await update.mutateAsync({ id: campaign.id, ...fields })
        onDone(campaign.id)
      } else {
        const row = await create.mutateAsync({ committee_id: scope === SOCIETY ? null : scope, ...fields })
        onDone(row.id)
      }
    } catch (err) {
      setError(errorText(err, 'Could not save the campaign.'))
    } finally {
      saving.current = false
    }
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <Panel className="space-y-6">
        {!editing && (scopes.task.length > 1 || scopes.society) && (
          <Field label="For" htmlFor="campaign-scope">
            <select
              id="campaign-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
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

        <Field label="Name" htmlFor="campaign-title">
          <input
            ref={titleInput}
            id="campaign-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleSeen(true)
            }}
            maxLength={200}
            required
            aria-invalid={showTitleProblem || undefined}
            aria-describedby={showTitleProblem ? 'campaign-title-problem' : undefined}
            placeholder="World Diabetes Day"
            className={`${inputCls} ${tapCls}`}
          />
          {showTitleProblem && (
            <div className="mt-2">
              <ErrorText id="campaign-title-problem">{titleProblem}</ErrorText>
            </div>
          )}
        </Field>

        <Field
          label="About"
          htmlFor="campaign-body"
          hint="Optional. What the campaign is for and how it will run. Links become clickable."
        >
          <textarea
            id="campaign-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={8000}
            className={inputCls}
          />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="First day" htmlFor="campaign-starts" hint="Optional.">
            <input
              id="campaign-starts"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Last day" htmlFor="campaign-ends" hint="Optional.">
            <input
              ref={endInput}
              id="campaign-ends"
              type="date"
              value={endsOn}
              min={startsOn || undefined}
              onChange={(e) => setEndsOn(e.target.value)}
              aria-invalid={Boolean(datesProblem) || undefined}
              aria-describedby={datesProblem ? 'campaign-dates-problem' : undefined}
              className={inputCls}
            />
            {datesProblem && (
              <div className="mt-2">
                <ErrorText id="campaign-dates-problem">{datesProblem}</ErrorText>
              </div>
            )}
          </Field>
        </div>

        <Field label="Stage">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Stage">
            {CAMPAIGN_STATUSES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
                className={`${chipBtnCls(status === value)} ${tapCls}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {!editing && (
          <p className="text-sm text-soft/60">
            Once the campaign is open you add its subtasks and working groups, and put people on
            each of them.
          </p>
        )}
      </Panel>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={`${primaryBtnCls} ${tapCls}`}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Open campaign'}
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
        {editing && <SaveStatus dirty={dirty && !busy} />}
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}
