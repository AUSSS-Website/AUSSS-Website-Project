import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { resizeImage } from '../lib/resizeImage.js'

// Events: reads and writes for the committees' officers and the EB. Same shape
// as merchQueries.js. Authorisation lives in the database (row-level security
// on public.events and the `event-media` bucket): an officer reads and writes
// their committee's events, the EB every event and the society-wide ones.
//
// Pictures: an event's picture is a JPEG made here in the browser, in the
// public `event-media` bucket at '<event id>/<random>.jpg'. A new picture is a
// new file; the old one is removed once the row points at the new one.

const BUCKET = 'event-media'
const IMAGE_PX = 1600
const IMAGE_QUALITY = 0.85

export const eventKeys = {
  all: () => ['events'],
  list: (scope) => ['events', 'list', scope],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

const EVENT_SELECT =
  'id, slug, committee_id, title, description, starts_at, ends_at, all_day, days, place, image, signup_url, published, created_at, updated_at, committee:committees(slug, abbr, name, color)'

// `scope`: a committee id, 'society' for the society-wide events, or 'all'
// (what this person may edit; the database narrows it). Newest start first.
async function fetchEvents(scope) {
  let q = supabase.from('events').select(EVENT_SELECT).order('starts_at', { ascending: false })
  if (scope === 'society') q = q.is('committee_id', null)
  else if (scope !== 'all') q = q.eq('committee_id', scope)
  return unwrap(await q) || []
}

export function useEventList(scope, enabled = true) {
  return useQuery({
    queryKey: eventKeys.list(scope),
    queryFn: () => fetchEvents(scope),
    enabled: enabled && Boolean(scope),
  })
}

async function fetchEvent(id) {
  return unwrap(await supabase.from('events').select(EVENT_SELECT).eq('id', id).maybeSingle())
}

export function useEvent(id) {
  return useQuery({
    queryKey: ['events', 'one', id],
    queryFn: () => fetchEvent(id),
    enabled: Boolean(id),
  })
}

// A new event starts as a draft; the database makes its link from the title.
// `schedule` is the columns of when it happens (schedulePatch in
// eventSchedule.js).
async function createEvent({ committeeId, title, schedule }) {
  return unwrap(
    await supabase
      .from('events')
      .insert({ committee_id: committeeId || null, title, ...schedule, published: false })
      .select(EVENT_SELECT)
      .single(),
  )
}

async function updateEvent(id, patch) {
  return unwrap(await supabase.from('events').update(patch).eq('id', id).select(EVENT_SELECT).single())
}

// Removes the event's uploaded pictures first, then the row.
async function deleteEvent(ev) {
  await removeFolder(ev.id)
  unwrap(await supabase.from('events').delete().eq('id', ev.id))
  return ev.id
}

export function useEventMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: eventKeys.all() })
  const create = useMutation({ mutationFn: createEvent, onSuccess: done })
  const update = useMutation({ mutationFn: ({ id, patch }) => updateEvent(id, patch), onSuccess: done })
  const remove = useMutation({ mutationFn: deleteEvent, onSuccess: done })
  return { create, update, remove }
}

// ---- pictures --------------------------------------------------------------

async function removeFolder(eventId) {
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(eventId, { limit: 100 })
    if (error) throw error
    if (!data || data.length === 0) return
    const rm = await supabase.storage.from(BUCKET).remove(data.map((o) => `${eventId}/${o.name}`))
    if (rm.error) throw rm.error
    if (data.length < 100) return
  }
}

const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`

// The object path of a picture in the bucket, or null for any other address.
function objectPath(url) {
  const i = typeof url === 'string' ? url.indexOf(PUBLIC_PREFIX) : -1
  return i === -1 ? null : decodeURIComponent(url.slice(i + PUBLIC_PREFIX.length))
}

function randomName() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Shrinks the file, uploads it under the event's folder and answers with its
// public address.
export async function uploadEventImage(eventId, file) {
  const blob = await resizeImage(file, IMAGE_PX, IMAGE_QUALITY)
  const path = `${eventId}/${randomName()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// Best effort: a picture the row no longer points at. A failure leaves a
// stray file, never a broken event.
export async function removeEventImage(url) {
  const path = objectPath(url)
  if (path) await supabase.storage.from(BUCKET).remove([path])
}
