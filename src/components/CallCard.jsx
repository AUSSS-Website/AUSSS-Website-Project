import { readableAccent, rgba } from '../lib/color.js'
import { formatDeadline, daysLeft } from '../hooks/useCalls.js'

// One Open Call on a committee page. Committee-accented, same card chrome as
// the "What we do" tiles it sits near.

export default function CallCard({ call, color, onApply }) {
  const accent = readableAccent(color)
  const positions = Array.isArray(call.positions) ? call.positions : []
  const left = daysLeft(call.deadline)
  const closingSoon = left !== null && left <= 7

  return (
    <li className="flex flex-col rounded-2xl border border-white/10 bg-forest-800 p-6">
      {(call.kind || call.deadline) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {call.kind && (
            <span
              className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ background: rgba(color, 0.18), color: accent }}
            >
              {call.kind}
            </span>
          )}
          {call.deadline && (
            <span
              className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${
                closingSoon ? 'text-amber-300' : 'text-silver/50'
              }`}
            >
              {left !== null && left <= 0
                ? 'Closes today'
                : closingSoon
                  ? `${left} day${left === 1 ? '' : 's'} left`
                  : `Closes ${formatDeadline(call.deadline)}`}
            </span>
          )}
        </div>
      )}

      <h3 className="heading-serif text-2xl text-white">{call.title}</h3>

      {call.summary && (
        <p className="mt-3 text-sm leading-relaxed text-silver/80">{call.summary}</p>
      )}

      {call.description && (
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-silver/70">
          {call.description
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}
        </div>
      )}

      {positions.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-silver/45">
            Open positions
          </p>
          <ul className="mt-3 space-y-2">
            {positions.map((p) => (
              <li key={p.id} className="flex gap-3 text-sm text-silver/80">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: accent }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="font-semibold text-white">{p.title}</span>
                  {p.slots && <span className="text-silver/50"> · {p.slots}</span>}
                  {p.blurb && (
                    <span className="block text-xs leading-relaxed text-silver/60">
                      {p.blurb}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {call.commitment && (
        <p className="mt-5 text-xs text-silver/55">
          <span className="font-semibold text-silver/70">Commitment:</span>{' '}
          {call.commitment}
        </p>
      )}

      {/* mt-auto keeps the button on the baseline across a row of cards. */}
      <div className="mt-auto pt-6">
        <button
          type="button"
          onClick={() => onApply(call)}
          className="w-full rounded-full px-5 py-2.5 text-sm font-semibold text-forest-950 transition-opacity hover:opacity-90 sm:w-auto"
          style={{ background: accent }}
        >
          Apply
          <span className="sr-only"> for {call.title}</span>
        </button>
      </div>
    </li>
  )
}
