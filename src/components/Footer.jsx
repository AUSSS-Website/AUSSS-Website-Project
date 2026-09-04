import { lazy, Suspense } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { socials } from '../data/society.js'
import SocialIcon from './SocialIcon.jsx'
import SignupForm from './SignupForm.jsx'
import { NEWSLETTER_OPEN } from '../data/signupsConfig.js'

// The aurora pulls in `ogl` (a full WebGL renderer, ~90 KB). It only ever
// shows on /magazine, so load it lazily instead of in every page's bundle.
const GalleryAurora = lazy(() => import('./GalleryAurora.jsx'))

export default function Footer() {
  // On the magazine page only, a faint aurora (bright at the top, fading down)
  // lets the page's glow leak a little way over the top of the footer before
  // settling back into the solid forest. The footer stays its own section.
  const onMagazine = useLocation().pathname === '/magazine'
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-forest-950 py-14">
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
                loading="lazy"
                decoding="async"
                className="h-24 w-auto"
              />
            </Link>
            <p className="heading-serif text-base text-silver/75">
              Life Savers, Change Makers
            </p>
            <div className="mt-1 flex gap-3">
              {socials.map((s) => (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.name}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-silver/70 transition-colors hover:border-medical hover:text-white"
                >
                  <SocialIcon name={s.key} className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          <nav
            aria-label="Footer"
            className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-silver/70"
          >
            <Link to="/" className="transition-colors hover:text-white">Home</Link>
            <Link to="/merch" className="transition-colors hover:text-white">Merch</Link>
            <Link to="/ifmsa" className="transition-colors hover:text-white">IFMSA</Link>
            <Link to="/magazine" className="transition-colors hover:text-white">Magazine</Link>
            <Link to="/contact" className="transition-colors hover:text-white">Contact</Link>
            <Link to="/members" className="transition-colors hover:text-white">Members</Link>
            <Link to="/constitution" className="transition-colors hover:text-white">
              Constitution
            </Link>
            <Link to="/join" className="transition-colors hover:text-white">Join</Link>
            <Link to="/sorting" className="transition-colors hover:text-white">Sorting Quiz</Link>
            <Link to="/login" className="transition-colors hover:text-white">Officer login</Link>
          </nav>
        </div>

        {NEWSLETTER_OPEN && (
          <div className="mt-12 flex flex-col items-center gap-4 border-t border-white/10 pt-10 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-silver/55">
              The AUSSS Digest
            </p>
            <p className="max-w-md text-sm text-silver/70">
              Society news, magazine drops and recruitment alerts, straight to
              your inbox. No spam.
            </p>
            <SignupForm
              kind="newsletter"
              layout="inline"
              submitLabel="Subscribe"
              successText="Subscribed. Watch your inbox."
            />
          </div>
        )}

        <div className="mt-10 pt-4">
          <p className="mb-5 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-silver/55">
            Find us
          </p>
          <div className="mx-auto grid max-w-3xl items-stretch gap-6 md:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <iframe
                title="Faculty of Medicine, Ain Shams University on Google Maps"
                src="https://maps.google.com/maps?q=Faculty%20of%20Medicine%2C%20Ain%20Shams%20University&z=16&output=embed"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block h-64 w-full border-0 grayscale-[0.2] md:h-full"
              />
            </div>
            <address className="flex flex-col justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-6 not-italic">
              <p className="heading-serif text-base text-white">
                Faculty of Medicine, Ain Shams University
              </p>
              <p className="text-sm leading-relaxed text-silver/70">
                38 Abbassia, next to Al-Nour Mosque
                <br />
                Cairo 1181, Egypt
              </p>
              <a
                href="https://maps.google.com/maps?q=Faculty%20of%20Medicine%2C%20Ain%20Shams%20University"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-silver/70 transition-colors hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="11" r="2.25" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                Open in Google Maps
              </a>
            </address>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center gap-5 border-t border-white/10 pt-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-silver/40">
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
                loading="lazy"
                decoding="async"
                className="h-10 w-auto opacity-60 transition-opacity hover:opacity-100 sm:h-12"
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
                loading="lazy"
                decoding="async"
                className="h-9 w-auto opacity-60 transition-opacity hover:opacity-100 sm:h-11"
              />
            </a>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-8 text-center text-xs text-silver/40">
          © {new Date().getFullYear()} AUSSS · Faculty of Medicine, Ain Shams
          University · Cairo, Egypt
        </div>
      </div>
    </footer>
  )
}
