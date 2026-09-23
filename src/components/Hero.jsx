import { useRef } from 'react'
import ECGBackground from './ECGBackground.jsx'
import CountUp from './CountUp.jsx'
import Button from './ui/Button.jsx'
import { useMemberCount } from '../hooks/useMemberCount.js'

export default function Hero() {
  // The ECG baseline anchors just below this CTA row on every viewport.
  const ctaRef = useRef(null)
  // The logo img: the trace's big spikes sync to its printed ECG spikes.
  const logoRef = useRef(null)
  const memberCount = useMemberCount()
  return (
    <section
      id="home"
      // select-none + no touch callout: tapping/holding to play with the ECG
      // shouldn't select text or pop the long-press image menu on mobile.
      // min-h-svh (not screen/100vh): on phones 100vh changes as the URL bar
      // collapses, reflowing the whole page on scroll, svh stays stable.
      className="relative flex min-h-svh select-none items-center overflow-hidden bg-black"
      style={{ WebkitTouchCallout: 'none' }}
    >
      {/* Black stage: near-black base easing into forest at the bottom so
          the seam into the next section still blends. The canvas draws the
          stage lights and the ECG trace. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-black to-forest-950" />
      {/* Baseline lays across the middle of the CTA row. */}
      <ECGBackground anchorRef={ctaRef} logoRef={logoRef} band={0.68} />

      <div className="container-prose relative z-10 py-32 text-center">
        <p className="animate-fade-in mb-4 inline-flex items-center gap-2 rounded-full border border-medical/40 bg-medical/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-medical-light">
          <span aria-hidden="true">✦</span>
          55 Years of Youth · 55 Years of Impact
        </p>

        <p className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.25em] text-silver">
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
          className="animate-fade-up mx-auto h-52 w-auto sm:h-64 lg:h-80"
        />

        <p
          className="animate-fade-up heading-serif mx-auto mt-8 text-balance text-4xl text-white sm:text-6xl"
          style={{ animationDelay: '0.1s' }}
        >
          Life Savers, <span className="text-medical-light">Change Makers</span>
        </p>

        <p
          className="animate-fade-up mx-auto mt-5 max-w-2xl text-balance text-base font-light text-silver/80 sm:text-xl"
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
          className="animate-fade-in mx-auto mt-20 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] sm:grid-cols-4"
          style={{ animationDelay: '0.5s' }}
        >
          {[
            [memberCount.toLocaleString(), 'Members'],
            ['10', 'Committees and divisions'],
            ['300+', 'Exchange students hosted'],
            ['80+', 'Campaigns a year'],
          ].map(([v, l]) => (
            <div key={l} className="bg-forest-900/40 px-4 py-6 backdrop-blur-sm">
              <div className="heading-serif text-3xl text-white">
                <CountUp value={v} />
              </div>
              <div className="mt-1 text-xs uppercase tracking-widest text-silver/70">
                {l}
              </div>
            </div>
          ))}
        </div>

        <p
          className="animate-fade-in mx-auto mt-8 max-w-2xl text-sm font-light text-silver/70 sm:text-base"
          style={{ animationDelay: '0.6s' }}
        >
          This year, AUSSS officially celebrates its{' '}
          <span className="font-semibold text-medical-light">
            55th anniversary
          </span>
          .
        </p>
      </div>
    </section>
  )
}
