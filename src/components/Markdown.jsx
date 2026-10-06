import { Link } from 'react-router-dom'
import { parseMarkdown } from '../lib/markdown.js'

// Renders text typed in the portal's content editor (src/lib/markdown.js says
// what it understands). Everything becomes React elements, never HTML, so the
// text cannot inject markup. Links to this site's own pages stay in the app;
// others open in a new tab.

const linkCls = 'font-semibold text-accent underline decoration-line/25 underline-offset-2 hover:text-ink'

// `marks` styles bold and italic words where a section gives them a meaning of
// its own (the home page's highlighted words); elsewhere they are plain.
const PLAIN = { strong: 'font-semibold text-ink', em: '' }

function Inline({ nodes, marks = PLAIN }) {
  return nodes.map((n, i) => {
    if (typeof n === 'string') return n
    if (n.type === 'br') return <br key={i} />
    if (n.type === 'strong') {
      return (
        <strong key={i} className={marks.strong}>
          <Inline nodes={n.children} marks={marks} />
        </strong>
      )
    }
    if (n.type === 'em') {
      return (
        <em key={i} className={marks.em || undefined}>
          <Inline nodes={n.children} marks={marks} />
        </em>
      )
    }
    if (n.href.startsWith('/')) {
      return (
        <Link key={i} to={n.href} className={linkCls}>
          <Inline nodes={n.children} marks={marks} />
        </Link>
      )
    }
    const external = /^https?:/i.test(n.href)
    return (
      <a
        key={i}
        href={n.href}
        className={`${linkCls} break-words`}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        <Inline nodes={n.children} marks={marks} />
      </a>
    )
  })
}

// `className` goes on the wrapper and sets the text size and colour; the
// blocks inside only add spacing and their own shape. `gap` is the space
// between blocks, `marks` the classes for bold and italic words.
export default function Markdown({ text, className = '', gap = 'space-y-3', marks = PLAIN }) {
  const blocks = parseMarkdown(text)
  if (blocks.length === 0) return null
  return (
    <div className={`${gap} ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h2') {
          return (
            <h3 key={i} className="heading-serif pt-2 text-xl text-ink">
              <Inline nodes={b.children} marks={marks} />
            </h3>
          )
        }
        if (b.type === 'h3') {
          return (
            <h4 key={i} className="pt-1 text-base font-semibold text-ink">
              <Inline nodes={b.children} marks={marks} />
            </h4>
          )
        }
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type
          return (
            <List key={i} className={`space-y-1.5 pl-5 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'}`}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline nodes={item} marks={marks} />
                </li>
              ))}
            </List>
          )
        }
        if (b.type === 'quote') {
          return (
            <blockquote key={i} className="border-l-2 border-medical/50 pl-4 italic">
              <Inline nodes={b.children} marks={marks} />
            </blockquote>
          )
        }
        return (
          <p key={i}>
            <Inline nodes={b.children} marks={marks} />
          </p>
        )
      })}
    </div>
  )
}
