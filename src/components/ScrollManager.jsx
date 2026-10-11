import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { scrollBehavior } from '../lib/motion.js'

/**
 * Scroll behaviour on navigation:
 *   - `/#section` hash  → smooth-scroll to that section once mounted.
 *   - Back / Forward (POP) → restore the scroll position you left, so backing
 *     out of a committee page lands you on the same section of the home page
 *     you were already in.
 *   - A new forward navigation (PUSH/REPLACE) → start at the top.
 *   - The same page with another ?query, replacing the entry it is on (a tab
 *     or a filter kept in the address, src/hooks/useTabParam.js) → stay put.
 * Renders nothing.
 */
const positions = new Map() // history entry key → scrollY

// The page behind an open sheet must not scroll. The mobile menu and the cart
// can be open together and close in either order (the menu shuts when the cart
// takes the focus, or when a tablet is turned on its side), so the lock is
// counted: the page scrolls again when the last one lets go. Each used to put
// back the value it had found, and when the first one opened was the first one
// closed the page stayed locked with nothing open. Returns the function that
// lets go, which is also the effect's cleanup:
//
//   useEffect(() => (open ? lockPageScroll() : undefined), [open])
let locks = 0
let overflowBefore = ''

export function lockPageScroll() {
  if (locks === 0) {
    overflowBefore = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  locks += 1
  let held = true
  return () => {
    if (!held) return
    held = false
    locks -= 1
    if (locks === 0) document.body.style.overflow = overflowBefore
  }
}

export default function ScrollManager() {
  const location = useLocation()
  const navType = useNavigationType() // 'POP' | 'PUSH' | 'REPLACE'
  // Where the navigation before this one left the reader, to tell a new page
  // or section from the one they are already on. Empty until the first one: an
  // arrival from the portal or the exam is always a new page here.
  const last = useRef(null)

  // Continuously remember where this history entry is scrolled to.
  useEffect(() => {
    const save = () => positions.set(location.key, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => {
      save() // capture the final position right before leaving
      window.removeEventListener('scroll', save)
    }
  }, [location.key])

  useEffect(() => {
    // A different history entry for the same path and #section, with another
    // ?query. (The key is compared so that this effect running twice for one
    // navigation, as it does in development, is not mistaken for a second
    // navigation.) The query must differ: a link to the very page the reader
    // is on (the logo or "Home" on the home page, a #section asked for twice)
    // also replaces its entry, and that one must still go to the top or to its
    // section.
    const queryOnly =
      last.current !== null &&
      last.current.key !== location.key &&
      last.current.pathname === location.pathname &&
      last.current.hash === location.hash &&
      last.current.search !== location.search
    last.current = {
      key: location.key,
      pathname: location.pathname,
      hash: location.hash,
      search: location.search,
    }
    // Only the ?query changed, in place: a tab or a filter. Jumping to the top
    // (or back to the #section) would take the tabs out from under the
    // reader's hand.
    if (navType === 'REPLACE' && queryOnly) return

    if (location.hash) {
      const id = location.hash.replace('#', '')
      // The section may not be there yet: every page but the home page is its
      // own chunk and mounts a moment after the address changes (a link such
      // as /constitution#ifmsa-egypt from another page). Look again for a few
      // seconds before giving up.
      let tries = 0
      let t
      const go = () => {
        const el = document.getElementById(id)
        if (el) {
          el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
        } else if (++tries < 40) {
          t = setTimeout(go, 75)
        }
      }
      t = setTimeout(go, 60)
      return () => clearTimeout(t)
    }

    if (navType === 'POP') {
      // Restore the remembered position. Re-apply across a couple of frames
      // (and a short fallback) so it sticks once the destination has laid out.
      const y = positions.get(location.key) ?? 0
      const restore = () => window.scrollTo({ top: y, left: 0, behavior: 'instant' })
      const raf1 = requestAnimationFrame(() => {
        restore()
        requestAnimationFrame(restore)
      })
      const t = setTimeout(restore, 120)
      return () => {
        cancelAnimationFrame(raf1)
        clearTimeout(t)
      }
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [location.key, location.hash, navType])

  return null
}
