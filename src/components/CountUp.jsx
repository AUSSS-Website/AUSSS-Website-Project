import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion.js'

// Parses "581" → {prefix:'', num:581, suffix:''},
// "300+" → {num:300, suffix:'+'}, "1.5M+" → {num:1.5, suffix:'M+'},
// "15,000" → {num:15000, suffix:''}. Non-numeric values pass through.
function parse(value) {
  const str = String(value)
  const m = str.match(/^(\D*?)([\d,]+(?:\.\d+)?)(.*)$/)
  if (!m)
    return { prefix: '', num: null, suffix: str, decimals: 0, grouped: false }
  const raw = m[2].replace(/,/g, '')
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
  // Only thousands-group if the source value was written with a comma
  // (so "15,000" keeps its comma but a year like "1969" stays plain).
  return {
    prefix: m[1],
    num: parseFloat(raw),
    suffix: m[3],
    decimals,
    grouped: m[2].includes(','),
  }
}

const fmt = (n, decimals, grouped) =>
  decimals > 0
    ? n.toFixed(decimals)
    : grouped
      ? Math.round(n).toLocaleString('en-US')
      : String(Math.round(n))

/**
 * Animated count-up that runs once when scrolled into view.
 * Falls back to the final value if reduced-motion is preferred or
 * the value isn't numeric. Drop-in for a stat number.
 */
export default function CountUp({ value, duration = 1400, className }) {
  const { prefix, num, suffix, decimals, grouped } = parse(value)
  const ref = useRef(null)
  // Pre-rendered HTML (scripts/prerender.mjs) shows the final figure: a
  // crawler must not read "0 Members". So does the first paint for a reader
  // who asked for less motion. For everyone else the count starts at 0.
  const first = () => {
    if (num == null) return value
    if (typeof window === 'undefined' || prefersReducedMotion()) {
      return prefix + fmt(num, decimals, grouped) + suffix
    }
    return prefix + '0' + suffix
  }
  const [display, setDisplay] = useState(first)
  // A figure that is replaced (the live content arriving, an edit in the
  // portal preview) starts from its own first frame, in the same render. The
  // count below only begins once the figure is on screen, and a figure made of
  // words never counts, so without this the old text would stay up.
  const [shownFor, setShownFor] = useState(value)
  if (!Object.is(shownFor, value)) {
    setShownFor(value)
    setDisplay(first())
  }

  useEffect(() => {
    if (num == null) return
    const el = ref.current
    if (!el) return

    const settle = () =>
      setDisplay(prefix + fmt(num, decimals, grouped) + suffix)

    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      settle()
      return
    }

    let raf = 0
    const run = () => {
      const start = performance.now()
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration)
        // easeOutCubic
        const eased = 1 - Math.pow(1 - t, 3)
        setDisplay(prefix + fmt(num * eased, decimals, grouped) + suffix)
        if (t < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          obs.disconnect()
          run()
        }
      },
      { threshold: 0.4 },
    )
    obs.observe(el)
    return () => {
      obs.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  )
}
