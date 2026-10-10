import DocumentCard from './DocumentCard.jsx'
import { nationalBooklets } from '../data/nationalBooklets.js'

// The national team's two booklets on /exchange/incomings, under our own
// welcome booklet: one card each, read in place (and searched) when opened.
// The files and their words are in src/data/nationalBooklets.js.
export default function NationalBooklets() {
  return (
    <section id="national-booklets" className="scroll-mt-28">
      <div className="reveal mx-auto max-w-3xl text-center">
        <h2 className="heading-serif text-3xl text-ink sm:text-4xl">From the national team</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-soft/70">
          IFMSA-Egypt’s exchange team writes two booklets for every student coming to Egypt. Read them here beside
          ours, or search them for a word.
        </p>
      </div>
      <div className="mt-8 space-y-6">
        {nationalBooklets.map((b) => (
          <DocumentCard key={b.id} id={b.id} src={b.src} title={b.title} meta={b.meta} jump={b.jump} large>
            <p>{b.blurb}</p>
          </DocumentCard>
        ))}
      </div>
    </section>
  )
}
