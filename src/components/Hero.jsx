import { useRef, useState } from 'react'
import ECGBackground from './ECGBackground.jsx'
import CountUp from './CountUp.jsx'
import Button from './ui/Button.jsx'
import { useMemberCount } from '../hooks/useMemberCount.js'

// Two taps or clicks on the logo this close together, in time (ms) and in
// place (px), count as a double click. Counted by hand because phones do not
// all send dblclick for a double tap.
const DOUBLE_MS = 350
const DOUBLE_PX = 30

export default function Hero() {
  // The ECG baseline anchors just below this CTA row on every viewport.
  const ctaRef = useRef(null)
  // The logo img: the trace's big spikes sync to its printed ECG spikes.
  const logoRef = useRef(null)
  const memberCount = useMemberCount()
  // The heartbeat is off until the logo is double-clicked (or double-tapped);
  // doing it again turns it off.
  const [ecgOn, setEcgOn] = useState(false)
  const lastTap = useRef(null)
  const onLogoTap = (e) => {
    const prev = lastTap.current
    const now = e.timeStamp
    if (prev && now - prev.t < DOUBLE_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_PX) {
      lastTap.current = null
      setEcgOn((v) => !v)
      return
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY }
  }
  return (
    <section
      id="home"
      // select-none + no touch callout: tapping/holding to play with the ECG
      // shouldn't select text or pop the long-press image menu on mobile.
      // min-h-svh (not screen/100vh): on phones 100vh changes as the URL bar
      // collapses, reflowing the whole page on scroll, svh stays stable.
      className="relative flex min-h-svh select-none items-center overflow-hidden bg-page dark:bg-black"
      style={{ WebkitTouchCallout: 'none' }}
    >
      {/* The stage. Dark theme: near-black easing into forest at the bottom,
          so the seam into the next section blends. Light theme: a pale band
          easing into the page. The canvas draws the stars and the ECG trace
          in the colours of the theme. */}
      <div className="absolute inset-0 bg-gradient-to-b from-sunk via-page to-page dark:from-black dark:via-black" />
      {/* Baseline lays across the middle of the CTA row. */}
      <ECGBackground anchorRef={ctaRef} logoRef={logoRef} band={0.68} on={ecgOn} />

      <div className="container-prose relative z-10 py-32 text-center">
        <p className="animate-fade-in mb-4 inline-flex items-center gap-2 rounded-full border border-medical/40 bg-medical/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-accent">
          <span aria-hidden="true">✦</span>
          55 Years of Youth · 55 Years of Impact
        </p>

        <p className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-line/15 bg-veil/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.25em] text-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-medical-light" />
          Ain Shams University · Faculty of Medicine
        </p>

        <h1 className="sr-only">
          AUSSS, Ain Shams University Students’ Scientific Society (IFMSA Ain
          Shams) · Life Savers, Change Makers
        </h1>
        <img
          ref={logoRef}
          src="/assets/brand/ausss-vertical-white.png"
          alt="AUSSS"
          // This is the LCP element, hint the browser to fetch it first.
          fetchpriority="high"
          decoding="async"
          draggable={false}
          onPointerUp={onLogoTap}
          // manipulation: a double tap on the logo is ours, not the browser's zoom.
          style={{ touchAction: 'manipulation' }}
          className="logo-ink animate-fade-up mx-auto h-52 w-auto sm:h-64 lg:h-80"
        />

        <p
          className="animate-fade-up heading-serif mx-auto mt-8 text-balance text-4xl text-ink sm:text-6xl"
          style={{ animationDelay: '0.1s' }}
        >
          Life Savers, <span className="text-accent">Change Makers</span>
        </p>

        <p
          className="animate-fade-up mx-auto mt-5 max-w-2xl text-balance text-base font-light text-soft/80 sm:text-xl"
          style={{ animationDelay: '0.2s' }}
        >
          Science, health and humanity, driven by Ain Shams’ medical students.
        </p>

        <div
          ref={ctaRef}
          className="animate-fade-up mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
          style={{ animationDelay: '0.3s' }}
        >
          <Button to="/join" size="lg" className="w-full sm:w-auto">
            Join the Society
          </Button>
          <Button href="#about" variant="outline" size="lg" className="w-full sm:w-auto">
            Discover our mission
          </Button>
        </div>

        <div
          className="animate-fade-in mx-auto mt-20 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line/10 bg-veil/[0.06] sm:grid-cols-4"
          style={{ animationDelay: '0.5s' }}
        >
          {[
            [memberCount.toLocaleString(), 'Members'],
            ['10', 'Committees and divisions'],
            ['300+', 'Exchange students hosted'],
            ['80+', 'Campaigns a year'],
          ].map(([v, l]) => (
            <div key={l} className="bg-sunk/40 px-4 py-6 backdrop-blur-sm">
              <div className="heading-serif text-3xl text-ink">
                <CountUp value={v} />
              </div>
              <div className="mt-1 text-xs uppercase tracking-widest text-soft/70">
                {l}
              </div>
            </div>
          ))}
        </div>

        <p
          className="animate-fade-in mx-auto mt-8 max-w-2xl text-sm font-light text-soft/70 sm:text-base"
          style={{ animationDelay: '0.6s' }}
        >
          This year, AUSSS officially celebrates its{' '}
          <span className="font-semibold text-accent">
            55th anniversary
          </span>
          .
        </p>
      </div>
    </section>
  )
}
