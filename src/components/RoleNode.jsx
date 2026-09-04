import { useEffect, useId, useRef, useState } from 'react'
import { readableAccent, rgba } from '../lib/color.js'

// One position in the exchange hierarchy, with its explanation in a card that
// appears on hover.
//
// Hover alone would hide the explanation from half the people who need it, so
// the node is a real button: it also opens on keyboard focus and on tap, and
// closes on Escape, on blur, or when you point somewhere else. The description
// is wired up with aria-describedby, so a screen reader gets it whether or not
// the card is visible.
export default function RoleNode({ role, tier = 'officer' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrapRef = useRef(null)
  const accent = readableAccent(role.color)
  const isOfficer = tier === 'officer'

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={id}
        aria-expanded={open}
        // Open, never toggle: on touch the tap fires focus first, so a toggle
        // here would open the card and immediately shut it again. Tapping
        // elsewhere or pressing Escape is what closes it.
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!wrapRef.current?.contains(e.relatedTarget)) setOpen(false)
        }}
        className={`w-full rounded-2xl border bg-forest-800 text-left transition-colors ${
          isOfficer ? 'p-6' : 'p-5'
        } ${open ? 'border-white/30' : 'border-white/10 hover:border-white/25'}`}
      >
        <span
          className="inline-block rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ background: rgba(role.color, 0.2), color: accent }}
        >
          {role.committee || `Supports ${role.reportsTo}`}
        </span>
        <span
          className={`heading-serif mt-3 block text-white ${
            isOfficer ? 'text-2xl' : 'text-lg'
          }`}
        >
          {role.abbr}
        </span>
        <span className="mt-1 block text-sm leading-snug text-silver/60">
          {role.title}
        </span>
      </button>

      {/* The card. Deliberately NOT faded in and out: a half-transparent
          panel sitting over the tier below it is unreadable, and a 200ms fade
          spends 200ms in exactly that state every time it opens or closes. It
          snaps instead, on a solid ground and above everything else on the
          page. Still mounted while closed so aria-describedby keeps working;
          clamped so a node at the edge of the grid can't push the page
          sideways. */}
      <div
        id={id}
        role="tooltip"
        className={`absolute left-1/2 top-full z-50 w-[min(22rem,calc(100vw-2.5rem))] -translate-x-1/2 pt-3 ${
          open ? 'visible' : 'invisible'
        }`}
      >
        <div
          className="rounded-2xl border bg-forest-900 p-5 shadow-2xl shadow-black/60 ring-1 ring-black/20"
          style={{ borderColor: rgba(role.color, 0.45) }}
        >
          <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>
            {role.title}
          </p>
          <p className="mt-2.5 text-sm leading-relaxed text-silver/80">
            {role.about}
          </p>
          {role.email && (
            <a
              href={`mailto:${role.email}`}
              className="mt-3 inline-block text-xs font-semibold text-medical-light underline-offset-2 hover:text-white hover:underline"
            >
              {role.email}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
