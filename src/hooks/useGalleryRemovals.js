import { useCallback, useEffect, useMemo, useState } from 'react'
import { removed as committedRemovals } from '../data/galleryRemovals.js'
import {
  GALLERY_WEBAPP_URL,
  galleryLiveEnabled,
} from '../data/galleryConfig.js'
import { appsScriptGet } from '../lib/appsScriptGet.js'
import { appsScriptPostClaim, UNKNOWN_ACTION } from '../lib/appsScriptPost.js'
import { readJson } from '../lib/localCache.js'

// Shared gallery-removal state for both the inline admin mode
// (/gallery?admin=1) and the dedicated admin page (/gallery/admin).
//
// A photo's `full` path is the removal key. There are three layers, unioned
// into the "effective" hidden set:
//   1. committed, src/data/galleryRemovals.js, baked at build time (permanent).
//   2. live, fetched from the Apps Script backend, editable by the admin
//                  page; takes effect for every visitor without a redeploy.
//   3. localMarks, browser-only pending marks, used only as a fallback when no
//                  backend URL is configured (the old mark→export→redeploy flow).

export const LS_KEY = 'ausss-gallery-removals' // pending marks (no-backend fallback)
const CACHE_KEY = 'ausss-gallery-live-cache' // last-known live list, for instant hide
const KEY_SS = 'ausss-gallery-adminkey' // admin key, sessionStorage only

export function readLocalMarks() {
  return readJson(LS_KEY, [])
}

// One GET to the backend; throws on a non-ok payload or after a timeout.
async function api(params) {
  return appsScriptGet(GALLERY_WEBAPP_URL, params)
}

export async function fetchLiveList() {
  if (!galleryLiveEnabled) return []
  const data = await api({ action: 'list' })
  return Array.isArray(data.removed) ? data.removed : []
}

/**
 * @param {'none'|'live'|'local'} write
 *   'none', read-only (public gallery): fetch + merge the live list, no edits.
 *   'live', admin page: toggles write straight to the backend.
 *   'local', inline ?admin=1: toggles go to localStorage for later export.
 */
export function useGalleryRemovals(write = 'none') {
  const [live, setLive] = useState(() =>
    galleryLiveEnabled ? readJson(CACHE_KEY, []) : [],
  )
  const [localMarks, setLocalMarks] = useState(() =>
    write === 'local' ? readLocalMarks() : [],
  )
  const [loading, setLoading] = useState(galleryLiveEnabled)
  const [error, setError] = useState(null)
  const [adminKey, setAdminKeyState] = useState(() => {
    try {
      return sessionStorage.getItem(KEY_SS) || ''
    } catch {
      return ''
    }
  })

  // Pull the authoritative live list on mount (and cache it for next time).
  useEffect(() => {
    if (!galleryLiveEnabled) {
      setLoading(false)
      return
    }
    let alive = true
    fetchLiveList()
      .then((list) => {
        if (!alive) return
        setLive(list)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(list))
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        // Keep the cached/empty list, but tell the admin UI the live sync
        // failed so stale data isn't mistaken for the real list. The public
        // gallery never renders `error`, so visitors are unaffected.
        if (alive) setError('Could not load the live removal list. Showing cached data.')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const committed = useMemo(() => new Set(committedRemovals), [])

  const effective = useMemo(
    () => new Set([...committedRemovals, ...live, ...localMarks]),
    [live, localMarks],
  )

  const setAdminKey = useCallback((k) => {
    setAdminKeyState(k)
    try {
      sessionStorage.setItem(KEY_SS, k)
    } catch {
      /* ignore */
    }
  }, [])

  const checkKey = useCallback(async (k) => {
    // Key travels in the POST body, not the URL. Fall back to the legacy GET
    // only if the backend predates `claim` support.
    try {
      const data = await appsScriptPostClaim(GALLERY_WEBAPP_URL, {
        action: 'check',
        key: k,
      })
      return Boolean(data.ok)
    } catch (err) {
      if (err.code === UNKNOWN_ACTION) {
        try {
          const data = await api({ action: 'check', key: k })
          return Boolean(data.ok)
        } catch {
          return false
        }
      }
      return false
    }
  }, [])

  // Toggle a photo's removal. Behavior depends on `write` mode.
  const toggle = useCallback(
    async (full) => {
      // Committed (in-source) removals are permanent, can't toggle live.
      if (committed.has(full)) return

      if (write === 'live') {
        const wasRemoved = live.includes(full)
        const action = wasRemoved ? 'remove' : 'add'
        setError(null)
        // Optimistic update for snappy UI; reconcile/revert on the response.
        setLive((prev) =>
          wasRemoved ? prev.filter((p) => p !== full) : [...prev, full],
        )
        try {
          let data
          try {
            // Admin key in the POST body, not the URL.
            data = await appsScriptPostClaim(GALLERY_WEBAPP_URL, {
              action,
              path: full,
              key: adminKey,
            })
          } catch (postErr) {
            if (postErr.code === UNKNOWN_ACTION) {
              data = await api({ action, path: full, key: adminKey })
            } else {
              throw postErr
            }
          }
          if (Array.isArray(data.removed)) {
            setLive(data.removed)
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(data.removed))
            } catch {
              /* ignore */
            }
          }
        } catch (err) {
          setLive((prev) =>
            wasRemoved ? [...prev, full] : prev.filter((p) => p !== full),
          )
          setError(err.message || 'Update failed')
        }
        return
      }

      // Fallback: localStorage marks for the export workflow.
      setLocalMarks((prev) => {
        const next = prev.includes(full)
          ? prev.filter((p) => p !== full)
          : [...prev, full]
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    [write, live, adminKey, committed],
  )

  const clearLocal = useCallback(() => {
    setLocalMarks([])
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!galleryLiveEnabled) return
    setLoading(true)
    setError(null)
    try {
      const list = await fetchLiveList()
      setLive(list)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(list))
      } catch {
        /* cache write is best-effort */
      }
    } catch {
      setError('Could not refresh the live removal list. Showing cached data.')
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    effective,
    committed,
    live,
    localMarks,
    loading,
    error,
    adminKey,
    setAdminKey,
    checkKey,
    toggle,
    clearLocal,
    refresh,
    liveEnabled: galleryLiveEnabled,
  }
}

// Build the full contents of src/data/galleryRemovals.js from a set of
// `full` paths, used by the export ("Copy"/"Download") actions.
export function buildRemovalFile(effective) {
  const all = [...effective].sort()
  return (
    `// Soft-delete list for gallery photos. Any photo whose \`full\` path\n` +
    `// appears here is hidden from every visitor. Reversible, delete a line\n` +
    `// to restore. Marked in admin mode and exported here.\n\n` +
    `export const removed = [\n` +
    all.map((p) => `  '${p}',`).join('\n') +
    `\n]\n`
  )
}
