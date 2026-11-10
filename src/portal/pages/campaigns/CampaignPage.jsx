import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  CONCEPT_NOTE_ACCEPT,
  campaignProgress,
  conceptNoteProblem,
  conceptNoteUrl,
  useCampaign,
  useCampaignMutations,
  useNames,
  useWorkScopes,
} from '../../workQueries.js'
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
  CAMPAIGN_STATUSES,
  CommitteeTag,
  DueLabel,
  PRIORITY_RANK,
  PriorityPill,
  ProgressBar,
  RichText,
  TASK_STATUSES,
  TaskStatusPill,
  campaignDates,
  chipBtnCls,
  personName,
  progressText,
  when,
} from '../../workUi.jsx'
import CampaignEditor from './CampaignEditor.jsx'
import CampaignPosts from './CampaignPosts.jsx'
import TaskEditor from '../tasks/TaskEditor.jsx'
import { Avatar } from '../../Avatar.jsx'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'

// /portal/campaigns/:id. The campaign, the subtasks and working groups it is
// split into (each a page of its own at /portal/tasks/:id, with its own people,
// notes and files), everybody on them, and the campaign's notes.
//
// "Manager" mirrors app.can_manage_campaign: a committee officer / the EB, or
// the campaign's creator while they may still hand out work there. Whoever may
// hand out work in the committee may add a subtask. A person who is only on a
// subtask sees the campaign, their own subtasks, and the notes. The database
// enforces all of it.
//
// What takes the page's place is kept in the address: the campaign's form
// (?tab=edit) and the form for a new subtask (?tab=new). So is the layout of
// the subtasks (?view=board).

const VIEWS = ['campaign', 'edit', 'new']

const LAYOUTS = [
  ['list', 'List'],
  ['board', 'Board'],
]

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps the portal's small pill. In px and not rem, because the root size
// shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// Open work first by due date (undated last), then by priority; done last.
function byUrgency(a, b) {
  const doneA = a.status === 'done'
  const doneB = b.status === 'done'
  if (doneA !== doneB) return doneA ? 1 : -1
  if (a.due_on !== b.due_on) {
    if (!a.due_on) return 1
    if (!b.due_on) return -1
    return a.due_on < b.due_on ? -1 : 1
  }
  return (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
}

// A person on a subtask, with the line about them when there is one.
const personLine = (names, a) => {
  const name = personName(names, a.profile_id, '…')
  return a.note ? `${name} (${a.note})` : name
}

function SubtaskCard({ task, names, compact }) {
  return (
    <li>
      <Link
        to={`/portal/tasks/${task.id}`}
        className="block rounded-2xl border border-line/10 bg-card p-4 transition-colors hover:border-line/25 active:border-line/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          {!compact && <TaskStatusPill status={task.status} />}
          <PriorityPill priority={task.priority} />
          <DueLabel task={task} />
        </div>
        <p
          className={`mt-2.5 text-sm font-semibold ${
            task.status === 'done' ? 'text-soft/50 line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </p>
        <p className="mt-2 text-xs text-soft/55">
          {task.assignees.length ? task.assignees.map((a) => personLine(names, a)).join(', ') : 'Nobody on it yet'}
        </p>
      </Link>
    </li>
  )
}

// The campaign's concept note: one document. Everybody on the campaign opens
// it; a manager uploads, replaces or removes it. `onOpening` is told while a
// download starts, so the page does not ask "Leave site?" about it.
function ConceptNote({ campaign, canManage, onOpening }) {
  const { setConcept, removeConcept } = useCampaignMutations()
  const input = useRef(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const has = Boolean(campaign.concept_note_path)
  const busy = setConcept.isPending || removeConcept.isPending

  const open = async () => {
    setError('')
    setOpening(true)
    onOpening?.(true)
    try {
      window.location.assign(await conceptNoteUrl(campaign))
      // Long enough for the browser to have started the download.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    } catch (e) {
      setError(errorText(e, 'Couldn’t open the concept note. Try again.'))
    } finally {
      setOpening(false)
      onOpening?.(false)
    }
  }

  const choose = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = conceptNoteProblem(file)
    setError(problem)
    if (problem) return
    try {
      await setConcept.mutateAsync({ campaign, file })
    } catch (err) {
      setError(errorText(err, 'Could not upload the concept note.'))
    }
  }

  const remove = async () => {
    setError('')
    try {
      await removeConcept.mutateAsync(campaign)
    } catch (err) {
      setError(errorText(err, 'Could not remove the concept note.'))
    }
  }

  return (
    <Panel title="Concept note">
      {has ? (
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className={`mt-4 block max-w-full truncate text-left text-sm font-semibold text-accent underline decoration-line/20 underline-offset-2 ${pressCls} hover:text-ink ${tapCls}`}
        >
          {opening ? 'Opening…' : campaign.concept_note_name}
        </button>
      ) : (
        <p className="mt-4 text-sm text-soft/60">
          {canManage ? 'None yet. Upload the campaign’s concept note for everybody on it to read.' : 'None yet.'}
        </p>
      )}
      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={CONCEPT_NOTE_ACCEPT}
            onChange={choose}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className={`${outlineBtnCls} ${tapCls}`}
          >
            {setConcept.isPending ? 'Uploading…' : has ? 'Replace' : 'Upload'}
          </button>
          {has && (
            <ConfirmButton
              label="Remove"
              busyLabel="Removing…"
              busy={removeConcept.isPending}
              disabled={busy}
              onConfirm={remove}
              className={`${outlineBtnCls} ${tapCls}`}
            />
          )}
        </div>
      )}
      {canManage && <p className="mt-3 text-xs text-soft/50">A PDF, a Word document or a PowerPoint, up to 10 MB.</p>}
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Panel>
  )
}

// Each campaign is a page of its own: a note half written for one is never
// posted on the next.
export default function CampaignPage() {
  const { id } = useParams()
  return <CampaignView key={id} id={id} />
}

function CampaignView({ id }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const scopes = useWorkScopes()
  const campaign = useCampaign(id)
  const { update, remove, addNote, removeNote } = useCampaignMutations()
  const [tab, setTab] = useTabParam(VIEWS, 'campaign')
  const [view, setView] = useTabParam(LAYOUTS, 'list', 'view')
  const [draft, setDraft] = useState('')
  // What a new subtask could not finish (people or files), said on the page it
  // returns to.
  const [notice, setNotice] = useState('')
  const [statusError, setStatusError] = useState('')
  const [noteError, setNoteError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  // A second click lands before React has re-rendered the disabled button,
  // and would post the note twice.
  const posting = useRef(false)
  usePageTitle(campaign.data?.title || 'Campaign')
  // Opening the concept note stands the question down: to the browser a
  // download begins as if the page were being left.
  const [fileOpening, setFileOpening] = useState(false)
  useLeaveWarning(!fileOpening && (draft.trim() !== '' || addNote.isPending))

  // A form says when it holds typed work. While it does it stays open whatever
  // the address says, and the address is put back (see TaskPage.jsx).
  const [holding, setHolding] = useState(false)
  const [heldTab, setHeldTab] = useState('campaign')
  useEffect(() => {
    if (tab !== 'campaign') setHeldTab(tab)
  }, [tab])
  useEffect(() => {
    if (holding && tab === 'campaign') setTab(heldTab)
  }, [holding, tab, heldTab, setTab])
  const form = tab !== 'campaign' ? tab : holding ? heldTab : 'campaign'
  const closeForm = () => {
    setHolding(false)
    setTab('campaign')
  }

  // A form opens from its top, and closing it puts the page back where it was.
  const wasAt = useRef(null)
  const openForm = (which) => {
    wasAt.current = window.scrollY
    setNotice('')
    setTab(which)
  }
  useLayoutEffect(() => {
    if (form !== 'campaign') {
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else if (wasAt.current !== null) {
      window.scrollTo({ top: wasAt.current, behavior: 'instant' })
      wasAt.current = null
    }
  }, [form])

  const c = campaign.data
  const tasks = useMemo(() => [...(c?.tasks || [])].sort(byUrgency), [c])
  const ids = useMemo(() => {
    if (!c) return []
    return [
      c.created_by,
      ...c.tasks.flatMap((t) => t.assignees.map((a) => a.profile_id)),
      ...c.notes.map((n) => n.author_id),
      ...c.posts.map((p) => p.author_id),
    ]
  }, [c])
  const names = useNames(ids)

  // Everybody on the campaign, each with the subtasks they are on.
  const people = useMemo(() => {
    const map = new Map()
    for (const t of tasks) {
      for (const a of t.assignees) {
        if (!map.has(a.profile_id)) map.set(a.profile_id, [])
        map.get(a.profile_id).push(t.title)
      }
    }
    return [...map.entries()]
  }, [tasks])

  // An address that opens a form waits for the committees too: until they are
  // known nobody counts as a manager, and the campaign would show first.
  if (campaign.isPending || (form !== 'campaign' && scopes.loading)) return <PageLoading />
  // Only a campaign that never arrived is "not found" (see TaskPage.jsx).
  if (!c) {
    return (
      <>
        <PageHeader eyebrow="Campaigns" title="Campaign not found" />
        <Panel>
          <p className="text-sm text-soft/70">
            {campaign.error
              ? errorText(campaign.error, 'Couldn’t load the campaign.')
              : 'It was deleted, or you have no part in it.'}
          </p>
          <Link
            to="/portal/campaigns"
            className={`-mb-3 mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent ${pressCls} hover:text-ink`}
          >
            &larr; All campaigns
          </Link>
        </Panel>
      </>
    )
  }

  const inScope = c.committee_id ? scopes.task.some((x) => x.id === c.committee_id) : scopes.society
  const officer = c.committee_id ? scopes.post.some((x) => x.id === c.committee_id) : scopes.society
  const isManager = officer || (c.created_by === user.id && inScope)
  const canAdd = inScope

  if (form === 'edit' && isManager) {
    return (
      <>
        <PageHeader eyebrow="Campaigns" title="Edit campaign" />
        <CampaignEditor campaign={c} scopes={scopes} onHold={setHolding} onCancel={closeForm} onDone={closeForm} />
      </>
    )
  }

  if (form === 'new' && canAdd) {
    return (
      <>
        <PageHeader
          eyebrow={c.title}
          title="New subtask"
          subtitle="A working group or a single job inside the campaign, with its own people, notes and files."
        />
        <TaskEditor
          campaign={c}
          onHold={setHolding}
          onCancel={closeForm}
          onDone={(_id, problem) => {
            setNotice(problem || '')
            closeForm()
          }}
        />
      </>
    )
  }

  const progress = campaignProgress(tasks)
  const dates = campaignDates(c)

  const setStatus = async (status) => {
    setStatusError('')
    try {
      await update.mutateAsync({ id: c.id, status })
    } catch (e) {
      setStatusError(errorText(e, 'Could not change the stage.'))
    }
  }

  const postNote = async (e) => {
    e.preventDefault()
    if (posting.current || !draft.trim()) return
    posting.current = true
    setNoteError('')
    try {
      await addNote.mutateAsync({ campaign_id: c.id, body: draft })
      setDraft('')
    } catch (err) {
      setNoteError(errorText(err, 'Could not add the note.'))
    } finally {
      posting.current = false
    }
  }

  const dropNote = async (note) => {
    setNoteError('')
    try {
      await removeNote.mutateAsync(note)
    } catch (err) {
      setNoteError(errorText(err, 'Could not remove the note.'))
    }
  }

  const destroy = async () => {
    setDeleteError('')
    try {
      await remove.mutateAsync(c.id)
      navigate('/portal/campaigns', { replace: true })
    } catch (e) {
      setDeleteError(errorText(e, 'Could not delete the campaign.'))
    }
  }

  return (
    <>
      <Link
        to="/portal/campaigns"
        className="-mt-[14px] mb-[10px] inline-flex min-h-[44px] items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 transition-colors hover:text-ink"
      >
        &larr; All campaigns
      </Link>

      <PageHeader
        eyebrow="Campaign"
        title={c.title}
        subtitle={`Opened by ${personName(names, c.created_by)} · ${when(c.created_at)}`}
        action={
          isManager && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => openForm('edit')} className={`${outlineBtnCls} ${tapCls}`}>
                  Edit
                </button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel={tasks.length ? 'Delete with its subtasks' : undefined}
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
        <div className="min-w-0 space-y-8">
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <CommitteeTag committee={c.committee} />
              {dates && <span className="text-xs font-semibold text-soft/60">{dates}</span>}
            </div>
            {c.body ? (
              <RichText text={c.body} className="mt-4 text-sm text-soft/85" />
            ) : (
              <p className="mt-4 text-sm text-soft/45">No description.</p>
            )}
          </Panel>

          <section aria-label="Subtasks">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <p className={panelTitleCls}>
                Subtasks and working groups <span className="text-soft/40">{tasks.length}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {tasks.length > 0 && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Layout">
                    {LAYOUTS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={view === value}
                        onClick={() => setView(value)}
                        className={`${chipBtnCls(view === value)} ${tapCls}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {canAdd && (
                  <button
                    type="button"
                    onClick={() => openForm('new')}
                    className={`${primaryBtnCls} ${tapCls} px-5 py-2 text-xs`}
                  >
                    Add subtask
                  </button>
                )}
              </div>
            </div>

            {tasks.length === 0 ? (
              <Panel>
                <p className="text-sm text-soft/70">
                  {canAdd
                    ? 'Nothing yet. Add the first subtask or working group, and put people on it.'
                    : 'You are not on any of its subtasks at the moment.'}
                </p>
              </Panel>
            ) : view === 'board' ? (
              <div className="grid gap-4 md:grid-cols-2">
                {TASK_STATUSES.map(([status, label]) => {
                  const column = tasks.filter((t) => t.status === status)
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
                            <SubtaskCard key={t.id} task={t} names={names} compact />
                          ))}
                        </ul>
                      )}
                    </section>
                  )
                })}
              </div>
            ) : (
              <ul className="space-y-3">
                {tasks.map((t) => (
                  <SubtaskCard key={t.id} task={t} names={names} />
                ))}
              </ul>
            )}
            {!isManager && tasks.length > 0 && (
              <p className="mt-3 text-xs text-soft/50">You see the subtasks you are on or made.</p>
            )}
          </section>

          <CampaignPosts campaign={c} names={names} userId={user.id} isManager={isManager} />

          <section aria-label="Notes">
            <p className={`mb-4 ${panelTitleCls}`}>
              Notes <span className="text-soft/40">{c.notes.length}</span>
            </p>
            {c.notes.length === 0 ? (
              <p className="text-sm text-soft/60">
                No notes yet. A note here is read by everybody on the campaign; a note about one
                subtask goes on that subtask.
              </p>
            ) : (
              <ol className="space-y-4">
                {c.notes.map((n) => (
                  <li key={n.id} className="rounded-2xl border border-line/10 bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex items-center gap-2 text-xs text-soft/50">
                        <Avatar name={personName(names, n.author_id)} src={names[n.author_id]?.avatar_url} size="sm" />
                        <span>
                          <span className="font-semibold text-ink">{personName(names, n.author_id)}</span>
                          {' · '}
                          {when(n.created_at)}
                        </span>
                      </p>
                      {(isManager || n.author_id === user.id) && (
                        <ConfirmButton
                          variant="text"
                          label="Remove"
                          busy={removeNote.isPending}
                          onConfirm={() => dropNote(n)}
                          ariaLabel="Remove this note"
                        />
                      )}
                    </div>
                    <RichText text={n.body} className="mt-2 text-sm text-soft/85" />
                  </li>
                ))}
              </ol>
            )}
            <form onSubmit={postNote} className="mt-5">
              <label htmlFor="campaign-note" className="sr-only">
                Add a note
              </label>
              <textarea
                id="campaign-note"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // Held still while it is sent, so nothing typed meanwhile is
                // cleared away with the note that went.
                readOnly={addNote.isPending}
                rows={3}
                maxLength={4000}
                placeholder="Add a note for everybody on the campaign…"
                className={inputCls}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="submit"
                  disabled={addNote.isPending || !draft.trim()}
                  className={`${primaryBtnCls} ${tapCls} px-5 py-2 text-xs`}
                >
                  {addNote.isPending ? 'Adding…' : 'Add note'}
                </button>
                <ErrorText>{noteError}</ErrorText>
              </div>
            </form>
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          <Panel title="Stage">
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Stage">
              {CAMPAIGN_STATUSES.map(([value, label]) => {
                const current = c.status === value
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={current}
                    // The chip in use stays a live button, so the keyboard's
                    // place is not lost on the chip that was just pressed.
                    disabled={!isManager || (update.isPending && !current)}
                    onClick={() => {
                      if (!current) setStatus(value)
                    }}
                    className={`${chipBtnCls(current)} ${tapCls} disabled:cursor-default ${
                      current ? 'cursor-default' : ''
                    } ${isManager ? '' : 'disabled:opacity-60'}`}
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
            <ProgressBar {...progress} className="mt-5" />
            <p className="mt-2 text-xs text-soft/55">{progressText(progress)}</p>
          </Panel>

          <ConceptNote campaign={c} canManage={isManager} onOpening={setFileOpening} />

          <Panel title={people.length ? `People (${people.length})` : 'People'}>
            {people.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">Nobody yet. People are put on a subtask, not on the campaign.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {people.map(([pid, titles]) => (
                  <li key={pid} className="flex items-start gap-2 text-sm text-ink">
                    <Avatar name={personName(names, pid, '')} src={names[pid]?.avatar_url} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate">
                        {personName(names, pid, '…')}
                        {pid === user.id && <span className="text-soft/50"> (you)</span>}
                      </span>
                      <span className="block text-xs text-soft/50">{titles.join(', ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </>
  )
}
