import DocumentCard from './DocumentCard.jsx'
import { documentFacts } from '../lib/documents.js'
import { NATIONAL_FILE_NAME } from '../content/schemas/constitutionDocuments.js'

// The parts of /constitution that the EB edits in the portal (the block
// constitution.documents), drawn by the page and by the editor's preview
// alike, so the preview cannot drift from the real thing.

// "How it's amended": the steps, numbered in their order, each with the
// sections it is drawn from.
export function AmendmentSteps({ steps }) {
  return (
    <ol className="mt-8 space-y-4">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-4 rounded-2xl border border-line/10 bg-card/60 p-6">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-medical/15 text-sm font-bold text-accent">
            {i + 1}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h3 className="heading-serif text-lg text-ink">{s.title}</h3>
              {s.ref && (
                <span className="text-2xs font-medium uppercase tracking-[0.16em] text-soft/40">{s.ref}</span>
              )}
            </div>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-soft/75">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// The Constitution & Bylaws of IFMSA-Egypt, the federation AUSSS belongs to.
// It opens in place when asked for (DocumentCard), so the page does not load a
// second long document for everyone who came for the society's own. The IFMSA
// page links straight here (/constitution#ifmsa-egypt).
//   pdf, version   the block's `national` and `nationalVersion`
export function NationalRules({ pdf, version }) {
  return (
    <section id="ifmsa-egypt" className="mt-20 scroll-mt-28">
      <div className="reveal mx-auto max-w-3xl">
        <span className="eyebrow">
          <span className="h-px w-8 bg-medical" />
          The national rules
        </span>
        <h2 className="heading-serif mt-4 text-3xl text-ink sm:text-4xl">
          IFMSA-Egypt Constitution &amp; Bylaws
        </h2>
        <p className="mt-4 text-base leading-relaxed text-soft/75">
          AUSSS is an autonomous affiliate member of IFMSA-Egypt, the national
          federation of medical students’ associations, and works within its
          rules as well as its own. The federation’s Constitution &amp; Bylaws
          sets out who its members are and the rights they hold, how its
          General Assembly meets and votes, the roles of the Executive Board,
          the Team of Officials and the Supervising Council, the standing
          committees and support divisions, its finances, and how Egypt is
          represented in IFMSA.
        </p>
      </div>

      <div className="mt-6">
        {/* Keyed by the file, so a newer version published since the page was built opens afresh. */}
        <DocumentCard
          key={pdf.url}
          id="ifmsa-egypt-document"
          src={pdf.url}
          fileName={NATIONAL_FILE_NAME}
          title="IFMSA-Egypt Constitution & Bylaws"
          meta={documentFacts(pdf, version)}
          logo={{ src: '/assets/ifmsa/ifmsa-egypt-horizontal-white.png', alt: 'IFMSA-Egypt' }}
          heading={false}
          cardWidth="max-w-3xl"
        />
      </div>
    </section>
  )
}
