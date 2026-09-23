import { useMagazineEngagement } from '../hooks/useMagazineEngagement.js'
import { magazineCountersVisible } from '../data/magazineConfig.js'

// Like button and live "reads" count for a magazine issue. The hook records a
// view even while the counter UI is hidden (magazineCountersVisible === false),
// so the numbers keep accumulating for the day the counter is switched on.
export default function MagazineEngagement({ issueId, className = '' }) {
  const { counts, liked, like, enabled } = useMagazineEngagement(issueId)
  if (!enabled) return null
  // Tracking already fired in the hook above, just hide the visible counter.
  if (!magazineCountersVisible) return null

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={like}
        disabled={liked}
        aria-pressed={liked}
        aria-label={liked ? 'Liked' : 'Like this issue'}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
          liked
            ? 'border-medical/40 bg-medical/15 text-medical-light'
            : 'border-white/15 bg-forest-800 text-silver/80 hover:border-medical/40 hover:text-white'
        }`}
      >
        <HeartIcon filled={liked} />
        {liked ? 'Liked' : 'Like'}
        <span className="tabular-nums text-silver/60">{counts.likes}</span>
      </button>

      <span className="inline-flex items-center gap-1.5 text-sm text-silver/55">
        <EyeIcon />
        <span className="tabular-nums">{counts.views}</span>
        {counts.views === 1 ? 'read' : 'reads'}
      </span>
    </div>
  )
}

function HeartIcon({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20s-7-4.6-9.2-9A4.6 4.6 0 0 1 12 6.5 4.6 4.6 0 0 1 21.2 11C19 15.4 12 20 12 20Z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}
