import { useCallback, useEffect, useState } from 'react'
import { restSelect, supabaseRestEnabled } from '../lib/supabaseRest.js'
import { readJson } from '../lib/localCache.js'

// Live committee page overrides, keyed by committee slug.
//
// Officers edit them in the portal (/portal/committees/<slug>); the database
// stores one document per committee in committees.page:
//   { tagline, about[], whatWeDo[], whatWeDoEnabled, photo, membersEnabled, members[] }
// Committee pages fetch the whole map once on load and merge the matching
// slug's override on top of the static society.js committee. Mirrors the
// fetch + localStorage-cache shape of src/lib/gallery.js. An empty page ({})
// means "no override" and is left out of the map.

const CACHE_KEY = 'ausss-officer-overrides-cache'

async function fetchOverrides() {
  if (!supabaseRestEnabled) return {}
  const rows = await restSelect('committees', { select: 'slug,page' })
  const map = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const page = row?.page
    if (
      typeof row?.slug === 'string' &&
      page &&
      typeof page === 'object' &&
      !Array.isArray(page) &&
      Object.keys(page).length > 0
    ) {
      map[row.slug] = page
    }
  }
  return map
}

export function useOfficerOverrides() {
  const [overrides, setOverrides] = useState(() =>
    supabaseRestEnabled ? readJson(CACHE_KEY, {}) : {},
  )
  const [loading, setLoading] = useState(supabaseRestEnabled)

  const refresh = useCallback(async () => {
    if (!supabaseRestEnabled) return {}
    const map = await fetchOverrides()
    setOverrides(map)
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(map))
    } catch {
      /* ignore */
    }
    return map
  }, [])

  useEffect(() => {
    if (!supabaseRestEnabled) {
      setLoading(false)
      return
    }
    let alive = true
    refresh()
      .catch(() => {
        /* keep cached/empty map */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [refresh])

  return { overrides, loading, refresh, liveEnabled: supabaseRestEnabled }
}
