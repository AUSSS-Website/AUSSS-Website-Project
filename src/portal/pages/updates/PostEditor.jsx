import { useEffect, useRef, useState } from 'react'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { postTimeProblems, usePostMutations } from '../../workQueries.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  SaveStatus,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { LEVEL_LABELS, POST_KINDS, chipBtnCls } from '../../workUi.jsx'
import { errorText } from '../../../lib/errorText.js'

// Write or edit an update. Audience = a committee (or the whole society, EB
// only), optionally narrowed to levels. publish_at null keeps it a draft that
// only the committee's officers and the EB can see. A post never changes
// committee once saved (the database pins it).
//
// The title and the two times are checked where they are entered, from the
// first change to each or the first try at saving. Cancel asks before it throws
// typed work away, and so does the browser when the tab is closed or reloaded.
// `onHold` (optional) is told true while the form holds typed work or a save is
// under way, and false once it does not or the form has gone: the page uses it
// to keep the form open when a link changes the address under it.

const SOCIETY = 'society'

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps the portal's small pill. In px and not rem, because the root size
// shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// <input type="datetime-local"> speaks local wall time without a zone.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

export default function PostEditor({ post, scopes, onDone, onCancel, onHold }) {
  const editing = Boolean(post)
  // The form as it opened, to tell whether anything has been typed since.
  const [opened] = useState(() => ({
    scope: post ? post.committee_id || SOCIETY : scopes.society ? SOCIETY : scopes.post[0]?.id || '',
    kind: post?.kind || 'announcement',
    title: post?.title || '',
    body: post?.body || '',
    levels: post?.levels || [],
    pinned: post?.pinned || false,
    // 'now' | 'draft' | 'at'
    timing: !post ? 'now' : !post.publish_at ? 'draft' : Date.parse(post.publish_at) > Date.now() ? 'at' : 'now',
    publishAt: toLocalInput(post?.publish_at),
    expiresAt: toLocalInput(post?.expires_at),
  }))
  const [scope, setScope] = useState(opened.scope)
  const [kind, setKind] = useState(opened.kind)
  const [title, setTitle] = useState(opened.title)
  const [body, setBody] = useState(opened.body)
  const [levels, setLevels] = useState(opened.levels)
  const [pinned, setPinned] = useState(opened.pinned)
  const [timing, setTiming] = useState(opened.timing)
  const [publishAt, setPublishAt] = useState(opened.publishAt)
  const [expiresAt, setExpiresAt] = useState(opened.expiresAt)
  const [error, setError] = useState('')
  // A field's own message waits until that field has been changed, or a save
  // was tried: nobody is told off for a field they have not reached yet. It
  // does not wait for the field to be left, because a line that appears as the
  // pointer goes down on something else moves that thing from under the click.
  const [seen, setSeen] = useState({})
  const see = (field) => setSeen((prev) => (prev[field] ? prev : { ...prev, [field]: true }))
  const titleInput = useRef(null)
  const publishInput = useRef(null)
  const expiresInput = useRef(null)
  // A second click lands before React has re-rendered the disabled button,
  // and would post the update twice.
  const saving = useRef(false)
  const { save } = usePostMutations()
  const busy = save.isPending

  const dirty =
    scope !== opened.scope ||
    kind !== opened.kind ||
    title !== opened.title ||
    body !== opened.body ||
    pinned !== opened.pinned ||
    timing !== opened.timing ||
    (timing === 'at' && publishAt !== opened.publishAt) ||
    expiresAt !== opened.expiresAt ||
    !sameSet(levels, opened.levels)
  const holding = dirty || busy
  useLeaveWarning(holding)
  useEffect(() => {
    onHold?.(holding)
    return () => onHold?.(false)
  }, [holding, onHold])

  // An update that is out and stays out. Only such a one may be given a
  // take-down time that has passed: that takes it down as soon as it is saved.
  const alreadyOut = editing && opened.timing === 'now' && timing === 'now'
  const expiryChanged = expiresAt !== opened.expiresAt

  // What stands in the way of saving, per field. Worked out on every render,
  // so a message goes the moment its field is put right, and again at the
  // moment of saving, since a time that was ahead can pass while the form is open.
  const problemsNow = () => ({
    title: title.trim() ? '' : 'Give the update a title.',
    ...postTimeProblems({
      timing,
      publishAt: fromLocalInput(publishAt),
      expiresAt: fromLocalInput(expiresAt),
      expiryChanged,
      alreadyOut,
    }),
  })
  const problems = problemsNow()
  const shown = {
    title: seen.title ? problems.title : '',
    publishAt: seen.publishAt ? problems.publishAt : '',
    expiresAt: seen.expiresAt ? problems.expiresAt : '',
  }
  // The pickers do not offer a time that has gone. Read when the form is drawn,
  // which is as near to now as a picker needs.
  const earliest = toLocalInput(new Date().toISOString())
  // Said, never refused: on an update that is out, a take-down time that has
  // passed is a way to retire it, and it can as easily be last year by a slip.
  const comesDown = fromLocalInput(expiresAt)
  const downAtOnce =
    alreadyOut && expiryChanged && Boolean(comesDown) && !problems.expiresAt && Date.parse(comesDown) <= Date.now()

  const toggleLevel = (value) =>
    setLevels((prev) => (prev.includes(value) ? prev.filter((l) => l !== value) : [...prev, value]))

  const submit = async (e) => {
    e.preventDefault()
    if (saving.current) return
    setError('')
    const found = problemsNow()
    if (found.title || found.publishAt || found.expiresAt) {
      // Every message shows at its own field; the first of them gets the cursor.
      setSeen((prev) => ({
        title: prev.title || Boolean(found.title),
        publishAt: prev.publishAt || Boolean(found.publishAt),
        expiresAt: prev.expiresAt || Boolean(found.expiresAt),
      }))
      const first = found.title ? titleInput : found.publishAt ? publishInput : expiresInput
      first.current?.focus()
      return
    }
    let publish_at
    if (timing === 'draft') publish_at = null
    else if (timing === 'at') publish_at = fromLocalInput(publishAt)
    else {
      // already out: keep the original moment so the feed order doesn't jump
      publish_at =
        post?.publish_at && Date.parse(post.publish_at) <= Date.now()
          ? post.publish_at
          : new Date().toISOString()
    }
    const fields = { kind, title, body, levels, pinned, publish_at, expires_at: fromLocalInput(expiresAt) }
    if (!editing) fields.committee_id = scope === SOCIETY ? null : scope
    saving.current = true
    try {
      await save.mutateAsync(editing ? { id: post.id, ...fields } : fields)
      onDone()
    } catch (err) {
      setError(errorText(err, 'Could not save the update.'))
    } finally {
      saving.current = false
    }
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <Panel className="space-y-6">
        {!editing && (scopes.society || scopes.post.length > 1) && (
          <Field label="For" htmlFor="post-scope">
            <select id="post-scope" value={scope} onChange={(e) => setScope(e.target.value)} className={inputCls}>
              {scopes.society && <option value={SOCIETY}>Whole society</option>}
              {scopes.post.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.abbr} · {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Who should see it" hint="Nothing ticked means everyone in the audience above. The EB always sees every update.">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Who should see it">
            {LEVEL_LABELS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={levels.includes(value)}
                onClick={() => toggleLevel(value)}
                className={`${chipBtnCls(levels.includes(value))} ${tapCls}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Kind">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Kind">
            {POST_KINDS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
                className={`${chipBtnCls(kind === value)} ${tapCls}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Title" htmlFor="post-title">
          <input
            ref={titleInput}
            id="post-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              see('title')
            }}
            maxLength={200}
            required
            aria-invalid={Boolean(shown.title) || undefined}
            aria-describedby={shown.title ? 'post-title-problem' : undefined}
            className={`${inputCls} ${tapCls}`}
          />
          {shown.title && (
            <div className="mt-2">
              <ErrorText id="post-title-problem">{shown.title}</ErrorText>
            </div>
          )}
        </Field>

        <Field label="Message" htmlFor="post-body" hint="Plain text. Line breaks are kept and links become clickable.">
          <textarea
            id="post-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            maxLength={12000}
            className={inputCls}
          />
        </Field>

        <Field label="When">
          <div className="flex flex-wrap gap-2" role="group" aria-label="When">
            {[
              ['now', 'Publish now'],
              ['at', 'Schedule'],
              ['draft', 'Keep as draft'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={timing === value}
                onClick={() => setTiming(value)}
                className={`${chipBtnCls(timing === value)} ${tapCls}`}
              >
                {label}
              </button>
            ))}
          </div>
          {timing === 'at' && (
            <>
              <input
                ref={publishInput}
                type="datetime-local"
                aria-label="Publish at"
                value={publishAt}
                min={earliest}
                onChange={(e) => {
                  setPublishAt(e.target.value)
                  see('publishAt')
                }}
                required
                aria-invalid={Boolean(shown.publishAt) || undefined}
                aria-describedby={shown.publishAt ? 'post-publish-problem' : undefined}
                className={`${inputCls} mt-3 max-w-xs`}
              />
              {shown.publishAt && (
                <div className="mt-2">
                  <ErrorText id="post-publish-problem">{shown.publishAt}</ErrorText>
                </div>
              )}
            </>
          )}
        </Field>

        <Field label="Take it down on" htmlFor="post-expires" hint="Optional. After this moment the update leaves everyone’s feed.">
          <input
            ref={expiresInput}
            id="post-expires"
            type="datetime-local"
            value={expiresAt}
            min={alreadyOut ? undefined : timing === 'at' && publishAt > earliest ? publishAt : earliest}
            onChange={(e) => {
              setExpiresAt(e.target.value)
              see('expiresAt')
            }}
            aria-invalid={Boolean(shown.expiresAt) || undefined}
            aria-describedby={shown.expiresAt ? 'post-expires-problem' : downAtOnce ? 'post-expires-note' : undefined}
            className={`${inputCls} max-w-xs`}
          />
          {shown.expiresAt && (
            <div className="mt-2">
              <ErrorText id="post-expires-problem">{shown.expiresAt}</ErrorText>
            </div>
          )}
          {downAtOnce && (
            <p id="post-expires-note" className="mt-2 text-xs text-warn">
              That time has passed, so the update will come down as soon as you save.
            </p>
          )}
        </Field>

        {/* A tick box and not a switch: it counts only once the form is saved.
            The row brings 12px of its own above and below, which the margins
            here take into account. */}
        <div className="-mb-3 border-t border-line/10 pt-3">
          <CheckField
            checked={pinned}
            onChange={setPinned}
            label="Pin to the top"
            hint="Pinned updates stay above newer ones until you unpin them."
            disabled={busy}
          />
        </div>
      </Panel>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={`${primaryBtnCls} ${tapCls}`}>
          {busy ? 'Saving…' : timing === 'draft' ? 'Save draft' : editing ? 'Save changes' : 'Publish'}
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
