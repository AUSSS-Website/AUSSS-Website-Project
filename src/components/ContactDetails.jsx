import SocialIcon from './SocialIcon.jsx'
import { mapEmbed, mapLink, networkName } from '../content/schemas/siteContact.js'

// The parts of the block `site.contact` (src/content/schemas/siteContact.js) as
// the footer and /contact draw them. The portal's preview draws the same ones.

// The round icons under the motto in the footer.
export function SocialIconLinks({ socials }) {
  return (
    <div className="mt-1 flex gap-3">
      {socials.map((s, i) => (
        <a
          key={`${s.network}-${i}`}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={networkName(s.network)}
          className="grid h-9 w-9 place-items-center rounded-full border border-line/15 text-soft/70 transition-colors hover:border-medical hover:text-ink"
        >
          <SocialIcon name={s.network} className="h-4 w-4" />
        </a>
      ))}
    </div>
  )
}

// The cards under "Follow AUSSS" on /contact.
export function SocialCards({ socials }) {
  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-3">
      {socials.map((s, i) => (
        <a
          key={`${s.network}-${i}`}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col items-center rounded-3xl border border-line/10 bg-card p-8 text-center transition-all duration-500 hover:-translate-y-1.5 hover:border-medical/40 hover:shadow-2xl hover:shadow-forest-950/40"
        >
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-page text-accent transition-colors group-hover:bg-cta group-hover:text-on-cta">
            <SocialIcon name={s.network} className="h-8 w-8" />
          </span>
          <h3 className="heading-serif mt-6 text-2xl text-ink">{networkName(s.network)}</h3>
          <p className="mt-2 break-words text-sm font-medium text-accent">{s.handle}</p>
          {s.blurb && <p className="mt-3 text-sm leading-relaxed text-soft/65">{s.blurb}</p>}
        </a>
      ))}
    </div>
  )
}

// The map and the address card under "Find us" in the footer.
export function FindUs({ doc }) {
  return (
    <div className="mx-auto grid max-w-3xl items-stretch gap-6 md:grid-cols-2">
      <div className="overflow-hidden rounded-2xl border border-line/10">
        <iframe
          title={`${doc.place} on Google Maps`}
          src={mapEmbed(doc.mapQuery)}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="block h-64 w-full border-0 grayscale-[0.2] md:h-full"
        />
      </div>
      <address className="flex flex-col justify-center gap-3 rounded-2xl border border-line/10 bg-veil/[0.02] p-6 not-italic">
        <p className="heading-serif text-base text-ink">{doc.place}</p>
        <p className="whitespace-pre-line text-sm leading-relaxed text-soft/70">{doc.address}</p>
        <a
          href={mapLink(doc.mapQuery)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 text-sm text-soft/70 transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="11" r="2.25" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Open in Google Maps
        </a>
      </address>
    </div>
  )
}
