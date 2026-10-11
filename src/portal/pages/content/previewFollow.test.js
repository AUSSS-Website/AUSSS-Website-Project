import { describe, expect, it } from 'vitest'
import {
  FRAME_MS,
  easeShare,
  findMatch,
  interpolate,
  matchAnchors,
  movedByHand,
  normalizeText,
  readingFraction,
  snippetOf,
  writtenAfter,
} from './previewFollow.js'

describe('normalizeText and snippetOf', () => {
  it('reads typed markdown the way the preview shows it', () => {
    expect(normalizeText('Any student at the **Faculty of Medicine**, Ain Shams.')).toBe(
      'any student at the faculty of medicine ain shams',
    )
    expect(normalizeText('Ask on [our page](/committees/scoph)!')).toBe('ask on our page')
  })

  it('takes the first six words, and nothing from a value too short to tell apart', () => {
    expect(snippetOf('Who can join AUSSS, and when is the next intake?')).toBe('who can join ausss and when')
    expect(snippetOf('55+')).toBeNull()
    expect(snippetOf('')).toBeNull()
  })
})

describe('matchAnchors', () => {
  const elements = [
    { text: 'frequently asked questions', y: 0 },
    { text: 'who can join ausss and when is the next intake', y: 100 },
    { text: 'do i need to pay', y: 220 },
    { text: 'where do we meet', y: 340 },
  ]

  it('pairs each row with the preview text it produced, in order', () => {
    const anchors = [
      { y: 1000, snippet: 'who can join ausss and when' },
      { y: 1300, snippet: 'do i need to pay' },
      { y: 1600, snippet: 'where do we meet' },
    ]
    expect(matchAnchors(anchors, elements)).toEqual([
      [1000, 100],
      [1300, 220],
      [1600, 340],
    ])
  })

  it('skips rows with nothing to match, and never goes backwards', () => {
    const anchors = [
      { y: 900, snippet: null },
      { y: 1000, snippet: 'where do we meet' },
      // matches an element above the previous match: dropped
      { y: 1300, snippet: 'do i need to pay' },
    ]
    expect(matchAnchors(anchors, elements)).toEqual([[1000, 340]])
  })

  it('lets a list and its first row share a match', () => {
    const anchors = [
      { y: 1000, snippet: 'who can join ausss and when' },
      { y: 1010, snippet: 'who can join ausss and when' },
    ]
    expect(matchAnchors(anchors, elements)).toEqual([
      [1000, 100],
      [1010, 100],
    ])
  })

  it('searches from where it last matched', () => {
    expect(findMatch(elements, 'where', 1)).toBe(3)
    expect(findMatch(elements, 'frequently', 1)).toBe(-1)
  })
})

describe('interpolate', () => {
  const pairs = [
    [0, 0],
    [100, 50],
    [300, 450],
  ]

  it('places a point between two rows at the same fraction between their matches', () => {
    expect(interpolate(pairs, 50)).toBe(25)
    expect(interpolate(pairs, 200)).toBe(250)
  })

  it('holds at the ends', () => {
    expect(interpolate(pairs, -20)).toBe(0)
    expect(interpolate(pairs, 999)).toBe(450)
    expect(interpolate([], 10)).toBe(0)
  })
})

describe('readingFraction', () => {
  it('reads a third of the way down until the last window of scrolling', () => {
    expect(readingFraction(0, 900, 4000)).toBeCloseTo(1 / 3)
    expect(readingFraction(2000, 900, 4000)).toBeCloseTo(1 / 3)
  })

  it('slides to the bottom as the page reaches its end', () => {
    expect(readingFraction(3100, 900, 4000)).toBeCloseTo(1)
    expect(readingFraction(2650, 900, 4000)).toBeCloseTo(2 / 3)
  })

  it('stays at a third on a page that does not scroll', () => {
    expect(readingFraction(0, 900, 600)).toBeCloseTo(1 / 3)
  })
})

describe('easeShare', () => {
  // What is left of a gap after frames that come `dt` ms apart for `ms` ms.
  const leftAfter = (ms, dt) => {
    let left = 1
    for (let t = 0; t < ms - 1e-9; t += dt) left *= 1 - easeShare(dt)
    return left
  }

  it('covers a third of the way in a frame at 60 frames a second', () => {
    expect(easeShare(FRAME_MS)).toBeCloseTo(0.34)
  })

  it('gets as far in the same time on a screen that draws twice or four times as often', () => {
    const at60 = leftAfter(FRAME_MS * 12, FRAME_MS)
    expect(leftAfter(FRAME_MS * 12, FRAME_MS / 2)).toBeCloseTo(at60)
    expect(leftAfter(FRAME_MS * 12, FRAME_MS / 4)).toBeCloseTo(at60)
    // and no faster: one frame at 120 Hz covers less than a fifth, not a third
    expect(easeShare(FRAME_MS / 2)).toBeLessThan(0.2)
  })

  it('stands still for no time, and arrives after a long pause', () => {
    expect(easeShare(0)).toBe(0)
    expect(easeShare(-5)).toBe(0)
    expect(easeShare(5000)).toBeCloseTo(1)
  })
})

describe('movedByHand', () => {
  it('lets the following’s own steps pass, rounding included', () => {
    expect(movedByHand(300, 300, 1200)).toBe(false)
    expect(movedByHand(300.5, 301.4, 1200)).toBe(false)
    expect(movedByHand(298, 300, 1200)).toBe(false)
  })

  it('sees a scroll by hand, up or down, to the very end included', () => {
    expect(movedByHand(340, 300, 1200)).toBe(true)
    expect(movedByHand(120, 300, 1200)).toBe(true)
    expect(movedByHand(1200, 300, 1200)).toBe(true)
    expect(movedByHand(0, 300, 1200)).toBe(true)
  })

  it('does not take a preview that grew shorter for a hand', () => {
    // It stood at 900; a row was removed and the end is now at 640.
    expect(movedByHand(640, 900, 640)).toBe(false)
    // Nothing is left to scroll.
    expect(movedByHand(0, 900, 0)).toBe(false)
    // Scrolled up by hand to above the end: still a hand.
    expect(movedByHand(600, 900, 640)).toBe(true)
  })
})

describe('writtenAfter', () => {
  // Scroll events as the preview's scroll listener meets them, each with the
  // end of the preview at that moment: which of them it takes for a hand.
  const seen = (written, steps) =>
    steps.map(([top, maxScroll]) => {
      const hand = movedByHand(top, written, maxScroll)
      if (!hand) written = writtenAfter(top, written)
      return hand
    })

  it('keeps its place through a step inside the slack, so a slow scroll by hand adds up', () => {
    expect(writtenAfter(301.5, 300)).toBe(300)
    expect(writtenAfter(298, 300)).toBe(300)
    expect(seen(300, [[301.5, 1200], [303, 1200]])).toEqual([false, true])
    expect(seen(300, [[299, 1200], [298, 1200], [297, 1200]])).toEqual([false, false, true])
  })

  it('takes the new end as its place when the preview grew shorter', () => {
    expect(writtenAfter(640, 900)).toBe(640)
    // From there a scroll by hand is seen again.
    expect(seen(900, [[640, 640], [600, 640]])).toEqual([false, true])
    // A second shortening is not a hand either.
    expect(seen(900, [[640, 640], [500, 500]])).toEqual([false, false])
  })
})
