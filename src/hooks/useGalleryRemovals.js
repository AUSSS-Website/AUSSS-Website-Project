import { useCallback, useEffect, useMemo, useState } from 'react'
import { GALLERY_WEBAPP_URL } from '../data/galleryConfig.js'
import { appsScriptGet } from '../lib/appsScriptGet.js'
import { appsScriptPostClaim } from '../lib/appsScriptPost.js'
import { readJson } from '../lib/localCache.js'

// Gallery takedowns. A photo's `full` path is the key; the list of hidden
// paths lives in the Apps Script backend (apps-script/gallery.gs) and takes
// effect for every visitor without a redeploy. The public gallery reads it
// (`write = false`); the admin page (/gallery/admin) also toggles it, gated by
// the admin key.

const CACHE_KEY = 'ausss-gallery-live-cache' // last-known list, for an instant hide
const KEY_SS = 'ausss-gallery-adminkey' // admin key, sessionStorage only

async function fetchLiveList() {
  const data = await appsScriptGet(GALLERY_WEBAPP_URL, { action: 'list' })
  return Array.isArray(data.removed) ? data.removed : []
}

function cacheList(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list))
  } catch {
    /* cache write is best-effort */
  }
}

export function useGalleryRemovals(write = false) {
  const [live, setLive] = useState(() => readJson(CACHE_KEY, []))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [adminKey, setAdminKeyState] = useState(() => {
    try {
      return sessionStorage.getItem(KEY_SS) || ''
    } catch {
      return ''
    }
  })

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchLiveList()
      setLive(list)
      cacheList(list)
    } catch {
      // Keep the cached list, but tell the admin UI the sync failed so stale
      // data is not mistaken for the real list. Visitors never see `error`.
      setError('Could not load the live removal list. Showing cached data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const hidden = useMemo(() => new Set(live), [live])

  const setAdminKey = useCallback((k) => {
    setAdminKeyState(k)
    try {
      sessionStorage.setItem(KEY_SS, k)
    } catch {
      /* ignore */
    }
  }, [])

  // The key travels in the POST body, never the URL.
  const checkKey = useCallback(async (k) => {
    try {
      const data = await appsScriptPostClaim(GALLERY_WEBAPP_URL, { action: 'check', key: k })
      return Boolean(data.ok)
    } catch {
      return false
    }
  }, [])

  // Hide or restore one photo. Optimistic, reconciled with the reply.
  const toggle = useCallback(
    async (full) => {
      if (!write) return
      const wasHidden = live.includes(full)
      setError(null)
      setLive((prev) => (wasHidden ? prev.filter((p) => p !== full) : [...prev, full]))
      try {
        const data = await appsScriptPostClaim(GALLERY_WEBAPP_URL, {
          action: wasHidden ? 'remove' : 'add',
          path: full,
          key: adminKey,
        })
        if (Array.isArray(data.removed)) {
          setLive(data.removed)
          cacheList(data.removed)
        }
      } catch (err) {
        setLive((prev) => (wasHidden ? [...prev, full] : prev.filter((p) => p !== full)))
        setError(err.message || 'Update failed')
      }
    },
    [write, live, adminKey],
  )

  return { hidden, loading, error, adminKey, setAdminKey, checkKey, toggle, refresh }
}
