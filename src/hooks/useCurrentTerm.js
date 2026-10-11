import { useEffect, useMemo, useState } from 'react'
import { restSelect, supabaseRestEnabled } from '../lib/supabaseRest.js'
import { readJson } from '../lib/localCache.js'
import { termVars } from '../lib/anniversary.js'

// The current term (public.terms, the row the portal's New term page marks as
// current), read by the pages that count the society's years: see
// src/lib/anniversary.js.
//
// Same loading order as the site settings (useSiteSettings.js): what the build
// baked in, else what this browser saw last; the live answer then replaces it.
// With none of the three, the pages count from today's date.

const CACHE_KEY = 'ausss-current-term'
const GLOBAL_KEY = '__AUSSS_TERM__'

// { label, starts_on, ends_on }, or null when there is no current term.
export async function fetchCurrentTerm() {
  if (!supabaseRestEnabled) return null
  const rows = await restSelect('terms', { select: 'label,starts_on,ends_on', is_current: 'eq.true', limit: '1' })
  const term = Array.isArray(rows) ? rows[0] : null
  return term && typeof term.ends_on === 'string' ? term : null
}

// Used by entry-server.jsx: the prerender fetched the term once.
export function setBakedTerm(term) {
  globalThis[GLOBAL_KEY] = term
}

function initialTerm() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  if (baked && typeof baked === 'object') return baked
  return readJson(CACHE_KEY, null)
}

// One fetch per page load, shared by every component on the page.
let pending = null
function loadTerm() {
  if (!pending) {
    pending = fetchCurrentTerm().then((live) => {
      try {
        if (live) localStorage.setItem(CACHE_KEY, JSON.stringify(live))
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

export function useCurrentTerm() {
  const [term, setTerm] = useState(initialTerm)

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    loadTerm()
      .then((live) => {
        if (alive && live) setTerm(live)
      })
      .catch(() => {
        /* keep the baked or cached term, or count from the date */
      })
    return () => {
      alive = false
    }
  }, [])

  return term
}

// { years: '56', anniversary: '56th' } for the current term.
export function useTermVars() {
  const term = useCurrentTerm()
  return useMemo(() => termVars(term), [term])
}
