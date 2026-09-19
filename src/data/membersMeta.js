import { useEffect, useState } from 'react'
import { readJson } from '../lib/localCache.js'
import { restRpc, supabaseRestEnabled } from '../lib/supabaseRest.js'

// The Hero's "Members" figure. The live number is rpc/roster_stats (the
// roster in Supabase); MEMBERS_META is what a first-time visitor sees, and what
// everyone sees if the roster is unreachable or still empty. Bump it now and
// then so the first impression doesn't drift far from the truth.
export const MEMBERS_META = { count: 581 }

const CACHE_KEY = 'ausss:member-count'

// Returns the count remembered from the last visit and refreshes the memory in
// the background. It deliberately does NOT re-render with the fresh number:
// the Hero counts up from zero, and restarting that mid-animation looks broken.
export function useMemberCount() {
  const [count] = useState(() => {
    const cached = readJson(CACHE_KEY, {}).count
    return Number.isInteger(cached) && cached > 0 ? cached : MEMBERS_META.count
  })
  useEffect(() => {
    if (!supabaseRestEnabled) return
    restRpc('roster_stats')
      .then((s) => {
        if (Number.isInteger(s?.count) && s.count > 0) {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ count: s.count }))
        }
      })
      .catch(() => {
        /* offline, blocked storage: keep showing what we have */
      })
  }, [])
  return count
}
