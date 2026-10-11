import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { errorText } from '../lib/errorText.js'
import { photoUrl } from '../lib/gallery.js'

// Gallery editor reads and writes (PNSD officers and the EB). Same shape as
// officerQueries.js: plain async functions first, react-query hooks under
// them. Authorisation lives in the database (row-level security on albums,
// gallery_photos and the Storage bucket); these helpers only decide what to
// fetch and how to shape an upload.
//
// Files: every photo is a pair in the public `gallery` bucket,
//   <album id>/<photo id>-thumb.jpg   600 px, the grid
//   <album id>/<photo id>-full.jpg    1600 px, the lightbox and share cards
// made here in the browser (canvas) before upload. The row's `path` is the
// prefix without the suffix.

const BUCKET = 'gallery'
const THUMB_WIDTH = 600
const FULL_WIDTH = 1600
const BIN_DAYS = 30

export const galleryKeys = {
  albums: () => ['gallery', 'albums'],
  photos: (albumId) => ['gallery', 'photos', albumId],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export { photoUrl }

// A caught error as a sentence to show an editor. errorText does the choosing
// (src/lib/errorText.js): no connection, no permission, a refusal the database
// wrote, or `fallback`, the caller's own words for what failed. The gallery's
// database functions word a refusal with no capital and no full stop ("the
// link /gallery/aswan already belongs to another album"), so the sentence is
// finished here.
export function galleryError(err, fallback) {
  const said = errorText(err, fallback)
  const text = said.charAt(0).toUpperCase() + said.slice(1)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

// An error in words of our own, for the editor to read: errorText shows it as
// written, where any other thrown Error would give way to the fallback.
function refusal(message) {
  return Object.assign(new Error(message), { rejected: true })
}

// ---- changes that show at once -----------------------------------------------

// `rows` with each entry of `changes` (a Map of row id to fields) laid over
// its row.
function overlay(rows, changes) {
  return rows.map((r) => (changes.has(r.id) ? { ...r, ...changes.get(r.id) } : r))
}

// The options of a mutation that shows its change before it is saved, for a
// switch that should answer the click and not the server: a photo hidden, an
// album published. It is called with { id, patch }, and optionally `shown`,
// fields that go with the patch on screen only (a joined label).
//
// The cached list under `queryKey` is changed first. If the save fails the
// change is put back, field by field, unless a later change has shown
// something else in that field since, in which case that one stands. Changes
// are sent one at a time, in the order they were made, so two quick changes to
// one row cannot land the wrong way round; and the list is read again only
// after the last of them, since a read taken in between would show the row
// without the ones still on their way.
//
// `ripple(rows, id, patch)` names the other rows the database will change with
// this one, as [id, fields] pairs; `arrange` puts a changed list back in the
// order it is read in; `reload` reads everything the change touches again.
function shownAtOnce(qc, { queryKey, mutationKey, write, ripple, arrange = (rows) => rows, reload }) {
  return {
    mutationKey,
    scope: { id: mutationKey.join('/') },
    mutationFn: ({ id, patch }) => write(id, patch),
    onMutate: async ({ id, patch, shown }) => {
      await qc.cancelQueries({ queryKey })
      const rows = qc.getQueryData(queryKey)
      if (!rows?.some((r) => r.id === id)) return undefined
      const changes = new Map(ripple ? ripple(rows, id, patch) : [])
      changes.set(id, { ...patch, ...shown })
      // What each of those fields held, to put back if the save fails.
      const was = new Map()
      for (const r of rows) {
        if (changes.has(r.id)) was.set(r.id, Object.fromEntries(Object.keys(changes.get(r.id)).map((k) => [k, r[k]])))
      }
      qc.setQueryData(queryKey, arrange(overlay(rows, changes)))
      return { was }
    },
    onError: (_err, _change, context) => {
      const rows = qc.getQueryData(queryKey)
      if (!context?.was || !rows) return
      // What the changes made after this one, and still on their way, noted
      // down to go back to. Oldest first; the ones before it have all landed.
      const later = qc
        .getMutationCache()
        .findAll({ mutationKey, exact: true, status: 'pending' })
        .map((m) => m.state.context?.was)
        .filter((theirs) => theirs && theirs !== context.was)
      // A field no later change has touched goes back now. Where one has, its
      // value stands; but what that change noted down to go back to is the
      // value this one showed, which was never saved. It is handed what this
      // one had noted instead, so that if it fails as well the field ends on
      // what the database holds.
      const back = new Map()
      for (const [rowId, fields] of context.was) {
        for (const [field, before] of Object.entries(fields)) {
          const next = later.find((theirs) => theirs.has(rowId) && field in theirs.get(rowId))
          if (next) next.get(rowId)[field] = before
          else back.set(rowId, { ...back.get(rowId), [field]: before })
        }
      }
      if (back.size > 0) qc.setQueryData(queryKey, arrange(overlay(rows, back)))
    },
    // This change still counts as on its way here: 1 means it is the last.
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) === 1) reload()
    },
  }
}

// ---- albums ----------------------------------------------------------------

// `archived_term` is the term an album is archived under (null while it is in
// the gallery); the board archives a term's albums at the rollover, and an
// editor can move one album either way.
const ALBUM_SELECT =
  'id, slug, title, blurb, cover_photo_id, sort_order, published, created_at, updated_at, archived_term_id, archived_term:terms(label)'

// Every album plus, for the list page, its visible photo count and a cover thumb.
async function fetchAlbums() {
  const albums = unwrap(
    await supabase.from('albums').select(ALBUM_SELECT).order('sort_order').order('created_at'),
  )
  const photos = unwrap(
    await supabase
      .from('gallery_photos')
      .select('id, album_id, path, featured, hidden, deleted_at, sort_order, created_at')
      .is('deleted_at', null)
      .order('sort_order')
      .order('created_at'),
  )
  const byAlbum = new Map()
  for (const p of photos || []) {
    if (!byAlbum.has(p.album_id)) byAlbum.set(p.album_id, [])
    byAlbum.get(p.album_id).push(p)
  }
  return (albums || []).map((a) => {
    const list = byAlbum.get(a.id) || []
    const visible = list.filter((p) => !p.hidden)
    const chosen = visible.find((p) => p.id === a.cover_photo_id)
    const cover = chosen || visible.find((p) => p.featured) || visible[0] || null
    return {
      ...a,
      photoCount: list.length,
      visibleCount: visible.length,
      cover: cover ? photoUrl(cover.path, 'thumb') : null,
    }
  })
}

export function useAlbums(enabled = true) {
  return useQuery({ queryKey: galleryKeys.albums(), queryFn: fetchAlbums, enabled })
}

// The current term: an album moved to the archive by hand is filed under it.
export function useCurrentTerm() {
  return useQuery({
    queryKey: ['terms', 'current'],
    queryFn: async () =>
      unwrap(await supabase.from('terms').select('id, label').eq('is_current', true).maybeSingle()),
  })
}

async function createAlbum(fields) {
  return unwrap(
    await supabase
      .from('albums')
      .insert({ title: fields.title, blurb: fields.blurb || '', slug: fields.slug || '' })
      .select(ALBUM_SELECT)
      .single(),
  )
}

async function updateAlbum(id, patch) {
  return unwrap(await supabase.from('albums').update(patch).eq('id', id).select(ALBUM_SELECT).single())
}

// Removes the album's files first (the row cascade takes the photo rows), so
// nothing is left in the bucket.
async function deleteAlbum(id) {
  await removeFolder(id)
  unwrap(await supabase.from('albums').delete().eq('id', id))
  return id
}

// New shelf order: the array of album ids, first to last. The rows are written
// together, so a drop is saved in one round trip's time however long the shelf.
async function reorderAlbums(ids) {
  const results = await Promise.all(
    ids.map((id, i) => supabase.from('albums').update({ sort_order: i }).eq('id', id)),
  )
  results.forEach(unwrap)
  return ids
}

const albumSetKey = [...galleryKeys.albums(), 'set']

// Reads the shelf again after something other than `set` (below) changed it.
// While a change from `set` is still on its way this does nothing: a read
// taken now would show the album without that change, the Published switch
// flipping back for a moment, and the change reads the shelf again itself once
// it has landed.
function reloadAlbums(qc) {
  if (qc.isMutating({ mutationKey: albumSetKey, exact: true }) === 0) qc.invalidateQueries({ queryKey: galleryKeys.albums() })
}

export function useAlbumMutations() {
  const qc = useQueryClient()
  const shelf = galleryKeys.albums()
  const done = () => reloadAlbums(qc)
  // create, update and remove put what the database answered straight onto the
  // cached shelf, and none of them waits for the shelf to be read again. The
  // page can then go on at once (open the new album, say "Saved."), and it
  // goes on rightly even if that read is slow or fails: with no connection a
  // read is tried again for many seconds before it gives up.
  const create = useMutation({
    mutationFn: createAlbum,
    onSuccess: (row) => {
      qc.setQueryData(shelf, (rows) =>
        rows && !rows.some((a) => a.id === row.id) ? [...rows, { ...row, photoCount: 0, visibleCount: 0, cover: null }] : rows,
      )
      done()
    },
  })
  // Only the fields that were sent are taken from the row handed back: it also
  // carries the settings `set` looks after, as they stood before a change of
  // theirs that may still be on its way.
  const update = useMutation({
    mutationFn: ({ id, patch }) => updateAlbum(id, patch),
    onSuccess: (row, { patch }) => {
      const kept = Object.fromEntries(Object.keys(patch).map((field) => [field, row[field]]))
      qc.setQueryData(shelf, (rows) => rows?.map((a) => (a.id === row.id ? { ...a, ...kept } : a)))
      done()
    },
  })
  const remove = useMutation({
    mutationFn: deleteAlbum,
    onSuccess: (id) => {
      qc.setQueryData(shelf, (rows) => rows?.filter((a) => a.id !== id))
      done()
    },
  })
  // The list shows the new order the moment a row is dropped: the cached shelf
  // is put in that order first, and put back if the save fails. Either way the
  // shelf is read again afterwards, so the screen ends on what the database holds.
  const reorder = useMutation({
    mutationFn: reorderAlbums,
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: galleryKeys.albums() })
      const before = qc.getQueryData(galleryKeys.albums())
      if (before) {
        // `ids` is the gallery's shelf; archived albums are not on it and keep their place.
        const byId = new Map(before.map((a) => [a.id, a]))
        const moved = new Set(ids)
        const next = ids.map((id, i) => byId.get(id) && { ...byId.get(id), sort_order: i }).filter(Boolean)
        if (next.length === moved.size) {
          qc.setQueryData(galleryKeys.albums(), [...next, ...before.filter((a) => !moved.has(a.id))])
        }
      }
      return { before }
    },
    onError: (_err, _ids, context) => {
      if (context?.before) qc.setQueryData(galleryKeys.albums(), context.before)
    },
    onSettled: done,
  })
  // One setting of an album that takes effect the moment it is changed: the
  // Published switch, the cover, the archive it is filed under. It shows at
  // once and goes back if the save fails (see shownAtOnce). `update` above is
  // for the details form, which waits for the row the database hands back: the
  // link in it is tidied there, and may be refused.
  const set = useMutation(
    shownAtOnce(qc, {
      queryKey: shelf,
      mutationKey: albumSetKey,
      write: updateAlbum,
      // Called by the last change on its way, which still counts as one: it
      // reads the shelf whatever reloadAlbums would say.
      reload: () => qc.invalidateQueries({ queryKey: shelf }),
    }),
  )
  return { create, update, remove, reorder, set }
}

// ---- photos ----------------------------------------------------------------

const PHOTO_SELECT =
  'id, album_id, path, width, height, sort_order, label, featured, hidden, deleted_at, created_at'

function shapePhoto(p) {
  return { ...p, thumb: photoUrl(p.path, 'thumb'), full: photoUrl(p.path, 'full') }
}

// Every photo of the album, bin included, in display order (featured first).
async function fetchPhotos(albumId) {
  const rows = unwrap(
    await supabase
      .from('gallery_photos')
      .select(PHOTO_SELECT)
      .eq('album_id', albumId)
      .order('featured', { ascending: false })
      .order('sort_order')
      .order('created_at'),
  )
  return (rows || []).map(shapePhoto)
}

export function useAlbumPhotos(albumId) {
  return useQuery({
    queryKey: galleryKeys.photos(albumId),
    queryFn: () => fetchPhotos(albumId),
    enabled: Boolean(albumId),
  })
}

async function updatePhoto(id, patch) {
  return shapePhoto(
    unwrap(await supabase.from('gallery_photos').update(patch).eq('id', id).select(PHOTO_SELECT).single()),
  )
}

function objectPaths(path) {
  return [`${path}-thumb.jpg`, `${path}-full.jpg`]
}

// Files then row, so a failure never leaves a row pointing at nothing.
async function purgePhoto(photo) {
  const { error } = await supabase.storage.from(BUCKET).remove(objectPaths(photo.path))
  if (error) throw error
  unwrap(await supabase.from('gallery_photos').delete().eq('id', photo.id))
  return photo.id
}

// Everything under <album id>/ in the bucket, in pages of 100.
async function removeFolder(albumId) {
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(albumId, { limit: 100 })
    if (error) throw error
    if (!data || data.length === 0) return
    const names = data.map((o) => `${albumId}/${o.name}`)
    const rm = await supabase.storage.from(BUCKET).remove(names)
    if (rm.error) throw rm.error
    if (data.length < 100) return
  }
}

// Binned photos older than BIN_DAYS go for good. Runs when an editor opens an
// album, so the bin empties itself without a scheduled job.
export async function purgeExpired(albumId) {
  const cutoff = new Date(Date.now() - BIN_DAYS * 86400000).toISOString()
  const rows = unwrap(
    await supabase
      .from('gallery_photos')
      .select('id, path')
      .eq('album_id', albumId)
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff),
  )
  for (const p of rows || []) await purgePhoto(p)
  return (rows || []).length
}

// The order fetchPhotos asks the database for, for a list that was changed
// here before it is read again: the featured photo first, then by place.
function inDisplayOrder(photos) {
  return [...photos].sort(
    (a, b) =>
      Number(b.featured) - Number(a.featured) ||
      a.sort_order - b.sort_order ||
      (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0),
  )
}

const photoChangeKey = (albumId) => [...galleryKeys.photos(albumId), 'update']

// The database keeps one featured photo to an album (the single_featured_photo
// trigger): featuring one takes the banner from whichever had it.
function unfeatureOthers(photos, id, patch) {
  if (!patch.featured) return []
  return photos.filter((p) => p.featured && p.id !== id).map((p) => [p.id, { featured: false }])
}

export function usePhotoMutations(albumId) {
  const qc = useQueryClient()
  // The shelf is read again too, for its photo counts and cover.
  const done = useCallback(() => {
    qc.invalidateQueries({ queryKey: galleryKeys.photos(albumId) })
    reloadAlbums(qc)
  }, [qc, albumId])
  // Everything an editor does to a photo short of deleting it for good (hide,
  // feature, label, to the bin and back) shows at once: see shownAtOnce.
  const update = useMutation(
    shownAtOnce(qc, {
      queryKey: galleryKeys.photos(albumId),
      mutationKey: photoChangeKey(albumId),
      write: updatePhoto,
      ripple: unfeatureOthers,
      arrange: inDisplayOrder,
      reload: done,
    }),
  )
  // Reads the album again after something other than `update` changed it (an
  // upload, a delete). While a change from `update` is still on its way this
  // does nothing: a read taken now would show the photo without that change,
  // and the change reads everything again itself once it has landed.
  const reload = useCallback(() => {
    if (qc.isMutating({ mutationKey: photoChangeKey(albumId) }) === 0) done()
  }, [qc, albumId, done])
  // Deleting for good is not shown before it has happened. Once it has, the
  // photo leaves the list without waiting for the list to be read again.
  const purge = useMutation({
    mutationFn: purgePhoto,
    onSuccess: (id) => {
      qc.setQueryData(galleryKeys.photos(albumId), (rows) => rows?.filter((p) => p.id !== id))
      reload()
    },
  })
  return { update, purge, reload }
}

// ---- upload ----------------------------------------------------------------

// The picked file decoded with its EXIF orientation applied (phones store
// portrait shots sideways plus a rotation flag). createImageBitmap does that
// natively; the <img> route is the fallback for browsers without it.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(refusal('That file could not be read as an image'))
    }
    img.src = url
  })
}

function scaled(source, maxWidth, quality) {
  const sw = source.width || source.naturalWidth
  const sh = source.height || source.naturalHeight
  const scale = Math.min(1, maxWidth / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, w, h)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, w, h }) : reject(refusal('Could not encode the image'))),
      'image/jpeg',
      quality,
    )
  })
}

// One photo file -> its thumb and full JPEGs.
export async function makePhotoPair(file) {
  const source = await decodeImage(file)
  try {
    const full = await scaled(source, FULL_WIDTH, 0.85)
    const thumb = await scaled(source, THUMB_WIDTH, 0.8)
    return { full, thumb }
  } finally {
    if (typeof source.close === 'function') source.close()
  }
}

function randomId() {
  try {
    return crypto.randomUUID()
  } catch {
    // RFC 4122 v4 from Math.random: only for browsers without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }
}

async function putObject(path, blob) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
}

// Uploads one file into the album: resize, put both files, insert the row.
// A failed insert removes the files again so the bucket never holds orphans.
export async function uploadPhoto(albumId, file, sortOrder) {
  const { full, thumb } = await makePhotoPair(file)
  const id = randomId()
  const path = `${albumId}/${id}`
  await putObject(`${path}-full.jpg`, full.blob)
  try {
    await putObject(`${path}-thumb.jpg`, thumb.blob)
    return shapePhoto(
      unwrap(
        await supabase
          .from('gallery_photos')
          .insert({ id, album_id: albumId, path, width: full.w, height: full.h, sort_order: sortOrder })
          .select(PHOTO_SELECT)
          .single(),
      ),
    )
  } catch (err) {
    await supabase.storage.from(BUCKET).remove(objectPaths(path))
    throw err
  }
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export function isAcceptedImage(file) {
  if (ACCEPTED_TYPES.includes(file.type)) return true
  // Some browsers leave `type` blank for HEIC; go by the name.
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')
}
