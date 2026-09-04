import { Link } from 'react-router-dom'
import { testimonials } from '../data/society.js'

// Exchange stories from students who've been through it. Direction-agnostic,
// someone who went abroad and someone who hosted both have one, so this sits
// on both /exchange/outgoings and /exchange/incomings.
//
// Until real quotes are published it renders the empty state, which is what
// keeps /exchange/share reachable from browsing.
export default function ExchangeStories() {
  const visible = testimonials.filter((t) => t.published !== false)

  return (
    <section className="reveal mx-auto max-w-4xl">
      <h2 className="heading-serif text-center text-3xl text-white">
        Exchange stories
      </h2>

      {visible.length === 0 ? (
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
          <p className="heading-serif text-xl text-white">
            Be the first story here
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-silver/70">
            Went abroad or hosted an incoming student with AUSSS? Share how it
            went. Your story helps the next student take the leap.
          </p>
          <Link
            to="/exchange/share"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-medical px-5 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light"
          >
            Share your experience
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-10 space-y-8">
            {visible.map((t, idx) => (
              <figure
                key={idx}
                className="overflow-hidden rounded-3xl border border-white/10 bg-forest-800"
              >
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
                      className="h-7 w-7 text-medical-light/60"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M7 7h4v4c0 3-1.5 5-4 6V13H7V7zm8 0h4v4c0 3-1.5 5-4 6V13h-2V7h2z" />
                    </svg>
                    <blockquote className="mt-3 text-base leading-relaxed text-silver/85">
                      {t.quote}
                    </blockquote>
                    <figcaption className="mt-5 text-sm text-silver/60">
                      <span className="font-semibold text-white">{t.name}</span>
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
                            className="h-16 w-16 rounded-lg object-cover ring-1 ring-white/10 sm:h-20 sm:w-20"
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
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Share your exchange story
            </Link>
          </div>
        </>
      )}
    </section>
  )
}
