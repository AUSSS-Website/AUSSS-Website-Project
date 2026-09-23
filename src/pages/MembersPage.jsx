import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { lookupMember, adviceFor, NOT_A_MEMBER } from '../lib/membership.js'
import { splitPositions } from '../lib/text.js'
import SpecialResult from '../components/SpecialResult.jsx'
import {
  matchPosition,
  isPresidentPosition,
  isHebaIsmail,
} from '../lib/teamIndex.js'

const CONSTITUTION_PDF = '/assets/docs/AUSSS-Constitution-and-Bylaws.pdf'
const MEMBERSHIP_ISSUE_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSeU1QhHkuLpJtiUFGbD_Kdbqhzs8GMAuR3x63HMnm4XzeBAYQ/viewform'

const STATUS_COLOR = {
  'Full Member': '#0f7a53',
  'Associate Member': '#5B8DB8',
  'Candidate Member': '#C9A33B',
  'Honorary Life Member': '#8FB4D4',
  'Observer / Volunteer': '#9aa5a0',
  Suspended: '#bd202a',
  'Not yet a member': '#9aa5a0',
}

// GA cells can be "", "0", "3", ">2", "2+", "≥1" … parse safely.
function parseGA(value) {
  const s = String(value ?? '').trim()
  if (!s) return { display: '–', num: 0, atLeast: false, known: false }
  const digits = s.match(/\d+/)
  const num = digits ? parseInt(digits[0], 10) : 0
  const atLeast = /[>≥]|\+|more|over|at least/i.test(s)
  return { display: s, num, atLeast, known: true }
}

function ProgressRow({ label, have, need }) {
  const { display, num, atLeast, known } = parseGA(have)
  // ">2" with a need of 2 means the requirement is met.
  const effective = atLeast ? Math.max(num, need) : num
  const done = known && effective >= need
  const pct = Math.max(0, Math.min(100, (effective / need) * 100))
  return (
    <div>
      <div className="flex justify-between text-xs text-silver/70">
        <span>{label}</span>
        <span className={done ? 'text-medical-light' : ''}>
          {display} / {need}
          {done ? ' ✓' : ''}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: done ? '#0f7a53' : '#5B8DB8',
          }}
        />
      </div>
    </div>
  )
}

function GuidanceCard({ advice, accent }) {
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-forest-800 p-7 text-left">
      {advice.next ? (
        <p className="text-sm text-silver/70">
          Path to advance →{' '}
          <span className="font-semibold" style={{ color: accent }}>
            {advice.next}
          </span>
        </p>
      ) : (
        <p className="text-sm font-semibold" style={{ color: accent }}>
          Maintaining your status
        </p>
      )}

      {advice.progress?.length > 0 && (
        <div className="mt-5 space-y-4">
          {advice.progress.map((p) => (
            <ProgressRow key={p.label} {...p} />
          ))}
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {advice.steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-silver/80">
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold"
              style={{ background: 'rgba(91,141,184,0.2)', color: accent }}
            >
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ul>

      {advice.rights && (
        <p className="mt-6 border-t border-white/10 pt-4 text-xs text-silver/55">
          <span className="font-semibold text-silver/75">Your rights: </span>
          {advice.rights}
        </p>
      )}
    </div>
  )
}

// Shown on a miss when the lookup thinks it knows what was meant. Names are
// offered only for near-complete spellings (the database decides); a roster
// email is never shown, only a masked hint the owner would recognise.
function DidYouMean({ suggestions, form, busy, onRetry }) {
  const btn =
    'rounded-full border border-medical/50 px-4 py-1.5 text-sm font-semibold text-medical-light transition-colors hover:bg-medical/15 disabled:opacity-50'
  return (
    <div className="mt-4 rounded-2xl border border-medical/30 bg-medical/[0.07] p-5" role="status">
      <p className="text-sm font-semibold text-white">Did you mean…</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {suggestions.names?.map((n) => (
          <button key={n} type="button" disabled={busy} onClick={() => onRetry({ name: n, email: '' })} className={btn}>
            {n}
          </button>
        ))}
        {suggestions.fixedEmail && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRetry({ ...form, email: suggestions.fixedEmail })}
            className={btn}
          >
            {suggestions.fixedEmail}
          </button>
        )}
        {suggestions.email && (
          <button type="button" disabled={busy} onClick={() => onRetry(form, { acceptNear: true })} className={btn}>
            {suggestions.email}
          </button>
        )}
      </div>
      {suggestions.email && (
        <p className="mt-3 text-xs text-silver/55">
          An address very close to the one you typed is registered. If that’s yours, tap it.
        </p>
      )}
    </div>
  )
}

export default function MembersPage() {
  useReveal()
  usePageTitle('Members')
  useEffect(() => {
    // Browsers try to restore scroll position on refresh, but here the
    // result card isn't restored, so the user lands on a half-scrolled
    // empty page. Disable restoration and snap to the top.
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])
  const [form, setForm] = useState({ name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [reveal, setReveal] = useState(false) // "show status anyway" on special pages
  const resultRef = useRef(null)
  // After a fresh result lands, glide down to it. Adaptive, if the card
  // fits in the viewport beneath the sticky header, vertically centre it so
  // both top and bottom content are visible at once; if it's taller, just
  // align the top to the header offset so the user starts at the headline.
  useEffect(() => {
    if (!result) return
    const id = window.requestAnimationFrame(() => {
      const el = resultRef.current
      if (!el) return
      // Matches the `scroll-padding-top: 7rem` from index.css base layer.
      const headerOffset = 7 * 16
      const rect = el.getBoundingClientRect()
      const usable = window.innerHeight - headerOffset
      let top = window.scrollY + rect.top - headerOffset
      if (rect.height < usable) {
        // Centre the card in the usable viewport area.
        top -= (usable - rect.height) / 2
      }
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [result])

  const submit = (e) => {
    e.preventDefault()
    run(form)
  }

  // A "did you mean" click: put the suggestion in the form, so what is on
  // screen is what was looked up, and look again.
  const retry = (next, opts) => {
    setForm(next)
    run(next, opts)
  }

  const run = async (query, { acceptNear = false } = {}) => {
    if (!query.name.trim() && !query.email.trim()) return
    // Guard re-entry: an Enter-key submit can fire while a lookup is already
    // running, and two in-flight lookups could land out of order.
    if (busy) return
    setBusy(true)
    setResult(null)
    setReveal(false)
    // Heba's roster name spelling is not predictable, so if the typed name
    // matches a known variant, ask for the unique Supervising Council holder
    // instead of relying on the exact-name lookup.
    if (isHebaIsmail({ typedName: query.name })) {
      const heba = await lookupMember({ role: 'supervising-council' })
      if (heba.state === 'found') {
        setResult({ state: 'heba', record: heba.record })
        setBusy(false)
        return
      }
    }
    const r = await lookupMember({ name: query.name, email: query.email, acceptNear })
    if (r.state === 'found') {
      const pos = r.record.currentPosition
      const positions = splitPositions(pos)
      if (isHebaIsmail({ position: pos })) {
        setResult({ state: 'heba', record: r.record })
      } else if (isPresidentPosition(pos)) {
        const otherPositions = positions.filter(
          (p) => !isPresidentPosition(p),
        )
        setResult({ state: 'president', record: r.record, otherPositions })
      } else {
        const m = matchPosition(pos)
        if (m) {
          const otherPositions = positions.filter((p) => p !== m.matched)
          setResult({
            state: 'to-member',
            entry: m.entry,
            record: r.record,
            otherPositions,
          })
        } else setResult(r)
      }
    } else {
      setResult(r)
    }
    setBusy(false)
  }

  const special =
    result?.state === 'president' ||
    result?.state === 'to-member' ||
    result?.state === 'heba'
  // The real status card shows for a normal hit, or when a special page
  // user clicks "show status anyway".
  const statusRecord =
    result?.state === 'found'
      ? result.record
      : special && reveal
        ? result.record
        : null
  const found = !!statusRecord
  const advice = found ? adviceFor(statusRecord) : null
  const tierLabel = found ? advice.tierLabel : null
  const accent =
    STATUS_COLOR[tierLabel] ||
    (result?.state === 'not-found' ? STATUS_COLOR['Not yet a member'] : '#5B8DB8')

  return (
    <article className="bg-forest-950">
      <header className="relative overflow-hidden pb-12 pt-32 sm:pt-40">
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            AUSSS Members
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-white sm:text-6xl">
            Check your membership
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg font-light text-silver/75">
            Enter the name <em>or</em> email you registered with to see your
            current membership status and what it takes to advance.
          </p>
        </div>
      </header>

      <div className="container-prose pb-28 sm:pb-36">
        <div className="mx-auto max-w-xl">
          {/* Form */}
          <form
            onSubmit={submit}
            className="reveal rounded-3xl border border-white/12 bg-forest-900/60 p-8 sm:p-10"
          >
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-silver/60">
              Full name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="As registered with AUSSS"
              className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-medical focus:ring-2 focus:ring-medical/20"
            />
            <div className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-silver/35">
              <span className="h-px flex-1 bg-white/10" />
              or
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-silver/60">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="The email you registered with"
              className="mb-6 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-medical focus:ring-2 focus:ring-medical/20"
            />
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-4 text-sm font-semibold text-forest transition-all duration-300 hover:bg-silver-light disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Check my status'}
            </button>
            <p className="mt-4 text-center text-[11px] text-silver/50">
              Not yet a Life Saver, Change Maker?{' '}
              <Link
                to="/join"
                className="font-semibold text-medical-light transition-colors hover:text-white"
              >
                Join AUSSS →
              </Link>
            </p>
          </form>

          {/* Result */}
          {result && (
            <div ref={resultRef} className="mt-8 scroll-mt-32 text-center">
              {special && !reveal && (
                <SpecialResult
                  result={result}
                  onReveal={() => setReveal(true)}
                />
              )}
              {found && (
                <>
                  <div className="rounded-3xl border border-white/12 bg-forest-900/60 p-8">
                    <p className="text-xs uppercase tracking-[0.22em] text-silver/55">
                      Membership status
                    </p>
                    <p
                      className="heading-serif mt-2 text-3xl"
                      style={{ color: accent }}
                    >
                      {statusRecord.status || tierLabel}
                    </p>
                    <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] sm:grid-cols-4">
                      {[
                        ['Year joined', statusRecord.yearJoined || '–'],
                        ['Years spent', statusRecord.yearsSpent || '–'],
                        ['Local GAs', parseGA(statusRecord.lgas).display],
                        ['National GAs', parseGA(statusRecord.ngas).display],
                      ].map(([k, v]) => (
                        <div key={k} className="bg-forest-900/40 px-3 py-4">
                          <div className="heading-serif text-xl text-white">
                            {v}
                          </div>
                          <div className="mt-1 text-[10px] uppercase tracking-widest text-silver/55">
                            {k}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const positions = splitPositions(statusRecord.currentPosition)
                      if (positions.length <= 1) {
                        return (
                          <p className="mt-4 text-sm text-silver/70">
                            Current position:{' '}
                            <span className="text-white">
                              {positions[0] || 'General Member'}
                            </span>
                          </p>
                        )
                      }
                      return (
                        <div className="mt-4 text-sm text-silver/70">
                          <p>Current positions:</p>
                          <ul className="mt-1.5 space-y-1">
                            {positions.map((p) => (
                              <li key={p} className="text-white">
                                {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}
                    <p className="mt-6 border-t border-white/10 pt-4 text-xs text-silver/55">
                      Something wrong with your record?{' '}
                      <a
                        href={MEMBERSHIP_ISSUE_FORM}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-medical-light underline-offset-2 transition-colors hover:text-white hover:underline"
                      >
                        Tell us through this form
                      </a>
                      .
                    </p>
                  </div>
                  <GuidanceCard advice={advice} accent={accent} />
                </>
              )}

              {result.state === 'not-found' && (
                <div className="rounded-3xl border border-white/12 bg-forest-900/60 p-8">
                  <p className="heading-serif text-2xl text-white">
                    No matching member found
                  </p>
                  {result.suggestions && (
                    <DidYouMean
                      suggestions={result.suggestions}
                      form={form}
                      busy={busy}
                      onRetry={retry}
                    />
                  )}
                  <p className="mt-2 text-sm text-silver/65">
                    Check the exact name or email you registered with. Not a
                    member yet? Here’s how to join:
                  </p>
                  <GuidanceCard
                    advice={{ ...NOT_A_MEMBER, progress: [], steps: NOT_A_MEMBER.steps }}
                    accent={accent}
                  />
                </div>
              )}

              {result.state === 'ambiguous' && (
                <div className="rounded-3xl border border-white/12 bg-forest-900/60 p-8">
                  <p className="heading-serif text-2xl text-white">
                    More than one member shares this name
                  </p>
                  <p className="mt-2 text-sm text-silver/65">
                    We can’t identify you by name alone. Please{' '}
                    <Link to="/contact" className="text-medical-light hover:text-white">
                      contact us
                    </Link>{' '}
                    and we’ll confirm your membership status directly.
                  </p>
                </div>
              )}

              {result.state === 'not-connected' && (
                <div className="rounded-3xl border border-white/12 bg-forest-900/60 p-8">
                  <p className="heading-serif text-2xl text-white">
                    The lookup is unavailable right now
                  </p>
                  <p className="mt-2 text-sm text-silver/65">
                    Please check back soon, or{' '}
                    <Link to="/contact" className="text-medical-light hover:text-white">
                      contact us
                    </Link>
                    .
                  </p>
                </div>
              )}

              {result.state === 'error' && (
                <div className="rounded-3xl border border-white/12 bg-forest-900/60 p-8">
                  <p className="heading-serif text-2xl text-white">
                    Something went wrong
                  </p>
                  <p className="mt-2 text-sm text-silver/65">
                    Please try again in a moment. ({result.message})
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Governance, only render alongside an actual membership status
              card (so it doesn't crowd the special TO/EB/Heba cards or the
              not-found / error states). */}
          {found && (
          <div className="mt-12 rounded-2xl border border-white/10 bg-forest-800/60 p-7 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">
              Governance
            </p>
            <h2 className="heading-serif mt-2 text-xl text-white">
              Constitution &amp; Bylaws
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-silver/65">
              Every membership rule above comes from the AUSSS Constitution
              &amp; Bylaws. Read the full document.
            </p>
            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/constitution"
                className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-transform hover:scale-[1.03] sm:w-auto"
              >
                View document
              </Link>
              <a
                href={CONSTITUTION_PDF}
                download
                className="w-full rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
              >
                Download PDF
              </a>
            </div>
          </div>
          )}
        </div>
      </div>
    </article>
  )
}
