import { describe, expect, it } from 'vitest'
import { dropIndex, moveId, settleOffsets } from './SortableList.jsx'

// Four rows, 100 px tall with a 12 px gap: their middle lines.
const centers = [50, 162, 274, 386]

describe('dropIndex', () => {
  it('stays put until the row has crossed a neighbour’s middle', () => {
    expect(dropIndex(centers, 1, 162)).toBe(1)
    expect(dropIndex(centers, 1, 162 + 100)).toBe(1)
    expect(dropIndex(centers, 1, 162 - 100)).toBe(1)
  })

  it('moves down past each row whose middle it crosses', () => {
    expect(dropIndex(centers, 0, 163)).toBe(1)
    expect(dropIndex(centers, 0, 275)).toBe(2)
    expect(dropIndex(centers, 0, 2000)).toBe(3)
  })

  it('moves up past each row whose middle it crosses', () => {
    expect(dropIndex(centers, 3, 273)).toBe(2)
    expect(dropIndex(centers, 3, 161)).toBe(1)
    expect(dropIndex(centers, 3, -500)).toBe(0)
  })

  it('copes with a list of one', () => {
    expect(dropIndex([50], 0, 900)).toBe(0)
  })
})

describe('moveId', () => {
  it('moves one id and keeps the rest in order, without touching the input', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(moveId(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveId(ids, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveId(ids, 1, 1)).toEqual(ids)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('settleOffsets', () => {
  // The same four rows by their top edges: 100 px tall with a 12 px gap.
  const laidOut = (ids) => new Map(ids.map((id, i) => [id, i * 112]))

  it('starts the dropped row where it was let go, and leaves the rows that had already made room', () => {
    // 'a' was dragged down past 'b' and 'c' and let go 30 px short of its
    // place; 'b' and 'c' had each moved up one place to make room.
    const before = new Map([['a', 194], ['b', 0], ['c', 112], ['d', 336]])
    expect(settleOffsets(before, laidOut(['b', 'c', 'a', 'd']))).toEqual([['a', -30]])
  })

  it('carries a row caught part-way through making room the rest of the way', () => {
    // 'b' had slid 40 px of the 112 it had to go when 'a' was let go on its place.
    const before = new Map([['a', 112], ['b', 72], ['c', 224], ['d', 336]])
    expect(settleOffsets(before, laidOut(['b', 'a', 'c', 'd']))).toEqual([['b', 72]])
  })

  it('swaps two rows from each other’s places for a move by key', () => {
    expect(settleOffsets(laidOut(['a', 'b', 'c', 'd']), laidOut(['a', 'c', 'b', 'd']))).toEqual([
      ['c', 112],
      ['b', -112],
    ])
  })

  it('brings a row that was put back from where it hung to its own place', () => {
    const before = new Map([['a', 0], ['b', 112], ['c', 20], ['d', 336]])
    expect(settleOffsets(before, laidOut(['a', 'b', 'c', 'd']))).toEqual([['c', -204]])
  })

  it('moves nothing that is already in place, to within half a px', () => {
    const before = new Map([['a', 0.2], ['b', 111.6], ['c', 224.5], ['d', 336]])
    expect(settleOffsets(before, laidOut(['a', 'b', 'c', 'd']))).toEqual([['c', 0.5]])
  })

  it('leaves out a row that is new, and one that has gone', () => {
    const before = new Map([['a', 0], ['gone', 112]])
    const after = new Map([['a', 112], ['new', 0]])
    expect(settleOffsets(before, after)).toEqual([['a', -112]])
  })
})
