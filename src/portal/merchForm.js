// Pure helpers for the merch editor's forms (no React, no network), so the
// tests read them as they are.

// A product id from its name: lower case, dashes, at most 40 characters.
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

// "S, M, L" to ['S', 'M', 'L']: trimmed, no blanks, no repeats.
export function splitList(text) {
  const out = []
  for (const part of String(text || '').split(',')) {
    const s = part.trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}
