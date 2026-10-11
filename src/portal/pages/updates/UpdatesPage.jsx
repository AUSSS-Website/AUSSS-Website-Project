import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  isPostLive,
  useNames,
  usePostAudience,
  usePostMutations,
  usePosts,
  useWorkScopes,
} from '../../workQueries.js'
import { ConfirmButton, ErrorText, PageHeader, PageLoading, Panel, Spinner, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { CommitteeTag, LEVEL_LABELS, POST_KIND_LABEL, RichText, UnreadDot, personName, when } from '../../workUi.jsx'
import PostEditor from './PostEditor.jsx'
import { Avatar } from '../../Avatar.jsx'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'

// /portal/updates. The feed of posts addressed to this person (the database
// decides), newest first with pinned ones on top. Opening a long post, or pressing
// "Mark as read", leaves a receipt; the post's managers (committee officers,
// EB) see the count and, on demand, exactly who has and has not read it.
//
// The editor takes the feed's place, and which one is open is kept in the
// address: ?tab=new for a new update, ?edit=<its id> for one being changed. A
// reload stays in it.

const EMPTY = []
const LONG = 420 // characters before a body is folded

// The feed itself, or the form for a new update.
const VIEWS = ['feed', 'new']

// On a touch screen a button stands at least a thumb tall; with a mouse it
// keeps its small size. In px and not rem, because the root size shrinks on a
// 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// The quiet words under a card: who has read it, Edit, Delete.
const quietBtnCls = `inline-flex items-center text-xs font-semibold text-soft/60 ${pressCls} ${tapCls} hover:text-ink disabled:opacity-40`

function stateLabel(post) {
  if (!post.publish_at) return 'Draft'
  if (Date.parse(post.publish_at) > Date.now()) return `Scheduled for ${when(post.publish_at)}`
  if (post.expires_at && Date.parse(post.expires_at) <= Date.now()) return 'Expired'
  return ''
}

function Audience({ postId }) {
  const audience = usePostAudience(postId, true)
  if (audience.isPending) return <Spinner className="h-5 w-5" />
  if (audience.error) return <ErrorText>{errorText(audience.error, 'Couldn’t load who has read it.')}</ErrorText>
  const unread = audience.data.filter((p) => !p.read_at)
  const read = audience.data.filter((p) => p.read_at)
  const list = (people) => people.map((p) => p.full_name || 'No name yet').join(', ')
  return (
    <div className="space-y-3 text-xs text-soft/70">
      <p>
        <span className="font-semibold text-ink">Not yet ({unread.length}):</span>{' '}
        {unread.length ? list(unread) : 'Everyone has read it.'}
      </p>
      {read.length > 0 && (
        <p>
          <span className="font-semibold text-ink">Read ({read.length}):</span> {list(read)}
        </p>
      )}
    </div>
  )
}

// `onDelete(id)` returns a promise. The card that asked is the only one that
// says "Deleting…", and a refusal is shown on it, under its own buttons.
// `readProblem` is the sentence to show when marking this one update as read
// did not go through.
function PostCard({ post, names, uid, canManage, onRead, onEdit, onDelete, readProblem }) {
  const isRead = post.reads.some((r) => r.profile_id === uid)
  const live = isPostLive(post)
  const long = post.body.length > LONG
  const [open, setOpen] = useState(false)
  const [showAudience, setShowAudience] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const label = stateLabel(post)
  const levels = LEVEL_LABELS.filter(([v]) => post.levels.includes(v)).map(([, l]) => l)
  const audienceId = `post-audience-${post.id}`

  const expand = () => {
    setOpen(true)
    if (!isRead && live) onRead(post.id)
  }

  const destroy = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      await onDelete(post.id)
    } catch (e) {
      setDeleteError(errorText(e, 'Could not delete the update.'))
    } finally {
      setDeleting(false)
    }
  }

  const problem = deleteError || readProblem

  return (
    <li className={`rounded-2xl border bg-card p-5 ${isRead || !live ? 'border-line/10' : 'border-medical/50'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-soft/55">
        {!isRead && live && <UnreadDot />}
        <CommitteeTag committee={post.committee} />
        <span className="font-semibold uppercase tracking-[0.14em] text-accent">
          {POST_KIND_LABEL[post.kind] || post.kind}
        </span>
        {post.pinned && <span className="font-semibold text-warn">Pinned</span>}
        {label && <span className="font-semibold text-warn">{label}</span>}
        {levels.length > 0 && <span>For {levels.join(', ').toLowerCase()}</span>}
      </div>

      <h2 className="mt-3 text-lg font-semibold text-ink">{post.title}</h2>
      <p className="mt-1.5 flex items-center gap-2 text-xs text-soft/50">
        <Avatar name={personName(names, post.author_id, 'AUSSS')} src={names[post.author_id]?.avatar_url} size="sm" />
        <span>
          {personName(names, post.author_id, 'AUSSS')} · {when(post.publish_at || post.created_at)}
        </span>
      </p>

      {post.body && (
        <>
          <RichText
            text={long && !open ? `${post.body.slice(0, LONG).trimEnd()}…` : post.body}
            className="mt-4 text-sm text-soft/85"
          />
          {long && !open && (
            <button
              type="button"
              onClick={expand}
              className={`-mb-3 -mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent ${pressCls} hover:text-ink`}
            >
              Read more &rarr;
            </button>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {!isRead && live && (!long || open) && (
          <button type="button" onClick={() => onRead(post.id)} className={`${outlineBtnCls} ${tapCls}`}>
            Mark as read
          </button>
        )}
        {canManage && (
          <>
            <button
              type="button"
              aria-expanded={showAudience}
              aria-controls={showAudience ? audienceId : undefined}
              onClick={() => setShowAudience((v) => !v)}
              className={quietBtnCls}
            >
              Read by {post.reads.length} · {showAudience ? 'hide who' : 'show who'}
            </button>
            <button type="button" onClick={() => onEdit(post)} disabled={deleting} className={quietBtnCls}>
              Edit
            </button>
            {/* Stretched to a thumb's height on a touch screen, the red pill
                it turns into as well (that one wears classes of its own). */}
            <span className={`inline-flex items-stretch ${tapCls}`}>
              <ConfirmButton
                variant="text"
                label="Delete"
                busyLabel="Deleting…"
                busy={deleting}
                onConfirm={destroy}
                className={quietBtnCls}
              />
            </span>
          </>
        )}
      </div>

      {problem && (
        <div className="mt-3">
          <ErrorText>{problem}</ErrorText>
        </div>
      )}

      {canManage && showAudience && (
        <div id={audienceId} className="mt-4 border-t border-line/10 pt-4">
          <Audience postId={post.id} />
        </div>
      )}
    </li>
  )
}

export default function UpdatesPage() {
  usePageTitle('Updates')
  const { user } = useAuth()
  const scopes = useWorkScopes()
  const posts = usePosts()
  const { markRead, remove } = usePostMutations()
  const canPost = scopes.society || scopes.post.length > 0

  const rows = posts.data || EMPTY
  const names = useNames(useMemo(() => rows.map((p) => p.author_id), [rows]))
  const unreadIds = rows
    .filter((p) => isPostLive(p) && !p.reads.some((r) => r.profile_id === user.id))
    .map((p) => p.id)

  const canManage = (post) =>
    post.committee_id ? scopes.post.some((c) => c.id === post.committee_id) : scopes.society

  // Which editor the address asks for, if any: 'new', or the id of the update
  // to change. An update can be opened for editing only by someone who manages
  // it, so an address that names any other shows the feed.
  const [tab, setTab] = useTabParam(VIEWS, 'feed')
  const manageable = rows.filter(canManage)
  const [editId, setEditId] = useTabParam(
    manageable.map((p) => p.id),
    '',
    'edit',
  )
  const asked = editId || (tab === 'new' && canPost ? 'new' : '')
  // The form says when it holds typed work, and `held` is then the editor it
  // is in. While it does that editor stays open whatever the address says, and
  // the address is put back: the Updates link in the header leads to this same
  // page without ?tab=new or ?edit=, and would otherwise close a half-written
  // update without a word. Cancel is the way out, and asks.
  const [held, setHeld] = useState('')
  const openFor = held || asked
  const holdEditor = useCallback((on) => setHeld(on ? openFor : ''), [openFor])
  useEffect(() => {
    if (!held || held === asked) return
    if (held === 'new') {
      setEditId('')
      setTab('new')
    } else {
      setTab('feed')
      setEditId(held)
    }
  }, [held, asked, setTab, setEditId])
  const editing = openFor && openFor !== 'new' ? manageable.find((p) => p.id === openFor) : null
  const editor = editing ? { post: editing } : openFor === 'new' ? {} : null
  const closeEditor = () => {
    setHeld('')
    setEditId('')
    setTab('feed')
  }

  // The editor takes the feed's place. It opens from its top, however far down
  // the card that opened it was, and closing it puts the feed back where it was.
  // Where that was is noted on the press: once the shorter form is in the page
  // the browser has already pulled the scroll position up to fit it.
  const editorOpen = Boolean(editor)
  const wasAt = useRef(null)
  const openEditor = (post) => {
    wasAt.current = window.scrollY
    if (post) setEditId(post.id)
    else setTab('new')
  }
  useLayoutEffect(() => {
    if (editorOpen) {
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else if (wasAt.current !== null) {
      window.scrollTo({ top: wasAt.current, behavior: 'instant' })
      wasAt.current = null
    }
  }, [editorOpen])

  // The ids a failed "mark as read" was for: one is said on its card, several
  // (Mark all as read) once, under the button.
  const unmarked = markRead.isError ? markRead.variables || EMPTY : EMPTY

  if (editor) {
    return (
      <>
        <PageHeader eyebrow="Updates" title={editor.post ? 'Edit update' : 'New update'} />
        <PostEditor
          // A different update is a different form, with nothing carried over.
          key={editor.post?.id || 'new'}
          post={editor.post}
          scopes={scopes}
          onHold={holdEditor}
          onCancel={closeEditor}
          onDone={closeEditor}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Updates"
        title="Updates"
        subtitle="Announcements, news and resources from your committees and the EB."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {unreadIds.length > 1 && (
              <button
                type="button"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(unreadIds)}
                className={`${outlineBtnCls} ${tapCls}`}
              >
                Mark all as read
              </button>
            )}
            {canPost && (
              <button type="button" onClick={() => openEditor()} className={`${primaryBtnCls} ${tapCls}`}>
                New update
              </button>
            )}
          </div>
        }
      />

      {unmarked.length > 1 && (
        <div className="mb-4">
          <ErrorText>{errorText(markRead.error, 'Could not mark the updates as read.')}</ErrorText>
        </div>
      )}

      {posts.isPending ? (
        <PageLoading />
      ) : posts.error ? (
        <Panel>
          <ErrorText>{errorText(posts.error, 'Couldn’t load the updates.')}</ErrorText>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">
            {canPost ? 'Nothing posted yet. Write the first update.' : 'No updates for you yet.'}
          </p>
        </Panel>
      ) : (
        <ul className="max-w-3xl space-y-4">
          {rows.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              names={names}
              uid={user.id}
              canManage={canManage(post)}
              onRead={(id) => markRead.mutate([id])}
              onEdit={openEditor}
              onDelete={(id) => remove.mutateAsync(id)}
              readProblem={
                unmarked.length === 1 && unmarked[0] === post.id
                  ? errorText(markRead.error, 'Could not mark this as read.')
                  : ''
              }
            />
          ))}
        </ul>
      )}
    </>
  )
}
