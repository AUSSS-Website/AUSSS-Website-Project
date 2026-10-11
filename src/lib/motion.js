// Motion that gives way to the reader's "reduce motion" setting.
//
// Pages are pre-rendered in Node (scripts/prerender.mjs), where there is no
// window: everything here is safe to call there.

// True when the reader's system asks for less motion. False where that cannot
// be asked (Node, a browser without matchMedia).
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// The `behavior` for scrollTo, scrollBy and scrollIntoView: a jump for a
// reader who asked for less motion, a smooth scroll for everyone else. Ask at
// the moment of scrolling, since the setting can change while the page is open.
//
//   window.scrollTo({ top: 0, behavior: scrollBehavior() })
//   el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
export function scrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

// What every button shares: its colours ease over 150 ms, and it sinks a
// little the moment it is pressed, so the press is answered before the click
// lands. With reduced motion the button does not move; its colours still ease,
// since a colour change is not movement and it shows the press was taken. The
// scale is behind `motion-safe:` and not undone with `motion-reduce:transform-none`:
// a pressed rule outranks that class, and the class would also take away a
// transform that holds a button in place.
//
// Part of primaryBtnCls, outlineBtnCls and chipBtnCls in the portal and of
// <Button>; add it to a hand-typed button in place of its `transition-colors`.
export const pressCls =
  'transition-[color,background-color,border-color,transform] duration-150 ease-out motion-safe:active:scale-[0.97]'
