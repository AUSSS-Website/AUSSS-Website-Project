import { useState } from 'react'
import { readableAccent, rgba } from '../lib/color.js'
import { initials } from '../lib/text.js'

// Shared presentational pieces for the committee page, also reused by the
// officer editor's live preview, so what officers see while editing is the
// exact same component that renders on the public page (no drift).

export function PersonCard({ person, color }) {
  const accent = readableAccent(color)
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <div className="flex w-36 flex-col items-center text-center">
      <div
        className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-forest-950 text-lg font-semibold text-silver ring-2"
        style={{ '--tw-ring-color': rgba(color, 0.55) }}
      >
        {person.photo && !imgFailed ? (
          <img
            src={person.photo}
            alt={person.name || person.role || person.abbr}
            loading="lazy"
            // lh3.googleusercontent (Drive photos) 403s when a referrer is sent.
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          initials(person.name)
        )}
      </div>
      <span
        className={`mt-3 block text-sm font-semibold leading-tight ${
          person.name?.trim() ? 'text-white' : 'italic text-silver/35'
        }`}
      >
        {person.name?.trim() || 'Name TBA'}
      </span>
      {(person.abbr || person.role) && (
        <span
          className="mt-1 block text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: accent }}
        >
          {person.abbr || person.role}
        </span>
      )}
    </div>
  )
}

export function SectionLabel({ children, accent, center, noRule }) {
  return (
    <div className={center ? 'text-center' : ''}>
      <span
        className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] ${
          center ? 'justify-center' : ''
        }`}
        style={{ color: accent }}
      >
        {!noRule && (
          <span
            className="h-px w-8"
            style={{ background: accent }}
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    </div>
  )
}
