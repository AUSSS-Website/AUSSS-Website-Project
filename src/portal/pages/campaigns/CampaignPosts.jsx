import { useRef, useState } from 'react'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { useCampaignMutations } from '../../workQueries.js'
import {
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import {
  ONLINE_POST_PLATFORMS,
  ONLINE_POST_STATUSES,
  OnlinePostStatusPill,
  PLATFORM_LABEL,
  RichText,
  chipBtnCls,
  personName,
} from '../../workUi.jsx'
import { errorText } from '../../../lib/errorText.js'

// The campaign's online posts: what goes out on the society's pages, where and
// when. Each has a caption, a link (to the design while it is made, to the post
// once it is out), a day and a state. Anybody on the campaign adds one;
// whoever added it, or a manager of the campaign, changes or removes it. The
// portal publishes nothing: this is the campaign's own list.
//
// One form at a time, in the list's place: for a new post, or over the post
// being changed.

const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

const dayLabel = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

// Posts with a day first, soonest first; the undated after them, newest last.
function byDay(a, b) {
  if (a.post_on !== b.post_on) {
    if (!a.post_on) return 1
    if (!b.post_on) return -1
    return a.post_on < b.post_on ? -1 : 1
  }
  return a.created_at < b.created_at ? -1 : 1
}

function PostForm({ campaignId, post, onClose }) {
  const { savePost } = useCampaignMutations()
  const [opened] = useState(() => ({
    platform: post?.platform || 'instagram',
    caption: post?.caption || '',
    link: post?.link || '',
    postOn: post?.post_on || '',
    status: post?.status || 'draft',
  }))
  const [platform, setPlatform] = useState(opened.platform)
  const [caption, setCaption] = useState(opened.caption)
  const [link, setLink] = useState(opened.link)
  const [postOn, setPostOn] = useState(opened.postOn)
  const [status, setStatus] = useState(opened.status)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const dirty =
    platform !== opened.platform ||
    caption !== opened.caption ||
    link !== opened.link ||
    postOn !== opened.postOn ||
    status !== opened.status
  useLeaveWarning(dirty || savePost.isPending)

  const submit = async (e) => {
    e.preventDefault()
    if (saving.current) return
    const url = link.trim()
    if (!caption.trim() && !url) return setError('Write the caption, or paste a link.')
    if (url && !/^https?:\/\//i.test(url)) return setError('The link has to start with http:// or https://.')
    setError('')
    saving.current = true
    try {
      await savePost.mutateAsync({
        id: post?.id,
        campaign_id: campaignId,
        platform,
        caption,
        link: url,
        post_on: postOn || null,
        status,
      })
      onClose()
    } catch (err) {
      setError(errorText(err, 'Could not save the post.'))
    } finally {
      saving.current = false
    }
    return undefined
  }

  const ids = post ? `post-${post.id}` : 'post-new'
  return (
    <form onSubmit={submit} noValidate>
      <Panel className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Where" htmlFor={`${ids}-platform`}>
            <select
              id={`${ids}-platform`}
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className={inputCls}
            >
              {ONLINE_POST_PLATFORMS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day" htmlFor={`${ids}-day`} hint="Optional. The day it is meant to go out.">
            <input
              id={`${ids}-day`}
              type="date"
              value={postOn}
              onChange={(e) => setPostOn(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Caption" htmlFor={`${ids}-caption`}>
          <textarea
            id={`${ids}-caption`}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            maxLength={4000}
            className={inputCls}
          />
        </Field>
        <Field
          label="Link"
          htmlFor={`${ids}-link`}
          hint="Optional. The design while it is being made, or the post itself once it is out."
        >
          <input
            id={`${ids}-link`}
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            maxLength={500}
            placeholder="https://"
            className={`${inputCls} ${tapCls}`}
          />
        </Field>
        <Field label="State">
          <div className="flex flex-wrap gap-2" role="group" aria-label="State">
            {ONLINE_POST_STATUSES.map(([value, label]) => (
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
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={savePost.isPending} className={`${primaryBtnCls} ${tapCls} px-5 py-2 text-xs`}>
            {savePost.isPending ? 'Saving…' : post ? 'Save post' : 'Add post'}
          </button>
          {dirty ? (
            <ConfirmButton
              label="Cancel"
              confirmLabel="Discard changes"
              onConfirm={onClose}
              disabled={savePost.isPending}
              className={`${outlineBtnCls} ${tapCls}`}
            />
          ) : (
            <button type="button" onClick={onClose} className={`${outlineBtnCls} ${tapCls}`}>
              Cancel
            </button>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      </Panel>
    </form>
  )
}

export default function CampaignPosts({ campaign, names, userId, isManager }) {
  const { removePost } = useCampaignMutations()
  // '' = no form, 'new', or the id of the post being changed.
  const [editing, setEditing] = useState('')
  const [error, setError] = useState('')
  const posts = [...campaign.posts].sort(byDay)

  const remove = async (post) => {
    setError('')
    try {
      await removePost.mutateAsync(post)
    } catch (err) {
      setError(errorText(err, 'Could not remove the post.'))
    }
  }

  return (
    <section aria-label="Online posts">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className={panelTitleCls}>
          Online posts <span className="text-soft/40">{posts.length}</span>
        </p>
        {editing !== 'new' && (
          <button type="button" onClick={() => setEditing('new')} className={`${outlineBtnCls} ${tapCls}`}>
            Add post
          </button>
        )}
      </div>

      {posts.length === 0 && editing !== 'new' && (
        <p className="text-sm text-soft/60">
          None yet. List what the campaign puts out on the society’s pages: the caption, the day,
          and a link to the design or to the post once it is out.
        </p>
      )}

      {posts.length > 0 && (
        <ul className="space-y-3">
          {posts.map((p) =>
            editing === p.id ? (
              <li key={p.id}>
                <PostForm campaignId={campaign.id} post={p} onClose={() => setEditing('')} />
              </li>
            ) : (
              <li key={p.id} className="rounded-2xl border border-line/10 bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-line/15 px-2.5 py-0.5 text-2xs font-semibold text-ink">
                      {PLATFORM_LABEL[p.platform] || p.platform}
                    </span>
                    <OnlinePostStatusPill status={p.status} />
                    {p.post_on && <span className="text-xs font-semibold text-soft/60">{dayLabel(p.post_on)}</span>}
                  </div>
                  {(isManager || p.author_id === userId) && (
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => setEditing(p.id)}
                        className="text-xs font-semibold text-accent hover:text-ink"
                      >
                        Edit
                      </button>
                      <ConfirmButton
                        variant="text"
                        label="Remove"
                        busy={removePost.isPending}
                        onConfirm={() => remove(p)}
                        ariaLabel="Remove this post"
                      />
                    </div>
                  )}
                </div>
                {p.caption && <RichText text={p.caption} className="mt-3 text-sm text-soft/85" />}
                {p.link && <RichText text={p.link} className="mt-2 text-sm" />}
                <p className="mt-2 text-xs text-soft/45">Added by {personName(names, p.author_id)}</p>
              </li>
            ),
          )}
        </ul>
      )}

      {editing === 'new' && (
        <div className={posts.length ? 'mt-3' : ''}>
          <PostForm campaignId={campaign.id} onClose={() => setEditing('')} />
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </section>
  )
}
