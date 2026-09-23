import { useCallback, useEffect, useState } from 'react'
import { restSelect, supabaseRestEnabled } from '../lib/supabaseRest.js'
import { readJson } from '../lib/localCache.js'

// Global site settings, flipped by the EB in the portal (/portal/admin/settings)
// and read by every visitor. Backed by the public.site_settings table (one row
// per key, jsonb value). Currently a single flag: `magazineInHeader`, whether
// the Magazine CTA shows in the navbar.
//
// Reads are cached in localStorage so the navbar can render the right state
// instantly on repeat visits (no flash); the first-ever load falls back to the
// defaults and corrects itself once the fetch resolves.

const CACHE_KEY = 'ausss-site-settings'
const DEFAULTS = { magazineInHeader: true }

async function fetchSiteSettings() {
  if (!supabaseRestEnabled) return { ...DEFAULTS }
  const rows = await restSelect('site_settings', { select: 'key,value' })
  const out = { ...DEFAULTS }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row.key === 'string') out[row.key] = row.value
  }
  return out
}

export function useSiteSettings() {
  const [settings, setSettings] = useState(() => ({
    ...DEFAULTS,
    ...readJson(CACHE_KEY, {}),
  }))

  const refresh = useCallback(async () => {
    if (!supabaseRestEnabled) return
    try {
      const s = await fetchSiteSettings()
      setSettings(s)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(s))
      } catch {
        /* ignore */
      }
    } catch {
      /* keep cached/default settings */
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { settings, refresh, setSettings }
}
