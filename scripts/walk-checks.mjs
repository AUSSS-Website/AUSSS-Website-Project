// Checks both page walks run inside the page (scripts/page-walk.mjs and
// scripts/portal-sample-walk.mjs). Each is passed to page.evaluate(), which
// sends the function's source to the browser, so it must not use anything
// from this module's scope.

// Does anything in a fixed or sticky bar run past the edge of the screen? The
// sideways-scroll check cannot see it: content that sticks out of a fixed
// header never makes the page scroll, so it is cut off unnoticed. That is
// how the Members button went missing at 1024px when Events joined the
// header (2026-10-07) without either walk noticing.
//
// Counted: a visible element inside a fixed or sticky element whose box ends
// past either edge of the viewport. Not counted: anything hidden
// (visibility, opacity 0, inert or aria-hidden, such as a closed menu or
// drawer), and anything inside a container that clips it and itself sits on
// the screen (a row that scrolls sideways on purpose, a collapsed drawer).
// Of a nested set only the innermost is named. Returns null when nothing is
// cut off.
export function measureCutOff() {
  const vw = document.documentElement.clientWidth
  const offScreen = (r) => r.right > vw + 1 || r.left < -1
  const roots = [...document.body.querySelectorAll('*')].filter((el) => {
    const pos = getComputedStyle(el).position
    return pos === 'fixed' || pos === 'sticky'
  })
  const hits = new Set()
  for (const root of roots) {
    if (root.closest('[inert], [aria-hidden="true"]')) continue
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || !offScreen(r)) continue
      if (el.closest('[inert], [aria-hidden="true"]')) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      let clipped = false
      for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
        if (getComputedStyle(p).overflowX === 'visible') continue
        if (!offScreen(p.getBoundingClientRect())) {
          clipped = true
          break
        }
      }
      if (!clipped) hits.add(el)
    }
  }
  const list = [...hits]
  const innermost = list.filter((el) => !list.some((o) => o !== el && el.contains(o)))
  if (innermost.length === 0) return null
  return innermost.slice(0, 6).map((el) => {
    const r = el.getBoundingClientRect()
    return {
      el: `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).slice(0, 90)}`,
      text: (el.textContent || '').trim().slice(0, 50),
      left: Math.round(r.left),
      right: Math.round(r.right),
    }
  })
}
