import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { readableAccent, rgba } from '../lib/color.js'
import { initials } from '../lib/text.js'

/* ── Heba "Grandma" garden generator ───────────────────────────────────
   One main vine emerges from behind the photo and spirals around it.
   As it wraps, branches sprout at sampled points along its length, each
   ending in a flower with a leaf along the way. Sparkles fade in as the
   spiral passes. Uses a seeded PRNG so the composition feels organic
   but stays identical between renders. */
function buildHebaGarden() {
  const CX = 120
  const CY = 120
  const PHOTO_R = 58 // start the spiral hidden behind the photo edge
  const deg = (d) => (d * Math.PI) / 180
  const polar = (a, r) => [CX + r * Math.cos(deg(a)), CY - r * Math.sin(deg(a))]
  const fmt = (n) => n.toFixed(1)

  // Mulberry32, deterministic PRNG
  let seed = 0x9e3779b9 >>> 0
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const range = (lo, hi) => lo + rand() * (hi - lo)

  // Cubic Bezier interpolation, used for placing leaves along branches.
  const bezier = (P0, P1, P2, P3, t) => {
    const o = 1 - t
    return [
      o * o * o * P0[0] +
        3 * o * o * t * P1[0] +
        3 * o * t * t * P2[0] +
        t * t * t * P3[0],
      o * o * o * P0[1] +
        3 * o * o * t * P1[1] +
        3 * o * t * t * P2[1] +
        t * t * t * P3[1],
    ]
  }

  /* ── Main spiral ──────────────────────────────────────────────────── */
  // Start at 200° (emerges from behind her lower-left shoulder) and run
  // an extra wrap so the tail lands at 270°, the bottom of the photo.
  // Total = 3 full turns + 70° = 3.194 turns.
  const SPIRAL_DURATION = 7.0 // seconds, three wraps take a bit longer
  const SPIRAL_START_A = 200
  const SPIRAL_TURNS = 3.194
  const SPIRAL_START_R = 52 // hidden behind photo (r < PHOTO_R)
  const SPIRAL_END_R = 92 // small radial bump to fit the extra wrap
  const SPIRAL_STEPS = 320

  const spiralPoints = []
  for (let i = 0; i <= SPIRAL_STEPS; i++) {
    const t = i / SPIRAL_STEPS
    // Slight radial jitter so the curve doesn't look too mathematical
    const r =
      SPIRAL_START_R + (SPIRAL_END_R - SPIRAL_START_R) * t + (rand() - 0.5) * 2
    const a = SPIRAL_START_A + SPIRAL_TURNS * 360 * t
    const [x, y] = polar(a, r)
    spiralPoints.push({ x, y, a, r, t })
  }
  let spiralD = `M ${fmt(spiralPoints[0].x)},${fmt(spiralPoints[0].y)}`
  for (let i = 1; i < spiralPoints.length; i++) {
    spiralD += ` L ${fmt(spiralPoints[i].x)},${fmt(spiralPoints[i].y)}`
  }

  /* ── Branches ─────────────────────────────────────────────────────── */
  const TYPES = ['rose', 'rose', 'daisy', 'daisy', 'bud', 'bud', 'bud', 'bud']
  const BRANCH_COUNT = 32
  const BRANCH_T_START = 0.12 // skip the part hidden behind the photo
  const BRANCH_T_END = 0.97
  const branches = []
  for (let i = 0; i < BRANCH_COUNT; i++) {
    const baseT =
      BRANCH_T_START +
      (BRANCH_T_END - BRANCH_T_START) * ((i + 0.5) / BRANCH_COUNT)
    const t = baseT + range(-0.018, 0.018)
    const idx = Math.max(
      0,
      Math.min(SPIRAL_STEPS, Math.round(t * SPIRAL_STEPS)),
    )
    const root = spiralPoints[idx]

    // Branch direction: mostly radial (outward), with a side bias and jitter
    const sideSign = rand() < 0.5 ? -1 : 1
    const sideBias = sideSign * range(10, 28)
    const branchEndA = root.a + sideBias + range(-12, 12)
    const branchLen = range(14, 28)
    const branchEndR = root.r + branchLen
    const P0 = [root.x, root.y]
    const P3 = polar(branchEndA, branchEndR)
    const P1 = polar(
      root.a + sideBias * 0.4 + range(-8, 8),
      root.r + branchLen * range(0.32, 0.5),
    )
    const P2 = polar(
      branchEndA + range(-10, 10),
      branchEndR * range(0.76, 0.9),
    )

    // Leaf along the branch (interpolated on the Bezier)
    const leafT = range(0.5, 0.72)
    const [lx, ly] = bezier(P0, P1, P2, P3, leafT)
    const leafRot = 90 - branchEndA + range(-30, 30)
    const leafW = range(9.5, 12.5)

    // Flower at branch tip
    const type = TYPES[(i * 5) % TYPES.length]
    const flowerRot =
      type === 'bud'
        ? 90 - branchEndA + range(-18, 18) + 180
        : range(0, 360)
    const baseFlowerSize = type === 'rose' ? 17 : type === 'daisy' ? 14.5 : 9
    const flowerSize = baseFlowerSize * range(0.92, 1.12)

    const startTime = t * SPIRAL_DURATION
    branches.push({
      d: `M ${fmt(P0[0])},${fmt(P0[1])} C ${fmt(P1[0])},${fmt(P1[1])} ${fmt(P2[0])},${fmt(P2[1])} ${fmt(P3[0])},${fmt(P3[1])}`,
      w: range(0.9, 1.4).toFixed(2),
      opacity: range(0.82, 0.96).toFixed(2),
      startTime,
      leafX: lx,
      leafY: ly,
      leafRot,
      leafW,
      leafH: leafW * (20 / 14),
      leafStartTime: startTime + 0.22,
      flowerX: P3[0],
      flowerY: P3[1],
      flowerType: type,
      flowerSize,
      flowerRot,
      flowerStartTime: startTime + 0.38,
    })
  }

  /* ── Extra leaves and flowers ─────────────────────────────────────────
     Scattered between the branches so the floral density is ~20% higher
     than what one-leaf + one-flower per branch gives. */
  const EXTRA_COUNT = Math.round(BRANCH_COUNT * 0.2) // 7 of each
  const extraLeaves = []
  const extraFlowers = []
  for (let i = 0; i < EXTRA_COUNT; i++) {
    const t =
      BRANCH_T_START +
      (BRANCH_T_END - BRANCH_T_START) * ((i + 0.5) / EXTRA_COUNT) +
      range(-0.03, 0.03)
    const idx = Math.max(
      0,
      Math.min(SPIRAL_STEPS, Math.round(t * SPIRAL_STEPS)),
    )
    const root = spiralPoints[idx]
    const offsetA = root.a + (rand() < 0.5 ? -85 : 85) + range(-18, 18)
    const offsetR = root.r + range(6, 18)
    const [lx, ly] = polar(offsetA, offsetR)
    const w = range(8.5, 11.5)
    extraLeaves.push({
      x: lx,
      y: ly,
      rot: 90 - root.a + range(-30, 30),
      w,
      h: w * (20 / 14),
      startTime: t * SPIRAL_DURATION + 0.3,
    })
  }
  for (let i = 0; i < EXTRA_COUNT; i++) {
    const t =
      BRANCH_T_START +
      (BRANCH_T_END - BRANCH_T_START) * ((i + 0.5) / EXTRA_COUNT) +
      range(-0.04, 0.04)
    const idx = Math.max(
      0,
      Math.min(SPIRAL_STEPS, Math.round(t * SPIRAL_STEPS)),
    )
    const root = spiralPoints[idx]
    const offsetA = root.a + (rand() < 0.5 ? -90 : 90) + range(-15, 15)
    const offsetR = root.r + range(10, 22)
    const [fx, fy] = polar(offsetA, offsetR)
    const type = TYPES[(i * 3) % TYPES.length]
    const baseSize = type === 'rose' ? 14 : type === 'daisy' ? 12 : 8
    extraFlowers.push({
      x: fx,
      y: fy,
      type,
      size: baseSize * range(0.9, 1.1),
      rot:
        type === 'bud'
          ? 90 - root.a + range(-15, 15) + 180
          : range(0, 360),
      startTime: t * SPIRAL_DURATION + 0.45,
    })
  }

  /* ── Sparkle dots ─────────────────────────────────────────────────── */
  const sparkles = []
  const SPARKLE_COUNT = 22
  for (let i = 0; i < SPARKLE_COUNT; i++) {
    // Distribute angularly with jitter, radii varying across the halo
    const a = (360 / SPARKLE_COUNT) * i + range(-15, 15)
    const r = range(72, 118)
    const [sx, sy] = polar(a, r)
    // Light up roughly when the spiral wraps over that angle
    const angleSweep =
      ((a - SPIRAL_START_A + 720) % 360) / (SPIRAL_TURNS * 360)
    const t = Math.min(0.98, angleSweep + range(-0.04, 0.06))
    sparkles.push({
      x: sx,
      y: sy,
      r: range(0.7, 1.25),
      opacity: range(0.75, 1).toFixed(2),
      startTime: t * SPIRAL_DURATION + 0.35,
    })
  }

  return {
    spiral: { d: spiralD, duration: SPIRAL_DURATION },
    branches,
    sparkles,
    extraLeaves,
    extraFlowers,
  }
}

const HEBA_GARDEN = buildHebaGarden()

function RevealButton({ onReveal, label }) {
  return (
    <button
      onClick={onReveal}
      className="relative z-10 mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-silver/55 underline-offset-4 transition-colors hover:text-white hover:underline"
    >
      {label}
    </button>
  )
}

/* Render the member's additional positions as a stacked list under the
   primary role label. Used by both President and TeamMember cards when the
   record packs more than one current position. */
function AlsoServingAs({ positions, accent }) {
  if (!positions || positions.length === 0) return null
  return (
    <div className="relative mt-4 text-[11px] uppercase tracking-[0.18em]">
      <p className="text-silver/45">Also serving as</p>
      <ul className="mt-2 flex flex-col items-center gap-1.5">
        {positions.map((p) => (
          <li
            key={p}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 font-semibold text-silver/80"
            style={accent ? { color: accent, borderColor: 'rgba(255,255,255,0.18)' } : undefined}
          >
            {p}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── President: dry, sarcastic ───────────────────────────────────────── */
function President({ onReveal, otherPositions }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#C9A33B]/30 bg-gradient-to-br from-forest-800 to-forest-950 p-10 text-center sm:p-14">
      <span className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#C9A33B]/10 blur-3xl" />
      <div className="relative mx-auto h-32 w-32 sm:h-36 sm:w-36">
        <div className="h-full w-full overflow-hidden rounded-full bg-gradient-to-br from-[#C9A33B]/25 to-amber-300/10 ring-2 ring-[#E7C763]/45">
          <img
            src="/assets/team/amr-hesham.jpg"
            alt="Amr Hesham"
            className="h-full w-full object-cover"
          />
        </div>
        {/* Crown perched on his head, slight tilt for personality */}
        <svg
          viewBox="0 0 24 24"
          className="absolute -top-5 left-1/2 h-10 w-10 -translate-x-1/2 -rotate-[14deg] text-[#E7C763] drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] sm:-top-6 sm:h-12 sm:w-12"
          fill="#E7C763"
          fillOpacity="0.22"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" strokeLinejoin="round" />
          <path d="M5 21h14" strokeLinecap="round" />
        </svg>
      </div>
      <p className="heading-serif relative mt-4 text-2xl text-white sm:text-3xl">
        Amr Hesham Shaker
      </p>
      <p className="relative mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-[#E7C763]">
        AUSSS · Office of the President
      </p>
      <p className="relative mt-2 text-sm italic text-silver/65">
        “Making AUSSS Great Again”
      </p>
      <h2 className="heading-serif relative mt-4 text-4xl text-white sm:text-5xl">
        You’re the President.
      </h2>
      <p className="relative mx-auto mt-5 max-w-lg text-lg font-light leading-relaxed text-silver/80">
        …why are you looking up your own membership status? You run this place.
      </p>
      <p className="relative mx-auto mt-3 max-w-lg text-sm text-silver/55">
        Constitution §9: “the organisation shall be managed by the Executive
        Board.” You’d know. You signed it.
      </p>
      <AlsoServingAs positions={otherPositions} accent="#E7C763" />
      <RevealButton onReveal={onReveal} label="Fine, show it anyway →" />
    </div>
  )
}

/* ── Heba Ismail: past president, current Supervising Council ───────── */
function Heba({ onReveal }) {
  const cardRef = useRef(null)

  // GSAP + ScrollTrigger: when the card enters the viewport, draw the vines
  // out from behind the photo, pop the leaves, blossom the flowers, twinkle
  // the sparkles. Respects prefers-reduced-motion by jumping to the end.
  useEffect(() => {
    const root = cardRef.current
    if (!root) return
    let ctx
    let cancelled = false
    ;(async () => {
      let gsap, scrollTriggerMod
      try {
        ;[{ gsap }, scrollTriggerMod] = await Promise.all([
          import('gsap'),
          import('gsap/ScrollTrigger'),
        ])
      } catch {
        // GSAP couldn't load, reveal the (static) garden so the CSS pre-hide
        // doesn't leave it permanently invisible.
        if (!cancelled) root.classList.add('hb-ready')
        return
      }
      if (cancelled) return
      const ScrollTrigger = scrollTriggerMod.ScrollTrigger || scrollTriggerMod.default
      gsap.registerPlugin(ScrollTrigger)

      ctx = gsap.context(() => {
        const spiralEl = root.querySelector('.hb-spiral')
        const branchEls = Array.from(root.querySelectorAll('.hb-branch'))
        const leafEls = Array.from(root.querySelectorAll('.hb-leaf'))
        const bloomEls = Array.from(root.querySelectorAll('.hb-bloom'))
        const sparkleEls = Array.from(root.querySelectorAll('.hb-sparkle'))

        // Prep all stem paths so they can be drawn via stroke-dashoffset
        // opacity:1 here matters, the CSS pre-hide (see index.css) sets these
        // to opacity:0 to kill the load flash, and the timeline only animates
        // strokeDashoffset, so without restoring opacity they'd draw invisibly.
        if (spiralEl) {
          const len = spiralEl.getTotalLength()
          gsap.set(spiralEl, {
            strokeDasharray: len,
            strokeDashoffset: len,
            opacity: 1,
          })
        }
        branchEls.forEach((el) => {
          const len = el.getTotalLength()
          gsap.set(el, {
            strokeDasharray: len,
            strokeDashoffset: len,
            opacity: 1,
          })
        })
        gsap.set([...leafEls, ...bloomEls, ...sparkleEls], {
          scale: 0,
          opacity: 0,
          transformOrigin: '50% 50%',
        })

        const reduced = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: root,
            start: 'top 78%',
            once: true,
          },
        })

        // 1. The main spiral draws continuously (linear ease so the per-
        //    branch timing maps 1:1 to spiral progress)
        tl.to(
          spiralEl,
          {
            strokeDashoffset: 0,
            duration: HEBA_GARDEN.spiral.duration,
            ease: 'none',
          },
          0,
        )

        // 2. Each branch starts drawing when the spiral passes its origin
        branchEls.forEach((el) => {
          const t = parseFloat(el.dataset.startTime)
          tl.to(
            el,
            {
              strokeDashoffset: 0,
              duration: 0.55,
              ease: 'power2.out',
            },
            t,
          )
        })

        // 3. Each leaf pops once its branch starts
        leafEls.forEach((el) => {
          const t = parseFloat(el.dataset.startTime)
          tl.to(
            el,
            {
              scale: 1,
              opacity: 1,
              duration: 0.45,
              ease: 'back.out(1.7)',
            },
            t,
          )
        })

        // 4. Each flower blooms after its branch finishes drawing
        bloomEls.forEach((el) => {
          const t = parseFloat(el.dataset.startTime)
          tl.to(
            el,
            {
              scale: 1,
              opacity: 1,
              duration: 0.55,
              ease: 'back.out(1.9)',
            },
            t,
          )
        })

        // 5. Sparkles fade in roughly as the spiral wraps over them
        sparkleEls.forEach((el) => {
          const t = parseFloat(el.dataset.startTime)
          tl.to(
            el,
            {
              scale: 1,
              opacity: 1,
              duration: 0.4,
              ease: 'power1.out',
            },
            t,
          )
        })

        if (reduced) {
          tl.progress(1).pause()
          tl.scrollTrigger?.kill()
        }
      }, root)
    })()
    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [])

  return (
    <div
      ref={cardRef}
      className="relative overflow-hidden rounded-3xl border border-[#D4A85C]/35 bg-gradient-to-br from-forest-800 via-forest-900 to-forest-950 p-10 text-center sm:p-14"
    >
      <span className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#D4A85C]/12 blur-3xl" />
      <span className="pointer-events-none absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-rose-300/10 blur-3xl" />

      <div className="relative mx-auto h-60 w-60 sm:h-72 sm:w-72">
        <svg
          viewBox="0 0 240 240"
          className="absolute inset-0 h-full w-full"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            {/* Leaf, central vein + three pairs of side veins for detail */}
            <symbol id="hb-leaf-sym" viewBox="-7 -10 14 20">
              <path
                d="M 0,-9 C 5.5,-7.5 6.5,4 0,9.5 C -6.5,4 -5.5,-7.5 0,-9 Z"
                fill="currentColor"
              />
              <path
                d="M 0,-7 V 7.5"
                stroke="rgba(7,42,28,0.45)"
                strokeWidth="0.55"
                fill="none"
                strokeLinecap="round"
              />
              <g
                stroke="rgba(7,42,28,0.32)"
                strokeWidth="0.32"
                fill="none"
                strokeLinecap="round"
              >
                <path d="M 0,-4 Q 1.5,-3.6 3.2,-2.2" />
                <path d="M 0,-4 Q -1.5,-3.6 -3.2,-2.2" />
                <path d="M 0,0 Q 1.8,0.6 3.6,2.4" />
                <path d="M 0,0 Q -1.8,0.6 -3.6,2.4" />
                <path d="M 0,3 Q 1.5,3.6 2.7,5.2" />
                <path d="M 0,3 Q -1.5,3.6 -2.7,5.2" />
              </g>
            </symbol>

            {/* Rose, three layered petal rings, soft outline, highlights */}
            <symbol id="hb-rose-sym" viewBox="-10 -10 20 20">
              <g>
                <circle cx="0" cy="-5" r="4.2" fill="#F2B1B1" />
                <circle cx="-4.8" cy="-1.4" r="4.2" fill="#F2B1B1" />
                <circle cx="4.8" cy="-1.4" r="4.2" fill="#F2B1B1" />
                <circle cx="-3" cy="4.5" r="4.2" fill="#F2B1B1" />
                <circle cx="3" cy="4.5" r="4.2" fill="#F2B1B1" />
              </g>
              <g
                fill="none"
                stroke="#D88B8B"
                strokeWidth="0.45"
                opacity="0.45"
              >
                <circle cx="0" cy="-5" r="4.2" />
                <circle cx="-4.8" cy="-1.4" r="4.2" />
                <circle cx="4.8" cy="-1.4" r="4.2" />
                <circle cx="-3" cy="4.5" r="4.2" />
                <circle cx="3" cy="4.5" r="4.2" />
              </g>
              <g>
                <circle cx="0" cy="-2.6" r="2.5" fill="#F8C6C6" />
                <circle cx="-2.4" cy="0.7" r="2.5" fill="#F8C6C6" />
                <circle cx="2.4" cy="0.7" r="2.5" fill="#F8C6C6" />
              </g>
              <ellipse cx="-1.4" cy="-4.2" rx="1" ry="1.4" fill="#FBDCDC" opacity="0.85" />
              <ellipse cx="3.4" cy="-1.6" rx="0.85" ry="1.2" fill="#FBDCDC" opacity="0.65" />
              <ellipse cx="-3.4" cy="-1.6" rx="0.85" ry="1.2" fill="#FBDCDC" opacity="0.55" />
              <circle cx="0" cy="0" r="1.8" fill="#E7C879" />
              <circle cx="-0.4" cy="-0.4" r="0.7" fill="#F2D89E" opacity="0.95" />
              <circle cx="0.5" cy="0.5" r="0.45" fill="#B68641" />
            </symbol>

            {/* Daisy: 8 cream petals + gold disc */}
            <symbol id="hb-daisy-sym" viewBox="-9 -9 18 18">
              <g fill="#F8E8C8">
                <ellipse cx="0" cy="-6" rx="1.8" ry="4.6" />
                <ellipse
                  cx="0"
                  cy="-6"
                  rx="1.8"
                  ry="4.6"
                  transform="rotate(45)"
                />
                <ellipse
                  cx="0"
                  cy="-6"
                  rx="1.8"
                  ry="4.6"
                  transform="rotate(90)"
                />
                <ellipse
                  cx="0"
                  cy="-6"
                  rx="1.8"
                  ry="4.6"
                  transform="rotate(135)"
                />
                <ellipse
                  cx="0"
                  cy="-6"
                  rx="1.8"
                  ry="4.6"
                  transform="rotate(180)"
                />
                <ellipse
                  cx="0"
                  cy="-6"
                  rx="1.8"
                  ry="4.6"
                  transform="rotate(225)"
                />
                <ellipse
                  cx="0"
                  cy="-6"
                  rx="1.8"
                  ry="4.6"
                  transform="rotate(270)"
                />
                <ellipse
                  cx="0"
                  cy="-6"
                  rx="1.8"
                  ry="4.6"
                  transform="rotate(315)"
                />
              </g>
              <circle cx="0" cy="0" r="2.7" fill="#E7C879" />
              <circle
                cx="0"
                cy="0"
                r="2.7"
                fill="none"
                stroke="#B68641"
                strokeWidth="0.3"
                opacity="0.55"
              />
              <g fill="#B68641" opacity="0.7">
                <circle cx="-0.8" cy="-0.7" r="0.32" />
                <circle cx="0.6" cy="0.5" r="0.32" />
                <circle cx="-0.45" cy="0.9" r="0.28" />
                <circle cx="0.85" cy="-0.7" r="0.28" />
                <circle cx="1" cy="0.7" r="0.25" />
                <circle cx="-1" cy="0.2" r="0.25" />
              </g>
            </symbol>

            {/* Bud, pink teardrop, highlight, green calyx with stem */}
            <symbol id="hb-bud-sym" viewBox="-5 -8 10 16">
              <path
                d="M 0,-6 C 4,-5 4,3 0,5.5 C -4,3 -4,-5 0,-6 Z"
                fill="#F2B1B1"
              />
              <path
                d="M -1.4,-4.2 C -0.4,-3 -0.4,2 -1.1,4"
                stroke="#FBDCDC"
                strokeWidth="0.7"
                fill="none"
                strokeLinecap="round"
                opacity="0.75"
              />
              <path
                d="M 0,-6 C 1.6,-4.8 1.8,0 0.9,3"
                stroke="#D88B8B"
                strokeWidth="0.35"
                fill="none"
                strokeLinecap="round"
                opacity="0.4"
              />
              <path
                d="M -2.6,3 Q 0,7 2.6,3 Q 0,1.5 -2.6,3 Z"
                fill="#8FB99A"
              />
              <path
                d="M -1.8,3.4 L -2.4,4.4 M 1.8,3.4 L 2.4,4.4"
                stroke="#638E66"
                strokeWidth="0.35"
                fill="none"
                strokeLinecap="round"
                opacity="0.7"
              />
              <path
                d="M 0,4.5 V 7"
                stroke="#638E66"
                strokeWidth="0.45"
                strokeLinecap="round"
                fill="none"
              />
            </symbol>
          </defs>

          {/* One main spiral wraps around the photo. Branches sprout off
              it at sampled points as the spiral draws, each branch has a
              startTime in seconds matching where the spiral reaches it. */}
          <g stroke="#E2BF6C" strokeLinecap="round" fill="none">
            <path
              className="hb-spiral"
              strokeWidth="1.7"
              strokeOpacity="0.94"
              d={HEBA_GARDEN.spiral.d}
            />
            {HEBA_GARDEN.branches.map((b, i) => (
              <path
                key={`br-${i}`}
                className="hb-branch"
                strokeWidth={b.w}
                strokeOpacity={b.opacity}
                d={b.d}
                data-start-time={b.startTime.toFixed(3)}
              />
            ))}
          </g>

          {/* One leaf per branch, wrapped in a positioning group so GSAP
              can scale the <use> without fighting the SVG transform */}
          <g style={{ color: '#A8CFAB' }}>
            {HEBA_GARDEN.branches.map((b, i) => (
              <g
                key={`lf-${i}`}
                transform={`translate(${b.leafX.toFixed(1)} ${b.leafY.toFixed(1)}) rotate(${b.leafRot.toFixed(1)})`}
              >
                <use
                  className="hb-leaf"
                  href="#hb-leaf-sym"
                  x={(-b.leafW / 2).toFixed(1)}
                  y={(-b.leafH / 2).toFixed(1)}
                  width={b.leafW.toFixed(1)}
                  height={b.leafH.toFixed(1)}
                  data-start-time={b.leafStartTime.toFixed(3)}
                />
              </g>
            ))}
            {HEBA_GARDEN.extraLeaves.map((l, i) => (
              <g
                key={`xlf-${i}`}
                transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.rot.toFixed(1)})`}
              >
                <use
                  className="hb-leaf"
                  href="#hb-leaf-sym"
                  x={(-l.w / 2).toFixed(1)}
                  y={(-l.h / 2).toFixed(1)}
                  width={l.w.toFixed(1)}
                  height={l.h.toFixed(1)}
                  data-start-time={l.startTime.toFixed(3)}
                />
              </g>
            ))}
          </g>

          {/* One flower per branch tip, mix of roses, daisies, buds */}
          <g>
            {HEBA_GARDEN.branches.map((b, i) => {
              const sym =
                b.flowerType === 'rose'
                  ? '#hb-rose-sym'
                  : b.flowerType === 'daisy'
                    ? '#hb-daisy-sym'
                    : '#hb-bud-sym'
              const w = b.flowerSize
              const h = b.flowerType === 'bud' ? b.flowerSize * 1.6 : b.flowerSize
              return (
                <g
                  key={`fl-${i}`}
                  transform={`translate(${b.flowerX.toFixed(1)} ${b.flowerY.toFixed(1)}) rotate(${b.flowerRot.toFixed(1)})`}
                >
                  <use
                    className="hb-bloom"
                    href={sym}
                    x={(-w / 2).toFixed(1)}
                    y={(-h / 2).toFixed(1)}
                    width={w.toFixed(1)}
                    height={h.toFixed(1)}
                    data-start-time={b.flowerStartTime.toFixed(3)}
                  />
                </g>
              )
            })}
            {HEBA_GARDEN.extraFlowers.map((f, i) => {
              const sym =
                f.type === 'rose'
                  ? '#hb-rose-sym'
                  : f.type === 'daisy'
                    ? '#hb-daisy-sym'
                    : '#hb-bud-sym'
              const w = f.size
              const h = f.type === 'bud' ? f.size * 1.6 : f.size
              return (
                <g
                  key={`xfl-${i}`}
                  transform={`translate(${f.x.toFixed(1)} ${f.y.toFixed(1)}) rotate(${f.rot.toFixed(1)})`}
                >
                  <use
                    className="hb-bloom"
                    href={sym}
                    x={(-w / 2).toFixed(1)}
                    y={(-h / 2).toFixed(1)}
                    width={w.toFixed(1)}
                    height={h.toFixed(1)}
                    data-start-time={f.startTime.toFixed(3)}
                  />
                </g>
              )
            })}
          </g>

          {/* Sparkle dots, each lights up as the spiral wraps past it */}
          <g fill="#FAE2A0">
            {HEBA_GARDEN.sparkles.map((s, i) => (
              <circle
                key={i}
                className="hb-sparkle"
                cx={s.x.toFixed(1)}
                cy={s.y.toFixed(1)}
                r={s.r.toFixed(2)}
                opacity={s.opacity}
                data-start-time={s.startTime.toFixed(3)}
              />
            ))}
          </g>
        </svg>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="heba-photo h-32 w-32 overflow-hidden rounded-full bg-gradient-to-br from-[#D4A85C]/25 to-rose-300/10 ring-2 ring-[#E7C879]/45 sm:h-36 sm:w-36">
            <img
              src="/assets/team/heba-ismail.jpg"
              alt="Heba Ismail"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>

      <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-[#E7C879]">
        AUSSS · Past and present
      </p>
      <h2 className="heading-serif relative mt-4 text-4xl text-white sm:text-5xl">
        Welcome back, Heba.
      </h2>
      <p className="relative mx-auto mt-3 max-w-md text-[11px] uppercase leading-relaxed tracking-[0.08em] text-silver/55">
        &ldquo;&lsquo;What&rsquo; and &lsquo;if&rsquo; are two words as
        non&nbsp;threatening as words can be, but put them together
        side&nbsp;by&nbsp;side and they have the power to haunt you for
        the rest of your life.{' '}
        <span className="font-semibold text-[#F0D38A]">What if?</span>&rdquo;
      </p>

      <div className="relative mt-5 flex flex-col items-center gap-2">
        <span className="rounded-full border border-[#D4A85C]/45 bg-[#D4A85C]/10 px-3.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#F0D38A]">
          Supervising Council · 2025–2026
        </span>
        <span className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-silver/80">
          International TEDA · 2025–2026
        </span>
        <span className="rounded-full border border-white/[0.05] bg-white/[0.03] px-3.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-silver/60">
          AUSSS Past President · 2024–2025
        </span>
      </div>

      <p className="relative mx-auto mt-7 max-w-lg text-lg font-light leading-relaxed text-silver/85">
        You handed the gavel down and stayed in the room. AUSSS still runs
        on the shape you gave it.
      </p>
      <p className="relative mx-auto mt-3 max-w-lg text-sm leading-relaxed text-silver/60">
        There’s no membership tier high enough for what you’ve already done
        for this society. Thank you, sincerely, for sticking around to
        watch over us.
      </p>

      <a
        href="/assets/eb-candidatures/heba-ismail-candidature.pdf"
        target="_blank"
        rel="noopener noreferrer"
        className="relative mt-7 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#F0D38A] underline-offset-4 transition-colors hover:text-white hover:underline"
      >
        Revisit her presidential candidature
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </a>

      <RevealButton
        onReveal={onReveal}
        label="Show membership status →"
      />
    </div>
  )
}

/* ── Officer / Director / EB: warm recognition ──────────────────────── */
function TeamMember({ entry, onReveal, otherPositions }) {
  const isCommittee = entry.kind === 'committee'
  const color = isCommittee ? entry.color : '#5B8DB8'
  const accent = readableAccent(color)
  // Always show the canonical name + photo from the data, never the typed
  // input, so it's stable and correct whether looked up by name or email.
  const displayName = entry.holderName || entry.roleLabel || 'AUSSS Official'
  const showPhoto = Boolean(entry.holderPhoto)

  return (
    <div
      className="relative overflow-hidden rounded-3xl border bg-forest-900/60 p-10 text-center sm:p-14"
      style={{ borderColor: rgba(color, 0.35) }}
    >
      <div
        className="absolute inset-x-0 top-0 h-40"
        style={{
          background: `radial-gradient(60% 100% at 50% 0%, ${rgba(
            color,
            0.32,
          )} 0%, rgba(2,28,18,0) 75%)`,
        }}
      />

      <img
        src={
          isCommittee && entry.logo
            ? entry.logo
            : '/assets/brand/ausss-vertical-white.png'
        }
        alt={isCommittee ? `${entry.abbr} logo` : 'AUSSS'}
        className="relative mx-auto h-20 w-auto object-contain drop-shadow"
      />

      <div
        className="relative mx-auto mt-6 grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-forest-950 text-2xl font-semibold text-silver ring-4"
        style={{ '--tw-ring-color': rgba(color, 0.5) }}
      >
        {showPhoto ? (
          <img
            src={entry.holderPhoto}
            alt={displayName}
            className="h-full w-full object-cover"
          />
        ) : (
          initials(displayName)
        )}
      </div>

      <p
        className="relative mt-6 text-xs font-semibold uppercase tracking-[0.24em]"
        style={{ color: accent }}
      >
        Welcome back
      </p>
      <h2 className="heading-serif relative mt-2 text-3xl text-white sm:text-4xl">
        {displayName}
      </h2>
      <p
        className="relative mt-3 text-sm font-semibold uppercase tracking-[0.16em]"
        style={{ color: accent }}
      >
        {entry.roleLabel}
      </p>
      {isCommittee && (
        <p className="relative mt-1 text-sm text-silver/70">
          {entry.committeeName}
        </p>
      )}

      <p className="relative mx-auto mt-5 max-w-md text-sm leading-relaxed text-silver/65">
        You’re on the AUSSS Team of Officials. Membership status checks are
        for the rest of us.
      </p>

      <AlsoServingAs positions={otherPositions} accent={accent} />

      <div className="relative mt-7 flex flex-col items-center gap-3">
        {isCommittee && (
          <Link
            to={`/committees/${entry.slug}`}
            className="rounded-full px-6 py-3 text-sm font-semibold text-forest transition-transform hover:scale-[1.03]"
            style={{ background: '#fff' }}
          >
            Go to your committee page →
          </Link>
        )}
        <RevealButton
          onReveal={onReveal}
          label="Show my membership status instead →"
        />
      </div>
    </div>
  )
}

export default function SpecialResult({ result, onReveal }) {
  if (result.state === 'president')
    return <President onReveal={onReveal} otherPositions={result.otherPositions} />
  if (result.state === 'heba')
    return <Heba onReveal={onReveal} />
  return (
    <TeamMember
      entry={result.entry}
      onReveal={onReveal}
      otherPositions={result.otherPositions}
    />
  )
}
