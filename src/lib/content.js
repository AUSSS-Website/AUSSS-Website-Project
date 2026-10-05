// Content edited from the portal (Phase 6): the published documents of
// public.content_blocks, read through rpc/content_public() as one answer.
//
// Same loading order as the gallery and the stories: what the build baked in,
// else what this browser saw last, then the live answer replaces both. A block
// with nothing published shows the copy that ships in the code (the schema's
// `defaults`), so a page never renders empty and the site works with the
// database unreachable.
import { useEffect, useMemo, useState } from 'react'
import { restRpc, supabaseRestEnabled } from './supabaseRest.js'
import { readJson } from './localCache.js'
import { resolveDoc } from '../content/schema.js'

const CACHE_KEY = 'ausss-content-snapshot'
const GLOBAL_KEY = '__AUSSS_CONTENT__'

// { '<key>': { …published document… } }
export async function fetchContentBlocks() {
  if (!supabaseRestEnabled) return {}
  const doc = await restRpc('content_public', {})
  const blocks = doc && typeof doc === 'object' ? doc.blocks : null
  return blocks && typeof blocks === 'object' && !Array.isArray(blocks) ? blocks : {}
}

// Used by entry-server.jsx: the prerender fetched the documents once.
export function setBakedContent(blocks) {
  globalThis[GLOBAL_KEY] = blocks
}

function initialBlocks() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  if (baked && typeof baked === 'object') return baked
  return readJson(CACHE_KEY, {})
}

// One fetch per page load, shared by every block on the page.
let pending = null
function loadBlocks() {
  if (!pending) {
    pending = fetchContentBlocks().then((live) => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(live))
      } catch {
        /* cache write is best-effort */
      }
      return live
    })
    // A failed fetch may be tried again by the next page.
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}

// The document a page shows for one block, in the shape of its schema.
export function useContentBlock(schema) {
  const [blocks, setBlocks] = useState(initialBlocks)

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    loadBlocks()
      .then((live) => {
        if (alive) setBlocks(live)
      })
      .catch(() => {
        /* keep whatever we had: baked, cached or the shipped copy */
      })
    return () => {
      alive = false
    }
  }, [])

  const published = blocks[schema.key]
  return useMemo(() => resolveDoc(schema, published), [schema, published])
}
