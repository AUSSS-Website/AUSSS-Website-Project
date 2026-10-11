import { useEffect, useRef } from 'react'

// Accessible modal plumbing for dialogs/drawers. While `active`:
//   • remembers what was focused, moves focus into the container, and restores
//     it on close (so keyboard users aren't dumped at <body>),
//   • traps Tab / Shift+Tab inside the container,
//   • calls onClose() on Escape.
// Returns a ref to put on the dialog container.
export default function useFocusTrap(active, onClose) {
  const ref = useRef(null)

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
        onClose?.()
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

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      // Restore focus to the trigger if it's still in the document.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [active, onClose])

  return ref
}
