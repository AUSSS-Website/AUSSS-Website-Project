import { describe, expect, it } from 'vitest'
import { normalizeProduct } from './merch.js'
import { shippedProducts } from '../data/merchProducts.js'
import { slugify, splitList } from '../portal/merchForm.js'

describe('normalizeProduct', () => {
  it('reads a database row into the shape the shop renders', () => {
    const p = normalizeProduct({
      id: 'notebook',
      name: 'AUSSS Notebook',
      price: 40,
      sizes: [],
      size_chart: '',
      designs: ['SCOPH', 'Exchange'],
      wide_designs: ['Exchange', 'Gone'],
      available: true,
    })
    expect(p).toMatchObject({
      id: 'notebook',
      price: 40,
      sizeChart: '',
      designs: ['SCOPH', 'Exchange'],
      wideDesigns: ['Exchange'],
      available: true,
    })
  })

  it('keeps the shipped copy as it is', () => {
    for (const p of shippedProducts) {
      expect(normalizeProduct(p)).toEqual({ ...p, wideDesigns: p.wideDesigns || [], sizeChart: p.sizeChart || '' })
    }
  })

  it('treats missing fields as empty, and a missing flag as on sale', () => {
    expect(normalizeProduct({ id: 'x', name: 'X' })).toMatchObject({
      price: 0,
      sizes: [],
      designs: [],
      image: '',
      available: true,
    })
  })
})

describe('slugify', () => {
  it('makes a product id from a name', () => {
    expect(slugify('"The" AUSSS Jacket!')).toBe('the-ausss-jacket')
    expect(slugify('Café mug')).toBe('cafe-mug')
    expect(slugify('a'.repeat(39) + ' b')).toBe('a'.repeat(39))
  })
})

describe('splitList', () => {
  it('splits on commas, trims and drops blanks and repeats', () => {
    expect(splitList(' S, M ,, L, M ')).toEqual(['S', 'M', 'L'])
    expect(splitList('')).toEqual([])
  })
})
