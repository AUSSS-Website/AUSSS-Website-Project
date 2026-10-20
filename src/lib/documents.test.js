import { describe, expect, it } from 'vitest'
import { documentFacts, downloadHref, fileSize } from './documents.js'

describe('fileSize', () => {
  it('says a size the way people do', () => {
    expect(fileSize(789020)).toBe('789 KB')
    expect(fileSize(400)).toBe('1 KB')
    expect(fileSize(1756124)).toBe('1.8 MB')
    expect(fileSize(19e6)).toBe('19 MB')
  })

  it('says nothing for a size it does not know', () => {
    for (const v of [0, -1, NaN, undefined, null, '12']) expect(fileSize(v)).toBe('')
  })
})

describe('documentFacts', () => {
  it('puts the version first, then the pages and the size', () => {
    expect(documentFacts({ pages: 49, bytes: 1756124 }, 'Issued October 2026')).toBe('Issued October 2026 · 49 pages · PDF, 1.8 MB')
  })

  it('leaves out what it does not know', () => {
    expect(documentFacts({ pages: 38, bytes: 789020 })).toBe('38 pages · PDF, 789 KB')
    expect(documentFacts({ pages: 1, bytes: 0 }, '  ')).toBe('1 page · PDF')
    expect(documentFacts(null)).toBe('PDF')
  })
})

describe('downloadHref', () => {
  const stored = 'https://abc.supabase.co/storage/v1/object/public/content-files/constitution.documents/x.pdf'

  it('asks Storage to send an uploaded file as an attachment, under the name given', () => {
    expect(downloadHref(stored, 'AUSSS-Constitution-and-Bylaws.pdf')).toBe(`${stored}?download=AUSSS-Constitution-and-Bylaws.pdf`)
    expect(downloadHref(stored)).toBe(`${stored}?download=`)
  })

  it('leaves the site’s own files and other addresses alone', () => {
    expect(downloadHref('/assets/docs/AUSSS-Constitution-and-Bylaws.pdf', 'x.pdf')).toBe('/assets/docs/AUSSS-Constitution-and-Bylaws.pdf')
    expect(downloadHref('https://drive.google.com/file/d/1/view', 'x.pdf')).toBe('https://drive.google.com/file/d/1/view')
    expect(downloadHref('', 'x.pdf')).toBe('')
  })
})
