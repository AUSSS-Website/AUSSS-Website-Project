import { useState, useEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { lookupMember, adviceFor, MEMBERSHIP_ENDED, NOT_A_MEMBER } from '../lib/membership.js'
import { splitPositions } from '../lib/text.js'
import { errorText, UNREACHED } from '../lib/errorText.js'
import { chipAccent, readableAccent, rgba } from '../lib/color.js'
import { prefersReducedMotion, pressCls, scrollBehavior } from '../lib/motion.js'
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

// What a failed lookup says. lookupMember hands back the caught error's
// message and nothing else, so its kind is read from the words: a request
// given up on, the roster's own refusal ("Too many lookups right now, please
// retry in a few minutes.", a whole sentence written for people, shown as
// written), or the server's own words ("Request failed (500)"), which are
// never shown.
const GAVE_UP = /timed out|aborted/i
const WHOLE_SENTENCE = /^[A-Z].*[.!?]$/s
function lookupErrorText(message) {
  const said = String(message ?? '').trim()
  if (GAVE_UP.test(said)) return UNREACHED
  return errorText(
    { message: said, rejected: WHOLE_SENTENCE.test(said) },
    'Please try again in a moment.',
  )
}

function ProgressRow({ label, have, need }) {
  const { display, num, atLeast, known } = parseGA(have)
  // ">2" with a need of 2 means the requirement is met.
  const effective = atLeast ? Math.max(num, need) : num
  const done = known && effective >= need
  const pct = Math.max(0, Math.min(100, (effective / need) * 100))
  // The bar starts empty and fills to its mark once it is on the page. For a
  // reader who asked for less motion it is at its mark from the start.
  const [filled, setFilled] = useState(prefersReducedMotion)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setFilled(true))
    return () => window.cancelAnimationFrame(id)
  }, [])
  return (
    <div>
      <div className="flex justify-between text-xs text-soft/70">
        <span>{label}</span>
        <span className={done ? 'text-accent' : ''}>
          {display} / {need}
          {done ? ' ✓' : ''}
        </span>
      </div>
      {/* The fill is as wide as the track and slides in from the left (a
          transform, which costs no layout, where a changing width does); the
          track clips what has not arrived. The figures above say the same. */}
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-veil/10"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full transition-transform duration-700 ease-out motion-reduce:transition-none ${
            done ? 'bg-ok' : 'bg-accent'
          }`}
          style={{ transform: `translateX(${(filled ? pct : 0) - 100}%)` }}
        />
      </div>
    </div>
  )
}

// `color` is the status colour as it comes (a hex). As text it goes through
// readableAccent, and the discs that number the steps are tinted with it and
// take chipAccent, the shade that reads on that tint.
function GuidanceCard({ advice, color }) {
  const accent = readableAccent(color)
  return (
    <div className="mt-6 rounded-2xl border border-line/10 bg-card p-7 text-left">
      {advice.next ? (
        <p className="text-sm text-soft/70">
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
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-soft/80">
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold"
              style={{ background: rgba(color, 0.2), color: chipAccent(color) }}
            >
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ul>

      {advice.rights && (
        <p className="mt-6 border-t border-line/10 pt-4 text-xs text-soft/55">
          <span className="font-semibold text-soft/75">Your rights: </span>
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
  // Tall enough for a thumb, and a long address wraps inside its pill on a
  // narrow phone.
  const btn = `inline-flex min-h-11 max-w-full items-center rounded-full [overflow-wrap:anywhere] border border-medical/50 px-4 py-1.5 text-sm font-semibold text-accent hover:bg-medical/15 disabled:opacity-50 ${pressCls}`
  return (
    <div className="mt-4 rounded-2xl border border-medical/30 bg-medical/[0.07] p-5" role="status">
      <p className="text-sm font-semibold text-ink">Did you mean…</p>
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
        <p className="mt-3 text-xs text-soft/55">
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
  const uid = useId()
  const [form, setForm] = useState({ name: '', email: '' })
  // True once "Check my status" was pressed with both fields empty, until
  // either is typed in.
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [reveal, setReveal] = useState(false) // "show status anyway" on special pages
  const nameRef = useRef(null)
  const submitRef = useRef(null)
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
      // Matches the `scroll-padding-top: 7rem` from index.css base layer. A
      // rem follows the screen and the reader's text size, so it is measured.
      const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
      const headerOffset = 7 * rem
      const rect = el.getBoundingClientRect()
      const usable = window.innerHeight - headerOffset
      let top = window.scrollY + rect.top - headerOffset
      if (rect.height < usable) {
        // Centre the card in the usable viewport area.
        top -= (usable - rect.height) / 2
      }
      window.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() })
    })
    return () => window.cancelAnimationFrame(id)
  }, [result])

  const submit = (e) => {
    e.preventDefault()
    run(form)
  }

  // A "did you mean" click: put the suggestion in the form, so what is on
  // screen is what was looked up, and look again. The suggestion that was
  // pressed goes with the old result, so the focus is handed to the form's
  // button first: left on a button that is gone, it would fall to the top of
  // the page.
  const retry = (next, opts) => {
    setForm(next)
    submitRef.current?.focus({ preventScroll: true })
    run(next, opts)
  }

  const edit = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setMissing(false)
  }

  const run = async (query, { acceptNear = false } = {}) => {
    if (!query.name.trim() && !query.email.trim()) {
      // Nothing to look up: say so at the fields and put the cursor in the
      // first, where a silent button looked broken.
      setMissing(true)
      nameRef.current?.focus()
      return
    }
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
  // The status colours are fixed hues, several of them too pale to read on a
  // white card or too deep for a dark one, so as text each goes through
  // readableAccent, which keeps the hue and finds the shade for the theme.
  const statusColor =
    STATUS_COLOR[tierLabel] ||
    (result?.state === 'not-found' ? STATUS_COLOR['Not yet a member'] : '#5B8DB8')
  const accent = readableAccent(statusColor)

  // One short line for a screen reader: the lookup has started, then what
  // came back. The cards below hold the detail. A failure is not here, since
  // its card is an alert and speaks for itself.
  const announce = busy
    ? 'Checking…'
    : found
      ? `Membership status: ${statusRecord.status || tierLabel}.`
      : special
        ? 'Your result is below.'
        : {
            'not-found': 'No matching member found.',
            ended: `${MEMBERSHIP_ENDED.title}.`,
            ambiguous: 'More than one member shares this name.',
            'not-connected': 'The lookup is unavailable right now.',
          }[result?.state] || ''

  // While the message is up both fields keep the red edge, the one with the
  // cursor in it too, and the ring shows where the cursor is. The ring is the
  // strength the site's other forms use: at 20% it was hard to see.
  const fieldCls =
    'w-full rounded-xl border bg-veil/5 px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-ink/30 focus:ring-2 focus:ring-medical/60'
  const fieldBorder = missing ? 'border-danger/70' : 'border-line/10 focus:border-medical'

  return (
    <article className="bg-page">
      <header className="relative overflow-hidden pb-12 pt-32 sm:pt-40">
        <div className="container-prose relative text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            AUSSS Members
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-ink sm:text-6xl">
            Check your membership
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg font-normal text-soft/75 dark:font-light">
            Enter the name <em>or</em> email you registered with to see your
            current membership status and what it takes to advance.
          </p>
          {/* The way into the portal for someone who came here to sign in:
              this page only looks a membership up. */}
          <p className="mt-3 text-sm text-soft/70">
            Here to sign in?{' '}
            <Link
              to="/portal"
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              Members portal
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
      </header>

      <div className="container-prose pb-28 sm:pb-36">
        <div className="mx-auto max-w-xl">
          {/* Form */}
          <form
            onSubmit={submit}
            className="reveal rounded-3xl border border-line/12 bg-sunk/60 p-8 sm:p-10"
          >
            <label
              htmlFor={`${uid}-name`}
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-soft/60"
            >
              Full name
            </label>
            <input
              ref={nameRef}
              id={`${uid}-name`}
              type="text"
              value={form.name}
              onChange={(e) => edit('name', e.target.value)}
              placeholder="As registered with AUSSS"
              autoComplete="name"
              aria-invalid={missing}
              aria-describedby={missing ? `${uid}-missing` : undefined}
              className={`mb-4 ${fieldCls} ${fieldBorder}`}
            />
            <div className="mb-4 flex items-center gap-3 text-2xs uppercase tracking-[0.2em] text-soft/35">
              <span className="h-px flex-1 bg-veil/10" />
              or
              <span className="h-px flex-1 bg-veil/10" />
            </div>
            <label
              htmlFor={`${uid}-email`}
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-soft/60"
            >
              Email
            </label>
            <input
              id={`${uid}-email`}
              type="email"
              value={form.email}
              onChange={(e) => edit('email', e.target.value)}
              placeholder="The email you registered with"
              autoComplete="email"
              aria-invalid={missing}
              aria-describedby={missing ? `${uid}-missing` : undefined}
              className={`${fieldCls} ${fieldBorder}`}
            />
            {missing && (
              <p id={`${uid}-missing`} role="alert" className="mt-2 text-xs text-danger">
                Please enter your name or your email.
              </p>
            )}
            {/* Not `disabled` while checking: the browser takes the focus away
                from a button that is switched off and leaves it on the page
                itself, so a keyboard would start again from the top of the
                page once the answer is in. It says it is unavailable, and
                run() ignores a second press. */}
            <button
              ref={submitRef}
              type="submit"
              aria-disabled={busy}
              className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-solid py-4 text-sm font-semibold text-on-solid hover:bg-solid-hover aria-disabled:pointer-events-none aria-disabled:opacity-60 ${pressCls}`}
            >
              {busy ? 'Checking…' : 'Check my status'}
            </button>
            <p className="mt-4 text-center text-2xs text-soft/50">
              Not yet a Life Saver, Change Maker?{' '}
              <Link
                to="/join"
                className="font-semibold text-accent transition-colors hover:text-ink"
              >
                Join AUSSS →
              </Link>
            </p>
          </form>

          {/* Always on the page, so that a change in it is read out. */}
          <p role="status" className="sr-only">
            {announce}
          </p>

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
                  <div className="rounded-3xl border border-line/12 bg-sunk/60 p-8">
                    <p className="text-xs uppercase tracking-[0.22em] text-soft/55">
                      Membership status
                    </p>
                    <p
                      className="heading-serif mt-2 text-3xl"
                      style={{ color: accent }}
                    >
                      {statusRecord.status || tierLabel}
                    </p>
                    <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line/10 bg-veil/[0.04] sm:grid-cols-4">
                      {[
                        ['Year joined', statusRecord.yearJoined || '–'],
                        ['Years spent', statusRecord.yearsSpent || '–'],
                        ['Local GAs', parseGA(statusRecord.lgas).display],
                        ['National GAs', parseGA(statusRecord.ngas).display],
                      ].map(([k, v]) => (
                        <div key={k} className="bg-sunk/40 px-3 py-4">
                          <div className="heading-serif text-xl text-ink">
                            {v}
                          </div>
                          <div className="mt-1 text-3xs uppercase tracking-widest text-soft/55">
                            {k}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const positions = splitPositions(statusRecord.currentPosition)
                      if (positions.length <= 1) {
                        return (
                          <p className="mt-4 text-sm text-soft/70">
                            Current position:{' '}
                            <span className="text-ink">
                              {positions[0] || 'General Member'}
                            </span>
                          </p>
                        )
                      }
                      return (
                        <div className="mt-4 text-sm text-soft/70">
                          <p>Current positions:</p>
                          <ul className="mt-1.5 space-y-1">
                            {positions.map((p) => (
                              <li key={p} className="text-ink">
                                {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}
                    <p className="mt-6 border-t border-line/10 pt-4 text-xs text-soft/55">
                      Something wrong with your record?{' '}
                      <a
                        href={MEMBERSHIP_ISSUE_FORM}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent underline-offset-2 transition-colors hover:text-ink hover:underline"
                      >
                        Tell us through this form
                      </a>
                      .
                    </p>
                  </div>
                  <GuidanceCard advice={advice} color={statusColor} />
                </>
              )}

              {result.state === 'not-found' && (
                <div className="rounded-3xl border border-line/12 bg-sunk/60 p-8">
                  <p className="heading-serif text-2xl text-ink">
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
                  <p className="mt-2 text-sm text-soft/65">
                    Check the exact name or email you registered with. Not a
                    member yet? Here’s how to join:
                  </p>
                  <GuidanceCard
                    advice={{ ...NOT_A_MEMBER, progress: [], steps: NOT_A_MEMBER.steps }}
                    color={statusColor}
                  />
                </div>
              )}

              {/* A membership that has ended: the fact and who to ask. The
                  lookup hands back nothing more for it, and this card says
                  nothing about why. */}
              {result.state === 'ended' && (
                <div className="rounded-3xl border border-line/12 bg-sunk/60 p-8">
                  <p className="heading-serif text-2xl text-ink">
                    {MEMBERSHIP_ENDED.title}
                  </p>
                  <p className="mt-2 text-sm text-soft/65">
                    {MEMBERSHIP_ENDED.body} If you have a question about it, please{' '}
                    <Link to="/contact" className="text-accent hover:text-ink">
                      contact the Executive Board
                    </Link>
                    .
                  </p>
                </div>
              )}

              {result.state === 'ambiguous' && (
                <div className="rounded-3xl border border-line/12 bg-sunk/60 p-8">
                  <p className="heading-serif text-2xl text-ink">
                    More than one member shares this name
                  </p>
                  <p className="mt-2 text-sm text-soft/65">
                    We can’t identify you by name alone. Please{' '}
                    <Link to="/contact" className="text-accent hover:text-ink">
                      contact us
                    </Link>{' '}
                    and we’ll confirm your membership status directly.
                  </p>
                </div>
              )}

              {result.state === 'not-connected' && (
                <div className="rounded-3xl border border-line/12 bg-sunk/60 p-8">
                  <p className="heading-serif text-2xl text-ink">
                    The lookup is unavailable right now
                  </p>
                  <p className="mt-2 text-sm text-soft/65">
                    Please check back soon, or{' '}
                    <Link to="/contact" className="text-accent hover:text-ink">
                      contact us
                    </Link>
                    .
                  </p>
                </div>
              )}

              {result.state === 'error' && (
                <div role="alert" className="rounded-3xl border border-line/12 bg-sunk/60 p-8">
                  <p className="heading-serif text-2xl text-ink">
                    Something went wrong
                  </p>
                  <p className="mt-2 text-sm text-soft/65">
                    {lookupErrorText(result.message)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Governance, only render alongside an actual membership status
              card (so it doesn't crowd the special TO/EB/Heba cards or the
              not-found / error states). */}
          {found && (
          <div className="mt-12 rounded-2xl border border-line/10 bg-card/60 p-7 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Governance
            </p>
            <h2 className="heading-serif mt-2 text-xl text-ink">
              Constitution &amp; Bylaws
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-soft/65">
              Every membership rule above comes from the AUSSS Constitution
              &amp; Bylaws. Read the full document.
            </p>
            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/constitution"
                className={`w-full rounded-full bg-solid px-6 py-3 text-sm font-semibold text-on-solid hover:bg-solid-hover motion-safe:hover:scale-[1.03] sm:w-auto ${pressCls}`}
              >
                View document
              </Link>
              <a
                href={CONSTITUTION_PDF}
                download
                className={`w-full rounded-full border border-line/25 px-6 py-3 text-sm font-semibold text-ink hover:bg-veil/10 sm:w-auto ${pressCls}`}
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
