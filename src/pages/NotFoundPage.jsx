import { Link } from 'react-router-dom'
import usePageTitle from '../hooks/usePageTitle.js'
import Button from '../components/ui/Button.jsx'
import { pressCls } from '../lib/motion.js'

// What an address that names no page shows: the catch-all route in App.jsx,
// and a committee address with no such committee (CommitteePage.jsx). Both
// used to send the visitor to the home page without a word, which hid the
// mistake from them and showed a search engine the home page under every
// mistyped address.
//
// The server still answers 200 for such an address (vercel.json hands the
// app's shell to every address that has no file of its own), so the page asks
// search engines to leave it out, for as long as it is shown.

// Where to go from here, in the order of the header. Committees have no page
// of their own to land on: the link goes to their section of the home page.
const PLACES = [
  { to: '/ifmsa', label: 'IFMSA' },
  { to: '/#officials', label: 'Committees' },
  { to: '/events', label: 'Events' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/magazine', label: 'Magazine' },
  { to: '/merch', label: 'Merch' },
  { to: '/join', label: 'Join us' },
  { to: '/members', label: 'Check membership' },
  { to: '/contact', label: 'Contact' },
]

export default function NotFoundPage() {
  usePageTitle('Page not found', undefined, { noindex: true })

  return (
    <article className="bg-page">
      {/* Top padding: the bar, then the floating Back button, which on a phone
          would otherwise sit on the first line of the centred text. */}
      <div className="relative overflow-hidden pb-24 pt-44 sm:pb-32 sm:pt-48">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative text-center">
          <p className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            Page not found
            <span className="h-px w-8 bg-medical" />
          </p>
          <h1 className="heading-serif mt-4 text-4xl text-ink sm:text-6xl">
            We couldn’t find that page
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-soft/75">
            The link may be out of date, or the address may have a small mistake
            in it. Any of these is a good place to start again.
          </p>

          {/* Heights in px here and below: a finger's 44px must not shrink
              with the root size on a small phone. */}
          <div className="mt-9">
            <Button to="/" className="min-h-[44px]">Back to the home page</Button>
          </div>

          <nav
            aria-label="Main pages"
            className="mx-auto mt-10 flex max-w-2xl flex-wrap justify-center gap-2.5 border-t border-line/10 pt-10"
          >
            {PLACES.map((p) => (
              <Link
                key={p.to}
                to={p.to}
                className={`inline-flex min-h-[44px] items-center rounded-full border border-line/15 px-5 text-sm font-semibold text-ink hover:border-line/30 hover:bg-veil/5 ${pressCls}`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </article>
  )
}
