import FAQ from '../../../components/FAQ.jsx'
import {
  IncomingsAlbum,
  IncomingsContacts,
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
  // the welcome booklet, the tracks and the stories are not part of the block.
  'exchange.incomings': ({ doc }) => (
    <div className="space-y-14">
      <p className="mx-auto max-w-2xl text-center text-lg font-light leading-relaxed text-soft/75">{doc.intro}</p>
      {doc.points.some((p) => p.text) && (
        <ul className="mx-auto max-w-3xl space-y-3">
          {doc.points
            .filter((p) => p.text)
            .map((p, i) => (
              <li key={i} className="flex gap-4 rounded-2xl border border-line/10 bg-card p-5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-medical/20 text-xs font-bold text-accent">
                  ✓
                </span>
                <p className="text-sm leading-relaxed text-soft/80">{p.text}</p>
              </li>
            ))}
        </ul>
      )}
      <IncomingsWhy sections={doc.sections.filter((s) => s.title || s.body)} />
      <IncomingsAlbum slug={doc.album} />
      <NationalBookletLink href={doc.nationalBooklet} />
      {doc.showContacts && <IncomingsContacts />}
      {doc.links.some((l) => l.label) && (
        <p className="text-center text-sm text-soft/60">
          Links at the foot of the page: {doc.links.filter((l) => l.label).map((l) => l.label).join(', ')}
        </p>
      )}
    </div>
  ),
}
