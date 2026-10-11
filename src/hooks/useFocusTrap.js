import { useEffect, useRef } from 'react'

// Accessible modal plumbing for dialogs/drawers. While `active`:
//   • remembers what was focused, moves focus into the container, and restores
//     it on close (so keyboard users aren't dumped at <body>),
//   • traps Tab / Shift+Tab inside the container,
//   • calls onClose() on Escape.
// Returns a ref to put on the dialog container.
//
// `onClose` may be a new function on every render: it is read when Escape is
// pressed and never starts the trap over, so callers need not memoise it.

// The traps that are active, the latest last. Only that one answers a key
// pressed while the focus is outside its dialog, so two dialogs open at once
// close one at a time.
const activeTraps = []

export default function useFocusTrap(active, onClose) {
  const ref = useRef(null)

  // The trap used to be set up again whenever it was handed a new onClose,
  // and each time it gave the focus back to the page and then to the dialog's
  // first control: a parent that re-rendered pulled the keyboard out of
  // whatever field it was in.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return

    const previouslyFocused = document.activeElement

    const focusable = () =>
      Array.from(
        node.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    // Move focus in (first focusable, else the container itself).
    const first = focusable()[0]
    if (first) first.focus()
    else {
      node.setAttribute('tabindex', '-1')
      node.focus()
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      // The container itself can hold the focus: a click on plain text inside
      // one that has tabindex="-1" puts it there. Shift+Tab from it would step
      // out to the page behind, so it wraps like the first control does.
      if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === node)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    // The focus can leave the dialog while it is open: a click on plain text
    // in a container that cannot take the focus, or the removal of the
    // control that held it (the cart's last item), drops it on <body>. The
    // listener above hears nothing from there, so Escape did nothing and Tab
    // walked through the page behind. Such a key is caught here on its way
    // down from the document, before the page behind can answer it: Escape
    // closes the dialog, and Tab comes back in at its first control
    // (Shift+Tab at its last). A key pressed inside the dialog is left to
    // the listener above, so whatever is in the dialog still hears it first.
    const trap = {}
    activeTraps.push(trap)
    const onStrayKeyDown = (e) => {
      if (activeTraps[activeTraps.length - 1] !== trap || node.contains(e.target)) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      e.preventDefault()
      const items = focusable()
      const next = e.shiftKey ? items[items.length - 1] : items[0]
      next?.focus()
    }

    node.addEventListener('keydown', onKeyDown)
    document.addEventListener('keydown', onStrayKeyDown, true)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keydown', onStrayKeyDown, true)
      activeTraps.splice(activeTraps.indexOf(trap), 1)
      // Restore focus to the trigger if it's still in the document.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return ref
}
