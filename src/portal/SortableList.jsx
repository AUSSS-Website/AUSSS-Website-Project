import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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
// and letting go calls onReorder with every id in the new order. With the
// handle focused, the up and down arrow keys move the row one place, so the
// order can be changed without a pointer; a screen reader hears each move.
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

// How close to the top or bottom of the window the pointer starts scrolling
// the page, and how fast at the very edge (px per frame).
const EDGE = 72
const SPEED = 14

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
  // The row in the air: { id, from, to, dy, shift }.
  const [drag, setDrag] = useState(null)
  const [said, setSaid] = useState('')
  const rows = useRef(new Map())
  const handles = useRef(new Map())
  const live = useRef(null) // measurements of the drag in progress
  const refocus = useRef(null)

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

  // Stop a drag that is still running if the list goes away.
  useEffect(() => () => cancelAnimationFrame(live.current?.frame), [])

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
    const rects = ids.map((x) => rows.current.get(x)?.getBoundingClientRect())
    if (from === -1 || rects.some((r) => !r)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0
    live.current = {
      pointer: e.pointerId,
      id,
      from,
      startPageY: e.clientY + window.scrollY,
      clientY: e.clientY,
      centers: rects.map((r) => r.top + window.scrollY + r.height / 2),
      frame: requestAnimationFrame(tick),
    }
    setDrag({ id, from, to: from, dy: 0, shift: rects[from].height + gap })
  }

  const move = (e) => {
    const m = live.current
    if (!m || e.pointerId !== m.pointer) return
    m.clientY = e.clientY
    update()
  }

  const end = (e, cancelled) => {
    const m = live.current
    if (!m || e.pointerId !== m.pointer) return
    cancelAnimationFrame(m.frame)
    live.current = null
    setDrag(null)
    if (cancelled) return
    // Worked out from the pointer itself, not from the last drawn frame.
    const dy = e.clientY + window.scrollY - m.startPageY
    const to = dropIndex(m.centers, m.from, m.centers[m.from] + dy)
    if (to === m.from) return
    commit(moveId(ids, m.from, to), getLabel(byId.get(m.id)), to)
  }

  const key = (id, e) => {
    if (disabled || drag) return
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (step === 0) return
    e.preventDefault()
    const from = ids.indexOf(id)
    const to = from + step
    if (to < 0 || to >= ids.length) return
    refocus.current = id
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
    return { transform: `translateY(${y}px)`, transition: 'transform 160ms ease' }
  }

  return (
    <>
      <ul className={className}>
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
              className={`grid h-10 w-8 shrink-0 touch-none select-none place-items-center rounded-lg text-soft/45 transition-colors hover:bg-veil/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60 disabled:opacity-30 ${
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
              className={`${itemClassName} ${lifted ? 'shadow-xl shadow-black/25 ring-1 ring-medical/50' : ''}`}
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
