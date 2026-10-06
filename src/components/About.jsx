import { Link } from 'react-router-dom'
import Markdown from './Markdown.jsx'
import { useContentBlock } from '../lib/content.js'
import homePage from '../content/schemas/homePage.js'

// The three cards keep their pictures by place: people, the globe, the document.
const ICONS = [
  <>
    <circle cx="9" cy="7" r="3" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
    <path d="M16 4.4a3 3 0 0 1 0 5.7" strokeLinecap="round" />
    <path d="M17 13.6a6.3 6.3 0 0 1 4.5 6.1" strokeLinecap="round" />
  </>,
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16" />
  </>,
  <>
    <path d="M5 4h11l3 3v13H5z" strokeLinejoin="round" />
    <path d="M9 9h7M9 13h7M9 17h4" strokeLinecap="round" />
  </>,
]

// Bold words in the deep colour, italic ones in the accent colour.
const LEDE_MARKS = {
  strong: 'font-medium text-forest dark:text-medical-light',
  em: 'font-medium not-italic text-accent',
}
const BODY_MARKS = {
  strong: 'font-semibold text-forest dark:text-medical-light',
  em: 'font-semibold not-italic text-accent',
}

// The words are the block `home.page`, edited by the EB in the portal. The
// portal's preview passes the document it is editing as `doc`, and `narrow`
// because its pane is too slim for the wide layout the window size would pick.
export default function About({ doc, narrow = false }) {
  const live = useContentBlock(homePage)
  const d = doc || live
  return (
    <section id="about" className="relative bg-cream py-28 sm:py-36 dark:bg-forest-950">
      <div className="container-prose">
        {/* Eyebrow on its own row, above the two-column layout. */}
        <div className="reveal">
          <span className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            About the Society
          </span>
        </div>

        <div className={`mt-8 grid items-start gap-16 ${narrow ? '' : 'lg:grid-cols-12'}`}>
          <div className={`reveal ${narrow ? '' : 'lg:col-span-5'}`}>
            <h2 className="heading-serif text-4xl text-forest sm:text-5xl dark:text-medical-light">
              {d.aboutHeading}
            </h2>
            <Markdown
              text={d.aboutLede}
              marks={LEDE_MARKS}
              className="heading-serif mt-8 text-2xl font-light leading-snug text-forest/80 sm:text-3xl dark:text-silver/80"
            />
          </div>

          <div className={`reveal space-y-6 text-lg leading-relaxed text-forest-900/90 dark:text-silver/75 ${narrow ? '' : 'lg:col-span-7'}`}>
            <Markdown text={d.aboutBody} marks={BODY_MARKS} gap="space-y-6" />
            {d.aboutQuote && (
              <blockquote className="whitespace-pre-line border-l-2 border-medical pl-6 font-serif text-xl italic text-forest dark:text-medical-light">
                “{d.aboutQuote}”
              </blockquote>
            )}
          </div>
        </div>

        <div className={`mt-20 grid gap-6 ${narrow ? '' : 'md:grid-cols-3'}`}>
          {d.pillars.map((p, i) => {
            // A page of this site stays in the app; any other address is a plain
            // link, opened in a new tab when it leaves the site.
            const internal = p.link.startsWith('/')
            const linkText = p.linkLabel || 'Learn more'
            const Wrapper = !p.link ? 'article' : internal ? Link : 'a'
            const label = { 'aria-label': `${p.title}, ${linkText}` }
            const wrapperProps = !p.link
              ? {}
              : internal
                ? { to: p.link, ...label }
                : {
                    href: p.link,
                    ...(/^https?:/i.test(p.link) ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
                    ...label,
                  }
            return (
              <Wrapper
                key={i}
                {...wrapperProps}
                className={`reveal group block rounded-2xl border border-forest-600/10 bg-white p-8 transition-all duration-500 hover:-translate-y-1.5 hover:border-medical/40 hover:shadow-xl hover:shadow-forest-900/5 dark:border-white/10 dark:bg-forest-900 dark:hover:border-medical/40 dark:hover:shadow-black/30 ${
                  p.link ? 'cursor-pointer' : ''
                }`}
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-leaf text-white transition-colors group-hover:bg-leaf-hover dark:text-silver">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    {ICONS[i]}
                  </svg>
                </span>
                <h3 className="heading-serif mt-6 text-xl text-forest dark:text-medical-light">
                  {p.title}
                </h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-forest-900/80 dark:text-silver/65">
                  {p.body}
                </p>
                {p.link && (
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition-colors group-hover:text-ink">
                    {linkText}
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        d="M5 12h14M13 6l6 6-6 6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </Wrapper>
            )
          })}
        </div>
      </div>
    </section>
  )
}
