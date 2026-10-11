import { useEffect } from 'react'

// Asks before the tab is closed or reloaded while `active` is true: with
// unsaved typing in a form, or with an upload still running that leaving
// would cut off.
//
//   useLeaveWarning(dirty || uploading)
//
// The question is the browser's own, in its own words; a page cannot word it.
// It covers closing the tab, a reload and an address typed over this one. A
// link inside the site is not leaving as the browser sees it (the router swaps
// the screen and the page stays), so it goes unasked: where that would lose
// work, switch the link off while `active`, or keep the form mounted.
export default function useLeaveWarning(active) {
  // Any truthy value will do (a count of uploads, a draft object): only
  // whether there is something to lose is watched, not which.
  const on = Boolean(active)
  useEffect(() => {
    if (!on) return undefined
    const warn = (e) => {
      e.preventDefault()
      // Older browsers ask only when this is set as well.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [on])
}
