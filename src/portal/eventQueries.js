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
  one: (id) => ['events', 'one', id],
}

// Every flip of an event's Published switch, for telling whether one is still
// on its way to the database.
const PUBLISH_KEY = ['event-publish']

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
    queryKey: eventKeys.one(id),
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
  const readAgain = () => qc.invalidateQueries({ queryKey: eventKeys.all() })
  const flipping = () => qc.isMutating({ mutationKey: PUBLISH_KEY })
  // Everything is read again after a write, unless a flip of Published is
  // still on its way: an answer read now would put the switch back where the
  // database still has it. The flip reads everything again when it ends.
  const done = () => (flipping() > 0 ? undefined : readAgain())
  const create = useMutation({ mutationFn: createEvent, onSuccess: done })
  const update = useMutation({
    mutationFn: ({ id, patch }) => updateEvent(id, patch),
    onSuccess: (row) => {
      // The event's own page shows what was stored at once, before it is read
      // again. A flip still on its way keeps the switch where it was put.
      qc.setQueryData(eventKeys.one(row.id), (shown) =>
        shown && flipping() > 0 ? { ...row, published: shown.published } : row,
      )
      return done()
    },
  })
  const remove = useMutation({ mutationFn: deleteEvent, onSuccess: done })
  // Takes { id, published }: the Published switch on the event's page. The
  // switch moves the moment it is flipped: the cached event takes the new
  // value first, and gets the old one back if the save fails. Flips made in a
  // row are saved one after the other (the scope), so the last of them is the
  // one that stands, and everything is read again only after that one, so the
  // screen ends on what the database holds. When the first of two fails, the
  // switch is not put back: the second was made on top of it.
  const publish = useMutation({
    mutationKey: PUBLISH_KEY,
    scope: { id: PUBLISH_KEY.join(':') },
    mutationFn: ({ id, published }) => updateEvent(id, { published }),
    onMutate: async ({ id, published }) => {
      await qc.cancelQueries({ queryKey: eventKeys.one(id) })
      const before = qc.getQueryData(eventKeys.one(id))
      if (before) qc.setQueryData(eventKeys.one(id), { ...before, published })
      return { was: before?.published }
    },
    onError: (_err, { id }, context) => {
      // This flip still counts as one in progress here, so 1 means no later
      // flip is waiting behind it.
      if (typeof context?.was === 'boolean' && flipping() === 1) {
        qc.setQueryData(eventKeys.one(id), (shown) => (shown ? { ...shown, published: context.was } : shown))
      }
    },
    onSettled: () => (flipping() > 1 ? undefined : readAgain()),
  })
  return { create, update, remove, publish }
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
  let blob
  try {
    blob = await resizeImage(file, IMAGE_PX, IMAGE_QUALITY)
  } catch {
    // The browser could not open the file as a picture. This sentence is the
    // site's own, so it is marked as one to show as written (errorText.js).
    const refusal = new Error('That file could not be read as a picture. Choose a JPEG, a PNG or a WebP file.')
    refusal.rejected = true
    throw refusal
  }
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
