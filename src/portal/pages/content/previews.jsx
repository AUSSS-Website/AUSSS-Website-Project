import FAQ from '../../../components/FAQ.jsx'
import { FindUs, SocialCards, SocialIconLinks } from '../../../components/ContactDetails.jsx'
import {
  IncomingsAlbum,
  IncomingsContacts,
  IncomingsFacts,
  IncomingsIncludes,
  IncomingsSteps,
  IncomingsTips,
  IncomingsWhy,
  NationalBookletLink,
  OUTGOING_CONTACTS,
  OUTGOINGS_COPY,
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
  // The edited parts of /exchange/outgoings, in page order, with the
  // outgoings headings. The title, the track cards and the stories are not
  // part of the block.
  'exchange.outgoings': ({ doc }) => (
    <div className="space-y-16">
      <p className="mx-auto max-w-2xl whitespace-pre-line text-center text-lg font-light leading-relaxed text-soft/75">
        {doc.intro}
      </p>
      <IncomingsFacts facts={doc.facts.filter((f) => f.figure)} />
      <IncomingsIncludes points={doc.points.filter((p) => p.text)} heading={OUTGOINGS_COPY.includes} />
      <IncomingsWhy
        sections={doc.sections.filter((s) => s.title || s.body)}
        heading={OUTGOINGS_COPY.whyHeading}
        lead={OUTGOINGS_COPY.whyLead}
      />
      <IncomingsSteps steps={doc.steps.filter((s) => s.title || s.body)} heading={OUTGOINGS_COPY.steps} />
      <IncomingsAlbum slug={doc.album} heading={OUTGOINGS_COPY.album} />
      <IncomingsTips
        tips={doc.tips.filter((t) => t.title || t.body)}
        heading={OUTGOINGS_COPY.tipsHeading}
        lead={OUTGOINGS_COPY.tipsLead}
      />
      {doc.showContacts && <IncomingsContacts contacts={OUTGOING_CONTACTS} lead={OUTGOINGS_COPY.contactsLead} />}
      {doc.links.some((l) => l.label) && (
        <p className="text-center text-sm text-soft/60">
          Links at the foot of the page: {doc.links.filter((l) => l.label).map((l) => l.label).join(', ')}
        </p>
      )}
    </div>
  ),
  // The footer's lines, channels and map, then the Contact page's two
  // introductions and its channel cards. Half-typed channels are skipped.
  'site.contact': ({ doc }) => {
    const socials = doc.socials.filter((c) => c.href && c.handle)
    return (
      <div className="space-y-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-soft/45">Footer</p>
          <p className="heading-serif text-base text-soft/75">{doc.motto}</p>
          <p className="mt-1 max-w-xs whitespace-pre-line text-xs leading-relaxed text-soft/55">{doc.footerLine}</p>
          <SocialIconLinks socials={socials} />
        </div>
        {doc.mapQuery && <FindUs doc={doc} />}
        <div className="border-t border-line/10 pt-10 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-soft/45">Contact page</p>
          <p className="mx-auto mt-4 max-w-2xl whitespace-pre-line text-lg font-light text-soft/75">{doc.contactIntro}</p>
        </div>
        <div>
          <h2 className="heading-serif text-2xl text-ink sm:text-3xl">Follow AUSSS</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-soft/65">{doc.followIntro}</p>
          <SocialCards socials={socials} />
        </div>
      </div>
    )
  },
}
