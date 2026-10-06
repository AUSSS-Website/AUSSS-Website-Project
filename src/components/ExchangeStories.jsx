import { Link } from 'react-router-dom'
import { testimonials } from '../data/society.js'
import { useExchangeStories } from '../lib/exchangeStories.js'

// Exchange stories from students who've been through it. Direction-agnostic,
// someone who went abroad and someone who hosted both have one, so this sits
// on both /exchange/outgoings and /exchange/incomings.
//
// Two sources: stories sent through /exchange/share and set to published by the
// exchange officers in the portal (src/lib/exchangeStories.js, featured ones
// first and highlighted), then the hand-written testimonials in society.js
// (with photos). With nothing published it renders the empty state, which is
// what keeps /exchange/share reachable from browsing.
//
// `audience="incoming"` is the incomings page: it speaks to a student coming
// to us, so it lists only the stories of students we hosted (a story whose
// destination is Egypt, Cairo or Ain Shams) and words the invitation for them.
// The default, the outgoings page, speaks to our own students thinking of
// going abroad, so it lists every other story: the ones from abroad.
const HOSTED_RE = /egypt|cairo|ain\s*shams/i

export default function ExchangeStories({ audience = 'outgoing' }) {
  const incoming = audience === 'incoming'
  const live = useExchangeStories()
  const all = [...live, ...testimonials.filter((t) => t.published !== false)]
  const visible = all.filter((t) => HOSTED_RE.test(t.destination || '') === incoming)

  return (
    <section className="reveal mx-auto max-w-4xl">
      <h2 className="heading-serif text-center text-3xl text-ink sm:text-4xl">
        {incoming ? 'From students we hosted' : 'From our students abroad'}
      </h2>

      {visible.length === 0 ? (
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-dashed border-line/15 bg-veil/[0.03] p-8 text-center">
          <p className="heading-serif text-xl text-ink">
            {incoming ? 'Were you one of our incomings?' : 'Went abroad with us?'}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-soft/70">
            {incoming
              ? 'Tell the next student what your month with us was like.'
              : 'Tell the next student what your exchange was like. Your story helps them take the leap.'}
          </p>
          <Link
            to="/exchange/share"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-cta px-5 py-2.5 text-sm font-semibold text-on-cta transition-colors hover:bg-cta-hover"
          >
            {incoming ? 'Share your story' : 'Share your experience'}
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-10 space-y-8">
            {visible.map((t, idx) => (
              <figure
                key={t.id || idx}
                className={`relative overflow-hidden rounded-3xl border bg-card ${
                  t.featured ? 'border-medical/60 shadow-[0_0_0_1px_rgba(91,141,184,0.25)]' : 'border-line/10'
                }`}
              >
                {t.featured && (
                  <span className="absolute right-4 top-4 rounded-full bg-cta px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-on-cta">
                    Featured
                  </span>
                )}
                <div className="grid gap-0 md:grid-cols-[minmax(0,18rem)_1fr]">
                  {t.photo && (
                    <img
                      src={t.photo}
                      alt={`${t.name} on exchange in ${t.destination}`}
                      loading="lazy"
                      className="h-72 w-full object-cover md:h-full"
                    />
                  )}
                  <div className="flex flex-col justify-center p-7 sm:p-9">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-7 w-7 text-accent/60"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M7 7h4v4c0 3-1.5 5-4 6V13H7V7zm8 0h4v4c0 3-1.5 5-4 6V13h-2V7h2z" />
                    </svg>
                    <blockquote className="mt-3 text-base leading-relaxed text-soft/85">
                      {t.quote}
                    </blockquote>
                    <figcaption className="mt-5 text-sm text-soft/60">
                      <span className="font-semibold text-ink">{t.name}</span>
                      {t.track ? ` · ${t.track}` : ''}
                      {t.destination ? ` · ${t.destination}` : ''}
                      {t.year ? ` · ${t.year}` : ''}
                    </figcaption>
                    {Array.isArray(t.gallery) && t.gallery.length > 0 && (
                      <div className="mt-5 flex flex-wrap gap-3">
                        {t.gallery.map((g) => (
                          <img
                            key={g}
                            src={g}
                            alt={`${t.destination}, ${t.name}'s exchange`}
                            loading="lazy"
                            className="h-16 w-16 rounded-lg object-cover ring-1 ring-line/10 sm:h-20 sm:w-20"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </figure>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              to="/exchange/share"
              className="inline-flex items-center gap-2 rounded-full border border-line/20 px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-veil/10"
            >
              {incoming ? 'Were you one of our incomings? Share your story' : 'Share your exchange story'}
            </Link>
          </div>
        </>
      )}
    </section>
  )
}
