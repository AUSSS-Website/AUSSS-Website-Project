import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { Link } from 'react-router-dom'
import { committees, society, slugFor } from '../data/society.js'
import { committeeOfficers, resolveBoard, usePeople } from '../lib/people.js'
import { usePublicEmail } from '../hooks/useSiteSettings.js'
import { useContentBlock } from '../lib/content.js'
import siteContact from '../content/schemas/siteContact.js'
import { SocialCards } from '../components/ContactDetails.jsx'

const isSupport = (g) => /support|division|psd|pnsd|cbsd/i.test(g || '')

function EmailValue({ email }) {
  if (!email)
    return <span className="text-sm italic text-soft/35">Email TBA</span>
  return (
    <a
      href={`mailto:${email}`}
      className="text-sm text-accent underline-offset-4 transition-colors hover:text-ink hover:underline"
    >
      {email}
    </a>
  )
}

function Row({ name, role, email }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line/10 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-ink">
          {name?.trim() || 'Name TBA'}
        </p>
        {role && (
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-soft/50">
            {role}
          </p>
        )}
      </div>
      <EmailValue email={email} />
    </div>
  )
}

function Group({ title, children }) {
  return (
    <section className="reveal">
      <h2 className="heading-serif text-2xl text-ink sm:text-3xl">{title}</h2>
      <div className="mt-4 rounded-2xl border border-line/10 bg-card/60 px-6">
        {children}
      </div>
    </section>
  )
}

export default function ContactPage() {
  usePageTitle('Contact')
  useReveal()

  const standing = committees.filter((c) => !isSupport(c.group))
  const support = committees.filter((c) => isSupport(c.group))

  // Names follow whoever holds each position this term (src/lib/people.js);
  // the inboxes are the roles' own and stay as society.js lists them.
  const holders = usePeople()
  const executiveBoard = resolveBoard(holders)
  const publicEmail = usePublicEmail()
  const contactEmail = publicEmail(society.contact)
  // The introductions and the channels: edited by the EB in the portal.
  const contact = useContentBlock(siteContact)

  const unitRows = (c) => {
    const people = committeeOfficers(c, holders)
    return people.map((p, i) => (
      <Row
        key={(p.abbr || p.name || i) + '-' + i}
        name={p.name}
        role={`${c.abbr} · ${p.role || p.abbr || c.officer || ''}`.replace(
          /·\s*$/,
          '',
        )}
        email={publicEmail(p) || publicEmail(c)}
      />
    ))
  }

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-16 pt-32 sm:pt-40">
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Get in touch
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-ink sm:text-6xl">
            Contact us
          </h1>
          <p className="mx-auto mt-4 max-w-2xl whitespace-pre-line text-lg font-light text-soft/75">
            {contact.contactIntro}
          </p>
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}`}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-solid px-6 py-3 text-sm font-semibold text-on-solid transition-colors hover:bg-solid-hover"
            >
              {contactEmail}
            </a>
          )}
        </div>
      </header>

      <div className="container-prose space-y-14 pb-28 sm:pb-36">
        {/* Follow us, merged in from the former /social page. */}
        <section className="reveal">
          <h2 className="heading-serif text-2xl text-ink sm:text-3xl">
            Follow AUSSS
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm text-soft/65">{contact.followIntro}</p>
          <SocialCards socials={contact.socials} />
        </section>

        <Group title="Executive Board">
          {executiveBoard.map((m, i) => (
            <Row key={i} name={m.name} role={m.role} email={publicEmail(m)} />
          ))}
        </Group>

        <Group title="Standing committees">
          {standing.map((c) => (
            <div key={slugFor(c)}>{unitRows(c)}</div>
          ))}
        </Group>

        <Group title="Support divisions">
          {support.map((c) => (
            <div key={slugFor(c)}>{unitRows(c)}</div>
          ))}
        </Group>

        <p className="reveal text-center text-sm text-soft/45">
          Looking for a specific committee?{' '}
          <Link
            to="/#officials"
            className="text-accent hover:text-ink"
          >
            Browse all committees and divisions →
          </Link>
        </p>
      </div>
    </article>
  )
}
