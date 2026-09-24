import { useCallback, useEffect, useRef, useState } from 'react'
import { restRpc, supabaseRestEnabled } from '../lib/supabaseRest.js'

// Reads, likes, downloads and reading depth for one magazine edition, through
// rpc/magazine_track (src/lib/supabaseRest.js; the CBSD officers see the
// results in the portal). One reading session per mount: the browser makes a
// random id, the first call counts the read, page turns report the furthest
// page reached, like and download count once per session. Likes are also
// remembered per browser so the button stays pressed on a later visit.
//
//   const engagement = useMagazineEngagement(issue.id)
//   engagement.counts / liked / like() / download() / reachPage(n) / enabled

const likedKey = (id) => `ausss-mag-liked-${id}`
const PAGE_DEBOUNCE_MS = 2500

function randomId() {
  try {
    return crypto.randomUUID()
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }
}

function track(session, issue, event, page, opts) {
  return restRpc('magazine_track', { session, issue, event, page: page ?? null }, opts)
}

export function useMagazineEngagement(issueId) {
  const enabled = supabaseRestEnabled && Boolean(issueId)
  const [counts, setCounts] = useState({ views: 0, likes: 0, downloads: 0 })
  const [liked, setLiked] = useState(false)
  const [ready, setReady] = useState(!enabled)
  const session = useRef(null)
  const furthest = useRef(0) // furthest page reported so far
  const pending = useRef(0) // furthest page seen, not yet sent
  const timer = useRef(null)

  // Remembered "already liked" state for this browser.
  useEffect(() => {
    if (!issueId) return
    try {
      setLiked(localStorage.getItem(likedKey(issueId)) === '1')
    } catch {
      /* ignore */
    }
  }, [issueId])

  // A new session per edition opened: count the read and load the totals.
  useEffect(() => {
    if (!enabled) {
      setReady(true)
      return
    }
    const id = randomId()
    session.current = id
    furthest.current = 0
    pending.current = 0
    let alive = true
    track(id, issueId, 'view')
      .then((d) => {
        if (alive && d) setCounts({ views: d.views || 0, likes: d.likes || 0, downloads: d.downloads || 0 })
      })
      .catch(() => {
        /* leave counts at 0, the page still works */
      })
      .finally(() => {
        if (alive) setReady(true)
      })

    // The last page reached goes out when the reader leaves, even mid-debounce.
    const flush = () => {
      if (pending.current > furthest.current) {
        furthest.current = pending.current
        track(id, issueId, 'page', pending.current, { keepalive: true, timeoutMs: 5000 }).catch(() => {})
      }
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      alive = false
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
      session.current = null
    }
  }, [enabled, issueId])

  // Called by the reader with the furthest page (1-based) now visible.
  const reachPage = useCallback(
    (page) => {
      if (!enabled || !session.current) return
      const n = Math.max(0, Math.floor(Number(page) || 0))
      if (n <= pending.current) return
      pending.current = n
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const id = session.current
        if (!id || pending.current <= furthest.current) return
        furthest.current = pending.current
        track(id, issueId, 'page', pending.current).catch(() => {
          // try again on the next page turn or when the reader leaves
          furthest.current = 0
        })
      }, PAGE_DEBOUNCE_MS)
    },
    [enabled, issueId],
  )

  const like = useCallback(async () => {
    if (!enabled || liked || !session.current) return
    // Optimistic: flip + bump immediately, persist, then confirm with the server.
    setLiked(true)
    setCounts((c) => ({ ...c, likes: c.likes + 1 }))
    try {
      localStorage.setItem(likedKey(issueId), '1')
    } catch {
      /* ignore */
    }
    try {
      const d = await track(session.current, issueId, 'like')
      if (d) setCounts({ views: d.views || 0, likes: d.likes || 0, downloads: d.downloads || 0 })
    } catch {
      /* keep the optimistic value */
    }
  }, [enabled, issueId, liked])

  // Fire-and-forget: the click opens the file in a new tab, never block it.
  const download = useCallback(() => {
    if (!enabled || !session.current) return
    track(session.current, issueId, 'download', null, { keepalive: true }).catch(() => {})
  }, [enabled, issueId])

  return { counts, liked, like, download, reachPage, ready, enabled }
}
