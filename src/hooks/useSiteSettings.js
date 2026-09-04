import { useCallback, useEffect, useState } from 'react'
import { OFFICERS_WEBAPP_URL, officersLiveEnabled } from '../data/officersConfig.js'
import { officersApiGet } from './useOfficerOverrides.js'
import { appsScriptPostClaim, UNKNOWN_ACTION } from '../lib/appsScriptPost.js'
import { readJson } from '../lib/localCache.js'

// Global site settings, flipped by dev/EB officers and read by every visitor.
// Backed by apps-script/officers.gs (Script Properties). Currently a single
// flag: `magazineInHeader`, whether the Magazine CTA shows in the navbar.
//
// Reads are cached in localStorage so the navbar can render the right state
// instantly on repeat visits (no flash); the first-ever load falls back to the
// defaults and corrects itself once the fetch resolves.

const CACHE_KEY = 'ausss-site-settings'
const DEFAULTS = { magazineInHeader: true }

export async function fetchSiteSettings() {
  if (!officersLiveEnabled) return { ...DEFAULTS }
  const data = await officersApiGet({ action: 'settings' })
  return { ...DEFAULTS, ...(data.settings || {}) }
}

// Dev/EB write. The session token travels in the POST body (not the URL), then
// we re-read the public settings to confirm the change landed. Returns the
// saved settings; throws if the confirm read shows the value didn't take.
export async function saveSiteSettings(token, patch) {
  const body = { action: 'setsettings', token }
  if (typeof patch.magazineInHeader === 'boolean') {
    body.magazineInHeader = patch.magazineInHeader
  }
  try {
    await appsScriptPostClaim(OFFICERS_WEBAPP_URL, body)
  } catch (err) {
    // Old backend without claim/POST support → fall back to the legacy GET.
    if (err.code === UNKNOWN_ACTION) {
      const params = { action: 'setsettings', token }
      if (typeof patch.magazineInHeader === 'boolean') {
        params.magazineInHeader = patch.magazineInHeader ? 'true' : 'false'
      }
      const data = await officersApiGet(params)
      return { ...DEFAULTS, ...(data.settings || {}) }
    }
    throw err
  }
  const confirmed = await fetchSiteSettings()
  if (
    typeof patch.magazineInHeader === 'boolean' &&
    confirmed.magazineInHeader !== patch.magazineInHeader
  ) {
    throw new Error('Setting did not save. Check your session and try again.')
  }
  return confirmed
}

export function useSiteSettings() {
  const [settings, setSettings] = useState(() => ({
    ...DEFAULTS,
    ...readJson(CACHE_KEY, {}),
  }))

  const refresh = useCallback(async () => {
    if (!officersLiveEnabled) return
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
