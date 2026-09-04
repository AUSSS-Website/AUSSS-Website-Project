import { useEffect, useRef } from 'react'

// Cardiac-monitor ECG sweep for the home hero. A glowing PQRST trace draws
// left→right with a fading history trail, like a real monitor, on a black
// stage under a faint field of twinkling stars.
//
// Logo sync: twice per sweep the beat anchors to the AUSSS logo, tall spikes
// fire exactly under the logo's own printed ECG spikes (at ~31% and ~68% of
// the logo's width) and reach up to its ECG line (~50% of its height), so the
// animated waveform overlaps the brand mark's.
//
// Interactive:
//   • tap/click anywhere while the hero is on screen → premature (ectopic)
//     beat: the QRS fires immediately, slightly taller, with a bigger bloom.
//   • press & hold → the line flatlines (asystole); releasing fires a strong
//     recovery beat.
//   • shake the phone → heart rate climbs (tachycardia), then eases back to
//     the resting rate. iOS needs motion permission, requested on first tap.
//
// Perf: canvas 2D, no deps, no shadowBlur (per-frame Gaussian blur is slow on
// mobile, glow is layered strokes instead). The trail draws at two alpha
// levels (bright head, one faded tail step) so the stroke count stays flat
// regardless of trail length. The RAF loop pauses when the tab is hidden or
// the hero is scrolled out of view.

// PQRST as a sum of Gaussians over normalized beat phase t ∈ [0, 1).
// Decays to ~0 between beats, giving the flatline for free.
const PQRST = [
  [0.12, 0.18, 0.022], // P  [amplitude, center, width]
  [-0.08, 0.36, 0.008], // Q
  [1.0, 0.385, 0.01], // R
  [-0.18, 0.41, 0.01], // S
  [0.28, 0.6, 0.045], // T
]
const R_CENTER = 0.385
const SNAP_PHASE = 0.34 // "just before the QRS": used by taps + logo anchors

function waveY(t) {
  let y = 0
  for (const [a, mu, s] of PQRST) {
    y += a * Math.exp(-((t - mu) ** 2) / (2 * s * s))
  }
  return y
}

// Glow = same polyline stroked widest-first: halo / glow / core.
const LAYERS = [
  ['#5B8DB8', 10, 0.06], // medical
  ['#8FB4D4', 4, 0.16], // medical-light
  ['#EEF2F5', 1.6, 0.50], // silver-light
]
// Two-level trail: full brightness for the newest ~75% of its life, then one
// short faded step until it expires, exactly one visible fade.
const BUCKET_ALPHAS = [0.2, 1] // faded tail, full-bright head
const FULL_LIFE = 0.74 // fraction of trailLife at full brightness


// Where the printed ECG sits inside the logo PNG (fractions of the rendered
// img box, measured from the asset's alpha channel).
const LOGO_SPIKE_XS = [0.31, 0.68]
const LOGO_LINE_Y = 0.5

const BASE_BPM = 60
const MAX_BPM = 150
const TAP_DEBOUNCE_MS = 10
const HOLD_FLATLINE_MS = 350
const SHAKE_THRESHOLD = 14 // m/s² above gravity
const SHAKE_DEBOUNCE_MS = 400
const SHAKE_BPM_STEP = 18
const BPM_DECAY = Math.LN2 / 150 // targetBpm → base, half-life ~150s

export default function ECGBackground({
  bpm = BASE_BPM,
  band = 0.1, // trace baseline as fraction of hero height (fallback)
  amplitude = 1.8, // R-peak height as fraction of hero height (capped 80px)
  // When set, the baseline tracks this element instead of `band`: it lays
  // on the element's top border (plus `anchorGap` px) on every viewport, so
  // the placement matches between desktop and phone layouts.
  anchorRef = null,
  anchorGap = 0,
  // The hero logo img; beats sync to its printed ECG spikes when present.
  logoRef = null,
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    // butt caps, not round: the trail is stroked in alpha buckets that share
    // endpoints, and stacked round caps render as bright dots along the line.
    ctx.lineJoin = 'round'
    ctx.lineCap = 'butt'

    let width = 0
    let height = 0
    let y0 = 0 // trace baseline (px)
    let ampPx = 0 // R-peak amplitude of ordinary beats (px)
    let speed = 0 // sweep speed (px/s)
    let trailLife = 0.1 // trail fade duration (ms)

    // Faint star field, kept to the truly black upper stage (above the trace
    // and the gradient at the bottom). Each star lives briefly, fading in,
    // peaking, fading out, then respawns somewhere new.
    let stars = []
    let starMaxY = 0

    const spawnStar = (born) => ({
      x: Math.random() * width,
      y: Math.random() * starMaxY,
      r: 0.6 + Math.random() * 1.1,
      baseA: 0.1 + Math.random() * 0.3,
      born,
      life: 1800 + Math.random() * 2600, // ms, fade-in + fade-out included
    })

    // Logo-synced beats: each {x, amp} fires once per sweep, with the R-peak
    // landing at x and reaching amp px above the baseline (the logo's line).
    let logoAnchors = []
    let anchorsFired = []
    let activeAnchor = null

    // Sweep state. `points` is a time-ordered buffer of {x, y, t}; a null
    // entry marks a path break (the head wrapping back to the left edge).
    let points = []
    let headX = 0
    let phase = 0 // beat phase 0..1
    let beatDur = 60 / bpm // seconds, re-randomized each beat
    let beatAmp = 1
    let ectopic = false // tapped beat → taller R, bigger bloom
    let flat = false // press & hold → asystole
    let pulse = 0 // bloom envelope, set at each R-peak
    let currentBpm = bpm
    let targetBpm = bpm

    function resize() {
      const newW = canvas.offsetWidth
      const newH = canvas.offsetHeight
      // Ignore height-only wobble (mobile URL bar collapsing on scroll),
      // re-measuring mid-sweep resets the trace and reads as jitter.
      if (points.length && newW === width && Math.abs(newH - height) < 100) {
        return
      }
      width = newW
      height = newH
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'
      y0 = height * band
      const c = canvas.getBoundingClientRect()
      const anchor = anchorRef?.current
      if (anchor) {
        const a = anchor.getBoundingClientRect()
        if (a.height > 0) {
          y0 = Math.min(a.top - c.top + anchorGap, height - 40)
        }
      }
      ampPx = Math.min(height * amplitude, 80)
      speed = Math.max(width / 9, 110)
      trailLife = ((0.52 * width) / speed) * 1000
      logoAnchors = []
      const logo = logoRef?.current
      if (logo) {
        const r = logo.getBoundingClientRect()
        // Width only settles once the image file has loaded (w-auto).
        if (r.height > 0 && r.width > 0) {
          const lineY = r.top - c.top + r.height * LOGO_LINE_Y
          // Full reach on every screen size: the spike tops land on the
          // logo's printed ECG line even on stacked phone layouts.
          const amp = Math.max(y0 - lineY, ampPx)
          logoAnchors = LOGO_SPIKE_XS.map((f) => ({
            x: r.left - c.left + r.width * f,
            amp,
          }))
        }
      }
      anchorsFired = logoAnchors.map(() => false)
      activeAnchor = null
      starMaxY = Math.max(Math.min(y0 - 60, height * 0.55), 80)
      const t0 = performance.now()
      stars = Array.from(
        { length: Math.min(Math.floor((width * starMaxY) / 6000), 200) },
        () => {
          const s = spawnStar(t0)
          s.born = t0 - Math.random() * s.life // stagger: start mid-life
          return s
        },
      )
      points = []
      headX = 0
      if (reduced) drawStatic()
    }

    const bucketOf = (p, now) => {
      const lin = 1 - (now - p.t) / trailLife
      return lin > 1 - FULL_LIFE ? 1 : 0
    }

    // Stroke the whole trail as one pass of `color`. Points are time-ordered,
    // so alpha buckets form contiguous runs, one beginPath per bucket, with
    // a 1-point overlap bridging segments so there are no gaps.
    function strokeTrace(now, color, widthPx, alphaFactor, dx = 0, dy = 0) {
      ctx.strokeStyle = color
      ctx.lineWidth = widthPx
      const n = points.length
      let i = 0
      while (i < n) {
        if (points[i] === null) {
          i++
          continue
        }
        let end = i
        while (end < n && points[end] !== null) end++
        let segStart = i
        let segBucket = bucketOf(points[i], now)
        for (let k = i + 1; k <= end; k++) {
          const b = k < end ? bucketOf(points[k], now) : -1
          if (b !== segBucket) {
            ctx.globalAlpha = alphaFactor * BUCKET_ALPHAS[segBucket]
            ctx.beginPath()
            ctx.moveTo(points[segStart].x + dx, points[segStart].y + dy)
            for (let m = segStart + 1; m < k; m++) {
              ctx.lineTo(points[m].x + dx, points[m].y + dy)
            }
            if (k < end) ctx.lineTo(points[k].x + dx, points[k].y + dy)
            ctx.stroke()
            segStart = k
            segBucket = b
          }
        }
        i = end
      }
      ctx.globalAlpha = 1
    }

    // Four-point sparkles: a thin cross with a bright core. Pass now=null
    // for a static frame (fixed alpha, no lifecycle).
    function drawStars(now) {
      ctx.strokeStyle = '#EEF2F5'
      ctx.fillStyle = '#FFFFFF'
      ctx.lineWidth = 1
      for (let i = 0; i < stars.length; i++) {
        let s = stars[i]
        if (now != null) {
          let p = (now - s.born) / s.life
          if (p >= 1) {
            s = stars[i] = spawnStar(now) // expired → reappear elsewhere
            p = 0
          }
          ctx.globalAlpha = s.baseA * Math.sin(Math.PI * Math.max(p, 0))
        } else {
          ctx.globalAlpha = s.baseA * 0.7
        }
        const len = s.r * 3
        ctx.beginPath()
        ctx.moveTo(s.x - len, s.y)
        ctx.lineTo(s.x + len, s.y)
        ctx.moveTo(s.x, s.y - len)
        ctx.lineTo(s.x, s.y + len)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r * 0.7, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    function drawHead(head) {
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 7)
      g.addColorStop(0, 'rgba(238, 242, 245, 0.9)')
      g.addColorStop(1, 'rgba(238, 242, 245, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(head.x, head.y, 7, 0, Math.PI * 2)
      ctx.fill()
    }

    function drawBloom(head) {
      const a = 0.1 * Math.min(pulse, 1.6)
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 90)
      g.addColorStop(0, `rgba(143, 180, 212, ${a.toFixed(3)})`)
      g.addColorStop(1, 'rgba(143, 180, 212, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(head.x, head.y, 90, 0, Math.PI * 2)
      ctx.fill()
    }

    function render(now) {
      ctx.clearRect(0, 0, width, height)
      drawStars(now)
      for (const [color, w, a] of LAYERS) strokeTrace(now, color, w, a)
      // The newest entry can be the wrap's path-break marker (null), the
      // pen head is the last REAL point. Never blank the whole frame for it:
      // that one-frame flash read as the page "reloading" at each wrap.
      let head = null
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i]) {
          head = points[i]
          break
        }
      }
      if (head) {
        drawHead(head)
        if (pulse > 0.02) drawBloom(head)
      }
    }

    // ── Animation loop ────────────────────────────────────────────────────
    let raf = 0
    let running = false
    let lastTime = 0
    let pageVisible = !document.hidden
    let inView = true
    // The sweep only starts once the hero's entrance animations have settled
    // and the final measurements are locked in, measuring mid-sweep would
    // reset the trace and read as jitter.
    let measured = false

    function frame(now) {
      const dt = Math.min(Math.max(now - lastTime, 0), 50) / 1000
      lastTime = now

      // Heart-rate dynamics: target decays toward base, current eases toward
      // target (~1s lag).
      targetBpm = bpm + (targetBpm - bpm) * Math.exp(-dt * BPM_DECAY)
      currentBpm += (targetBpm - currentBpm) * (1 - Math.exp(-dt * 3))
      const urgency = Math.min(
        Math.max((currentBpm - bpm) / (MAX_BPM - bpm), 0),
        1,
      )
      const speedNow = speed * (1 + 0.3 * urgency)

      // Advance the head in ~2px sub-steps so the QRS spike stays sharp
      // regardless of frame rate.
      let remaining = speedNow * dt
      while (remaining > 0) {
        // Finer sub-steps through the QRS: on phones a beat is ~100px wide,
        // so 2px sampling can straddle the razor-thin R-peak and randomly
        // clip its height, 0.5px steps there keep every spike full-size.
        const nearQRS = !flat && phase > 0.3 && phase < 0.46
        const step = Math.min(nearQRS ? 0.5 : 2, remaining)
        remaining -= step
        headX += step

        if (flat) {
          // Asystole: hold the line flat, phase frozen until release.
          points.push({ x: headX, y: y0, t: now })
        } else {
          // Logo sync: fire each anchored beat when the head reaches the
          // point where snapping the phase lands the R-peak on the anchor.
          for (let a = 0; a < logoAnchors.length; a++) {
            if (anchorsFired[a]) continue
            const lead = (R_CENTER - SNAP_PHASE) * beatDur * speedNow
            if (headX >= logoAnchors[a].x - lead) {
              anchorsFired[a] = true
              activeAnchor = logoAnchors[a]
              // Snap unless an R-peak is imminent anyway; if the current
              // beat's R already passed, replay it so the anchor still gets
              // its full-height spike.
              if (phase < 0.3 || phase >= R_CENTER) phase = SNAP_PHASE
              beatAmp = 1
            }
          }
          const prevPhase = phase
          phase += step / speedNow / beatDur
          if (prevPhase < R_CENTER && phase >= R_CENTER) {
            pulse = ectopic || activeAnchor ? 1.6 : 1
          }
          if (phase >= 1) {
            phase -= 1
            beatDur = (60 / currentBpm) * (0.92 + Math.random() * 0.16)
            beatAmp = 0.95 + Math.random() * 0.1
            ectopic = false
            activeAnchor = null
          }
          const amp = activeAnchor ? activeAnchor.amp : ampPx
          points.push({
            x: headX,
            y: y0 - waveY(phase) * beatAmp * amp,
            t: now,
          })
        }

        if (headX > width + 24) {
          headX = -24
          points.push(null) // break the path at the wrap
          anchorsFired = logoAnchors.map(() => false)
        }
      }

      pulse *= Math.exp(-dt * 5)

      // Trim expired trail (and any leading break markers).
      while (
        points.length &&
        (points[0] === null || now - points[0].t > trailLife)
      ) {
        points.shift()
      }

      render(now)
      raf = requestAnimationFrame(frame)
    }

    function updateRunning() {
      const should = measured && pageVisible && inView
      if (should && !running) {
        running = true
        lastTime = performance.now() // no dt spike → no head teleport
        raf = requestAnimationFrame(frame)
      } else if (!should && running) {
        running = false
        cancelAnimationFrame(raf)
      }
    }

    // ── Static frame for prefers-reduced-motion ───────────────────────────
    function drawStatic() {
      ctx.clearRect(0, 0, width, height)
      drawStars(null) // fixed alpha, no lifecycle
      const beatLen = (60 / bpm) * speed // px per beat at the resting rate
      const pts = []
      for (let x = 0; x <= width; x += 2) {
        pts.push({ x, y: y0 - waveY((x % beatLen) / beatLen) * ampPx })
      }
      const drawPath = (color, w, alpha, dx = 0, dy = 0) => {
        ctx.strokeStyle = color
        ctx.lineWidth = w
        ctx.globalAlpha = alpha
        ctx.beginPath()
        pts.forEach((p, i) =>
          i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy),
        )
        ctx.stroke()
      }
      drawPath('#5B8DB8', 10, 0.05)
      drawPath('#8FB4D4', 4, 0.13)
      drawPath('#EEF2F5', 1.6, 0.45)
      ctx.globalAlpha = 1
    }

    // ── Interactions ──────────────────────────────────────────────────────
    let lastTap = 0
    let lastShake = 0
    let motionAttached = false
    let holdTimer = 0
    let downX = 0
    let downY = 0

    const onMotion = (e) => {
      const a = e.accelerationIncludingGravity
      if (!a || a.x == null) return
      const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
      const now = performance.now()
      if (
        Math.abs(mag - 9.81) > SHAKE_THRESHOLD &&
        now - lastShake > SHAKE_DEBOUNCE_MS
      ) {
        lastShake = now
        targetBpm = Math.min(targetBpm + SHAKE_BPM_STEP, MAX_BPM)
      }
    }

    // iOS 13+ gates devicemotion behind a permission that must be requested
    // from a user gesture, so the first tap doubles as the request.
    function enableMotion(fromGesture) {
      if (motionAttached) return
      const DME = window.DeviceMotionEvent
      if (!DME) return
      if (typeof DME.requestPermission === 'function') {
        if (!fromGesture) return
        motionAttached = true // one attempt; denial degrades silently
        DME.requestPermission()
          .then((res) => {
            if (res === 'granted') {
              window.addEventListener('devicemotion', onMotion)
            }
          })
          .catch(() => {})
      } else {
        motionAttached = true
        window.addEventListener('devicemotion', onMotion)
      }
    }

    // Premature beat: jump just ahead of the QRS so the spike fires within
    // ~100ms. Skip if a QRS is already underway.
    const fireTapBeat = () => {
      const now = performance.now()
      if (now - lastTap < TAP_DEBOUNCE_MS) return
      lastTap = now
      if (phase < 0.3 || phase > 0.45) phase = SNAP_PHASE
      beatAmp = Math.min(beatAmp * 1.25, 1.4)
      ectopic = true
      targetBpm = Math.min(targetBpm * 1.06, MAX_BPM)
    }

    const onPointerDown = (e) => {
      enableMotion(true)
      if (!pageVisible || !inView) return
      downX = e.clientX
      downY = e.clientY
      // Holding flatlines the monitor until release.
      clearTimeout(holdTimer)
      holdTimer = setTimeout(() => {
        flat = true
      }, HOLD_FLATLINE_MS)
      // Mouse clicks beat immediately. Touches wait for release: a scroll
      // gesture also starts with pointerdown, and beating on every scroll
      // made the whole trace jitter while browsing.
      if (e.pointerType !== 'touch') fireTapBeat()
    }

    // A touch that starts moving is a scroll, not a hold, cancel the
    // flatline timer so casual scrolling doesn't trigger asystole. The
    // browser's own pointercancel covers most scrolls; this catches slow
    // drags it hasn't claimed yet. Touch-only, so mouse holds keep working.
    const onPointerMove = (e) => {
      if (
        e.pointerType === 'touch' &&
        Math.hypot(e.clientX - downX, e.clientY - downY) > 10
      ) {
        clearTimeout(holdTimer)
      }
    }

    const onPointerUp = (e) => {
      clearTimeout(holdTimer)
      if (flat) {
        flat = false
        // Recovery beat: the line jolts back with a strong spike.
        phase = SNAP_PHASE
        beatAmp = 1.4
        ectopic = true
        return
      }
      // Touch tap = released without moving (a scroll travels further).
      if (
        e.type === 'pointerup' &&
        e.pointerType === 'touch' &&
        Math.hypot(e.clientX - downX, e.clientY - downY) <= 10
      ) {
        fireTapBeat()
      }
    }

    const onVisibility = () => {
      pageVisible = !document.hidden
      updateRunning()
    }

    // ── Wire-up ───────────────────────────────────────────────────────────
    resize()
    // Show the stars right away; only the trace waits for the settled
    // measurements.
    if (!reduced) drawStars(null)
    window.addEventListener('resize', resize)
    // The hero content fades/slides in on mount, so the anchor measurements
    // can catch it mid-animation, and on slower connections the logo image
    // (whose width the spike anchors derive from) may not have loaded yet.
    // Take the final measurement once both have settled; only then start.
    function startWhenReady() {
      const logo = logoRef?.current
      if (logo && !logo.complete) {
        logo.addEventListener('load', startWhenReady, { once: true })
        return
      }
      points = []
      resize()
      measured = true
      updateRunning()
    }
    const settleTimer = setTimeout(startWhenReady, 1200)

    let observer = null
    if (!reduced) {
      observer = new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting
        updateRunning()
      })
      observer.observe(canvas)
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pointerdown', onPointerDown, { passive: true })
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('pointerup', onPointerUp, { passive: true })
      window.addEventListener('pointercancel', onPointerUp, { passive: true })
      enableMotion(false) // attaches now where no permission is needed
      updateRunning()
    }

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(settleTimer)
      clearTimeout(holdTimer)
      logoRef?.current?.removeEventListener('load', startWhenReady)
      window.removeEventListener('resize', resize)
      if (observer) observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('devicemotion', onMotion)
    }
  }, [bpm, band, amplitude, anchorRef, anchorGap, logoRef])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  )
}
