import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { Link } from 'react-router-dom'
import {
  executiveBoard,
  committees,
  society,
  socials,
  slugFor,
} from '../data/society.js'
import SocialIcon from '../components/SocialIcon.jsx'

const isSupport = (g) => /support|division|psd|pnsd|cbsd/i.test(g || '')

function EmailValue({ email }) {
  if (!email)
    return <span className="text-sm italic text-silver/35">Email TBA</span>
  return (
    <a
      href={`mailto:${email}`}
      className="text-sm text-medical-light underline-offset-4 transition-colors hover:text-white hover:underline"
    >
      {email}
    </a>
  )
}

function Row({ name, role, email }) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-white">
          {name?.trim() || 'Name TBA'}
        </p>
        {role && (
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-silver/50">
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
      <h2 className="heading-serif text-2xl text-white sm:text-3xl">{title}</h2>
      <div className="mt-4 rounded-2xl border border-white/10 bg-forest-800/60 px-6">
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

  const unitRows = (c) => {
    const people =
      Array.isArray(c.officers) && c.officers.length > 0
        ? c.officers
        : [{ name: c.holder, role: c.officer, email: c.email }]
    return people.map((p, i) => (
      <Row
        key={(p.abbr || p.name || i) + '-' + i}
        name={p.name}
        role={`${c.abbr} · ${p.abbr || p.role || c.officer || ''}`.replace(
          /·\s*$/,
          '',
        )}
        email={p.email ?? c.email}
      />
    ))
  }

  return (
    <article className="bg-forest-950">
      <header className="relative overflow-hidden pb-16 pt-32 sm:pt-40">
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Get in touch
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-white sm:text-6xl">
            Contact us
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg font-light text-silver/75">
            Reach the Executive Board, a standing committee or a support
            division directly, or follow us on our official channels.
          </p>
          {society.contactEmail && (
            <a
              href={`mailto:${society.contactEmail}`}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-colors hover:bg-silver-light"
            >
              {society.contactEmail}
            </a>
          )}
        </div>
      </header>

      <div className="container-prose space-y-14 pb-28 sm:pb-36">
        {/* Follow us, merged in from the former /social page. */}
        <section className="reveal">
          <h2 className="heading-serif text-2xl text-white sm:text-3xl">
            Follow AUSSS
          </h2>
          <p className="mt-2 text-sm text-silver/65">
            Events, announcements and campaigns. Keep up with the society on
            our official channels.
          </p>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {socials.map((s) => (
              <a
                key={s.key}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center rounded-3xl border border-white/10 bg-forest-800 p-8 text-center transition-all duration-500 hover:-translate-y-1.5 hover:border-medical/40 hover:shadow-2xl hover:shadow-forest-950/40"
              >
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-forest-950 text-medical-light transition-colors group-hover:bg-medical group-hover:text-white">
                  <SocialIcon name={s.key} className="h-8 w-8" />
                </span>
                <h3 className="heading-serif mt-6 text-2xl text-white">
                  {s.name}
                </h3>
                <p className="mt-2 break-words text-sm font-medium text-medical-light">
                  {s.handle}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-silver/65">
                  {s.blurb}
                </p>
              </a>
            ))}
          </div>
        </section>

        <Group title="Executive Board">
          {executiveBoard.map((m, i) => (
            <Row key={i} name={m.name} role={m.role} email={m.email} />
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

        <p className="reveal text-center text-sm text-silver/45">
          Looking for a specific committee?{' '}
          <Link
            to="/#officials"
            className="text-medical-light hover:text-white"
          >
            Browse all committees and divisions →
          </Link>
        </p>
      </div>
    </article>
  )
}
