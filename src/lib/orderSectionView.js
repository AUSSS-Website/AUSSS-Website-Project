import { useEffect, useSyncExternalStore } from 'react'

// Whether the "Place your order" section of /merch is on screen. The merch
// page watches the section and the navbar's cart button reads the flag, so
// the button can grow into a labelled pill while the visitor is choosing
// what to add. Off on every other page: the watcher clears it on unmount.

let inView = false
const listeners = new Set()

function set(next) {
  if (inView === next) return
  inView = next
  listeners.forEach((cb) => cb())
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const get = () => inView

export function useOrderSectionInView() {
  return useSyncExternalStore(subscribe, get, () => false)
}

// Watches the element behind `ref`. The band is the middle of the viewport
// (the top and bottom fifths are ignored), so the section counts as on screen
// only while it fills the part of the page the visitor is looking at, not
// while its edge peeks in under the header or above the fold.
export function useWatchOrderSection(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(
      ([entry]) => set(entry.isIntersecting),
      { rootMargin: '-20% 0px -20% 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      set(false)
    }
  }, [ref])
}
