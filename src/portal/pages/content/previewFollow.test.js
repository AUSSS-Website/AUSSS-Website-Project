import { describe, expect, it } from 'vitest'
import { findMatch, interpolate, matchAnchors, normalizeText, readingFraction, snippetOf } from './previewFollow.js'

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
