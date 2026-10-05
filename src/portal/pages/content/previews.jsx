import FAQ from '../../../components/FAQ.jsx'
import {
  IncomingsAlbum,
  IncomingsContacts,
  IncomingsFacts,
  IncomingsIncludes,
  IncomingsSteps,
  IncomingsTips,
  IncomingsWhy,
  NationalBookletLink,
} from '../../../components/IncomingsSections.jsx'

// How each block looks on the site, drawn with the same component the public
// page uses, so the preview cannot drift from the real thing. A block with no
// entry here simply has no preview.
export const previews = {
  'join.faq': ({ doc }) => (
    <div className="mx-auto max-w-3xl">
      <h2 className="heading-serif text-center text-3xl text-ink">Frequently asked questions</h2>
      <FAQ items={doc.items.filter((item) => item.q || item.a)} className="mt-8" />
    </div>
  ),
  // The edited parts of /exchange/incomings, in page order. The page's title,
  // the two track cards, the welcome booklet and the stories are not part of
  // the block, so they are left out here. Half-typed rows are skipped.
  'exchange.incomings': ({ doc }) => (
    <div className="space-y-16">
      <p className="mx-auto max-w-2xl whitespace-pre-line text-center text-lg font-light leading-relaxed text-soft/75">
        {doc.intro}
      </p>
      <IncomingsFacts facts={doc.facts.filter((f) => f.figure)} />
      <IncomingsIncludes points={doc.points.filter((p) => p.text)} />
      <IncomingsWhy sections={doc.sections.filter((s) => s.title || s.body)} />
      <IncomingsSteps steps={doc.steps.filter((s) => s.title || s.body)} />
      <IncomingsAlbum slug={doc.album} />
      <NationalBookletLink href={doc.nationalBooklet} />
      <IncomingsTips tips={doc.tips.filter((t) => t.title || t.body)} />
      {doc.showContacts && <IncomingsContacts />}
      {doc.links.some((l) => l.label) && (
        <p className="text-center text-sm text-soft/60">
          Links at the foot of the page: {doc.links.filter((l) => l.label).map((l) => l.label).join(', ')}
        </p>
      )}
    </div>
  ),
}
