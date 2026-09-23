import { Link } from 'react-router-dom'

const PILLARS = [
  {
    title: 'Health for the community',
    body: 'Awareness campaigns, screenings and outreach take students beyond the lecture hall to serve communities across Egypt.',
    icon: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
        <path d="M16 4.4a3 3 0 0 1 0 5.7" strokeLinecap="round" />
        <path d="M17 13.6a6.3 6.3 0 0 1 4.5 6.1" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: 'Global student exchange',
    body: 'Clinical and research clerkships connect Ain Shams students with partner faculties across the world.',
    to: '/exchange',
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16" />
      </>
    ),
  },
  {
    title: 'Evidence-based culture',
    body: 'Journal clubs, methodology workshops and mentorship build a generation fluent in scientific rigour.',
    icon: (
      <>
        <path d="M5 4h11l3 3v13H5z" strokeLinejoin="round" />
        <path d="M9 9h7M9 13h7M9 17h4" strokeLinecap="round" />
      </>
    ),
  },
]

export default function About() {
  return (
    <section id="about" className="relative bg-cream py-28 sm:py-36 dark:bg-forest-950">
      <div className="container-prose">
        {/* Eyebrow on its own row, above the two-column layout. */}
        <div className="reveal">
          <span className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            About the Society
          </span>
        </div>

        <div className="mt-8 grid items-start gap-16 lg:grid-cols-12">
          <div className="reveal lg:col-span-5">
            <h2 className="heading-serif text-4xl text-forest sm:text-5xl dark:text-medical-light">
              Where clinical practice meets scientific inquiry.
            </h2>
            <p className="heading-serif mt-8 text-2xl font-light leading-snug text-forest/80 sm:text-3xl dark:text-silver/80">
              For{' '}
              <span className="font-medium text-forest dark:text-medical-light">
                55 years
              </span>
              , AUSSS has been where Ain Shams medical students{' '}
              <span className="font-medium text-forest dark:text-medical-light">
                turn ideas into action
              </span>
              . It is where curiosity grows into a{' '}
              <span className="font-medium text-medical dark:text-medical-light">
                calling for change
              </span>
              .
            </p>
          </div>

          <div className="reveal space-y-6 text-lg leading-relaxed text-forest-900/90 lg:col-span-7 dark:text-silver/75">
            <p>
              The <strong className="text-forest dark:text-medical-light">Ain Shams University
              Students&rsquo; Scientific Society (AUSSS)</strong> is an
              independent, non-profit, non-political and non-religious student
              society within the Faculty of Medicine, Ain Shams University, and
              an{' '}
              <span className="font-semibold text-forest dark:text-medical-light">
                autonomous affiliate member of IFMSA-Egypt
              </span>
              .
            </p>
            <p>
              Through clinical and research exchanges, projects, campaigns and
              peer-to-peer training, AUSSS helps medical students use their
              knowledge{' '}
              <span className="font-semibold text-forest dark:text-medical-light">
                for the benefit of society
              </span>
              , and offers a forum to discuss health, education and science with
              peers{' '}
              <span className="font-semibold text-forest dark:text-medical-light">
                across Egypt and around the world
              </span>
              .
            </p>
            <blockquote className="border-l-2 border-medical pl-6 font-serif text-xl italic text-forest dark:text-medical-light">
              “Our mission is to offer future physicians a comprehensive
              introduction to global health issues, developing active,
              efficient and culturally sensitive students of medicine, intent on
              influencing the transnational inequalities that shape the health
              of our planet.”
            </blockquote>
          </div>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {PILLARS.map((p, i) => {
            const Wrapper = p.to ? Link : 'article'
            const wrapperProps = p.to
              ? { to: p.to, 'aria-label': `${p.title}, learn more` }
              : {}
            return (
              <Wrapper
                key={p.title}
                {...wrapperProps}
                className={`reveal group block rounded-2xl border border-forest-600/10 bg-white p-8 transition-all duration-500 hover:-translate-y-1.5 hover:border-medical/40 hover:shadow-xl hover:shadow-forest-900/5 dark:border-white/10 dark:bg-forest-900 dark:hover:border-medical/40 dark:hover:shadow-black/30 ${
                  p.to ? 'cursor-pointer' : ''
                }`}
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-forest text-silver transition-colors group-hover:bg-forest-600">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    {p.icon}
                  </svg>
                </span>
                <h3 className="heading-serif mt-6 text-xl text-forest dark:text-medical-light">
                  {p.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-forest-900/80 dark:text-silver/65">
                  {p.body}
                </p>
                {p.to && (
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-medical transition-colors group-hover:text-forest">
                    Explore exchange
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        d="M5 12h14M13 6l6 6-6 6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </Wrapper>
            )
          })}
        </div>
      </div>
    </section>
  )
}
