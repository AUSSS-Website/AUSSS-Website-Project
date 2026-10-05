import { useState } from 'react'
import { initials } from '../lib/text.js'

// A person's photo as a small round image, their initials when there is none
// or it fails to load. `src` is profiles.avatar_url: the photo they chose on
// their profile, otherwise the picture of the account they signed in with.

const SIZES = {
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-9 w-9 text-xs',
  nav: 'h-10 w-10 text-xs',
  row: 'h-12 w-12 text-sm',
  lg: 'h-20 w-20 text-xl',
}

export function Avatar({ name, src, size = 'md', className = '' }) {
  const [failedSrc, setFailedSrc] = useState('')
  const show = src && failedSrc !== src
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-page font-semibold text-soft/80 ring-1 ring-line/15 ${SIZES[size] || SIZES.md} ${className}`}
    >
      {show ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(name)
      )}
    </span>
  )
}
