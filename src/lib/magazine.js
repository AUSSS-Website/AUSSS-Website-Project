// The magazine shelf: one snapshot document, live from the database.
//
// The CBSD officers edit the editions in the portal (src/portal/pages/magazine); the
// public site reads the result through rpc/magazine_public(). Same loading order as
// the gallery (src/lib/gallery.js): the snapshot the build baked in, else the last
// one this browser saw, then the live document replaces both.
//
// Edition shape (what MagazinePage renders):
//   { id, title, switcherLabel, date, blurb, missing, pages: { base, count },
//     heroPage, download, canva }
// `pages.base` is a site path (/assets/magazine/<id>/pages, the editions built before
// the portal) or a Storage URL (editions uploaded from the portal); the page images
// are `${base}/NNN.jpg`, see pageUrls().
import { useEffect, useState } from 'react'
import { restRpc, supabaseRestEnabled } from './supabaseRest.js'
import { readJson } from './localCache.js'
import { pageUrls } from './pageImages.js'

const CACHE_KEY = 'ausss-magazine-snapshot'
const GLOBAL_KEY = '__AUSSS_MAGAZINE__'

// Who to reach about missing editions. CBSD produces the magazine, so its inbox
// owns archive requests (matches aussscbsdd in src/data/society.js).
export const ARCHIVE_CONTACT = {
  team: 'CBSD',
  email: 'aussscbsdd@gmail.com',
}

function normalizeIssue(m) {
  const count = Number(m.pages?.count) || 0
  return {
    id: m.id,
    title: m.title,
    switcherLabel: m.switcherLabel || '',
    date: m.date || '',
    blurb: m.blurb || '',
    missing: Boolean(m.missing),
    pages: { base: m.pages?.base || '', count },
    heroPage: Math.min(Math.max(Number(m.heroPage) || 1, 1), Math.max(count, 1)),
    download: m.download || '',
    canva: m.canva || '',
  }
}

export function issuesFromSnapshot(doc) {
  const list = doc && Array.isArray(doc.issues) ? doc.issues : []
  return list.map(normalizeIssue)
}

export async function fetchMagazineIssues() {
  if (!supabaseRestEnabled) return []
  return issuesFromSnapshot(await restRpc('magazine_public', {}))
}

// An edition is readable once it has page images or a Canva embed.
export function isPublished(issue) {
  return Boolean(issue && !issue.missing && (issue.pages?.count || issue.canva))
}

export function isMissing(issue) {
  return Boolean(issue && issue.missing)
}

// The page shown as the edition's cover (header thumbnail, switcher, share card).
export function heroUrl(issue) {
  const urls = pageUrls(issue?.pages)
  return urls[(issue?.heroPage || 1) - 1] || urls[0] || null
}

// The latest readable edition, where /magazine opens.
export function latestIssue(issues) {
  return issues.find(isPublished) || null
}

export function setBakedMagazine(issues) {
  globalThis[GLOBAL_KEY] = issues
}

function initialIssues() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  if (Array.isArray(baked) && baked.length > 0) return baked
  return readJson(CACHE_KEY, [])
}

// { issues, loading }. `loading` is true until the live fetch has settled, so the
// page can show a spinner rather than "first edition on its way" on a cold start.
export function useMagazine() {
  const [issues, setIssues] = useState(initialIssues)
  const [loading, setLoading] = useState(supabaseRestEnabled)

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    fetchMagazineIssues()
      .then((live) => {
        if (!alive || live.length === 0) return
        setIssues(live)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(live))
        } catch {
          /* cache write is best-effort */
        }
      })
      .catch(() => {
        /* keep whatever we had: baked or cached */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return { issues, loading }
}
