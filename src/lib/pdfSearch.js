// Searching the words of a PDF, for the site's document reader
// (src/components/PdfReader.jsx). No pdf.js and no DOM in here.
//
// pdf.js hands over a page's text as many small pieces, often one per word or
// per line, in reading order. To find a phrase that runs across pieces, a page
// becomes one line of folded text (lower case, one space between pieces, the
// quirks of exported documents ironed out), and every character of that line
// remembers which piece it came from and where in it, so a match can be drawn
// back onto the page.

export const MIN_QUERY = 2
export const MAX_MATCHES = 500

const SPACE = /\s/
// Zero-width characters that exports leave between a number and its heading
// ("1.​Name"), and the soft hyphen.
const INVISIBLE = new Set(['​', '‌', '‍', '‎', '‏', '⁠', '﻿', '­'])
const QUOTES = { '‘': "'", '’': "'", '‚': "'", 'ʼ': "'", '“': '"', '”': '"', '„': '"' }
const DASHES = new Set(['‐', '‑', '‒', '–', '—', '−'])

// One character as it is compared: '' when it is dropped, ' ' for any
// whitespace, otherwise one lower-case character with curly quotes and long
// dashes read as the plain ones.
function foldChar(ch) {
  if (INVISIBLE.has(ch)) return ''
  if (ch === ' ' || SPACE.test(ch)) return ' '
  if (QUOTES[ch]) return QUOTES[ch]
  if (DASHES.has(ch)) return '-'
  const lower = ch.toLowerCase()
  // A few letters lower-case to two characters; keep those as they are so
  // every position still stands for one character of the page.
  return lower.length === 1 ? lower : ch
}

// What someone typed, folded the same way: single spaces, no space at the ends.
export function foldQuery(query) {
  let out = ''
  for (const ch of String(query ?? '')) {
    const f = ch.length === 1 ? foldChar(ch) : ch
    if (f === ' ' && (out === '' || out.endsWith(' '))) continue
    out += f
  }
  return out.trimEnd()
}

// A page's pieces as one searchable line.
//   text     the folded line that is searched
//   display  the same positions with the page's own capitals, for snippets
//   piece    for each position, the index of the piece it came from, or -1 for
//            a space put between two pieces
//   offset   for each position, where in that piece (in its own string)
export function buildPageIndex(strings) {
  let text = ''
  let display = ''
  const piece = []
  const offset = []
  const push = (folded, shown, p, o) => {
    text += folded
    display += shown
    piece.push(p)
    offset.push(o)
  }
  ;(strings || []).forEach((str, p) => {
    const s = String(str ?? '')
    let wrote = false
    for (let o = 0; o < s.length; o++) {
      const ch = s[o]
      const f = foldChar(ch)
      if (f === '') continue
      if (f === ' ') {
        // one space at most, and none at the start of the line
        if (text !== '' && !text.endsWith(' ')) push(' ', ' ', p, o)
        continue
      }
      // a new piece is a new word unless the page itself put no gap there
      if (!wrote && text !== '' && !text.endsWith(' ')) push(' ', ' ', -1, 0)
      push(f, ch, p, o)
      wrote = true
    }
  })
  return { text, display, piece: Int32Array.from(piece), offset: Int32Array.from(offset) }
}

// Every place the folded query occurs in a page, left to right, not overlapping.
export function findMatches(index, query) {
  const found = []
  if (!index || query.length < MIN_QUERY) return found
  for (let at = index.text.indexOf(query); at !== -1; at = index.text.indexOf(query, at + query.length)) {
    found.push({ start: at, end: at + query.length })
  }
  return found
}

// A match as stretches of the page's own pieces: [{ piece, from, to }], `to`
// not included, in the order they appear. The reader marks these on the page.
export function matchRanges(index, match) {
  const ranges = []
  for (let i = match.start; i < match.end; i++) {
    const p = index.piece[i]
    if (p === -1) continue
    const o = index.offset[i]
    const last = ranges[ranges.length - 1]
    if (last && last.piece === p && o >= last.from) last.to = Math.max(last.to, o + 1)
    else ranges.push({ piece: p, from: o, to: o + 1 })
  }
  return ranges
}

// The words around a match, for the list of results.
export function snippet(index, match, radius = 48) {
  const from = Math.max(0, match.start - radius)
  const to = Math.min(index.display.length, match.end + radius)
  // start and end on a word where there is one within reach
  const lead = index.display.lastIndexOf(' ', from)
  const tail = index.display.indexOf(' ', to)
  const a = from === 0 ? 0 : lead !== -1 && from - lead < 16 ? lead + 1 : from
  const b = to === index.display.length ? to : tail !== -1 && tail - to < 16 ? tail : to
  return {
    before: (a > 0 ? '… ' : '') + index.display.slice(a, match.start),
    hit: index.display.slice(match.start, match.end),
    after: index.display.slice(match.end, b) + (b < index.display.length ? ' …' : ''),
  }
}

// The whole document: `pages[i]` is the index of page i + 1, or a gap while
// its text has not been read yet. Matches come in page order, each with its
// number within its page; `more` says the list was cut at MAX_MATCHES.
export function searchDocument(pages, rawQuery) {
  const query = foldQuery(rawQuery)
  const matches = []
  if (query.length < MIN_QUERY) return { query, matches, more: false }
  for (let i = 0; i < pages.length; i++) {
    const found = findMatches(pages[i], query)
    for (let n = 0; n < found.length; n++) {
      if (matches.length === MAX_MATCHES) return { query, matches, more: true }
      matches.push({ page: i + 1, n, start: found[n].start, end: found[n].end })
    }
  }
  return { query, matches, more: false }
}
