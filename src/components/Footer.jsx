import { lazy, Suspense } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useContentBlock } from '../lib/content.js'
import siteContact from '../content/schemas/siteContact.js'
import { FindUs, SocialIconLinks } from './ContactDetails.jsx'

// The aurora pulls in `ogl` (a full WebGL renderer, ~90 KB). It only ever
// shows on /magazine, so load it lazily instead of in every page's bundle.
const GalleryAurora = lazy(() => import('./GalleryAurora.jsx'))

export default function Footer() {
  // On the magazine page only, a faint aurora (bright at the top, fading down)
  // lets the page's glow leak a little way over the top of the footer before
  // settling back into the footer's own colour. The footer stays its own section.
  const onMagazine = useLocation().pathname === '/magazine'
  // Motto, address, map pin and channels: edited by the EB in the portal.
  const contact = useContentBlock(siteContact)
  return (
    <footer className="relative overflow-hidden border-t border-line/10 bg-sunk py-14 dark:bg-page">
      {onMagazine && (
        <Suspense fallback={null}>
          <GalleryAurora opacityClass="opacity-30" amplitude={1.1} blend={0.55} />
        </Suspense>
      )}
      <div className="container-prose relative z-10">
        <div className="flex flex-col items-center gap-10 text-center">
          <div className="flex flex-col items-center gap-3">
            <Link to="/" className="flex items-center">
              <img
                src="/assets/brand/ausss-horizontal-white.png"
                alt="AUSSS, Ain Shams University Students' Scientific Society"
                width="900"
                height="449"
                loading="lazy"
                decoding="async"
                className="logo-ink h-24 w-auto"
              />
            </Link>
            <p className="heading-serif text-base text-soft/75">{contact.motto}</p>
            <p className="mt-1 max-w-xs whitespace-pre-line text-xs leading-relaxed text-soft/55">
              {contact.footerLine}
            </p>
            <SocialIconLinks socials={contact.socials} />
          </div>

          <nav
            aria-label="Footer"
            className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-soft/70"
          >
            <Link to="/" className="transition-colors hover:text-ink">Home</Link>
            <Link to="/merch" className="transition-colors hover:text-ink">Merch</Link>
            <Link to="/ifmsa" className="transition-colors hover:text-ink">IFMSA</Link>
            <Link to="/events" className="transition-colors hover:text-ink">Events</Link>
            <Link to="/magazine" className="transition-colors hover:text-ink">Magazine</Link>
            <Link to="/contact" className="transition-colors hover:text-ink">Contact</Link>
            <Link to="/members" className="transition-colors hover:text-ink">Members</Link>
            <Link to="/constitution" className="transition-colors hover:text-ink">
              Constitution
            </Link>
            <Link to="/join" className="transition-colors hover:text-ink">Join</Link>
            <Link to="/sorting" className="transition-colors hover:text-ink">Sorting quiz</Link>
            <Link to="/portal/sign-in" className="transition-colors hover:text-ink">
              Members portal
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-ink">Privacy</Link>
          </nav>
        </div>

        <div className="mt-12 border-t border-line/10 pt-10">
          <p className="mb-5 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-soft/55">
            Find us
          </p>
          <FindUs doc={contact} />
        </div>

        <div className="mt-10 flex flex-col items-center gap-5 border-t border-line/10 pt-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-soft/40">
            An autonomous affiliate of
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
            <a
              href="https://www.ifmsa-egypt.org.eg"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="IFMSA-Egypt"
            >
              <img
                src="/assets/ifmsa/ifmsa-egypt-horizontal-white.png"
                alt=""
                width="13414"
                height="2316"
                loading="lazy"
                decoding="async"
                className="logo-ink h-10 w-auto opacity-60 transition-opacity hover:opacity-100 sm:h-12"
              />
            </a>
            <a
              href="https://ifmsa.org"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="IFMSA, International Federation of Medical Students' Associations"
            >
              <img
                src="/assets/ifmsa/ifmsa-horizontal-white.png"
                alt=""
                width="5409"
                height="1262"
                loading="lazy"
                decoding="async"
                className="logo-ink h-9 w-auto opacity-60 transition-opacity hover:opacity-100 sm:h-11"
              />
            </a>
          </div>
        </div>

        <div className="mt-10 border-t border-line/10 pt-8 text-center text-xs text-soft/40">
          © {new Date().getFullYear()} AUSSS · Faculty of Medicine, Ain Shams
          University · Cairo, Egypt
        </div>
      </div>
    </footer>
  )
}
