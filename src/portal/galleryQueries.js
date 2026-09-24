import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
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

// ---- albums ----------------------------------------------------------------

const ALBUM_SELECT = 'id, slug, title, blurb, cover_photo_id, sort_order, published, created_at, updated_at'

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

// New shelf order: the array of album ids, first to last.
async function reorderAlbums(ids) {
  for (let i = 0; i < ids.length; i++) {
    unwrap(await supabase.from('albums').update({ sort_order: i }).eq('id', ids[i]))
  }
  return ids
}

export function useAlbumMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: galleryKeys.albums() })
  const create = useMutation({ mutationFn: createAlbum, onSuccess: done })
  const update = useMutation({ mutationFn: ({ id, patch }) => updateAlbum(id, patch), onSuccess: done })
  const remove = useMutation({ mutationFn: deleteAlbum, onSuccess: done })
  const reorder = useMutation({ mutationFn: reorderAlbums, onSuccess: done })
  return { create, update, remove, reorder }
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

export function usePhotoMutations(albumId) {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: galleryKeys.photos(albumId) })
    qc.invalidateQueries({ queryKey: galleryKeys.albums() })
  }
  const update = useMutation({ mutationFn: ({ id, patch }) => updatePhoto(id, patch), onSuccess: done })
  const purge = useMutation({ mutationFn: purgePhoto, onSuccess: done })
  return { update, purge }
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
      reject(new Error('That file could not be read as an image'))
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
      (blob) => (blob ? resolve({ blob, w, h }) : reject(new Error('Could not encode the image'))),
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
