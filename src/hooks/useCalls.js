import { useCallback, useEffect, useState } from 'react'
import { fetchCalls } from '../lib/calls.js'
import { readJson } from '../lib/localCache.js'
import { useSiteSettings } from './useSiteSettings.js'

// Live Open Calls, keyed by committee slug, the public read.
//
// Shown only while the site setting `openCallsLive` is on (the EB switches it
// in the portal's Site settings); officers can prepare calls either way. Same
// shape as useOfficerOverrides: one fetch on mount, a localStorage cache so a
// repeat visit paints immediately, and failures swallowed in favour of the
// cached (or empty) map. An empty map is a normal state: most committees have
// no open calls most of the time, and the section just doesn't render.

const CACHE_KEY = 'ausss-calls-cache'

export function useCalls() {
  const live = useSiteSettings().settings.openCallsLive === true
  const [calls, setCalls] = useState(() => readJson(CACHE_KEY, {}))
  const [loading, setLoading] = useState(live)

  const refresh = useCallback(async () => {
    const map = await fetchCalls()
    setCalls(map)
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(map))
    } catch {
      /* ignore */
    }
    return map
  }, [])

  useEffect(() => {
    if (!live) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    refresh()
      .catch(() => {
        /* keep the cached/empty map */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [live, refresh])

  return { calls: live ? calls : {}, loading, refresh, liveEnabled: live }
}

// Shared formatting for a call's deadline. Returns '' when there isn't one.
export function formatDeadline(deadline) {
  if (!deadline) return ''
  const d = new Date(`${deadline}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Whole days left, counting the deadline day itself. Null when open-ended.
export function daysLeft(deadline) {
  if (!deadline) return null
  const end = new Date(`${deadline}T23:59:59`)
  if (Number.isNaN(end.getTime())) return null
  return Math.ceil((end.getTime() - Date.now()) / 86400000)
}
