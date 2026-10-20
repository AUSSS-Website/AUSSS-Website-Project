import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import PdfReader from '../components/PdfReader.jsx'
import { AmendmentSteps, NationalRules } from '../components/ConstitutionSections.jsx'
import { society } from '../data/society.js'
import { pressCls } from '../lib/motion.js'
import { usePublicEmail } from '../hooks/useSiteSettings.js'
import { useContentBlock } from '../lib/content.js'
import { documentFacts, downloadHref } from '../lib/documents.js'
import constitutionDocuments, { AUSSS_FILE_NAME } from '../content/schemas/constitutionDocuments.js'

// The two documents, and the steps of "How it's amended" (drawn from the
// society's document, with its section numbers), are the EB's to replace from
// the portal: the block constitution.documents. Until something is published
// they are what src/content/schemas/constitutionDocuments.js ships with.

// The AUSSS Constitution & Bylaws, read in-page (and searched: PdfReader), so
// "View document" reads it here rather than bouncing the user out to a new
// browser tab.
export default function ConstitutionPage() {
  usePageTitle('Constitution')
  useReveal()
  const secGenEmail = usePublicEmail()(society.contact)
  const docs = useContentBlock(constitutionDocuments)
  const ausss = docs.ausss

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-10 pt-32 sm:pt-40">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative">
          <div>
            {/* A thumb's height to press; the margin takes the padding back,
                so the line sits where it did. */}
            <Link
              to="/members"
              className="-my-3.5 inline-flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soft/60 transition-colors hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
          <h1 className="heading-serif mt-4 text-4xl text-ink sm:text-6xl">
            Constitution &amp; Bylaws
          </h1>
          <p className="mt-5 max-w-2xl text-lg font-normal leading-relaxed text-soft/75 dark:font-light">
            The document that governs AUSSS: membership, the Executive Board,
            committees and how the society is run. Read it in full below, or
            search it for a word.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={ausss.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-cta px-5 py-2.5 text-sm font-semibold text-on-cta hover:bg-cta-hover ${pressCls}`}
            >
              <PdfIcon />
              Open in a new tab
            </a>
            <a
              href={downloadHref(ausss.url, AUSSS_FILE_NAME)}
              download={AUSSS_FILE_NAME}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-line/20 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-veil/10 ${pressCls}`}
            >
              Download PDF
            </a>
          </div>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-soft/60">
            {documentFacts(ausss, docs.ausssVersion)}
          </p>

          <p className="mt-6 text-sm text-soft/70">
            Looking for the national rules?{' '}
            <Link
              to="#ifmsa-egypt"
              className="font-semibold text-accent underline-offset-2 hover:text-ink hover:underline"
            >
              The IFMSA-Egypt Constitution &amp; Bylaws
            </Link>{' '}
            is further down this page.
          </p>
        </div>
      </header>

      <div className="container-prose pb-20 sm:pb-28">
        {/* Wide and fitted to width, so the text is comfortably readable and
            you scroll through the pages, with a search bar above them. */}
        <div className="mx-auto w-full max-w-6xl">
          {/* Keyed by the file, so a newer version published since the page was built opens afresh. */}
          <PdfReader
            key={ausss.url}
            src={ausss.url}
            title="AUSSS Constitution & Bylaws"
            heightClass="h-[92vh]"
          />
        </div>

        {/* How it's amended, a quick brief drawn from the document itself. */}
        <section className="reveal mx-auto mt-16 max-w-3xl">
          <span className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            How it’s amended
          </span>
          <h2 className="heading-serif mt-4 text-3xl text-ink sm:text-4xl">
            A living document, changed by its members
          </h2>
          <p className="mt-4 text-base leading-relaxed text-soft/75">
            The Constitution &amp; Bylaws is the society’s own rulebook, and only
            AUSSS members can change it, at a Local General Assembly (LGA), the
            society’s highest decision-making body, made up of every member and
            held at least twice each term.
          </p>

          <AmendmentSteps steps={docs.steps} />

          <div className="mt-8 rounded-2xl border border-medical/30 bg-gradient-to-br from-card to-sunk p-6 text-center sm:p-7">
            <h3 className="heading-serif text-xl text-ink">
              Have a specific question?
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-soft/70">
              The Secretary General handles amendment proposals and member
              correspondence.
            </p>
            <a
              href={`mailto:${secGenEmail}`}
              className={`mt-5 inline-flex items-center gap-2 rounded-full bg-solid px-6 py-3 text-sm font-semibold text-on-solid hover:bg-solid-hover ${pressCls}`}
            >
              Email the Secretary General
            </a>
            <p className="mt-3 text-xs text-soft/45">{secGenEmail}</p>
          </div>
        </section>

        <NationalRules pdf={docs.national} version={docs.nationalVersion} />
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
