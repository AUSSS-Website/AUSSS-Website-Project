import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../../../lib/motion.js'
import {
  FRAME_MS,
  easeShare,
  interpolate,
  matchAnchors,
  movedByHand,
  normalizeText,
  readingFraction,
  snippetOf,
  writtenAfter,
} from './previewFollow.js'

// The content editor's preview, when it sits beside the form (wide screens),
// scrolls on its own and follows the part of the form being worked on: the
// field that has the cursor while it is on screen, else the point a third of
// the way down the window. The form's fields and list rows carry
// data-anchor (RecordEditor.jsx); previewFollow.js matches each with the
// preview text it produced.
//
// The first time the preview is scrolled by hand, it stops following for as
// long as this editor is open; `follow()` turns it back on. A wheel, a touch,
// a scrolling key and a press on the scrollbar are heard as they happen. Every
// other way (a scrollbar drawn over the content, the browser's find in page)
// is caught by where the preview is: the following remembers the last place
// it put the preview, and a scroll that ends anywhere else was not its own.
//
//   const { following, follow } = usePreviewFollow({ formRef, boxRef, enabled, version })

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
const TYPED = 'input:not([type]), input[type="text"], input[type="url"], textarea'

// What was typed first inside a field or row.
function firstTyped(el) {
  for (const input of el.querySelectorAll(TYPED)) {
    if (input.value.trim()) return input.value
  }
  return ''
}

function hasOwnText(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.nodeValue.trim()) return true
  }
  return false
}

export default function usePreviewFollow({ formRef, boxRef, enabled, version }) {
  const [following, setFollowing] = useState(true)
  const active = enabled && following
  const activeRef = useRef(active)
  activeRef.current = active
  const pairs = useRef([])
  const target = useRef(null)
  const frame = useRef(0)
  const pending = useRef(0)
  // Where the easing has got to, to a fraction of a px (a scroll position is
  // read back rounded), and when its last frame was drawn. Null and 0 at rest.
  const spot = useRef(null)
  const stamp = useRef(0)
  // The last position the following gave the preview, as the browser kept it.
  const written = useRef(0)

  // Where every anchored field and row is, and where its text is in the preview.
  const measure = useCallback(() => {
    const form = formRef.current
    const box = boxRef.current
    if (!form || !box) return
    const sy = window.scrollY
    const boxRect = box.getBoundingClientRect()
    const origin = boxRect.top + box.clientTop - box.scrollTop
    const anchors = [...form.querySelectorAll('[data-anchor]')].map((el) => ({
      y: el.getBoundingClientRect().top + sy,
      snippet: snippetOf(firstTyped(el)),
    }))
    const elements = []
    for (const el of box.querySelectorAll('*')) {
      if (!hasOwnText(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      elements.push({ text: normalizeText(el.textContent), y: r.top - origin })
    }
    const formRect = form.getBoundingClientRect()
    const matched = matchAnchors(anchors, elements)
    const start = [formRect.top + sy, 0]
    const end = [formRect.bottom + sy, box.scrollHeight]
    pairs.current = [start, ...matched.filter(([x, y]) => x >= start[0] && x <= end[0] && y <= end[1]), end]
  }, [formRef, boxRef])

  // Ease the preview towards its target: a third of the way in a 60 Hz frame,
  // and the matching share in a shorter or longer one (easeShare). With
  // reduced motion it is put there at once.
  const tick = useCallback(
    (now) => {
      frame.current = 0
      const box = boxRef.current
      if (!box || !activeRef.current || target.current == null) return
      const goal = target.current
      // The first frame has none before it to measure from: it counts as one 60 Hz frame.
      const dt = stamp.current ? now - stamp.current : FRAME_MS
      stamp.current = now
      if (spot.current == null) spot.current = box.scrollTop
      const gap = goal - spot.current
      const arrived = prefersReducedMotion() || Math.abs(gap) < 0.5
      spot.current = arrived ? goal : spot.current + gap * easeShare(dt)
      box.scrollTop = spot.current
      // Read back, since the browser rounds the position and holds it inside the preview.
      written.current = box.scrollTop
      // Held short of where it was put: the preview ends sooner than the target
      // (it has just grown shorter), so there is nothing more to ease towards.
      const held = Math.abs(written.current - spot.current) > 1
      if (arrived || held) {
        spot.current = null
        stamp.current = 0
      } else {
        frame.current = requestAnimationFrame(tick)
      }
    },
    [boxRef],
  )

  // Where the preview should be for what is on screen in the form now.
  const place = useCallback(() => {
    const form = formRef.current
    const box = boxRef.current
    if (!activeRef.current || !form || !box) return
    const vh = window.innerHeight
    const sy = window.scrollY
    let line = vh * readingFraction(sy, vh, document.documentElement.scrollHeight)
    const focused = document.activeElement
    if (focused && focused !== form && form.contains(focused)) {
      const r = focused.getBoundingClientRect()
      if (r.bottom > 0 && r.top < vh) line = r.top + Math.min(r.height, 48) / 2
    }
    const boxRect = box.getBoundingClientRect()
    // The matching text sits level with the line where it can.
    const inBox = Math.min(1, Math.max(0, (line - boxRect.top) / box.clientHeight))
    const y = interpolate(pairs.current, line + sy)
    const max = box.scrollHeight - box.clientHeight
    target.current = Math.min(max, Math.max(0, y - box.clientHeight * inBox))
    if (!frame.current) frame.current = requestAnimationFrame(tick)
  }, [formRef, boxRef, tick])

  // Measure and place once per frame, however many things changed in it.
  const refresh = useCallback(() => {
    if (pending.current) return
    pending.current = requestAnimationFrame(() => {
      pending.current = 0
      if (!activeRef.current) return
      measure()
      place()
    })
  }, [measure, place])

  // The page scrolling, the window resizing, a field taking the cursor.
  useEffect(() => {
    if (!active) return undefined
    const form = formRef.current
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', refresh)
    form?.addEventListener('focusin', place)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh)
    if (ro) {
      if (form) ro.observe(form)
      if (boxRef.current?.firstElementChild) ro.observe(boxRef.current.firstElementChild)
    }
    refresh()
    return () => {
      window.removeEventListener('scroll', place)
      window.removeEventListener('resize', refresh)
      form?.removeEventListener('focusin', place)
      ro?.disconnect()
      cancelAnimationFrame(frame.current)
      cancelAnimationFrame(pending.current)
      frame.current = 0
      pending.current = 0
      spot.current = null
      stamp.current = 0
    }
  }, [active, formRef, boxRef, place, refresh])

  // What is typed changes the preview: measure again.
  useEffect(() => {
    if (active) refresh()
  }, [active, version, refresh])

  // The first scroll by hand ends the following.
  useEffect(() => {
    const box = boxRef.current
    if (!active || !box) return undefined
    const stop = () => {
      // A preview short enough to need no scrolling has nothing to follow or to stop.
      if (box.scrollHeight <= box.clientHeight) return
      cancelAnimationFrame(frame.current)
      frame.current = 0
      spot.current = null
      stamp.current = 0
      setFollowing(false)
    }
    const onKey = (e) => {
      if (SCROLL_KEYS.has(e.key) && !e.target.closest?.('input, textarea, select, button, a')) stop()
    }
    // A press on the scrollbar itself, which sits outside the content box.
    const onPointer = (e) => {
      if (e.target === box && e.offsetX >= box.clientWidth) stop()
    }
    // Whatever else moved it. The following's own steps end where it put them;
    // a move the browser made to keep the position inside a shorter preview is
    // taken as the new place to compare with, and a smaller one is not, so
    // that a slow scroll by hand adds up (writtenAfter).
    const onScroll = () => {
      const top = box.scrollTop
      if (movedByHand(top, written.current, box.scrollHeight - box.clientHeight)) stop()
      else written.current = writtenAfter(top, written.current)
    }
    written.current = box.scrollTop
    // While it follows, the browser must not shift the preview to hold its
    // content still as text above grows (scroll anchoring): that shift would
    // look like a hand, and the following places the preview itself.
    const anchoring = box.style.overflowAnchor
    box.style.overflowAnchor = 'none'
    box.addEventListener('wheel', stop, { passive: true })
    box.addEventListener('touchmove', stop, { passive: true })
    box.addEventListener('keydown', onKey)
    box.addEventListener('pointerdown', onPointer)
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      box.style.overflowAnchor = anchoring
      box.removeEventListener('wheel', stop)
      box.removeEventListener('touchmove', stop)
      box.removeEventListener('keydown', onKey)
      box.removeEventListener('pointerdown', onPointer)
      box.removeEventListener('scroll', onScroll)
    }
  }, [active, boxRef])

  const follow = useCallback(() => setFollowing(true), [])
  return { following, follow }
}
