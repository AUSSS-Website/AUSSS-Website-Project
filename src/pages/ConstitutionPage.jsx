import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import PdfFrame from '../components/PdfFrame.jsx'

const CONSTITUTION_PDF = '/assets/docs/AUSSS-Constitution-and-Bylaws.pdf'
const SECGEN_EMAIL = 'ausss.secgen@gmail.com'

// How the document is amended, summarised straight from the Constitution &
// Bylaws (section references in parentheses), so members know the real process.
const AMENDMENT_STEPS = [
  {
    n: 1,
    title: 'Propose',
    ref: '§1.2.5, §14.2',
    body: 'A motion to amend can be raised only by a Full member, and the written proposal must reach the Secretary General before the General Assembly.',
  },
  {
    n: 2,
    title: 'Circulate',
    ref: '§14.3–14.4, §18.1',
    body: 'The Secretary General shares every proposal with the Supervising Council, Team of Officials and all members beforehand. Bylaw changes to Chapters 1 and 2 need at least two full members and one month’s notice; other points need two weeks’. Skipping these steps makes a proposal invalid.',
  },
  {
    n: 3,
    title: 'Vote',
    ref: '§14.1, §18.1.3, §11.2',
    body: 'Amendments are decided at the Local General Assembly by a two-thirds majority, with every Full member casting one vote.',
  },
  {
    n: 4,
    title: 'Adopt',
    ref: '§18.1.4, §11.4',
    body: 'Changes take effect once adopted by the General Assembly. A bylaw point can likewise be suspended by a two-thirds majority in an official LGA.',
  },
]

// The AUSSS Constitution & Bylaws, embedded in-page so "View document" reads
// it here rather than bouncing the user out to a new browser tab.
export default function ConstitutionPage() {
  usePageTitle('Constitution')
  useReveal()

  return (
    <article className="bg-forest-950">
      <header className="relative overflow-hidden pb-10 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, #C9D6DF 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative">
          <div>
            <Link
              to="/members"
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-silver/60 transition-colors hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Membership status
            </Link>
          </div>

          <div className="mt-8">
            <span className="eyebrow">
              <span className="h-px w-8 bg-medical" />
              Governance
            </span>
          </div>
          <h1 className="heading-serif mt-4 text-4xl text-white sm:text-6xl">
            Constitution &amp; Bylaws
          </h1>
          <p className="mt-5 max-w-2xl text-lg font-light leading-relaxed text-silver/75">
            The document that governs AUSSS: membership, the Executive Board,
            committees and how the society is run. Read it in full below.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={CONSTITUTION_PDF}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-medical px-5 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light"
            >
              <PdfIcon />
              Open in a new tab
            </a>
            <a
              href={CONSTITUTION_PDF}
              download
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Download PDF
            </a>
          </div>
        </div>
      </header>

      <div className="container-prose pb-20 sm:pb-28">
        {/* Wide and fitted to width, so the text is comfortably readable and
            you scroll through the pages. (It used to fit one whole page to the
            screen height, which left it under 500px wide on a laptop.) */}
        <div className="mx-auto w-full max-w-6xl">
          <PdfFrame
            src={CONSTITUTION_PDF}
            title="AUSSS Constitution & Bylaws"
            fit="width"
            heightClass="h-[92vh]"
          />
        </div>

        {/* How it's amended, a quick brief drawn from the document itself. */}
        <section className="reveal mx-auto mt-16 max-w-3xl">
          <span className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            How it’s amended
          </span>
          <h2 className="heading-serif mt-4 text-3xl text-white sm:text-4xl">
            A living document, changed by its members
          </h2>
          <p className="mt-4 text-base leading-relaxed text-silver/75">
            The Constitution &amp; Bylaws is the society’s own rulebook, and only
            AUSSS members can change it, at a Local General Assembly (LGA), the
            society’s highest decision-making body, made up of every member and
            held at least twice each term.
          </p>

          <ol className="mt-8 space-y-4">
            {AMENDMENT_STEPS.map((s) => (
              <li
                key={s.n}
                className="flex gap-4 rounded-2xl border border-white/10 bg-forest-800/60 p-6"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-medical/15 text-sm font-bold text-medical-light">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h3 className="heading-serif text-lg text-white">
                      {s.title}
                    </h3>
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-silver/40">
                      {s.ref}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-silver/75">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 rounded-2xl border border-medical/30 bg-gradient-to-br from-forest-800 to-forest-900 p-6 text-center sm:p-7">
            <h3 className="heading-serif text-xl text-white">
              Have a specific question?
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-silver/70">
              The Secretary General handles amendment proposals and member
              correspondence.
            </p>
            <a
              href={`mailto:${SECGEN_EMAIL}`}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-colors hover:bg-silver-light"
            >
              Email the Secretary General
            </a>
            <p className="mt-3 text-xs text-silver/45">{SECGEN_EMAIL}</p>
          </div>
        </section>
      </div>
    </article>
  )
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M7 3h7l5 5v13a0 0 0 0 1 0 0H7a0 0 0 0 1 0 0V3Z" strokeLinejoin="round" />
      <path d="M14 3v5h5M9 13h6M9 17h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
