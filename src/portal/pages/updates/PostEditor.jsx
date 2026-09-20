import { useState } from 'react'
import { usePostMutations } from '../../workQueries.js'
import { ErrorText, Field, Panel, Toggle, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { LEVEL_LABELS, POST_KINDS, chipBtnCls } from '../../workUi.jsx'

// Write or edit an update. Audience = a committee (or the whole society, EB
// only), optionally narrowed to levels. publish_at null keeps it a draft that
// only the committee's officers and the EB can see. A post never changes
// committee once saved (the database pins it).

const SOCIETY = 'society'

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

export default function PostEditor({ post, scopes, onDone, onCancel }) {
  const editing = Boolean(post)
  const [scope, setScope] = useState(
    post ? post.committee_id || SOCIETY : scopes.society ? SOCIETY : scopes.post[0]?.id || '',
  )
  const [kind, setKind] = useState(post?.kind || 'announcement')
  const [title, setTitle] = useState(post?.title || '')
  const [body, setBody] = useState(post?.body || '')
  const [levels, setLevels] = useState(post?.levels || [])
  const [pinned, setPinned] = useState(post?.pinned || false)
  // 'now' | 'draft' | 'at'
  const [timing, setTiming] = useState(
    !post ? 'now' : !post.publish_at ? 'draft' : Date.parse(post.publish_at) > Date.now() ? 'at' : 'now',
  )
  const [publishAt, setPublishAt] = useState(toLocalInput(post?.publish_at))
  const [expiresAt, setExpiresAt] = useState(toLocalInput(post?.expires_at))
  const [error, setError] = useState('')
  const { save } = usePostMutations()

  const toggleLevel = (value) =>
    setLevels((prev) => (prev.includes(value) ? prev.filter((l) => l !== value) : [...prev, value]))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Give the update a title.')
      return
    }
    let publish_at
    if (timing === 'draft') publish_at = null
    else if (timing === 'at') {
      publish_at = fromLocalInput(publishAt)
      if (!publish_at) {
        setError('Pick when it should go out.')
        return
      }
    } else {
      // already out: keep the original moment so the feed order doesn't jump
      publish_at =
        post?.publish_at && Date.parse(post.publish_at) <= Date.now()
          ? post.publish_at
          : new Date().toISOString()
    }
    const fields = { kind, title, body, levels, pinned, publish_at, expires_at: fromLocalInput(expiresAt) }
    if (!editing) fields.committee_id = scope === SOCIETY ? null : scope
    try {
      await save.mutateAsync(editing ? { id: post.id, ...fields } : fields)
      onDone()
    } catch (err) {
      setError(err?.message || 'Could not save the update.')
    }
  }

  return (
    <form onSubmit={submit} className="max-w-3xl">
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
          <div className="flex flex-wrap gap-2">
            {LEVEL_LABELS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={levels.includes(value)}
                onClick={() => toggleLevel(value)}
                className={chipBtnCls(levels.includes(value))}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Kind">
          <div className="flex flex-wrap gap-2">
            {POST_KINDS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
                className={chipBtnCls(kind === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Title" htmlFor="post-title">
          <input
            id="post-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className={inputCls}
          />
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
          <div className="flex flex-wrap gap-2">
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
                className={chipBtnCls(timing === value)}
              >
                {label}
              </button>
            ))}
          </div>
          {timing === 'at' && (
            <input
              type="datetime-local"
              aria-label="Publish at"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
              className={`${inputCls} mt-3 max-w-xs`}
            />
          )}
        </Field>

        <Field label="Take it down on" htmlFor="post-expires" hint="Optional. After this moment the update leaves everyone’s feed.">
          <input
            id="post-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className={`${inputCls} max-w-xs`}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <div className="max-w-md">
            <p className="text-sm font-medium text-white">Pin to the top</p>
            <p className="mt-1 text-xs text-silver/55">Pinned updates stay above newer ones until you unpin them.</p>
          </div>
          <Toggle checked={pinned} onChange={setPinned} label="Pin to the top" disabled={save.isPending} />
        </div>
      </Panel>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={save.isPending} className={primaryBtnCls}>
          {save.isPending ? 'Saving…' : timing === 'draft' ? 'Save draft' : editing ? 'Save changes' : 'Publish'}
        </button>
        <button type="button" onClick={onCancel} disabled={save.isPending} className={outlineBtnCls}>
          Cancel
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}
