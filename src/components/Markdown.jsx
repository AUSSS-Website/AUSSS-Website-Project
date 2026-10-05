import { Link } from 'react-router-dom'
import { parseMarkdown } from '../lib/markdown.js'

// Renders text typed in the portal's content editor (src/lib/markdown.js says
// what it understands). Everything becomes React elements, never HTML, so the
// text cannot inject markup. Links to this site's own pages stay in the app;
// others open in a new tab.

const linkCls = 'font-semibold text-accent underline decoration-line/25 underline-offset-2 hover:text-ink'

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    if (typeof n === 'string') return n
    if (n.type === 'br') return <br key={i} />
    if (n.type === 'strong') {
      return (
        <strong key={i} className="font-semibold text-ink">
          <Inline nodes={n.children} />
        </strong>
      )
    }
    if (n.type === 'em') {
      return (
        <em key={i}>
          <Inline nodes={n.children} />
        </em>
      )
    }
    if (n.href.startsWith('/')) {
      return (
        <Link key={i} to={n.href} className={linkCls}>
          <Inline nodes={n.children} />
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
        <Inline nodes={n.children} />
      </a>
    )
  })
}

// `className` goes on the wrapper and sets the text size and colour; the
// blocks inside only add spacing and their own shape.
export default function Markdown({ text, className = '' }) {
  const blocks = parseMarkdown(text)
  if (blocks.length === 0) return null
  return (
    <div className={`space-y-3 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h2') {
          return (
            <h3 key={i} className="heading-serif pt-2 text-xl text-ink">
              <Inline nodes={b.children} />
            </h3>
          )
        }
        if (b.type === 'h3') {
          return (
            <h4 key={i} className="pt-1 text-base font-semibold text-ink">
              <Inline nodes={b.children} />
            </h4>
          )
        }
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type
          return (
            <List key={i} className={`space-y-1.5 pl-5 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'}`}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline nodes={item} />
                </li>
              ))}
            </List>
          )
        }
        if (b.type === 'quote') {
          return (
            <blockquote key={i} className="border-l-2 border-medical/50 pl-4 italic">
              <Inline nodes={b.children} />
            </blockquote>
          )
        }
        return (
          <p key={i}>
            <Inline nodes={b.children} />
          </p>
        )
      })}
    </div>
  )
}
