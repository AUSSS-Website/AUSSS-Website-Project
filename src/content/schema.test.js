import { describe, expect, it } from 'vitest'
import { defaultDoc, emptyRow, normalizeDoc, resolveDoc, sameDoc, validateDoc } from './schema.js'
import { contentSchemas } from './index.js'

const schema = {
  key: 'test.page',
  fields: [
    { name: 'title', type: 'text', label: 'Title', required: true, max: 20 },
    { name: 'intro', type: 'markdown', label: 'Introduction' },
    { name: 'link', type: 'url', label: 'Link' },
    { name: 'photo', type: 'image', label: 'Photo' },
    { name: 'shown', type: 'toggle', label: 'Shown', default: true },
    { name: 'tone', type: 'select', label: 'Tone', options: [{ value: 'calm', label: 'Calm' }, { value: 'loud', label: 'Loud' }] },
    {
      name: 'items',
      type: 'list',
      label: 'Items',
      itemLabel: 'item',
      min: 1,
      max: 3,
      fields: [
        { name: 'q', type: 'text', label: 'Question', required: true },
        { name: 'a', type: 'textarea', label: 'Answer' },
      ],
    },
  ],
  defaults: { title: 'Shipped', items: [{ q: 'Shipped question', a: 'Shipped answer' }] },
}

describe('normalizeDoc', () => {
  it('returns exactly the schema shape, whatever it is given', () => {
    for (const junk of [null, undefined, 'text', 7, [], [1, 2]]) {
      expect(normalizeDoc(schema, junk)).toEqual({
        title: '', intro: '', link: '', photo: '', shown: true, tone: 'calm', items: [],
      })
    }
  })

  it('drops unknown keys and wrong types', () => {
    const doc = normalizeDoc(schema, {
      title: ['not', 'text'],
      extra: 'gone',
      shown: 'yes',
      tone: 'shrill',
      items: [{ q: 'kept', a: 5, extra: 1 }, 'not a row', null, ['nor', 'this']],
    })
    expect(doc).toEqual({
      title: '', intro: '', link: '', photo: '', shown: true, tone: 'calm',
      items: [{ q: 'kept', a: '' }],
    })
  })

  it('trims text, flattens one-line fields and keeps line breaks in long ones', () => {
    const doc = normalizeDoc(schema, {
      title: '  Two\nlines  ',
      intro: 'first  \r\nsecond\n\n',
      items: [{ q: ' q ', a: ' a\nb ' }],
    })
    expect(doc.title).toBe('Two lines')
    expect(doc.intro).toBe('first\nsecond')
    expect(doc.items[0]).toEqual({ q: 'q', a: 'a\nb' })
  })

  it('keeps only picture addresses a page may load', () => {
    expect(normalizeDoc(schema, { photo: 'https://x.supabase.co/storage/a.jpg' }).photo).toBe('https://x.supabase.co/storage/a.jpg')
    expect(normalizeDoc(schema, { photo: '/assets/exchange/a.jpg' }).photo).toBe('/assets/exchange/a.jpg')
    for (const bad of ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'http://x.org/a.jpg', '//x.org/a.jpg']) {
      expect(normalizeDoc(schema, { photo: bad }).photo).toBe('')
    }
  })

  it('cuts a list at its limit', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ q: `q${i}` }))
    expect(normalizeDoc(schema, { items }).items).toHaveLength(3)
  })
})

describe('validateDoc', () => {
  const good = { title: 'Fine', items: [{ q: 'A question', a: '' }] }

  it('passes a good document', () => {
    expect(validateDoc(schema, normalizeDoc(schema, good))).toEqual({})
  })

  it('names each problem by its path', () => {
    const errors = validateDoc(
      schema,
      normalizeDoc(schema, { title: '', link: 'exchange', items: [{ q: 'ok' }, { q: '' }] }),
    )
    expect(Object.keys(errors).sort()).toEqual(['items.1.q', 'link', 'title'])
    expect(errors.title).toBe('Title is needed.')
  })

  it('holds text to its limit and lists to their minimum', () => {
    const errors = validateDoc(schema, normalizeDoc(schema, { title: 'x'.repeat(21), items: [] }))
    expect(errors.title).toMatch(/too long/)
    expect(errors.items).toBe('Add at least one item.')
  })

  it('accepts the addresses a link may use', () => {
    for (const link of ['https://ifmsa.org', '/join', 'mailto:a@b.org']) {
      expect(validateDoc(schema, normalizeDoc(schema, { ...good, link })).link).toBeUndefined()
    }
  })
})

describe('defaultDoc, emptyRow, sameDoc, resolveDoc', () => {
  it('opens with the shipped copy', () => {
    expect(defaultDoc(schema).title).toBe('Shipped')
    expect(emptyRow(schema.fields[6])).toEqual({ q: '', a: '' })
  })

  it('compares documents whatever their key order', () => {
    const a = { title: 'T', items: [{ q: 'q', a: 'a' }] }
    const b = { items: [{ a: 'a', q: 'q' }], title: 'T' }
    expect(sameDoc(schema, a, b)).toBe(true)
    expect(sameDoc(schema, a, { ...b, title: 'U' })).toBe(false)
  })

  it('shows the published document when it is usable, the shipped copy when it is not', () => {
    expect(resolveDoc(schema, { title: 'Live', items: [{ q: 'Live q' }] }).title).toBe('Live')
    expect(resolveDoc(schema, null).title).toBe('Shipped')
    expect(resolveDoc(schema, [1]).title).toBe('Shipped')
    // published but broken (no title, no items): never render it
    expect(resolveDoc(schema, { title: '', items: [] }).title).toBe('Shipped')
  })
})

describe('the schemas the site ships', () => {
  it('have unique keys in the form the database accepts', () => {
    const keys = contentSchemas.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9-]{0,39}(\.[a-z][a-z0-9-]{0,39}){1,2}$/)
  })

  it('ship a copy that passes their own rules', () => {
    for (const s of contentSchemas) {
      expect(validateDoc(s, defaultDoc(s)), s.key).toEqual({})
    }
  })
})
