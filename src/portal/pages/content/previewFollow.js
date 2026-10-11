// The arithmetic behind the content editor's preview following the form
// (usePreviewFollow.js). Kept free of the DOM so it can be tested.
//
// The form and the preview are linked by text: each field or list row of the
// form is matched with the first element of the preview, after the previous
// match, that shows the start of what was typed in it. That gives pairs of
// positions (where the row is on the page, where its text is in the preview),
// and a point of the form between two rows is placed in the preview at the
// same fraction of the way between their matches.

// 'See **our** [page](/x), please!' -> 'see our page please'
export function normalizeText(s) {
  return String(s ?? '')
    .replace(/\]\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// The start of a typed value, as searched for in the preview: its first six
// words. Too little to be told apart (a figure such as "55+") gives null.
export function snippetOf(value, words = 6) {
  const text = normalizeText(value)
  if (text.length < 4) return null
  return text.split(' ').slice(0, words).join(' ')
}

// The first element at or after `from` whose text holds `snippet`, or -1.
// `elements` are { text } with text already normalised, in document order.
export function findMatch(elements, snippet, from = 0) {
  for (let i = Math.max(0, from); i < elements.length; i++) {
    if (elements[i].text.includes(snippet)) return i
  }
  return -1
}

// Pairs of [formY, previewY] for the anchors, kept only while both grow, so a
// stray match (a word that appears earlier in the preview too) cannot pull
// the preview backwards. `anchors` are { y, snippet } in form order;
// `elements` are { text, y } in preview document order.
export function matchAnchors(anchors, elements) {
  const pairs = []
  let cursor = 0
  let lastForm = -Infinity
  let lastPreview = -Infinity
  for (const a of anchors) {
    if (!a.snippet) continue
    const i = findMatch(elements, a.snippet, cursor)
    if (i < 0) continue
    const y = elements[i].y
    if (a.y < lastForm || y < lastPreview) continue
    pairs.push([a.y, y])
    cursor = i
    lastForm = a.y
    lastPreview = y
  }
  return pairs
}

// Piecewise linear: where a form position falls in the preview. Before the
// first pair and after the last it holds at their ends.
export function interpolate(pairs, x) {
  if (pairs.length === 0) return 0
  if (x <= pairs[0][0]) return pairs[0][1]
  for (let i = 1; i < pairs.length; i++) {
    const [x1, y1] = pairs[i]
    if (x <= x1) {
      const [x0, y0] = pairs[i - 1]
      return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return pairs[pairs.length - 1][1]
}

// Where on the screen the form is being read, as a fraction of the window's
// height: a third of the way down, sliding to the bottom over the last
// window's worth of scrolling so the end of the form reaches the end of the
// preview.
export function readingFraction(scrollY, viewport, docHeight) {
  const maxScroll = Math.max(0, docHeight - viewport)
  const base = 1 / 3
  if (maxScroll === 0) return base
  const toEnd = maxScroll - scrollY
  if (toEnd >= viewport) return base
  return base + (1 - base) * (1 - Math.max(0, toEnd) / viewport)
}

// One frame at 60 frames a second, in milliseconds.
export const FRAME_MS = 16.7

// The share of the way to its target the preview covers in a frame that came
// `dt` milliseconds after the one before. At 60 frames a second that is the
// third it always was. A screen that draws twice as often takes two smaller
// steps that add up to the same third, so the preview eases at one speed on
// every screen; a fixed third a frame ran twice as fast at 120 Hz.
export function easeShare(dt) {
  return 1 - 0.66 ** (Math.max(0, dt) / FRAME_MS)
}

// Whether something other than the following moved the preview: it is more
// than `slack` px from where the following last put it. That catches every way
// of scrolling by hand, the ones that send no wheel, touch or key event
// included (a scrollbar that is drawn over the content, the browser's find in
// page, a link inside the preview taking the cursor).
//
// One move is the browser's own and not a hand: the preview grew shorter, or
// its box taller, and the position was pulled back to the new end.
export function movedByHand(scrollTop, written, maxScroll, slack = 2) {
  if (Math.abs(scrollTop - written) <= slack) return false
  if (scrollTop < written && scrollTop >= maxScroll - 1) return false
  return true
}

// The place to compare the next scroll with, after one that movedByHand let
// pass. A step inside the slack leaves the place where it was: a scroll by
// hand that comes a px at a time (a scrollbar dragged slowly) then adds up
// until it is past the slack and is seen. Taking each small step as the new
// place would let such a scroll carry the preview any distance unnoticed.
// A step past the slack was the browser's pull back to a new end, and the
// preview stands there now.
export function writtenAfter(scrollTop, written, slack = 2) {
  return Math.abs(scrollTop - written) <= slack ? written : scrollTop
}
