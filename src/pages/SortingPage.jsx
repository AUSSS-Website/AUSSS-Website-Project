import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../hooks/usePageTitle.js'
import { committees, slugFor } from '../data/society.js'
import { chipAccent, readableAccent, rgba } from '../lib/color.js'
import { prefersReducedMotion, pressCls, scrollBehavior } from '../lib/motion.js'
import {
  QUESTIONS,
  QUIZ_BASIS,
  QUIZ_SOURCES,
  REVEAL_LINES,
  STORAGE_KEY,
  profileFor,
  scoreAnswers,
} from '../data/sortingQuiz.js'

// "The Sorting", a personality quiz that places students into a committee
// or support division. Stage machine: intro → quiz → reveal → result.

const byAbbr = (abbr) => committees.find((c) => c.abbr === abbr)

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return byAbbr(parsed?.abbr) ? parsed : null
  } catch {
    return null
  }
}

function saveResult(abbr) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ abbr, at: new Date().toISOString() }))
  } catch {
    /* private mode etc., result still shows, just isn't remembered */
  }
}

// A text-sized control keeps a thumb's 44px to land on: an unseen ::after
// reaches above and below the words. In px, not rem, since the root size
// shrinks on a 320px phone.
const tapAreaCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"

export default function SortingPage() {
  usePageTitle('Sorting quiz')
  const [stage, setStage] = useState('intro') // intro | quiz | reveal | result
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState([])
  const [picked, setPicked] = useState(null) // option flash before advancing
  const [saved, setSaved] = useState(readSaved)

  const ranked = useMemo(
    () => (answers.length === QUESTIONS.length ? scoreAnswers(answers) : []),
    [answers],
  )
  const winner = ranked.length ? byAbbr(ranked[0]) : null

  // Keep the viewport at the top of the card when questions change on
  // phones, the fixed navbar otherwise hides the new question.
  useEffect(() => {
    if (window.scrollY > 120) window.scrollTo({ top: 0, behavior: scrollBehavior() })
  }, [qIndex, stage])

  // Each step swaps the card, and the button that was pressed goes with it,
  // which left a keyboard reader back at the top of the page. Focus moves to
  // the new step's heading instead (to Skip while Dash deliberates), and a
  // screen reader reads it out. Only when the step has changed: on arrival
  // nothing was pressed, and the page keeps its focus where it was.
  const focusRef = useRef(null)
  const lastStep = useRef({ stage, qIndex })
  useEffect(() => {
    if (lastStep.current.stage === stage && lastStep.current.qIndex === qIndex) return
    lastStep.current = { stage, qIndex }
    focusRef.current?.focus({ preventScroll: true })
  }, [stage, qIndex])

  const begin = () => {
    setAnswers([])
    setQIndex(0)
    setPicked(null)
    setStage('quiz')
  }

  // The short wait that shows the pick before the next question arrives. It
  // is dropped when the page is left, and when Back is pressed inside it:
  // otherwise it fired after Back and moved the quiz forward again.
  const flashTimer = useRef()
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const choose = (optIdx) => {
    if (picked !== null) return // ignore double-taps during the flash
    setPicked(optIdx)
    flashTimer.current = window.setTimeout(() => {
      setPicked(null)
      setAnswers((prev) => [...prev.slice(0, qIndex), optIdx])
      if (qIndex + 1 < QUESTIONS.length) {
        setQIndex(qIndex + 1)
      } else {
        setStage(prefersReducedMotion() ? 'result' : 'reveal')
      }
    }, 240)
  }

  const goBack = () => {
    window.clearTimeout(flashTimer.current)
    setPicked(null)
    if (qIndex === 0) setStage('intro')
    else setQIndex(qIndex - 1)
  }

  // Remember the result once per completed run, when the winner is known.
  const recorded = useRef(false)
  useEffect(() => {
    if ((stage === 'reveal' || stage === 'result') && winner && !recorded.current) {
      recorded.current = true
      saveResult(winner.abbr)
      setSaved({ abbr: winner.abbr })
    }
    if (stage === 'quiz') recorded.current = false
  }, [stage, winner])

  return (
    <article className="bg-page">
      <div className="relative min-h-screen overflow-hidden pb-24 pt-32 sm:pt-40">
        {/* Same quiet dotted backdrop as /join */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative">
          {stage === 'intro' && <Intro saved={saved} onBegin={begin} focusRef={focusRef} />}
          {stage === 'quiz' && (
            <Question
              qIndex={qIndex}
              answers={answers}
              picked={picked}
              onChoose={choose}
              onBack={goBack}
              focusRef={focusRef}
            />
          )}
          {stage === 'reveal' && <Reveal onDone={() => setStage('result')} focusRef={focusRef} />}
          {stage === 'result' && winner && (
            <Result
              winner={winner}
              ranked={ranked}
              answers={answers}
              onRetake={begin}
              focusRef={focusRef}
            />
          )}
        </div>
      </div>
    </article>
  )
}

function Intro({ saved, onBegin, focusRef }) {
  const savedCommittee = saved ? byAbbr(saved.abbr) : null
  return (
    <div className="mx-auto max-w-2xl text-center animate-fade-up">
      <span className="eyebrow justify-center">
        <span className="h-px w-8 bg-medical" />
        The Sorting Ceremony
        <span className="h-px w-8 bg-medical" />
      </span>
      <h1
        ref={focusRef}
        tabIndex={-1}
        className="heading-serif mt-8 text-4xl text-ink focus:outline-none sm:text-6xl"
      >
        Where do you belong?
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg font-normal leading-relaxed text-soft/75 dark:font-light">
        Six standing committees, four support divisions. Find out which one is
        yours.
      </p>
      <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-soft/60">
        There’s no talking hat here, just a handful of questions and a
        remarkably perceptive alligator. There are no wrong answers, and no
        committee you can’t belong to. Answer as yourself and Dash will take
        care of the sorting.
      </p>
      <button
        type="button"
        onClick={onBegin}
        className={`mt-10 inline-flex items-center gap-2 rounded-full bg-cta px-8 py-3.5 text-sm font-semibold text-on-cta shadow-lg shadow-medical/20 hover:bg-cta-hover ${pressCls}`}
      >
        Begin the Sorting
        <span aria-hidden="true">→</span>
      </button>
      <p className="mt-5 text-xs text-soft/45">
        It takes about two minutes. Dash is gentle.
      </p>
      {savedCommittee && (
        // The link is one short word, so the whole pill is its place to land:
        // the ::after is laid over the pill, not over the word.
        <p className="relative mx-auto mt-10 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-line/10 bg-card/80 px-5 py-2.5 text-sm text-soft/70">
          Last time, Dash said
          <Link
            to={`/committees/${slugFor(savedCommittee)}`}
            className="font-bold transition-opacity after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] hover:opacity-80"
            style={{ color: readableAccent(savedCommittee.color) }}
          >
            {savedCommittee.abbr}
          </Link>
        </p>
      )}
    </div>
  )
}

function Question({ qIndex, answers, picked, onChoose, onBack, focusRef }) {
  const q = QUESTIONS[qIndex]
  const progress = qIndex / QUESTIONS.length
  return (
    // The site's own floating Back button (BackButton.jsx) is fixed at the top
    // left of every page, above everything. It sat on top of this card's Back:
    // a tap meant for "the question before" left the quiz and lost the answers.
    // Room at the top keeps the two apart on a phone only until the page is
    // scrolled a little, so below lg, where this card reaches the left edge,
    // its Back is at the right end of the row and can never be under the
    // other. From lg the card is clear of that corner and Back is on the left.
    <div className="mx-auto max-w-2xl pt-12 sm:pt-0">
      {/* The header stays where it is from one question to the next, so the
          bar can run on to its new length. Only the question below it is
          swapped (the key) and fades up again. */}
      <div className="animate-fade-up">
        <div className="flex flex-row-reverse items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-soft/60 lg:flex-row">
          <button
            type="button"
            onClick={onBack}
            className={`inline-flex items-center gap-1.5 uppercase hover:text-ink ${pressCls} ${tapAreaCls}`}
          >
            <span aria-hidden="true">←</span> Back
          </button>
          <span>
            Question {qIndex + 1} of {QUESTIONS.length}
          </span>
        </div>
        <div
          className="mt-4 h-1 overflow-hidden rounded-full bg-veil/10"
          role="progressbar"
          aria-valuenow={qIndex + 1}
          aria-valuemin={1}
          aria-valuemax={QUESTIONS.length}
          aria-label={`Question ${qIndex + 1} of ${QUESTIONS.length}`}
        >
          {/* A full-length bar scaled from its left end: the browser moves it
              without laying the page out again, which a changing width asks
              for. With reduced motion it steps to its new length. */}
          <div
            className="h-full origin-left bg-medical motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </div>

      <div key={qIndex} className="animate-fade-up">
        {/* The heading takes the focus when a question arrives (see
            focusRef in SortingPage), which is also what reads it out. */}
        <h2
          ref={focusRef}
          tabIndex={-1}
          className="heading-serif mt-10 text-2xl leading-snug text-ink focus:outline-none sm:text-3xl"
        >
          {q.question}
        </h2>
        {q.note && <p className="mt-3 text-sm italic text-accent">{q.note}</p>}

        <div className="mt-8 grid gap-3">
          {q.options.map((opt, i) => {
            const isPicked = picked === i
            const wasChosen = picked === null && answers[qIndex] === i
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChoose(i)}
                className={`rounded-2xl border p-5 text-left text-base leading-relaxed transition-[color,background-color,border-color,transform] duration-200 ease-out motion-safe:active:scale-[0.985] ${
                  isPicked || wasChosen
                    ? 'border-medical bg-medical/15 text-ink'
                    : 'border-line/10 bg-card text-soft/85 hover:border-line/30 hover:bg-card/70'
                }`}
              >
                {opt.text}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Dash deliberating, line by line. A reader who asked for less motion never
// comes here: `choose` sends them straight to the result.
function Reveal({ onDone, focusRef }) {
  const [lineIdx, setLineIdx] = useState(0)
  const done = useRef(onDone)
  done.current = onDone

  // Each line lingers for DWELL ms; the `animate-reveal` keyframe fades it in
  // and back out across that same window, so the deliberation reads slowly
  // and dramatically. Keep DWELL in sync with the `reveal` animation duration
  // in tailwind.config.js (2000ms).
  const DWELL = 2000
  useEffect(() => {
    const timers = REVEAL_LINES.map((_, i) =>
      window.setTimeout(() => setLineIdx(i), i * DWELL),
    )
    timers.push(
      window.setTimeout(() => done.current(), REVEAL_LINES.length * DWELL + 200),
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="mx-auto flex min-h-[40vh] max-w-xl flex-col items-center justify-center text-center">
      <span className="relative grid h-16 w-16 place-items-center rounded-full bg-medical/15">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-medical/30" />
        {/* Placeholder icon while Dash deliberates (swap for Dash art when ready) */}
        <svg
          viewBox="0 0 24 24"
          className="h-8 w-8 text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path
            d="M5 3v5a4 4 0 0 0 8 0V3M9 12v3a5 5 0 0 0 10 0v-1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="11" r="2" />
        </svg>
      </span>
      {/* The wrapper stays while the lines change inside it, so each new line
          is read out. */}
      <div aria-live="polite">
        <p
          key={lineIdx}
          className="mt-10 animate-reveal font-serif text-2xl italic leading-relaxed text-soft/85 sm:text-3xl"
        >
          {REVEAL_LINES[lineIdx]}
        </p>
      </div>
      <button
        ref={focusRef}
        type="button"
        onClick={() => done.current()}
        className={`mt-12 text-xs font-semibold uppercase tracking-[0.2em] text-soft/40 hover:text-ink ${pressCls} ${tapAreaCls}`}
      >
        Skip
      </button>
    </div>
  )
}

function Result({ winner, ranked, answers, onRetake, focusRef }) {
  const accent = readableAccent(winner.color)
  const runnersUp = ranked.slice(1, 3).map(byAbbr).filter(Boolean)
  const profile = useMemo(() => profileFor(answers), [answers])
  const [copied, setCopied] = useState(false)

  const share = async () => {
    const text = `Dash sorted me into ${winner.abbr}, ${winner.name}. Find where you belong:`
    const url = `${window.location.origin}/sorting`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'The AUSSS Sorting', text, url })
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div className="mx-auto max-w-2xl text-center animate-fade-up">
      <p className="font-serif text-2xl italic text-soft/70">Better be…</p>

      <div
        className="relative mx-auto mt-8 grid h-28 w-28 place-items-center rounded-full border"
        style={{ borderColor: rgba(winner.color, 0.45), background: rgba(winner.color, 0.12) }}
      >
        <span
          className="absolute inset-0 animate-pulse-ring rounded-full"
          style={{ background: rgba(winner.color, 0.25) }}
        />
        <img
          src={winner.logo}
          alt=""
          aria-hidden="true"
          className="logo-ink relative h-16 w-16 object-contain"
        />
      </div>

      <h1
        ref={focusRef}
        tabIndex={-1}
        className="heading-serif mt-8 text-5xl focus:outline-none sm:text-7xl"
        style={{ color: accent }}
      >
        {winner.abbr}!
      </h1>
      <p className="mt-3 text-lg text-ink">
        {winner.name}
        <span className="mx-2 text-soft/40">·</span>
        <span className="text-soft/60">{winner.group}</span>
      </p>
      {winner.nickname && (
        <p className="mt-4 text-base text-soft/75">
          Welcome to the{' '}
          <span className="font-semibold" style={{ color: accent }}>
            {winner.nickname}
          </span>
          {winner.mascot?.emoji ? ` ${winner.mascot.emoji}` : ''}
        </p>
      )}
      <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-soft/70">
        {winner.tagline} {winner.description}
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
        <Link
          to={`/committees/${slugFor(winner)}`}
          className="inline-flex min-h-[44px] items-center rounded-full px-7 py-3 text-sm font-semibold text-page transition-[opacity,transform] duration-150 ease-out hover:opacity-85 motion-safe:active:scale-[0.97]"
          style={{ background: accent }}
        >
          Meet your committee
        </Link>
        <button
          type="button"
          onClick={share}
          className={`min-h-[44px] rounded-full border border-line/20 px-7 py-3 text-sm font-semibold text-ink hover:border-line/45 ${pressCls}`}
        >
          {copied ? 'Copied!' : 'Share your result'}
        </button>
        {/* A button's changed label is not read out by itself. */}
        <span className="sr-only" role="status">
          {copied ? 'Copied' : ''}
        </span>
      </div>

      {runnersUp.length > 0 && (
        <div className="mx-auto mt-14 max-w-xl rounded-3xl border border-line/10 bg-card/60 p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
            Dash also heard echoes of
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {runnersUp.map((c) => (
              <Link
                key={c.abbr}
                to={`/committees/${slugFor(c)}`}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line/10 bg-sunk/70 px-4 py-2 text-sm text-soft/80 hover:border-line/30 hover:text-ink ${pressCls}`}
              >
                <span
                  className="rounded-full px-2 py-0.5 text-3xs font-bold uppercase tracking-[0.12em]"
                  style={{ background: rgba(c.color, 0.2), color: chipAccent(c.color) }}
                >
                  {c.abbr}
                </span>
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {profile.interests.length > 0 && (
        <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-line/10 bg-card/40 p-7">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-accent">
            What Dash heard in you
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {profile.interests.map((it) => (
              <span
                key={it.axis}
                className="inline-flex flex-col items-center rounded-2xl border border-line/10 bg-sunk/60 px-5 py-3"
              >
                <span className="text-sm font-bold text-ink">{it.name}</span>
                <span className="text-xs text-soft/55">{it.label}</span>
              </span>
            ))}
            {profile.trait && (
              <span className="inline-flex flex-col items-center rounded-2xl border border-line/10 bg-sunk/60 px-5 py-3">
                <span className="text-sm font-bold text-ink">{profile.trait.name}</span>
                <span className="text-xs text-soft/55">{profile.trait.label}</span>
              </span>
            )}
          </div>
          <p className="mx-auto mt-5 max-w-md text-center text-xs leading-relaxed text-soft/50">
            A leaning toward {profile.interests[0].blurb}
            {profile.trait ? `, and ${profile.trait.blurb}` : ''}. It’s a nudge
            toward {winner.abbr}, not a verdict.
          </p>
        </div>
      )}

      <details className="group mx-auto mt-6 max-w-xl rounded-3xl border border-line/10 bg-card/40 text-left">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6 [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold text-ink">
            The science behind the Sorting
          </span>
          <span
            aria-hidden="true"
            className="text-accent group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-300"
          >
            ▾
          </span>
        </summary>
        <div className="border-t border-line/10 px-6 pb-6 pt-5">
          <p className="text-sm leading-relaxed text-soft/70">{QUIZ_BASIS}</p>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Go deeper
          </p>
          <ul className="mt-3 space-y-3">
            {QUIZ_SOURCES.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-block text-sm font-semibold text-accent transition-colors hover:text-ink ${tapAreaCls}`}
                >
                  {s.label} ↗
                </a>
                <p className="text-xs leading-relaxed text-soft/50">{s.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm">
        <button
          type="button"
          onClick={onRetake}
          className={`font-semibold text-accent hover:text-ink ${pressCls} ${tapAreaCls}`}
        >
          Retake the Sorting
        </button>
        <Link
          to="/join"
          className={`font-semibold text-accent transition-colors hover:text-ink ${tapAreaCls}`}
        >
          How to join AUSSS →
        </Link>
      </div>
      <p className="mx-auto mt-8 max-w-md text-xs leading-relaxed text-soft/40">
        Sorted by a few honest questions, not by destiny. Every committee and
        division welcomes every member, whatever Dash says.
      </p>
    </div>
  )
}
