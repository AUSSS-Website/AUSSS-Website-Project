import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useCommittees } from './officerQueries.js'

// Phase 3 reads and writes: tasks and their timeline, updates (posts) and read
// receipts, the notifications feed. Same shape as queries.js: plain async
// functions first, react-query hooks underneath. Who may see or change what is
// decided by RLS and the triggers in the two 20260920200x migrations; the
// helpers here only decide what to fetch and which buttons to offer.

export const workKeys = {
  tasks: (uid) => ['tasks', uid],
  task: (id) => ['task', id],
  assignable: (committeeId) => ['task-assignable', committeeId || 'society'],
  names: (ids) => ['names', ids],
  posts: (uid) => ['posts', uid],
  audience: (postId) => ['post-audience', postId],
  notifications: (uid) => ['notifications', uid],
  unreadCount: (uid) => ['notifications', uid, 'unread'],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// ---- who may hand out work / publish where ---------------------------------

// Committees the signed-in person can create tasks in (`task`) or post to
// (`post`). `society` = the null-committee, EB-only scope. Mirrors
// app.can_assign_tasks_in / app.is_officer_of; the database has the last word.
export function useWorkScopes() {
  const { isEB, assignments } = useAuth()
  const all = useCommittees(isEB)
  return useMemo(() => {
    if (isEB) {
      const list = all.data || []
      return { loading: all.isPending, society: true, task: list, post: list }
    }
    const seen = new Map()
    const task = []
    const post = []
    for (const a of assignments) {
      const pos = a.position
      const c = pos?.committee
      if (!c) continue
      const officer = pos.level === 'officer'
      if (officer && !post.some((x) => x.id === c.id)) post.push(c)
      if ((officer || pos.can_assign_tasks) && !seen.has(c.id)) {
        seen.set(c.id, true)
        task.push(c)
      }
    }
    return { loading: false, society: false, task, post }
  }, [isEB, assignments, all.data, all.isPending])
}

// ---- names -----------------------------------------------------------------

// profiles RLS hides members from each other, so timelines resolve the ids
// they already hold through rpc/profile_names (name + avatar only).
export async function fetchNames(ids) {
  if (!ids.length) return {}
  const rows = unwrap(await supabase.rpc('profile_names', { ids }))
  const out = {}
  for (const r of rows || []) out[r.id] = r
  return out
}

export function useNames(ids) {
  const key = useMemo(() => [...new Set((ids || []).filter(Boolean))].sort(), [ids])
  const q = useQuery({
    queryKey: workKeys.names(key),
    queryFn: () => fetchNames(key),
    enabled: key.length > 0,
    staleTime: 5 * 60 * 1000,
  })
  return q.data || {}
}

// ---- tasks -----------------------------------------------------------------

const TASK_SELECT =
  'id, title, body, status, priority, due_on, completed_at, committee_id, created_by, created_at, updated_at, committee:committees(id,slug,abbr,name,color), assignees:task_assignees(profile_id)'

export async function fetchTasks() {
  const rows = unwrap(
    await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .order('due_on', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(400),
  )
  return rows || []
}

export async function fetchTask(id) {
  const [task, updates] = await Promise.all([
    supabase.from('tasks').select(TASK_SELECT).eq('id', id).maybeSingle(),
    supabase
      .from('task_updates')
      .select('id, author_id, kind, body, meta, created_at')
      .eq('task_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ])
  const row = unwrap(task)
  if (!row) return null
  return { ...row, updates: unwrap(updates) || [] }
}

export async function fetchAssignable(committeeId) {
  const rows = unwrap(
    await supabase.rpc('task_assignable_people', { committee: committeeId || null }),
  )
  return (rows || []).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
}

async function addAssignees(taskId, ids) {
  if (!ids.length) return
  unwrap(
    await supabase
      .from('task_assignees')
      .insert(ids.map((profile_id) => ({ task_id: taskId, profile_id }))),
  )
}

// fields: { committee_id, title, body, priority, due_on, status }
export async function createTask({ assignees = [], ...fields }) {
  const row = unwrap(await supabase.from('tasks').insert(fields).select('id').single())
  await addAssignees(row.id, assignees)
  return row
}

// `assignees` (when given) is the wanted set; only the difference is written,
// so the timeline shows who was added and who was dropped.
export async function updateTask({ id, assignees, previousAssignees = [], ...patch }) {
  if (Object.keys(patch).length) {
    unwrap(await supabase.from('tasks').update(patch).eq('id', id).select('id').single())
  }
  if (assignees) {
    const add = assignees.filter((p) => !previousAssignees.includes(p))
    const drop = previousAssignees.filter((p) => !assignees.includes(p))
    await addAssignees(id, add)
    if (drop.length) {
      unwrap(
        await supabase.from('task_assignees').delete().eq('task_id', id).in('profile_id', drop),
      )
    }
  }
}

export async function deleteTask(id) {
  unwrap(await supabase.from('tasks').delete().eq('id', id))
}

export async function addTaskComment({ task_id, body }) {
  unwrap(await supabase.from('task_updates').insert({ task_id, body }))
}

export function useTasks() {
  const { user } = useAuth()
  return useQuery({ queryKey: workKeys.tasks(user.id), queryFn: fetchTasks })
}

export function useTask(id) {
  return useQuery({
    queryKey: workKeys.task(id),
    queryFn: () => fetchTask(id),
    enabled: Boolean(id),
  })
}

export function useAssignable(committeeId, enabled = true) {
  return useQuery({
    queryKey: workKeys.assignable(committeeId),
    queryFn: () => fetchAssignable(committeeId),
    enabled,
  })
}

// One hook for every task write: they all invalidate the same two caches.
export function useTaskMutations() {
  const qc = useQueryClient()
  const onSettled = (_d, _e, vars) => {
    qc.invalidateQueries({ queryKey: ['tasks'] })
    const id = typeof vars === 'string' ? vars : vars?.id || vars?.task_id
    if (id) qc.invalidateQueries({ queryKey: workKeys.task(id) })
  }
  return {
    create: useMutation({ mutationFn: createTask, onSettled }),
    update: useMutation({ mutationFn: updateTask, onSettled }),
    remove: useMutation({ mutationFn: deleteTask, onSettled }),
    comment: useMutation({ mutationFn: addTaskComment, onSettled }),
  }
}

// ---- updates (posts) -------------------------------------------------------

const POST_SELECT =
  'id, committee_id, kind, title, body, levels, pinned, publish_at, expires_at, author_id, created_at, committee:committees(id,slug,abbr,name,color), reads:post_reads(profile_id)'

// Pinned first, then drafts (only their managers receive them), then newest.
export async function fetchPosts() {
  const rows = unwrap(
    await supabase.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(80),
  )
  const stamp = (p) => (p.publish_at ? Date.parse(p.publish_at) : Infinity)
  return (rows || []).sort((a, b) => Number(b.pinned) - Number(a.pinned) || stamp(b) - stamp(a))
}

export async function savePost({ id, ...fields }) {
  if (id) {
    unwrap(await supabase.from('posts').update(fields).eq('id', id).select('id').single())
    return
  }
  unwrap(await supabase.from('posts').insert(fields).select('id').single())
}

export async function deletePost(id) {
  unwrap(await supabase.from('posts').delete().eq('id', id))
}

// Receipts are insert-only; a second visit is a harmless duplicate.
export async function markPostsRead({ uid, ids }) {
  if (!ids.length) return
  unwrap(
    await supabase.from('post_reads').upsert(
      ids.map((post_id) => ({ post_id, profile_id: uid })),
      { onConflict: 'post_id,profile_id', ignoreDuplicates: true },
    ),
  )
}

export async function fetchPostAudience(postId) {
  return unwrap(await supabase.rpc('post_audience', { post: postId })) || []
}

export function isPostLive(post, now = Date.now()) {
  return (
    Boolean(post.publish_at) &&
    Date.parse(post.publish_at) <= now &&
    (!post.expires_at || Date.parse(post.expires_at) > now)
  )
}

export function usePosts() {
  const { user } = useAuth()
  return useQuery({ queryKey: workKeys.posts(user.id), queryFn: fetchPosts })
}

export function usePostAudience(postId, enabled) {
  return useQuery({
    queryKey: workKeys.audience(postId),
    queryFn: () => fetchPostAudience(postId),
    enabled: Boolean(postId) && enabled,
  })
}

export function usePostMutations() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: ['posts'] })
  return {
    save: useMutation({ mutationFn: savePost, onSettled }),
    remove: useMutation({ mutationFn: deletePost, onSettled }),
    markRead: useMutation({
      mutationFn: (ids) => markPostsRead({ uid: user.id, ids }),
      // the dot disappears at once; the refetch confirms it
      onMutate: (ids) => {
        qc.setQueryData(workKeys.posts(user.id), (prev) =>
          (prev || []).map((p) =>
            ids.includes(p.id) && !p.reads.some((r) => r.profile_id === user.id)
              ? { ...p, reads: [...p.reads, { profile_id: user.id }] }
              : p,
          ),
        )
      },
      onSettled,
    }),
  }
}

// ---- notifications ---------------------------------------------------------

export async function fetchNotifications() {
  const rows = unwrap(
    await supabase
      .from('notifications')
      .select('id, kind, payload, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(60),
  )
  return rows || []
}

export async function fetchUnreadCount() {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw error
  return count || 0
}

// ids omitted = everything unread
export async function markNotificationsRead(ids) {
  let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  if (ids) q = q.in('id', ids)
  unwrap(await q)
}

export function useNotifications() {
  const { user } = useAuth()
  return useQuery({ queryKey: workKeys.notifications(user.id), queryFn: fetchNotifications })
}

// Polled once a minute while the portal is open; cheap (a head count on a
// partial index) and it keeps the nav badge honest without Realtime.
export function useUnreadCount() {
  const { user } = useAuth()
  return useQuery({
    queryKey: workKeys.unreadCount(user.id),
    queryFn: fetchUnreadCount,
    refetchInterval: 60 * 1000,
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markNotificationsRead,
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
