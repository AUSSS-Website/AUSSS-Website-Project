import { useEffect, useState } from 'react'
import { scrollBehavior } from '../lib/motion.js'

// It fades in while it rises 16px once the page is 600px down, and leaves the
// same way; with reduced motion it only fades. Hidden, it is out of the tab
// order and takes no taps. It sits under the header (z-40 against the bar's
// z-50), so the open mobile menu covers it instead of showing it over a link.
export default function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
      aria-label="Back to top"
      aria-hidden={!show}
      tabIndex={show ? undefined : -1}
      className={`fixed bottom-6 right-6 z-40 grid h-12 w-12 place-items-center rounded-full bg-leaf text-white shadow-lg shadow-forest-900/30 transition-[opacity,transform,background-color,box-shadow] duration-200 ease-out hover:bg-leaf-hover hover:shadow-xl motion-safe:active:scale-[0.97] ${
        show
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none opacity-0 motion-safe:translate-y-4'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
