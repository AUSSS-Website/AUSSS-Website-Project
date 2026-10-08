import { describe, expect, it } from 'vitest'
import { albumsFromSnapshot, archivedByTerm, currentAlbums, findAlbum, trailFrom } from './gallery.js'

const photo = (id) => ({ id, path: `a/${id}`, w: 1600, h: 1200 })
const doc = {
  albums: [
    { id: '1', slug: 'spring-camp', title: 'Spring camp', photos: [photo('p1')], term: '2025-26' },
    { id: '2', slug: 'health-week', title: 'Health week', photos: [photo('p2')], term: null },
    { id: '3', slug: 'nga-2026', title: 'NGA 2026', photos: [photo('p3')], term: '2026-27' },
    { id: '4', slug: 'welcome-day', title: 'Welcome day', photos: [photo('p4')], term: '2025-26' },
    { id: '5', slug: 'empty', title: 'Empty', photos: [], term: null },
  ],
}

describe('the gallery and its archive', () => {
  const albums = albumsFromSnapshot(doc)

  it('keeps each album’s term, null while it is in the gallery', () => {
    expect(albums.map((a) => [a.slug, a.term])).toEqual([
      ['spring-camp', '2025-26'],
      ['health-week', null],
      ['nga-2026', '2026-27'],
      ['welcome-day', '2025-26'],
    ])
  })

  it('shows only the albums still in the gallery on /gallery', () => {
    expect(currentAlbums(albums).map((a) => a.slug)).toEqual(['health-week'])
  })

  it('groups the archive by term, latest first, keeping shelf order inside a term', () => {
    expect(archivedByTerm(albums).map((g) => [g.term, g.albums.map((a) => a.slug)])).toEqual([
      ['2026-27', ['nga-2026']],
      ['2025-26', ['spring-camp', 'welcome-day']],
    ])
  })

  it('has an empty archive when nothing is archived', () => {
    expect(archivedByTerm(currentAlbums(albums))).toEqual([])
  })

  it('still finds an archived album at its link', () => {
    expect(findAlbum(albums, 'spring-camp').album?.title).toBe('Spring camp')
  })

  it('builds the trail from whatever albums it is given', () => {
    expect(trailFrom(currentAlbums(albums))).toHaveLength(1)
    expect(trailFrom(albums)).toHaveLength(4)
  })
})
