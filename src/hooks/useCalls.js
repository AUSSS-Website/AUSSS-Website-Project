import { useCallback, useEffect, useState } from 'react'
import { callsLiveEnabled } from '../data/officersConfig.js'
import { fetchCalls } from '../lib/calls.js'
import { readJson } from '../lib/localCache.js'

// Live Open Calls, keyed by committee slug, the public read.
//
// Same shape as useOfficerOverrides: one GET on mount, a localStorage cache so
// a repeat visit paints immediately, and failures swallowed in favour of the
// cached (or empty) map. An empty map is a perfectly normal state, most
// committees have no open calls most of the time, and the section just doesn't
// render.
//
// It also doubles as the feature's availability probe: a backend that predates
// Open Calls answers `?action=calls` with "Unknown action" over a readable GET,
// so we land on the empty map and no Apply button is ever shown for an
// endpoint that wouldn't answer it.

const CACHE_KEY = 'ausss-calls-cache'

export function useCalls() {
  const [calls, setCalls] = useState(() => (callsLiveEnabled ? readJson(CACHE_KEY, {}) : {}))
  const [loading, setLoading] = useState(callsLiveEnabled)

  const refresh = useCallback(async () => {
    if (!callsLiveEnabled) return {}
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
    if (!callsLiveEnabled) {
      setLoading(false)
      return
    }
    let alive = true
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
  }, [refresh])

  return { calls, loading, refresh, liveEnabled: callsLiveEnabled }
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
