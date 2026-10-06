// Monochrome brand glyphs (inherit `currentColor`). Keyed by a channel's `network`.
const PATHS = {
  instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  facebook: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <path
        d="M13.4 21v-6.4h2.15l.32-2.5H13.4v-1.6c0-.72.2-1.21 1.23-1.21h1.31V7.06c-.23-.03-1.01-.1-1.92-.1-1.9 0-3.2 1.16-3.2 3.29v1.84H8.6v2.5h2.22V21h2.58z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  tiktok: (
    <path d="M16 3c.4 2.6 2 4.2 4.5 4.4v3.1c-1.6.1-3.1-.4-4.5-1.3v6.3a6 6 0 1 1-6-6c.3 0 .7 0 1 .1v3.2a3 3 0 1 0 2 2.8V3h3z" />
  ),
  linkedin: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <path d="M7.5 10.5V17M7.5 7.2v.1M11.5 17v-6.5M11.5 13.2c0-1.6 1.1-2.7 2.5-2.7s2.5 1.1 2.5 2.7V17" />
    </>
  ),
  youtube: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="4.5" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" />
    </>
  ),
  x: (
    <>
      <path d="M4 4h4.2L20 20h-4.2z" />
      <path d="M19.5 4l-6.6 7.2M11.1 12.8L4.5 20" />
    </>
  ),
}

export default function SocialIcon({ name, className = 'h-6 w-6' }) {
  const glyph = PATHS[name]
  if (!glyph) return null
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  )
}
