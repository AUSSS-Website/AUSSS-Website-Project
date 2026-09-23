import { useMemo, useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import {
  isPostLive,
  useNames,
  usePostAudience,
  usePostMutations,
  usePosts,
  useWorkScopes,
} from '../../workQueries.js'
import { Centered, ErrorText, PageHeader, Panel, Spinner, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { CommitteeTag, LEVEL_LABELS, POST_KIND_LABEL, RichText, UnreadDot, personName, when } from '../../workUi.jsx'
import PostEditor from './PostEditor.jsx'

// /portal/updates. The feed of posts addressed to this person (the database
// decides), newest first with pinned ones on top. Opening a long post, or pressing
// "Mark as read", leaves a receipt; the post's managers (committee officers,
// EB) see the count and, on demand, exactly who has and has not read it.

const EMPTY = []
const LONG = 420 // characters before a body is folded

function stateLabel(post) {
  if (!post.publish_at) return 'Draft'
  if (Date.parse(post.publish_at) > Date.now()) return `Scheduled for ${when(post.publish_at)}`
  if (post.expires_at && Date.parse(post.expires_at) <= Date.now()) return 'Expired'
  return ''
}

function Audience({ postId }) {
  const audience = usePostAudience(postId, true)
  if (audience.isPending) return <Spinner className="h-5 w-5" />
  if (audience.error) return <ErrorText>{audience.error.message}</ErrorText>
  const unread = audience.data.filter((p) => !p.read_at)
  const read = audience.data.filter((p) => p.read_at)
  const list = (people) => people.map((p) => p.full_name || 'No name yet').join(', ')
  return (
    <div className="space-y-3 text-xs text-silver/70">
      <p>
        <span className="font-semibold text-white">Not yet ({unread.length}):</span>{' '}
        {unread.length ? list(unread) : 'Everyone has read it.'}
      </p>
      {read.length > 0 && (
        <p>
          <span className="font-semibold text-white">Read ({read.length}):</span> {list(read)}
        </p>
      )}
    </div>
  )
}

function PostCard({ post, names, uid, canManage, onRead, onEdit, onDelete, deleting }) {
  const isRead = post.reads.some((r) => r.profile_id === uid)
  const live = isPostLive(post)
  const long = post.body.length > LONG
  const [open, setOpen] = useState(false)
  const [showAudience, setShowAudience] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const label = stateLabel(post)
  const levels = LEVEL_LABELS.filter(([v]) => post.levels.includes(v)).map(([, l]) => l)

  const expand = () => {
    setOpen(true)
    if (!isRead && live) onRead(post.id)
  }

  return (
    <li className={`rounded-2xl border bg-forest-800 p-5 ${isRead || !live ? 'border-white/10' : 'border-medical/50'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-silver/55">
        {!isRead && live && <UnreadDot />}
        <CommitteeTag committee={post.committee} />
        <span className="font-semibold uppercase tracking-[0.14em] text-medical-light">
          {POST_KIND_LABEL[post.kind] || post.kind}
        </span>
        {post.pinned && <span className="font-semibold text-amber-300">Pinned</span>}
        {label && <span className="font-semibold text-amber-300">{label}</span>}
        {levels.length > 0 && <span>For {levels.join(', ').toLowerCase()}</span>}
      </div>

      <h2 className="mt-3 text-lg font-semibold text-white">{post.title}</h2>
      <p className="mt-1 text-xs text-silver/50">
        {personName(names, post.author_id, 'AUSSS')} · {when(post.publish_at || post.created_at)}
      </p>

      {post.body && (
        <>
          <RichText
            text={long && !open ? `${post.body.slice(0, LONG).trimEnd()}…` : post.body}
            className="mt-4 text-sm text-silver/85"
          />
          {long && !open && (
            <button type="button" onClick={expand} className="mt-2 text-sm font-semibold text-medical-light hover:text-white">
              Read more &rarr;
            </button>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {!isRead && live && (!long || open) && (
          <button type="button" onClick={() => onRead(post.id)} className={outlineBtnCls}>
            Mark as read
          </button>
        )}
        {canManage && (
          <>
            <button
              type="button"
              aria-expanded={showAudience}
              onClick={() => setShowAudience((v) => !v)}
              className="text-xs font-semibold text-silver/60 hover:text-white"
            >
              Read by {post.reads.length} · {showAudience ? 'hide who' : 'show who'}
            </button>
            <button type="button" onClick={() => onEdit(post)} className="text-xs font-semibold text-silver/60 hover:text-white">
              Edit
            </button>
            {confirming ? (
              <>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => onDelete(post.id)}
                  className="text-xs font-semibold text-red-300 hover:text-red-200"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="text-xs font-semibold text-silver/60 hover:text-white">
                  Keep
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="text-xs font-semibold text-silver/60 hover:text-white">
                Delete
              </button>
            )}
          </>
        )}
      </div>

      {canManage && showAudience && (
        <div className="mt-4 border-t border-white/10 pt-4">
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
  const [editor, setEditor] = useState(null) // null | { post? }
  const [error, setError] = useState('')
  const canPost = scopes.society || scopes.post.length > 0

  const rows = posts.data || EMPTY
  const names = useNames(useMemo(() => rows.map((p) => p.author_id), [rows]))
  const unreadIds = rows
    .filter((p) => isPostLive(p) && !p.reads.some((r) => r.profile_id === user.id))
    .map((p) => p.id)

  const canManage = (post) =>
    post.committee_id ? scopes.post.some((c) => c.id === post.committee_id) : scopes.society

  const onDelete = async (id) => {
    setError('')
    try {
      await remove.mutateAsync(id)
    } catch (e) {
      setError(e?.message || 'Could not delete the update.')
    }
  }

  if (editor) {
    return (
      <>
        <PageHeader eyebrow="Updates" title={editor.post ? 'Edit update' : 'New update'} />
        <PostEditor
          post={editor.post}
          scopes={scopes}
          onCancel={() => setEditor(null)}
          onDone={() => setEditor(null)}
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
          <div className="flex items-center gap-2">
            {unreadIds.length > 1 && (
              <button
                type="button"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(unreadIds)}
                className={outlineBtnCls}
              >
                Mark all as read
              </button>
            )}
            {canPost && (
              <button type="button" onClick={() => setEditor({})} className={primaryBtnCls}>
                New update
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {posts.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : posts.error ? (
        <Panel>
          <ErrorText>Couldn’t load updates: {posts.error.message}</ErrorText>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">
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
              onEdit={(p) => setEditor({ post: p })}
              onDelete={onDelete}
              deleting={remove.isPending}
            />
          ))}
        </ul>
      )}
    </>
  )
}
