import { describe, expect, it } from 'vitest'
import { markdownToText, parseInline, parseMarkdown, safeHref } from './markdown.js'

describe('safeHref', () => {
  it('keeps web, mail, phone, site and anchor addresses', () => {
    expect(safeHref('https://ifmsa.org/exchange')).toBe('https://ifmsa.org/exchange')
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('mailto:sg@ausss-ainshams.org')).toBe('mailto:sg@ausss-ainshams.org')
    expect(safeHref('tel:+20 100 000 0000')).toBe('tel:+20 100 000 0000')
    expect(safeHref('/exchange/incomings')).toBe('/exchange/incomings')
    expect(safeHref('#fees')).toBe('#fees')
  })

  it('refuses anything that could run or leave the site unexpectedly', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      '//evil.example/path',
      '/\\evil.example/path',
      'https://x.org/"onmouseover="x',
      'ftp://x.org',
      'exchange',
      '',
      null,
    ]) {
      expect(safeHref(bad)).toBe('')
    }
  })
})

describe('parseInline', () => {
  it('leaves plain text alone, tags included', () => {
    expect(parseInline('<script>alert(1)</script> & <b>x</b>')).toEqual(['<script>alert(1)</script> & <b>x</b>'])
  })

  it('reads bold, italic and links', () => {
    expect(parseInline('a **b** *c* [d](/join)')).toEqual([
      'a ',
      { type: 'strong', children: ['b'] },
      ' ',
      { type: 'em', children: ['c'] },
      ' ',
      { type: 'link', href: '/join', children: ['d'] },
    ])
  })

  it('reads italic inside bold', () => {
    expect(parseInline('**very *much* so**')).toEqual([
      { type: 'strong', children: ['very ', { type: 'em', children: ['much'] }, ' so'] },
    ])
  })

  it('shows the label of a link it will not follow', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual(['click', ')'])
    expect(parseInline('[click](data:text/html,x)')).toEqual(['click'])
  })

  it('links a bare address and keeps closing punctuation outside it', () => {
    expect(parseInline('See https://ifmsa.org/exchange.')).toEqual([
      'See ',
      { type: 'link', href: 'https://ifmsa.org/exchange', children: ['https://ifmsa.org/exchange'] },
      '.',
    ])
  })

  it('never nests a link inside a link', () => {
    expect(parseInline('[https://a.org](https://b.org)')).toEqual([
      { type: 'link', href: 'https://b.org', children: ['https://a.org'] },
    ])
  })

  it('does not treat a lone asterisk as italic', () => {
    expect(parseInline('5 * 3 = 15')).toEqual(['5 * 3 = 15'])
  })
})

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
      { type: 'p', children: ['one', { type: 'br' }, 'two'] },
      { type: 'p', children: ['three'] },
    ])
  })

  it('reads headings, lists and quotes', () => {
    const blocks = parseMarkdown('# Top\n## Hospitals\n### Wards\n- a\n- b\n\n1. x\n2. y\n> said\n> again')
    expect(blocks.map((b) => b.type)).toEqual(['h2', 'h2', 'h3', 'ul', 'ol', 'quote'])
    expect(blocks[3].items).toEqual([['a'], ['b']])
    expect(blocks[4].items).toEqual([['x'], ['y']])
    expect(blocks[5].children).toEqual(['said', { type: 'br' }, 'again'])
  })

  it('ends a paragraph where a list starts', () => {
    expect(parseMarkdown('Bring:\n- passport\n- white coat').map((b) => b.type)).toEqual(['p', 'ul'])
  })

  it('copes with Windows line endings, empty text and non-strings', () => {
    expect(parseMarkdown('a\r\n\r\nb')).toHaveLength(2)
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown(null)).toEqual([])
    expect(parseMarkdown(42)).toEqual([{ type: 'p', children: ['42'] }])
  })
})

describe('markdownToText', () => {
  it('drops the marks and keeps the words', () => {
    expect(markdownToText('**Yes.** See the [Exchange page](/exchange).\n\n- one\n- two')).toBe(
      'Yes. See the Exchange page. one; two',
    )
  })

  it('returns plain text unchanged', () => {
    expect(markdownToText('Any student at the Faculty of Medicine.')).toBe('Any student at the Faculty of Medicine.')
  })
})
