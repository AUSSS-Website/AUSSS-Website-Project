// The sums behind the photo viewer's swipe (the lightbox in
// src/pages/GalleryPage.jsx), kept apart from the page so they can be tested
// without a browser.
//
// The photos sit side by side on a strip with no end: each has a place, a
// whole number, and past the last photo the album starts again. Where the
// strip is, is counted in photos, so 3.25 is a quarter of the way from place
// 3 to place 4. A drag sets it straight from the finger, and a spring carries
// it to rest on a whole number afterwards.

export const COMMIT = 0.2 // let go past a fifth of the width and the photo changes
export const FLICK = 0.5 // px per ms: a flick changes the photo however short it was
const SPRING = (2 * Math.PI) / 0.35 // the spring answers in about a third of a second

// The photo at a place: the album goes round, in both directions.
export const wrap = (n, count) => ((n % count) + count) % count

// A critically damped spring: where it is and how fast it moves `t` seconds
// after leaving `from` at `speed` for `to`. It takes up whatever speed it is
// given and does not bounce by itself; only a hard flick carries it a little
// past its place.
export function springAt(from, speed, to, t) {
  const a = from - to
  const b = speed + SPRING * a
  const decay = Math.exp(-SPRING * t)
  return { at: to + (a + b * t) * decay, speed: (b - SPRING * (a + b * t)) * decay }
}

// One photo has nowhere to go: the further it is pulled, the less it follows.
export function rubberband(pull, width) {
  return (pull * width * 0.55) / (width + 0.55 * Math.abs(pull))
}

// The finger's speed as it lets go, in px per ms (leftwards is negative), over
// the last 100 ms of its path. A finger that rested before lifting has none.
export function releaseSpeed(path, time) {
  const last = path[path.length - 1]
  if (!last || time - last.t > 100) return 0
  const first = path.find((p) => last.t - p.t <= 100)
  return last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0
}

// The place the strip comes to rest on when the finger lets go. A flick takes
// the next photo in its direction from wherever the strip is, and one more
// than it was heading for when it was caught already on its way there
// (`toward`), so two quick flicks move two photos. A slow release takes the
// next photo once the drag has carried the strip a fifth of the width, and
// otherwise leaves it on the photo it was heading for.
export function restingPlace({ at, moved, speed, heading, toward }) {
  const slack = 0.001
  if (speed <= -FLICK) {
    const next = Math.floor(at + slack) + 1
    return toward > 0 ? Math.max(next, heading + 1) : next
  }
  if (speed >= FLICK) {
    const before = Math.ceil(at - slack) - 1
    return toward < 0 ? Math.min(before, heading - 1) : before
  }
  if (moved >= COMMIT) return Math.floor(at - COMMIT + slack) + 1
  if (moved <= -COMMIT) return Math.ceil(at + COMMIT - slack) - 1
  return heading
}
