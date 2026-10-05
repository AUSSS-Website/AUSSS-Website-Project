// Field schemas for the parts of the site that are edited from the portal
// (Phase 6). A schema is a plain object: which fields a document has, their
// types and limits. The portal's RecordEditor draws its form from it; the
// public page reads its document through it. One schema per block in
// ./schemas, listed in ./index.js.
//
//   {
//     key: 'join.faq',                the row in public.content_blocks
//     title, description,             shown in the portal
//     path: '/join',                  the page it appears on
//     editors: ['scope'],             committees whose officers edit it besides
//                                     the EB (the database row is what decides)
//     fields: [ field, … ],
//     defaults: { … },                the document the site shows until one is
//                                     published: the copy that ships in the code
//   }
//
// A field is { name, type, label, help?, required?, max? } plus, by type:
//   text       one line
//   textarea   several lines, shown as typed
//   markdown   several lines, read by src/lib/markdown.js
//   url        an address a link may point at (safeHref)
//   image      the address of an uploaded picture
//   album      a gallery album, kept as its address name (the editor lists the albums)
//   toggle     true or false                       default?
//   select     one of options: [{ value, label }]  default?
//   list       rows of the same shape              fields, itemLabel, titleField?, min?, max?
//
// Pure: no React, no network, so the pre-render and the tests use it as is.
import { safeHref } from '../lib/markdown.js'

const LIST_MAX = 50
const TEXT_MAX = { text: 200, url: 500, image: 500, textarea: 2000, markdown: 4000 }

const maxOf = (field) => field.max || TEXT_MAX[field.type] || 200

function cleanString(v, { oneLine }) {
  if (typeof v !== 'string') return ''
  const s = v.replace(/\r\n?/g, '\n')
  return oneLine ? s.replace(/\s*\n\s*/g, ' ').trim() : s.replace(/[ \t]+$/gm, '').trim()
}

// A picture is an uploaded file (an https address) or one that ships with the
// site ("/assets/…"); nothing else is ever used as an image source.
function cleanImage(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^https:\/\/[^\s<>"']+$/i.test(s) || /^\/(?!\/)[^\s<>"']+$/.test(s) ? s : ''
}

function cleanField(field, v) {
  switch (field.type) {
    case 'toggle':
      return typeof v === 'boolean' ? v : Boolean(field.default)
    case 'select': {
      const values = (field.options || []).map((o) => o.value)
      return values.includes(v) ? v : (field.default ?? values[0] ?? '')
    }
    case 'list': {
      const rows = Array.isArray(v) ? v : []
      return rows
        .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
        .slice(0, field.max || LIST_MAX)
        .map((row) => cleanFields(field.fields, row))
    }
    case 'image':
      return cleanImage(v)
    case 'album':
      return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(v) ? v : ''
    case 'textarea':
    case 'markdown':
      return cleanString(v, { oneLine: false })
    default:
      return cleanString(v, { oneLine: true })
  }
}

function cleanFields(fields, doc) {
  const src = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}
  const out = {}
  for (const field of fields) out[field.name] = cleanField(field, src[field.name])
  return out
}

// Any value to a document of exactly the schema's shape: unknown keys dropped,
// wrong types replaced by the empty value, text trimmed. It never throws, so a
// page can pass it whatever the database returned.
export function normalizeDoc(schema, doc) {
  return cleanFields(schema.fields, doc)
}

// An empty row for a list field.
export function emptyRow(field) {
  return cleanFields(field.fields, {})
}

// The document the editor opens with when nothing is saved yet.
export function defaultDoc(schema) {
  return normalizeDoc(schema, schema.defaults || {})
}

function checkField(field, v, path, errors) {
  const label = field.label || field.name
  if (field.type === 'list') {
    const rows = Array.isArray(v) ? v : []
    const noun = field.itemLabel || 'row'
    if (field.min && rows.length < field.min) {
      errors[path] = field.min === 1 ? `Add at least one ${noun}.` : `Add at least ${field.min} ${noun}s.`
    } else if (rows.length > (field.max || LIST_MAX)) {
      errors[path] = `Keep to ${field.max || LIST_MAX} ${noun}s at most.`
    }
    rows.forEach((row, i) => {
      for (const sub of field.fields) checkField(sub, row?.[sub.name], `${path}.${i}.${sub.name}`, errors)
    })
    return
  }
  if (field.type === 'toggle' || field.type === 'select' || field.type === 'album') return
  const s = typeof v === 'string' ? v : ''
  if (!s) {
    if (field.required) errors[path] = `${label} is needed.`
    return
  }
  if (s.length > maxOf(field)) {
    errors[path] = `${label} is too long: ${s.length} characters, and the limit is ${maxOf(field)}.`
  } else if (field.type === 'url' && !safeHref(s)) {
    errors[path] = 'Use a full address that starts with https://, or a page of this site such as /join.'
  }
}

// What stops a document from being saved, as { 'items.2.q': 'message' }. Run
// it on a normalised document; an empty object means it is fine.
export function validateDoc(schema, doc) {
  const errors = {}
  for (const field of schema.fields) checkField(field, doc?.[field.name], field.name, errors)
  return errors
}

// Whether two documents are the same once both are in the schema's shape
// (the database returns keys in its own order).
export function sameDoc(schema, a, b) {
  return JSON.stringify(normalizeDoc(schema, a)) === JSON.stringify(normalizeDoc(schema, b))
}

// What a page should show: the published document, or the copy that ships in
// the code when nothing is published or the published one is unusable.
export function resolveDoc(schema, published) {
  if (!published || typeof published !== 'object' || Array.isArray(published)) return defaultDoc(schema)
  const doc = normalizeDoc(schema, published)
  return Object.keys(validateDoc(schema, doc)).length === 0 ? doc : defaultDoc(schema)
}
