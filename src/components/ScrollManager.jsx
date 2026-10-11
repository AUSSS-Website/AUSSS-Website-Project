import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { scrollBehavior } from '../lib/motion.js'

/**
 * Scroll behaviour on navigation:
 *   - `/#section` hash  → smooth-scroll to that section once mounted.
 *   - Back / Forward (POP) → restore the scroll position you left, so backing
 *     out of a committee page lands you on the same section of the home page
 *     you were already in.
 *   - A new forward navigation (PUSH/REPLACE) → start at the top.
 * Renders nothing.
 */
const positions = new Map() // history entry key → scrollY

export default function ScrollManager() {
  const location = useLocation()
  const navType = useNavigationType() // 'POP' | 'PUSH' | 'REPLACE'

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
