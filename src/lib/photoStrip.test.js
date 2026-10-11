import { describe, expect, it } from 'vitest'
import { COMMIT, FLICK, releaseSpeed, restingPlace, rubberband, springAt, wrap } from './photoStrip.js'

describe('wrap: the album goes round', () => {
  it('leaves a place inside the album as it is', () => {
    expect(wrap(0, 5)).toBe(0)
    expect(wrap(4, 5)).toBe(4)
  })

  it('starts again past the last photo, and comes round from before the first', () => {
    expect(wrap(5, 5)).toBe(0)
    expect(wrap(7, 5)).toBe(2)
    expect(wrap(-1, 5)).toBe(4)
    expect(wrap(-6, 5)).toBe(4)
  })

  it('has one answer for an album of one photo', () => {
    expect(wrap(3, 1)).toBe(0)
    expect(wrap(-3, 1)).toBe(0)
  })
})

describe('springAt: the glide to a place', () => {
  it('starts where the strip is, at the speed it has', () => {
    const still = springAt(3.25, 0, 4, 0)
    expect(still.at).toBe(3.25)
    expect(still.speed).toBeCloseTo(0, 10)
    const moving = springAt(3.25, -6, 3, 0)
    expect(moving.at).toBe(3.25)
    expect(moving.speed).toBeCloseTo(-6, 10)
  })

  it('is nearly there in a third of a second and at rest within a second', () => {
    expect(Math.abs(springAt(3, 0, 4, 0.35).at - 4)).toBeLessThan(0.02)
    const settled = springAt(3, 0, 4, 1)
    expect(Math.abs(settled.at - 4)).toBeLessThan(0.0004)
    expect(Math.abs(settled.speed)).toBeLessThan(0.02)
  })

  it('does not pass its place when it starts from rest, in either direction', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      expect(springAt(3, 0, 4, t).at).toBeLessThanOrEqual(4)
      expect(springAt(4, 0, 3, t).at).toBeGreaterThanOrEqual(3)
    }
  })

  it('moves one way only when it starts from rest', () => {
    let before = 3
    for (let t = 0.01; t <= 1; t += 0.01) {
      const { at } = springAt(3, 0, 4, t)
      expect(at).toBeGreaterThanOrEqual(before)
      before = at
    }
  })

  it('is carried a little past its place by a hard flick, and comes back', () => {
    // Nearly there already, and still moving at ten photos a second.
    const furthest = Math.max(...Array.from({ length: 100 }, (_, i) => springAt(3.9, 10, 4, i / 100).at))
    expect(furthest).toBeGreaterThan(4)
    expect(furthest).toBeLessThan(4.3)
    expect(Math.abs(springAt(3.9, 10, 4, 1).at - 4)).toBeLessThan(0.0004)
  })

  it('bends to a new place with no jump: the new glide starts from the old one’s place and speed', () => {
    const mid = springAt(3, 0, 4, 0.1)
    const bent = springAt(mid.at, mid.speed, 5, 0)
    expect(bent.at).toBeCloseTo(mid.at, 10)
    expect(bent.speed).toBeCloseTo(mid.speed, 10)
  })
})

describe('rubberband: a lone photo resists', () => {
  const WIDTH = 400

  it('stays put when it is not pulled', () => {
    expect(rubberband(0, WIDTH)).toBe(0)
  })

  it('follows the finger’s direction, by less than the finger moved', () => {
    expect(rubberband(100, WIDTH)).toBeGreaterThan(0)
    expect(rubberband(100, WIDTH)).toBeLessThan(100)
    expect(rubberband(-100, WIDTH)).toBe(-rubberband(100, WIDTH))
  })

  it('follows less the further it is pulled', () => {
    const first = rubberband(100, WIDTH) - rubberband(0, WIDTH)
    const second = rubberband(200, WIDTH) - rubberband(100, WIDTH)
    const third = rubberband(300, WIDTH) - rubberband(200, WIDTH)
    expect(second).toBeLessThan(first)
    expect(third).toBeLessThan(second)
    expect(third).toBeGreaterThan(0)
  })

  it('never leaves the screen, however far the pull', () => {
    expect(rubberband(100000, WIDTH)).toBeLessThan(WIDTH)
    expect(rubberband(-100000, WIDTH)).toBeGreaterThan(-WIDTH)
  })
})

describe('releaseSpeed: how fast the finger was going as it let go', () => {
  it('is nothing for a finger that never moved sideways', () => {
    expect(releaseSpeed([], 1000)).toBe(0)
    expect(releaseSpeed([{ t: 1000, x: 200 }], 1000)).toBe(0)
  })

  it('is the distance over the time, in px per ms, leftwards negative', () => {
    const left = [
      { t: 1000, x: 300 },
      { t: 1040, x: 260 },
      { t: 1080, x: 220 },
    ]
    expect(releaseSpeed(left, 1080)).toBe(-1)
    const right = left.map((p) => ({ t: p.t, x: 600 - p.x }))
    expect(releaseSpeed(right, 1080)).toBe(1)
  })

  it('reads only the last 100 ms of the path', () => {
    // A slow start, then a quick finish.
    const path = [
      { t: 1000, x: 300 },
      { t: 1200, x: 290 },
      { t: 1250, x: 240 },
      { t: 1300, x: 190 },
    ]
    expect(releaseSpeed(path, 1300)).toBe(-1)
  })

  it('is nothing for a finger that rested before lifting', () => {
    const path = [
      { t: 1000, x: 300 },
      { t: 1050, x: 200 },
    ]
    expect(releaseSpeed(path, 1150)).not.toBe(0)
    expect(releaseSpeed(path, 1151)).toBe(0)
  })
})

describe('restingPlace: where a release comes to rest', () => {
  // A drag that began at rest on place 3 and was let go at `at`.
  const from3 = (at, speed) => restingPlace({ at, moved: at - 3, speed, heading: 3, toward: 0 })
  const SLOW = FLICK / 2
  const FAST = FLICK * 2

  it('goes back when a slow drag stopped short of a fifth of the width', () => {
    expect(from3(3.19, 0)).toBe(3)
    expect(from3(2.81, 0)).toBe(3)
    expect(from3(3.19, -SLOW)).toBe(3)
    expect(from3(2.81, SLOW)).toBe(3)
  })

  it('takes the next photo once a slow drag has gone a fifth of the width', () => {
    expect(restingPlace({ at: 3 + COMMIT, moved: COMMIT, speed: 0, heading: 3, toward: 0 })).toBe(4)
    expect(restingPlace({ at: 3 - COMMIT, moved: -COMMIT, speed: 0, heading: 3, toward: 0 })).toBe(2)
    expect(from3(3.6, 0)).toBe(4)
    expect(from3(2.4, 0)).toBe(2)
  })

  it('follows a long slow drag across several photos', () => {
    expect(from3(4.1, 0)).toBe(4)
    expect(from3(4.3, 0)).toBe(5)
    expect(from3(1.9, 0)).toBe(2)
    expect(from3(1.7, 0)).toBe(1)
  })

  it('takes the next photo on a flick, however short the drag', () => {
    expect(from3(3.02, -FAST)).toBe(4)
    expect(from3(2.98, FAST)).toBe(2)
    expect(from3(3.02, -FLICK)).toBe(4)
    expect(from3(2.98, FLICK)).toBe(2)
  })

  it('takes the photo in the flick’s direction from wherever the strip is', () => {
    // Dragged most of the way on, then flicked back: the photo it left.
    expect(from3(3.8, FAST)).toBe(3)
    expect(from3(2.2, -FAST)).toBe(3)
    // Dragged on and flicked on: one photo, not two.
    expect(from3(3.8, -FAST)).toBe(4)
    expect(from3(2.2, FAST)).toBe(2)
  })

  it('moves two photos for two quick flicks', () => {
    // Caught on its way to place 4, and flicked on again before it got there.
    expect(restingPlace({ at: 3.4, moved: 0.02, speed: -FAST, heading: 4, toward: 1 })).toBe(5)
    expect(restingPlace({ at: 2.6, moved: -0.02, speed: FAST, heading: 2, toward: -1 })).toBe(1)
  })

  it('turns round when it is caught on its way and flicked back', () => {
    expect(restingPlace({ at: 3.4, moved: -0.02, speed: FAST, heading: 4, toward: 1 })).toBe(3)
    expect(restingPlace({ at: 2.6, moved: 0.02, speed: -FAST, heading: 2, toward: -1 })).toBe(3)
  })

  it('carries on to where it was heading when it is caught and let go', () => {
    expect(restingPlace({ at: 3.4, moved: 0, speed: 0, heading: 4, toward: 1 })).toBe(4)
  })

  it('counts a strip a hair short of a place as on it', () => {
    expect(restingPlace({ at: 3.9995, moved: 0, speed: -FAST, heading: 4, toward: 0 })).toBe(5)
    expect(restingPlace({ at: 4.0005, moved: 0, speed: FAST, heading: 4, toward: 0 })).toBe(3)
  })

  it('works before the first place too, since the strip has no end', () => {
    expect(restingPlace({ at: -0.3, moved: -0.3, speed: 0, heading: 0, toward: 0 })).toBe(-1)
    expect(restingPlace({ at: -0.9, moved: 0.02, speed: -FAST, heading: -1, toward: 0 })).toBe(0)
  })
})
