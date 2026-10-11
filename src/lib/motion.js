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
// since a colour change is not movement. The scale is behind `motion-safe:`
// and not undone with `motion-reduce:transform-none`: a pressed rule outranks
// that class, and the class would also take away a transform that holds a
// button in place.
//
// This class changes no colour by itself. A reader with reduced motion on a
// touch screen, where nothing hovers, sees a press only if the button also
// has a colour for it (`active:bg-cta-hover`, `active:bg-veil/20`), which
// then eases in through the transition here.
//
// Part of primaryBtnCls, outlineBtnCls and chipBtnCls in the portal and of
// <Button>, each with its pressed colour; add it to a hand-typed button in
// place of its `transition-colors`, and give that button an `active:` colour.
export const pressCls =
  'transition-[color,background-color,border-color,transform] duration-150 ease-out motion-safe:active:scale-[0.97]'
