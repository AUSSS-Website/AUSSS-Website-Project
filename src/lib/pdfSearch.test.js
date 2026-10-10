import { describe, expect, it } from 'vitest'
import {
  MAX_MATCHES,
  buildPageIndex,
  findMatches,
  foldQuery,
  matchRanges,
  searchDocument,
  snippet,
} from './pdfSearch.js'

describe('foldQuery', () => {
  it('lower-cases, trims and keeps single spaces', () => {
    expect(foldQuery('  General   Assembly ')).toBe('general assembly')
  })
  it('reads curly quotes and long dashes as the plain ones', () => {
    expect(foldQuery('members’ rights – “Full”')).toBe('members\' rights - "full"')
  })
  it('drops what cannot be seen', () => {
    expect(foldQuery('1.​Name')).toBe('1.name')
    expect(foldQuery(null)).toBe('')
  })
})

describe('buildPageIndex', () => {
  it('puts one space between pieces and none where the page has its own', () => {
    const index = buildPageIndex(['The General ', 'Assembly', ' meets', 'twice'])
    expect(index.text).toBe('the general assembly meets twice')
    expect(index.display).toBe('The General Assembly meets twice')
  })
  it('skips empty and blank pieces without doubling the space', () => {
    expect(buildPageIndex(['Local', '', '   ', 'Committee']).text).toBe('local committee')
  })
  it('remembers where every character came from', () => {
    const index = buildPageIndex(['Full', 'member'])
    // 'full member': position 4 is the space put between the two pieces
    expect(index.piece[4]).toBe(-1)
    expect([index.piece[5], index.offset[5]]).toEqual([1, 0])
    expect([index.piece[3], index.offset[3]]).toEqual([0, 3])
  })
  it('keeps positions true when a piece holds characters that are dropped', () => {
    const index = buildPageIndex(['1.​Name'])
    expect(index.text).toBe('1.name')
    // 'n' is the fourth character of the piece, after the zero-width one
    expect(index.offset[2]).toBe(3)
  })
})

describe('findMatches and matchRanges', () => {
  const index = buildPageIndex(['A motion to amend can be raised only by a', 'Full', 'member, and a full', 'member votes.'])

  it('finds a phrase that runs across pieces, whatever its capitals', () => {
    const found = findMatches(index, foldQuery('FULL MEMBER'))
    expect(found).toHaveLength(2)
    expect(index.display.slice(found[0].start, found[0].end)).toBe('Full member')
  })
  it('gives each match back as stretches of the pieces', () => {
    const [first, second] = findMatches(index, 'full member')
    expect(matchRanges(index, first)).toEqual([
      { piece: 1, from: 0, to: 4 },
      { piece: 2, from: 0, to: 6 },
    ])
    expect(matchRanges(index, second)).toEqual([
      { piece: 2, from: 14, to: 18 },
      { piece: 3, from: 0, to: 6 },
    ])
  })
  it('does not count overlapping matches twice', () => {
    expect(findMatches(buildPageIndex(['aaaa']), 'aa')).toHaveLength(2)
  })
  it('finds nothing for a query that is too short or a page not read yet', () => {
    expect(findMatches(index, 'a')).toEqual([])
    expect(findMatches(undefined, 'member')).toEqual([])
  })
  it('matches a curly apostrophe typed as a plain one', () => {
    const page = buildPageIndex(['the members’ rights'])
    expect(findMatches(page, foldQuery("members' rights"))).toHaveLength(1)
  })
})

describe('snippet', () => {
  it('shows the words around a match in the page\'s own capitals', () => {
    const index = buildPageIndex(['Amendments are decided at the Local General Assembly by a two-thirds majority of the Full members present.'])
    const [match] = findMatches(index, 'general assembly')
    const s = snippet(index, match, 20)
    expect(s.hit).toBe('General Assembly')
    expect(s.before.startsWith('… ')).toBe(true)
    expect(s.before.endsWith('Local ')).toBe(true)
    expect(s.after.endsWith(' …')).toBe(true)
  })
  it('adds no dots at the ends of the page', () => {
    const index = buildPageIndex(['Name'])
    const s = snippet(index, findMatches(index, 'name')[0])
    expect(s).toEqual({ before: '', hit: 'Name', after: '' })
  })
})

describe('searchDocument', () => {
  const pages = [buildPageIndex(['Quorum of the Assembly']), undefined, buildPageIndex(['No quorum, no vote. Quorum again.'])]

  it('lists matches in page order, numbered within their page', () => {
    const { matches, more } = searchDocument(pages, 'Quorum')
    expect(matches.map((m) => [m.page, m.n])).toEqual([[1, 0], [3, 0], [3, 1]])
    expect(more).toBe(false)
  })
  it('returns nothing for a short query', () => {
    expect(searchDocument(pages, 'q').matches).toEqual([])
  })
  it('stops at the limit and says so', () => {
    const big = [buildPageIndex([Array.from({ length: MAX_MATCHES + 5 }, () => 'vote').join(' ')])]
    const { matches, more } = searchDocument(big, 'vote')
    expect(matches).toHaveLength(MAX_MATCHES)
    expect(more).toBe(true)
  })
})
