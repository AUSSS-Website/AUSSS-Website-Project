// A small markdown reader for the text officers type in the portal's content
// editor. It turns the text into a tree of plain objects; Markdown.jsx turns
// the tree into React elements. No HTML is ever produced or parsed, so
// whatever is typed (tags, scripts, odd links) can only ever show as text.
//
// Pure: no React, no DOM, so it also runs in Node (the pre-render and tests).
//
// What it reads, on purpose a short list:
//   blocks   paragraphs (a blank line between them; a single line break stays
//            a line break), "## Heading" and "### Smaller heading",
//            "- item" lists, "1. item" lists, "> quoted" lines
//   inline   **bold**, *italic*, [label](address), and a bare https:// address
//
// A link is kept only when its address is one a page may safely point at
// (safeHref below); otherwise its label shows as plain text.

// The address if a link may point at it, else ''. Allowed: http(s) pages, mail
// and phone links, pages of this site ("/join") and anchors ("#fees").
export function safeHref(raw) {
  const href = String(raw ?? '').trim()
  if (/^https?:\/\/[^\s<>"']+$/i.test(href)) return href
  if (/^mailto:[^\s<>"'@]+@[^\s<>"'@]+$/i.test(href)) return href
  if (/^tel:\+?[0-9][0-9 ()-]*$/i.test(href)) return href
  if (/^\/(?!\/)[^\s<>"']*$/.test(href)) return href
  if (/^#[\w-]+$/.test(href)) return href
  return ''
}

// 1 bold, 3 italic, 5 link (6 label, 7 address), 8 bare address. A bare
// address stops before closing punctuation, so "see https://x.org." keeps
// its full stop outside the link.
const INLINE_RE =
  /(\*\*(?=\S)([\s\S]+?)\*\*)|(\*(?=\S)([^*]+?)\*)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"*])/

// One line of text to inline nodes: strings, { type: 'strong' | 'em', children }
// and { type: 'link', href, children }.
export function parseInline(text, inLink = false) {
  const out = []
  let rest = String(text ?? '')
  while (rest) {
    const m = INLINE_RE.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    if (m[1]) {
      out.push({ type: 'strong', children: parseInline(m[2], inLink) })
    } else if (m[3]) {
      out.push({ type: 'em', children: parseInline(m[4], inLink) })
    } else if (m[5]) {
      const href = inLink ? '' : safeHref(m[7])
      const children = parseInline(m[6], true)
      if (href) out.push({ type: 'link', href, children })
      else out.push(...children)
    } else if (inLink) {
      out.push(m[8])
    } else {
      out.push({ type: 'link', href: m[8], children: [m[8]] })
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

// Lines of one paragraph to inline nodes, with a { type: 'br' } between lines.
function inlineLines(lines) {
  const out = []
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'br' })
    out.push(...parseInline(line))
  })
  return out
}

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*$/
const BULLET_RE = /^[-*]\s+(.*)$/
const NUMBER_RE = /^\d{1,3}[.)]\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/

// The whole text to blocks:
//   { type: 'p' | 'h2' | 'h3' | 'quote', children }   children are inline nodes
//   { type: 'ul' | 'ol', items }                      each item is inline nodes
// "# Title" is read as h2: the page already has its one h1.
export function parseMarkdown(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  const blocks = []
  let i = 0
  const take = (re) => {
    const got = []
    while (i < lines.length) {
      const m = re.exec(lines[i].trimStart())
      if (!m) break
      got.push(m[1])
      i += 1
    }
    return got
  }
  while (i < lines.length) {
    const line = lines[i].trimStart()
    if (!line) {
      i += 1
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ type: heading[1].length === 3 ? 'h3' : 'h2', children: parseInline(heading[2]) })
      i += 1
    } else if (BULLET_RE.test(line)) {
      blocks.push({ type: 'ul', items: take(BULLET_RE).map((t) => parseInline(t)) })
    } else if (NUMBER_RE.test(line)) {
      blocks.push({ type: 'ol', items: take(NUMBER_RE).map((t) => parseInline(t)) })
    } else if (QUOTE_RE.test(line)) {
      blocks.push({ type: 'quote', children: inlineLines(take(QUOTE_RE)) })
    } else {
      const para = []
      while (i < lines.length) {
        const next = lines[i].trimStart()
        if (!next || HEADING_RE.test(next) || BULLET_RE.test(next) || NUMBER_RE.test(next) || QUOTE_RE.test(next)) break
        para.push(next)
        i += 1
      }
      blocks.push({ type: 'p', children: inlineLines(para) })
    }
  }
  return blocks
}

function inlineText(nodes) {
  return nodes
    .map((n) => (typeof n === 'string' ? n : n.type === 'br' ? ' ' : inlineText(n.children)))
    .join('')
}

// The same text with the markdown marks removed, for places that take plain
// text only (search-engine data, share cards).
export function markdownToText(text) {
  return parseMarkdown(text)
    .map((b) => (b.items ? b.items.map(inlineText).join('; ') : inlineText(b.children)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
