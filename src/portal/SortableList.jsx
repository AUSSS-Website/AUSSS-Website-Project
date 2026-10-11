import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion.js'

// A vertical list whose rows are put in order by dragging.
//
//   <SortableList
//     items={albums}
//     getId={(a) => a.id}
//     getLabel={(a) => a.title}
//     onReorder={(ids) => save(ids)}
//     renderItem={(a, handle) => <div className="flex">{handle} …</div>}
//   />
//
// Each row is dragged by its handle (renderItem decides where it sits), with a
// mouse, a finger or a pen: the row follows the pointer, the others make room,
// and letting go calls onReorder with every id in the new order. Escape while
// a row is in the air puts it back where it was and changes nothing. With the
// handle focused, the up and down arrow keys move the row one place, so the
// order can be changed without a pointer; a screen reader hears each move.
//
// A row that is let go, put back or moved by a key glides to its place from
// where it was drawn, and does not jump there. A reader who has asked for less
// motion gets the jump, and the rows that make room during a drag do so at
// once.
//
// The list shows the new order at once and keeps it until the parent passes a
// new `items` array (the saved order, or the old one if saving failed), so the
// parent should update its data when it saves.

// Where a dragged row lands: `centers` are the rows' middle lines in their
// starting order, `from` is the dragged row's index and `at` is where its
// middle is now. It moves past a row once its middle crosses that row's middle.
export function dropIndex(centers, from, at) {
  let to = from
  for (let i = 0; i < from; i++) {
    if (at < centers[i]) {
      to = i
      break
    }
  }
  for (let i = centers.length - 1; i > from; i--) {
    if (at > centers[i]) {
      to = i
      break
    }
  }
  return to
}

// `ids` with the entry at `from` moved to `to`.
export function moveId(ids, from, to) {
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

// How far each row has to travel to settle after the order has changed.
// `before` and `after` map a row's id to its top edge, in px: where it was
// drawn just before the change (in the air, or part-way through an earlier
// glide) and where the new order lays it out. A row that has less than half a
// px to go, or that is in only one of the two, is left out. Each entry is
// [id, how far above (negative) or below (positive) its place the row starts].
export function settleOffsets(before, after) {
  const moves = []
  for (const [id, top] of after) {
    const was = before.get(id)
    if (was == null) continue
    const dy = was - top
    if (Math.abs(dy) >= 0.5) moves.push([id, dy])
  }
  return moves
}

// How close to the top or bottom of the window the pointer starts scrolling
// the page, and how fast at the very edge (px per frame).
const EDGE = 72
const SPEED = 14

// The glide into place: quick off the mark and slowing in, with no overshoot.
const SETTLE_MS = 200
const SETTLE_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

function Grip() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

export default function SortableList({
  items,
  getId,
  getLabel,
  onReorder,
  renderItem,
  disabled = false,
  className = '',
  itemClassName = '',
}) {
  // The order shown while a save is on its way: ids, or null to follow `items`.
  const [pending, setPending] = useState(null)
  // The row in the air: { id, from, to, dy, shift, calm }. `calm` is true for
  // a reader who has asked for less motion.
  const [drag, setDrag] = useState(null)
  const [said, setSaid] = useState('')
  const list = useRef(null)
  const rows = useRef(new Map())
  const handles = useRef(new Map())
  const live = useRef(null) // measurements of the drag in progress
  const refocus = useRef(null)
  // For the glide into place: { at, lifted }, where each row was drawn just
  // before the order changed (see `tops`) and the id of the row that was moved,
  // which stays above the rows it passes. Null when no glide is due.
  const drawn = useRef(null)
  const glides = useRef([]) // the glides still running

  // A new array from the parent is the truth again.
  useEffect(() => setPending(null), [items])

  const byId = new Map(items.map((item) => [getId(item), item]))
  const ids = pending && pending.length === items.length && pending.every((id) => byId.has(id)) ? pending : items.map(getId)

  // Moving a row in the document can drop the keyboard focus; put it back.
  useLayoutEffect(() => {
    if (refocus.current == null) return
    handles.current.get(refocus.current)?.focus()
    refocus.current = null
  })

  const stopGlides = () => {
    for (const glide of glides.current) glide.cancel()
    glides.current = []
  }

  // Each row's top edge as it is drawn at this moment: in the air, moved
  // aside to make room, or part-way through a glide. Measured from the top of
  // the list itself, so nothing that scrolls in between changes it (giving a
  // handle the keyboard can scroll the page).
  const tops = () => {
    const from = list.current?.getBoundingClientRect().top ?? 0
    const at = new Map()
    for (const [id, el] of rows.current) at.set(id, el.getBoundingClientRect().top - from)
    return at
  }

  // The glide. A handler that is about to change what the list shows leaves
  // the rows' places in `drawn`; once the list is laid out again, each row
  // that is somewhere else starts from where it was and moves to where it now
  // belongs. A glide still running is ended first, so that the rows are
  // measured where they belong and the new one takes over from where the old
  // one had got to. A browser too old to animate shows the jump, as before.
  useLayoutEffect(() => {
    const before = drawn.current
    if (!before) return
    drawn.current = null
    stopGlides()
    if (prefersReducedMotion()) return
    for (const [id, dy] of settleOffsets(before.at, tops())) {
      const el = rows.current.get(id)
      if (typeof el?.animate !== 'function') continue
      glides.current.push(
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
          duration: SETTLE_MS,
          easing: SETTLE_EASING,
        }),
      )
      // The row that was moved stays on top until it has landed, as it was
      // while it hung in the air. Kept apart from the movement, which the
      // browser can then run without laying the page out again.
      if (id === before.lifted) {
        const above = { zIndex: 20, position: 'relative' }
        glides.current.push(el.animate([above, above], { duration: SETTLE_MS }))
      }
    }
  })

  // Stop a drag or a glide that is still running if the list goes away.
  useEffect(
    () => () => {
      cancelAnimationFrame(live.current?.frame)
      for (const glide of glides.current) glide.cancel()
    },
    [],
  )

  const commit = (next, label, to) => {
    setPending(next)
    setSaid(`${label} moved to position ${to + 1} of ${next.length}.`)
    onReorder(next)
  }

  const update = () => {
    const m = live.current
    if (!m) return
    const dy = m.clientY + window.scrollY - m.startPageY
    const to = dropIndex(m.centers, m.from, m.centers[m.from] + dy)
    setDrag((d) => (d && (d.dy !== dy || d.to !== to) ? { ...d, dy, to } : d))
  }

  // While the pointer rests near the top or bottom edge, scroll the page so a
  // long list can be dragged across.
  const tick = () => {
    const m = live.current
    if (!m) return
    const fromTop = m.clientY
    const fromBottom = window.innerHeight - m.clientY
    let by = 0
    if (fromTop < EDGE) by = -Math.ceil(((EDGE - fromTop) / EDGE) * SPEED)
    else if (fromBottom < EDGE) by = Math.ceil(((EDGE - fromBottom) / EDGE) * SPEED)
    if (by !== 0) {
      window.scrollBy(0, by)
      update()
    }
    m.frame = requestAnimationFrame(tick)
  }

  const start = (id, e) => {
    if (disabled || live.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    const from = ids.indexOf(id)
    // A row caught while it is still gliding is picked up where it is drawn,
    // not where it was heading: `rest` is how far it still had to go, and the
    // drag begins that far from the row's place so nothing jumps under the
    // pointer.
    const caught = rows.current.get(id)?.getBoundingClientRect().top
    stopGlides()
    const rects = ids.map((x) => rows.current.get(x)?.getBoundingClientRect())
    if (from === -1 || rects.some((r) => !r)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0
    const rest = caught - rects[from].top
    const centers = rects.map((r) => r.top + window.scrollY + r.height / 2)
    live.current = {
      pointer: e.pointerId,
      handle: e.currentTarget,
      id,
      from,
      label: getLabel(byId.get(id)),
      startPageY: e.clientY + window.scrollY - rest,
      clientY: e.clientY,
      centers,
      frame: requestAnimationFrame(tick),
    }
    setDrag({
      id,
      from,
      to: dropIndex(centers, from, centers[from] + rest),
      dy: rest,
      shift: rects[from].height + gap,
      calm: prefersReducedMotion(),
    })
  }

  const move = (e) => {
    const m = live.current
    if (!m || e.pointerId !== m.pointer) return
    m.clientY = e.clientY
    update()
  }

  // Ends the drag in progress and hands back its measurements. Where each row
  // is drawn at this moment is kept, so that the row in the air and any row
  // still making room glide from there to where they belong.
  const land = () => {
    const m = live.current
    cancelAnimationFrame(m.frame)
    live.current = null
    drawn.current = { at: tops(), lifted: m.id }
    setDrag(null)
    return m
  }

  const end = (e, cancelled) => {
    const m = live.current
    if (!m || e.pointerId !== m.pointer) return
    land()
    if (cancelled) return
    // Worked out from the pointer itself, not from the last drawn frame.
    const dy = e.clientY + window.scrollY - m.startPageY
    const to = dropIndex(m.centers, m.from, m.centers[m.from] + dy)
    if (to === m.from) return
    commit(moveId(ids, m.from, to), getLabel(byId.get(m.id)), to)
  }

  // Escape while a row is in the air puts it back and changes nothing. The key
  // is listened for on the whole page, since the keyboard need not be on the
  // handle the pointer is holding, and it goes no further: it has cancelled the
  // drag, and should not also close whatever the list stands in.
  const dragging = drag != null
  useEffect(() => {
    if (!dragging) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape' || !live.current) return
      e.preventDefault()
      e.stopPropagation()
      const m = land()
      // The pointer is still down. It is let go of, and what it does next is
      // no part of this drag.
      try {
        m.handle.releasePointerCapture?.(m.pointer)
      } catch {
        // The browser had already let go of it.
      }
      setSaid(`${m.label} was put back at position ${m.from + 1} of ${m.centers.length}.`)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // `land` only reads refs and sets state, so the one from the render that
    // began the drag is as good as any later one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  const key = (id, e) => {
    if (disabled || drag) return
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (step === 0) return
    e.preventDefault()
    const from = ids.indexOf(id)
    const to = from + step
    if (to < 0 || to >= ids.length) return
    refocus.current = id
    drawn.current = { at: tops(), lifted: id }
    commit(moveId(ids, from, to), getLabel(byId.get(id)), to)
  }

  const styleOf = (id, index) => {
    if (!drag) return undefined
    if (id === drag.id) {
      return { transform: `translateY(${drag.dy}px)`, zIndex: 20, position: 'relative' }
    }
    let y = 0
    if (drag.to < drag.from && index >= drag.to && index < drag.from) y = drag.shift
    if (drag.to > drag.from && index > drag.from && index <= drag.to) y = -drag.shift
    // The rows make room with a short slide, or at once when `calm`.
    return { transform: `translateY(${y}px)`, transition: drag.calm ? undefined : 'transform 160ms ease' }
  }

  return (
    <>
      <ul ref={list} className={className}>
        {ids.map((id, index) => {
          const item = byId.get(id)
          const label = getLabel(item)
          const lifted = drag?.id === id
          const handle = (
            <button
              type="button"
              ref={(el) => (el ? handles.current.set(id, el) : handles.current.delete(id))}
              disabled={disabled}
              onPointerDown={(e) => start(id, e)}
              onPointerMove={move}
              onPointerUp={(e) => end(e, false)}
              onPointerCancel={(e) => end(e, true)}
              onKeyDown={(e) => key(id, e)}
              aria-label={`Reorder ${label}: position ${index + 1} of ${ids.length}. Drag it, or press the up or down arrow key.`}
              title="Drag to reorder"
              // The grip is narrow to the eye; its ::after gives a finger 44px
              // each way, in px because the root size shrinks on a 320px phone.
              className={`relative grid h-10 w-8 shrink-0 touch-none select-none place-items-center rounded-lg text-soft/45 transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:bg-veil/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60 disabled:opacity-30 ${
                lifted ? 'cursor-grabbing text-ink' : 'cursor-grab'
              }`}
            >
              <Grip />
            </button>
          )
          return (
            <li
              key={id}
              ref={(el) => (el ? rows.current.set(id, el) : rows.current.delete(id))}
              style={styleOf(id, index)}
              // The lifted row's shadow and ring fade in as it is picked up
              // and out as it settles, in step with the glide.
              className={`${itemClassName} transition-shadow duration-200 ease-out ${lifted ? 'shadow-xl shadow-black/25 ring-1 ring-medical/50' : ''}`}
            >
              {renderItem(item, handle)}
            </li>
          )
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </>
  )
}
