import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'

// Plain-language privacy policy for ausss.org and the members portal. Written
// to be read by a medical student in two minutes, not by a lawyer. Keep it
// truthful: every item below maps to a real form, table or service in this
// repo. Update LAST_UPDATED whenever the substance changes.
const LAST_UPDATED = '13 September 2026'
const SECGEN_EMAIL = 'ausss.secgen@gmail.com'
const IFMSA_EXCHANGES_PRIVACY = 'https://ifmsa.org/exchanges-privacy/'
const IFMSA_PRIVACY = 'https://ifmsa.org/privacy/'

const SECTIONS = [
  {
    id: 'who',
    title: 'Who we are',
    body: [
      "AUSSS is the Ain Shams University Students' Scientific Society, the student society of the Faculty of Medicine, Ain Shams University, Cairo. We are the Ain Shams local committee of IFMSA-Egypt, which is a member of the International Federation of Medical Students' Associations (IFMSA).",
      'This policy covers this website and the members portal at /portal. The Secretary General is the contact for anything about your data.',
    ],
  },
  {
    id: 'public-site',
    title: 'Browsing the public site',
    body: [
      'You can read every public page without an account and without giving us any information.',
      'We do not use advertising cookies or trackers. If we turn on Vercel Web Analytics, it counts page views without cookies and without identifying you. If we ever enable Google Analytics, this page will say so.',
      'Some pages embed content from Google Calendar, Google Drive, Canva, Instagram and Google Maps. When such an embed loads, that provider receives your browser request under its own privacy policy.',
    ],
  },
  {
    id: 'forms',
    title: 'Forms on the site',
    bullets: [
      'Newsletter and recruitment alerts: your name, email address and an optional phone number, so we can send you the AUSSS Digest and tell you when applications open.',
      'Join applications: the details you enter on the join form, used only to process your application to the society or a committee.',
      'Exchange stories: your name, phone number, destination, year, your story and any photos you attach, used to publish the story on the exchange pages if you agree.',
      'Merch orders: your name, phone number and delivery details, used only to prepare and hand over your order.',
      'Membership status check: the name and email you type are converted to a one-way hash in your browser and compared with a hashed copy of the roster. The name and email themselves never leave your device.',
    ],
    after:
      "Form submissions are stored in spreadsheets in the society's Google account and are seen only by the officers who run that activity.",
  },
  {
    id: 'portal',
    title: 'The members portal',
    body: [
      'Signing in uses Google or an emailed sign-in link. We never store a password.',
    ],
    bullets: [
      'From your sign-in provider: your email address, display name and profile picture.',
      'What you add yourself: phone number, faculty year, and whether you want to appear in a members directory (off by default).',
      'From the membership roster: your membership status and tier, the year you joined and the positions you hold each term. The roster is the same membership record the society already keeps; the portal links your account to it by email.',
      'Verification requests: if the roster does not match your email, you can ask the Executive Board to confirm you. We keep the request and the decision.',
      'An audit trail: the portal records who changed what and when, so that membership and position changes can always be traced.',
    ],
    after:
      'Your session is kept in your own browser storage so you stay signed in. Signing out clears it.',
  },
  {
    id: 'who-sees',
    title: 'Who can see portal data',
    bullets: [
      'You can always see and edit your own details.',
      'Members of the Executive Board and the webmaster can see all member records, because they administer membership.',
      'Officers of a committee can see the members who hold a position in that committee this term, and nothing beyond it.',
      'Other members cannot see your record. A directory, when it exists, will show only people who opted in.',
    ],
    after:
      'These rules are enforced in the database itself, not only in the screens you see.',
  },
  {
    id: 'services',
    title: 'Services that hold data for us',
    bullets: [
      'Supabase hosts the portal database and sign-in service.',
      'Vercel hosts the website.',
      'Google provides sign-in, and Google Sheets and Drive hold form submissions and society documents.',
      'Resend, once configured, delivers sign-in and notification emails.',
    ],
    after:
      'Each of these processes data on our instructions. We do not sell or rent your information, and we do not share it with anyone for advertising.',
  },
  {
    id: 'ifmsa',
    title: 'IFMSA exchanges',
    body: [
      'If you apply for a SCOPE or SCORE exchange, your application goes through the IFMSA Exchange Database, which IFMSA operates as its own data controller. IFMSA describes this in its Exchanges Privacy notice, summarised here so you know what to expect.',
    ],
    bullets: [
      'The database collects what hosting organisations need to place you: name, gender, nationality, date of birth, passport or ID details, language, university details, contact details, and the documents a host requires, such as proof of enrolment, a photo, a passport copy, insurance, immunisation records and a police clearance.',
      'Inside IFMSA, access is limited to the Local and National Exchange Officers of the sending and hosting organisations and the international Standing Committee teams, through password-protected accounts. Outside IFMSA, your details are shared only with the hosting institution.',
      'IFMSA keeps the data for as long as the exchange and its evaluation need it, and lists your rights to get a copy, correct, delete or withdraw consent.',
    ],
    after:
      'Our Local Exchange Officers act within that framework. For questions about the IFMSA database itself, use the contact given on the IFMSA notice.',
    links: [
      { label: 'IFMSA Exchanges Privacy notice', href: IFMSA_EXCHANGES_PRIVACY },
      { label: 'IFMSA general Privacy Policy', href: IFMSA_PRIVACY },
    ],
  },
  {
    id: 'rights',
    title: 'Your choices',
    bullets: [
      'See and correct your portal details at any time under Profile.',
      'Ask us for a copy of what we hold about you, or to correct or delete it, by emailing the Secretary General. Deleting your portal account removes your sign-in and profile; membership records that the society must keep, such as the roster and past positions, are kept for its records.',
      'Unsubscribe from the Digest with the link in any email, or by writing to us.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: [
      `We will update this page when what we collect or how we use it changes, and note the date at the top. Last updated ${LAST_UPDATED}.`,
    ],
  },
]

export default function PrivacyPage() {
  usePageTitle('Privacy policy', 'What AUSSS collects on this site and in the members portal, who can see it, and how IFMSA handles exchange data.')
  useReveal()

  return (
    <article className="bg-forest-950">
      <header className="relative overflow-hidden pb-10 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, #C9D6DF 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative">
          <span className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            Privacy
          </span>
          <h1 className="heading-serif mt-4 text-4xl text-white sm:text-6xl">
            Privacy policy
          </h1>
          <p className="mt-5 max-w-2xl text-lg font-light leading-relaxed text-silver/75">
            What we collect on this site and in the members portal, who can see
            it, and how IFMSA handles exchange data. Written to be read, not
            skimmed past.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-silver/45">
            Last updated {LAST_UPDATED}
          </p>
        </div>
      </header>

      <div className="container-prose pb-20 sm:pb-28">
        <nav aria-label="Sections" className="mb-12 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-semibold text-silver/70 transition-colors hover:border-medical hover:text-white"
            >
              {s.title}
            </a>
          ))}
        </nav>

        <div className="mx-auto max-w-3xl space-y-10">
          {SECTIONS.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className="reveal scroll-mt-28 rounded-2xl border border-white/10 bg-forest-800/60 p-6 sm:p-8"
            >
              <h2 className="heading-serif text-2xl text-white">{s.title}</h2>
              {s.body?.map((p) => (
                <p key={p} className="mt-3 text-base leading-relaxed text-silver/75">
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="mt-4 space-y-2.5">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex gap-3 text-sm leading-relaxed text-silver/75">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-medical" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.after && (
                <p className="mt-4 text-sm leading-relaxed text-silver/60">{s.after}</p>
              )}
              {s.links && (
                <div className="mt-5 flex flex-wrap gap-3">
                  {s.links.map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                    >
                      {l.label}
                      <span aria-hidden="true">↗</span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          ))}

          <div className="rounded-2xl border border-medical/30 bg-gradient-to-br from-forest-800 to-forest-900 p-6 text-center sm:p-7">
            <h2 className="heading-serif text-xl text-white">Questions about your data?</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-silver/70">
              The Secretary General handles data requests and member
              correspondence.
            </p>
            <a
              href={`mailto:${SECGEN_EMAIL}`}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-colors hover:bg-silver-light"
            >
              Email the Secretary General
            </a>
            <p className="mt-3 text-xs text-silver/45">{SECGEN_EMAIL}</p>
            <p className="mt-6 text-xs text-silver/45">
              See also the{' '}
              <Link to="/constitution" className="underline decoration-white/30 underline-offset-2 hover:text-white">
                Constitution &amp; Bylaws
              </Link>
              , which governs membership records.
            </p>
          </div>
        </div>
      </div>
    </article>
  )
}
