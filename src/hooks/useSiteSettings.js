import { useCallback, useEffect, useState } from 'react'
import { restSelect, supabaseRestEnabled } from '../lib/supabaseRest.js'
import { readJson } from '../lib/localCache.js'
import { publicEmail } from '../data/emailConfig.js'

// Global site settings, switched by the EB in the portal (/portal/admin/settings)
// and read by every visitor. Backed by the public.site_settings table (one row
// per key, jsonb value). The switches the public pages read, and the value each
// takes while its row does not exist:
//
//   magazineInHeader         the Magazine button in the navbar
//   merchOrdersOpen          whether the merch checkout takes orders
//   openCallsLive            Open Calls on the committee pages (cards and the
//                            apply form); officers prepare calls either way
//   magazineCountersVisible  the reads count and Like button on /magazine;
//                            reads are recorded either way
//   domainEmailsLive         the @ausss-ainshams.org addresses instead of the
//                            Gmail inboxes (RUNBOOK section 19)
//
// Same loading order as the content blocks (src/lib/content.js): what the build
// baked in, else what this browser saw last, else the defaults; the live answer
// then replaces it. One fetch serves every component on the page, and it is
// made again at most once a minute.

export const SETTING_DEFAULTS = {
  magazineInHeader: true,
  merchOrdersOpen: true,
  openCallsLive: false,
  magazineCountersVisible: false,
  domainEmailsLive: false,
}

const CACHE_KEY = 'ausss-site-settings'
const GLOBAL_KEY = '__AUSSS_SETTINGS__'
const FRESH_MS = 60 * 1000

// { key: value } for every row, over the defaults.
export async function fetchSiteSettings() {
  if (!supabaseRestEnabled) return { ...SETTING_DEFAULTS }
  const rows = await restSelect('site_settings', { select: 'key,value' })
  const out = { ...SETTING_DEFAULTS }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row.key === 'string') out[row.key] = row.value
  }
  return out
}

// Used by entry-server.jsx: the prerender fetched the settings once.
export function setBakedSettings(settings) {
  globalThis[GLOBAL_KEY] = settings
}

function initialSettings() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  const known = baked && typeof baked === 'object' ? baked : readJson(CACHE_KEY, {})
  return { ...SETTING_DEFAULTS, ...known }
}

let pending = null
let fetchedAt = 0
function loadSettings() {
  if (!pending || Date.now() - fetchedAt > FRESH_MS) {
    fetchedAt = Date.now()
    pending = fetchSiteSettings().then((live) => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(live))
      } catch {
        /* cache write is best-effort */
      }
      return live
    })
    // A failed fetch may be tried again by the next component.
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}

export function useSiteSettings() {
  const [settings, setSettings] = useState(initialSettings)

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    loadSettings()
      .then((live) => {
        if (alive) setSettings(live)
      })
      .catch(() => {
        /* keep the baked, cached or default settings */
      })
    return () => {
      alive = false
    }
  }, [])

  return { settings }
}

// The address to show for a person or committee from society.js, following
// the `domainEmailsLive` switch.
export function usePublicEmail() {
  const live = useSiteSettings().settings.domainEmailsLive === true
  return useCallback((who) => publicEmail(who, live), [live])
}
