// Published exchange stories: one snapshot document, live from the database.
//
// Students send stories from /exchange/share (src/lib/stories.js); the exchange
// officers review them in the portal and set them to published, optionally
// featured. The public site reads the result through rpc/stories_public()
// (published stories, public fields only). Same loading order as the gallery
// (src/lib/gallery.js): the snapshot the build baked in, else the last one
// this browser saw, then the live document replaces both.
//
// Story shape (what ExchangeStories.jsx renders):
//   { id, name, quote, track, destination, year, featured, publishedAt }
import { useEffect, useState } from 'react'
import { restRpc, supabaseRestEnabled } from './supabaseRest.js'
import { readJson } from './localCache.js'

const CACHE_KEY = 'ausss-stories-snapshot'
const GLOBAL_KEY = '__AUSSS_STORIES__'

function normalizeStory(s) {
  return {
    id: s.id,
    name: s.name || '',
    quote: s.story || '',
    track: s.programme || '',
    destination: s.destination || '',
    year: s.year || '',
    featured: Boolean(s.featured),
    publishedAt: s.publishedAt || '',
  }
}

export function storiesFromSnapshot(doc) {
  const list = doc && Array.isArray(doc.stories) ? doc.stories : []
  return list.map(normalizeStory).filter((s) => s.quote)
}

export async function fetchExchangeStories() {
  if (!supabaseRestEnabled) return []
  return storiesFromSnapshot(await restRpc('stories_public', {}))
}

// Used by entry-server.jsx: the prerender fetched the published stories once.
export function setBakedStories(stories) {
  globalThis[GLOBAL_KEY] = stories
}

function initialStories() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  if (Array.isArray(baked)) return baked
  return readJson(CACHE_KEY, [])
}

// The published stories, featured first (the RPC's order), refreshed live.
export function useExchangeStories() {
  const [stories, setStories] = useState(initialStories)

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    fetchExchangeStories()
      .then((live) => {
        if (!alive) return
        setStories(live)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(live))
        } catch {
          /* cache write is best-effort */
        }
      })
      .catch(() => {
        /* keep whatever we had: baked or cached */
      })
    return () => {
      alive = false
    }
  }, [])

  return stories
}
