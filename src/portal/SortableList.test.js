import { describe, expect, it } from 'vitest'
import { dropIndex, moveId } from './SortableList.jsx'

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
