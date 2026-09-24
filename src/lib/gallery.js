// The public gallery: one snapshot document, live from the database.
//
// The PNSD officers edit albums and photos in the portal (src/portal/pages/gallery);
// the public site reads the result through rpc/gallery_public() and never sees the
// tables. This module turns that document into the album objects GalleryPage renders
// and decides what to show while it loads:
//
//   1. the snapshot the build baked in (scripts/prerender.mjs fetches it and hands it
//      to entry-server.jsx, so crawlers and preview bots see real albums),
//   2. else the last snapshot this browser saw (localStorage), for an instant paint,
//
// then the live document replaces both as soon as it arrives.
import { useEffect, useState } from 'react'
import { restRpc, supabaseRestEnabled } from './supabaseRest.js'
import { readJson } from './localCache.js'

const CACHE_KEY = 'ausss-gallery-snapshot'
const TRAIL_COUNT = 24
const GLOBAL_KEY = '__AUSSS_GALLERY__'

const STORAGE_BASE = `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/gallery/`

// '<album id>/<photo id>' -> the public URL of its thumb (600 px) or full (1600 px) file.
export function photoUrl(path, size = 'thumb') {
  return `${STORAGE_BASE}${path}-${size}.jpg`
}

// One album in the shape GalleryPage and seo/pages.js read. `cover` is the thumb URL
// (album cards), `coverFull` the 1600 px file (share cards), `aliases` the old slugs
// that should redirect here.
function normalizeAlbum(a) {
  const photos = (Array.isArray(a.photos) ? a.photos : []).map((p) => ({
    id: p.id,
    thumb: photoUrl(p.path, 'thumb'),
    full: photoUrl(p.path, 'full'),
    w: p.w,
    h: p.h,
    featured: Boolean(p.featured),
    label: p.label || '',
  }))
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    blurb: a.blurb || '',
    cover: a.cover ? photoUrl(a.cover, 'thumb') : photos[0]?.thumb,
    coverFull: a.cover ? photoUrl(a.cover, 'full') : photos[0]?.full,
    count: photos.length,
    aliases: Array.isArray(a.aliases) ? a.aliases : [],
    photos,
  }
}

// The document rpc/gallery_public() returns -> normalised album list.
export function albumsFromSnapshot(doc) {
  const list = doc && Array.isArray(doc.albums) ? doc.albums : []
  return list.map(normalizeAlbum).filter((a) => a.count > 0)
}

// Square thumbs for the cursor trail on the gallery index: round-robin across the
// albums so every album is represented, featured banners first.
export function trailFrom(albums) {
  const out = []
  for (let i = 0; out.length < TRAIL_COUNT; i++) {
    let added = false
    for (const a of albums) {
      const p = a.photos[i]
      if (p) {
        out.push(p.thumb)
        added = true
        if (out.length >= TRAIL_COUNT) break
      }
    }
    if (!added) break
  }
  return out
}

export function fetchGallerySnapshot() {
  return restRpc('gallery_public', {})
}

// Live albums, or an empty list when the backend is not configured or has none yet.
export async function fetchGalleryAlbums() {
  if (!supabaseRestEnabled) return []
  return albumsFromSnapshot(await fetchGallerySnapshot())
}

// Current slug, or an alias of it (a link shared before a rename).
export function findAlbum(albums, slug) {
  if (!slug) return { album: null, redirectTo: null }
  const direct = albums.find((a) => a.slug === slug)
  if (direct) return { album: direct, redirectTo: null }
  const alias = albums.find((a) => a.aliases.includes(slug))
  return alias ? { album: null, redirectTo: alias.slug } : { album: null, redirectTo: null }
}

function initialAlbums() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  if (Array.isArray(baked) && baked.length > 0) return baked
  return readJson(CACHE_KEY, [])
}

// Used by entry-server.jsx: the prerender fetched the live albums once and every
// rendered page should start from them.
export function setBakedGallery(albums) {
  globalThis[GLOBAL_KEY] = albums
}

// { albums, trail, loading }. `loading` is true until the live fetch has settled, so
// a page for a brand-new album can wait instead of saying "not found".
export function useGallery() {
  const [albums, setAlbums] = useState(initialAlbums)
  const [loading, setLoading] = useState(supabaseRestEnabled)

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    fetchGalleryAlbums()
      .then((live) => {
        if (!alive || live.length === 0) return
        setAlbums(live)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(live))
        } catch {
          /* cache write is best-effort */
        }
      })
      .catch(() => {
        /* keep whatever we had: baked or cached */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const trail = trailFrom(albums)

  return { albums, trail, loading }
}
