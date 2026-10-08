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
