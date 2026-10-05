import FAQ from '../../../components/FAQ.jsx'

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
}
