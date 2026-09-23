import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { committees, slugFor } from '../data/society.js'
import { readableAccent, rgba } from '../lib/color.js'
import SignupForm from '../components/SignupForm.jsx'
import { WAITLIST_OPEN } from '../data/signupsConfig.js'
import FAQ from '../components/FAQ.jsx'
import { joinFaqs } from '../data/faq.js'

const WHY = [
  {
    title: 'Go on exchange',
    body: 'Through SCOPE and SCORE you can do a clinical or research clerkship abroad, and host students from around the world here at Ain Shams.',
  },
  {
    title: 'Run real campaigns',
    body: 'Public-health screenings, awareness drives, peer education and human-rights advocacy that reach thousands of students and the public.',
  },
  {
    title: 'Train and lead',
    body: 'Capacity-building tracks and IFMSA trainer pathways turn members into certified trainers, project leads and officers.',
  },
  {
    title: 'A global network',
    body: 'As an autonomous affiliate of IFMSA-Egypt, AUSSS connects you to a federation of over a million medical students worldwide.',
  },
  {
    title: 'Bench to bedside',
    body: 'Research methodology, journal clubs and scientific output, alongside your clinical training.',
  },
  {
    title: 'A community',
    body: 'Six standing committees and four support divisions: a place to contribute, grow and belong throughout medical school.',
  },
]

function CommitteeRow({ list }) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((c) => {
        const accent = readableAccent(c.color)
        return (
          <Link
            key={c.abbr}
            to={`/committees/${slugFor(c)}`}
            className="flex flex-col rounded-2xl border border-white/10 bg-forest-800 p-6 transition-colors hover:border-white/25"
          >
            <span
              className="self-start rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ background: rgba(c.color, 0.2), color: accent }}
            >
              {c.abbr}
            </span>
            <h3 className="heading-serif mt-4 text-lg text-white">{c.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-silver/70">
              {c.tagline || c.description}
            </p>
          </Link>
        )
      })}
    </div>
  )
}

export default function JoinPage() {
  usePageTitle(
    'Join us',
    'Become part of AUSSS, the Ain Shams University Students’ Scientific Society. Join our committees for research, public health, and global student exchange.',
  )
  useReveal()
  const standing = committees.filter((c) => c.group === 'Standing Committee')
  const divisions = committees.filter((c) => c.group === 'Support Division')

  return (
    <article className="bg-forest-950">
      <header className="relative overflow-hidden pb-16 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, #C9D6DF 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Become a member
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-8 text-4xl text-white sm:text-6xl">
            Join AUSSS
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-light leading-relaxed text-silver/75">
            A community that turns medical students into life savers and change
            makers, open to every Faculty of Medicine student at Ain Shams
            University.
          </p>
        </div>
      </header>

      <div className="container-prose space-y-24 pb-28 sm:pb-36">
        {/* Why join */}
        <section className="reveal mx-auto max-w-5xl">
          <h2 className="heading-serif text-center text-3xl text-white">
            Why join AUSSS
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {WHY.map((w) => (
              <div
                key={w.title}
                className="rounded-2xl border border-white/10 bg-forest-800 p-7"
              >
                <h3 className="heading-serif text-xl text-white">{w.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-silver/70">
                  {w.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Committees summary */}
        <section className="reveal mx-auto max-w-5xl">
          <h2 className="heading-serif text-center text-3xl text-white">
            Find your committee
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-silver/60">
            Six standing committees and four support divisions. Open any of
            them to see what they do.
          </p>
          <div className="mt-6 flex justify-center">
            <Link
              to="/sorting"
              className="inline-flex items-center gap-2 rounded-full border border-medical/40 bg-medical/10 px-6 py-2.5 text-sm font-semibold text-medical-light transition-colors hover:border-medical hover:text-white"
            >
              Not sure where you fit? Take the Sorting quiz
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <p className="mt-10 text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
            Standing committees
          </p>
          <CommitteeRow list={standing} />

          <p className="mt-12 text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
            Support divisions
          </p>
          <CommitteeRow list={divisions} />
        </section>

        {/* Registration notice */}
        <section className="reveal mx-auto max-w-3xl">
          <div className="relative overflow-hidden rounded-3xl border border-medical/30 bg-gradient-to-br from-forest-800 to-forest-900 p-8 text-center sm:p-12">
            <span className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-medical/10 blur-3xl" />
            <span className="relative grid mx-auto h-14 w-14 place-items-center rounded-full bg-medical/15">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-medical/30" />
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7 text-medical-light"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
              Registration
            </p>
            <p className="relative mt-3 font-serif text-2xl leading-relaxed text-white sm:text-3xl">
              Registration opens once a year.
            </p>
            <p className="relative mx-auto mt-4 max-w-xl text-base leading-relaxed text-silver/75">
              Recruitment isn’t open right now. Leave your email and we’ll let
              you know the moment the next window opens. No spam, just the one
              heads-up.
            </p>
            {WAITLIST_OPEN && (
              <div className="relative mt-8">
                <SignupForm
                  submitLabel="Notify me when it opens"
                  successText="You’re on the list. We’ll email you when registration opens."
                />
              </div>
            )}
            <div className="relative mt-6 flex flex-wrap justify-center gap-4">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 text-sm font-semibold text-medical-light transition-colors hover:text-white"
              >
                Or follow our channels →
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="reveal mx-auto max-w-3xl">
          <h2 className="heading-serif text-center text-3xl text-white">
            Frequently asked questions
          </h2>
          <FAQ items={joinFaqs} className="mt-8" />
        </section>

        <div className="reveal text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-medical-light transition-colors hover:text-white"
          >
            ← Back to AUSSS home
          </Link>
        </div>
      </div>
    </article>
  )
}
