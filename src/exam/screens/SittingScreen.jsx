import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ExamLayout from '../ExamLayout.jsx'
import {
  HAND_IN_CHECKING,
  clockNotice,
  clockTone,
  connectionNote,
  hashFor,
  pageLabel,
  placeFromHash,
  saveWords,
  strayTap,
} from '../examFlow.js'
import { FlagIcon, focusCls, focusTargetCls, moveFocus, noteScreen, tapLinkCls, tapOutlineCls, tapPrimaryCls } from '../examUi.jsx'
import { answerOf, formatClock } from '../sitting.js'
import { useTimeLeft } from '../useSitting.js'
import ReviewScreen from './ReviewScreen.jsx'

// The paper: ten questions a page, the clock and the save state in a bar that
// stays at the top, the pages and the review under it. Tired students sit it
// for two hours on small phones, so:
//   - everything tapped is at least 44px tall and the options are whole rows;
//   - no text is ever cut short, a long option wraps;
//   - nothing moves when the save state changes or an answer is chosen (the
//     bar keeps room for its longest line, each question keeps a row for its
//     "Clear answer");
//   - nothing needs hover, and nothing moves on its own but the small saving
//     mark (a button changes colour, and may sink a little, only while it is
//     pressed);
//   - one tap can never lose work: a cleared answer can be put back, and
//     handing in asks twice (ReviewScreen);
//   - the second half of a double tap changes nothing: for a moment after the
//     page of questions changes, a press on the questions is not counted
//     (strayTap in examFlow.js, and `tapGuard` below).
// `sitting` is what useSitting returns while its status is 'sitting'.

// ---- the bar that stays in view -------------------------------------------------

const CLOCK_TONE = { plenty: 'text-ink', low: 'text-warn', last: 'text-danger' }

// Drawn again each second, alone: the questions under it are not.
function Clock({ clock }) {
  const left = useTimeLeft(clock)
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-soft/70">Time left</span>
      <span role="timer" className={`text-2xl font-semibold leading-none ${CLOCK_TONE[clockTone(left)]}`}>
        {formatClock(left) || '--:--'}
      </span>
      {/* Read out at ten, five and one minute; the running clock is not. */}
      <span role="status" className="sr-only">
        {clockNotice(left)}
      </span>
    </p>
  )
}

function SaveMark({ kind }) {
  const common = { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (kind === 'saved') {
    return (
      <svg {...common} className="h-4 w-4 shrink-0">
        <path d="M3 8.5l3.2 3L13 4.5" />
      </svg>
    )
  }
  if (kind === 'saving') {
    return (
      <svg {...common} className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none">
        <path d="M8 2a6 6 0 1 0 6 6" />
      </svg>
    )
  }
  return (
    <svg {...common} className="h-4 w-4 shrink-0">
      <path d="M8 2.5l6 10.5H2L8 2.5zM8 6.5v3M8 11.2v.1" />
    </svg>
  )
}

// The save state in words. Two lines are kept for it on a phone, where its
// longest sentence wraps, so the questions never move when it changes.
// `checking` is the one state that matters more than the saving: nobody knows
// yet whether a hand-in arrived, and no answer is taken meanwhile. It is said
// here, where it stays in view on every page, since the options under it do
// nothing until it is over.
function SaveState({ save, connected, onPhone, checking }) {
  const kind = checking || (save.kind === 'saved' && !connected) ? 'offline' : save.kind
  const tone = kind === 'offline' ? 'text-warn' : kind === 'saved' ? 'text-ok' : 'text-soft/80'
  return (
    <p className={`mt-1 flex min-h-8 items-start gap-1.5 text-xs font-medium leading-4 sm:min-h-4 ${tone}`}>
      <SaveMark kind={kind} />
      <span className="min-w-0">{checking ? HAND_IN_CHECKING : saveWords(save, { connected, onPhone })}</span>
    </p>
  )
}

// Told to a screen reader once when the connection goes and once when it is
// back, not with every answer.
function ConnectionNote({ connected, onPhone }) {
  const [note, setNote] = useState('')
  const was = useRef(connected)
  useEffect(() => {
    if (was.current === connected) return
    was.current = connected
    setNote(connectionNote(connected, onPhone))
  }, [connected, onPhone])
  return (
    <span role="status" className="sr-only">
      {note}
    </span>
  )
}

// A named region, so a screen reader can go straight to the time left.
function StatusBar({ sitting, where }) {
  return (
    <section aria-label="Time left and saving" className="sticky top-0 z-20 border-y border-line/10 bg-page">
      <div className="mx-auto w-full max-w-3xl px-4 py-2 sm:px-6">
        {/* With very large text on a narrow phone the page drops under the clock; it is never cut off. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Clock clock={sitting.clock} />
          <p className="shrink-0 text-sm font-semibold text-ink">{where}</p>
        </div>
        <SaveState
          save={sitting.save}
          connected={sitting.connected}
          onPhone={sitting.onPhone}
          checking={sitting.handInNote === 'checking'}
        />
        <ConnectionNote connected={sitting.connected} onPhone={sitting.onPhone} />
      </div>
    </section>
  )
}

// ---- one question ---------------------------------------------------------------

// Drawn again only when its own answer changes. `locked` is true while no
// answer is taken (a hand-in is on its way, or in doubt): the options and the
// buttons then say so themselves, where a tap that did nothing would not.
const Question = memo(function Question({ q, total, answer, locked, onChoose, onClear, onFlag }) {
  // The answer last cleared here, so a stray tap on "Clear answer" can be undone.
  const [cleared, setCleared] = useState(null)
  return (
    <section
      id={`question-${q.n}`}
      tabIndex={-1}
      className={`border-t border-line/10 py-6 first:border-t-0 ${focusTargetCls}`}
    >
      <fieldset className="min-w-0">
        <legend className="w-full">
          <span className="flex min-h-6 flex-wrap items-center gap-x-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Question {q.n} of {total}
            {answer.f && (
              <span className="inline-flex items-center gap-1 normal-case tracking-normal text-warn">
                <FlagIcon filled className="h-3.5 w-3.5" />
                Flagged
              </span>
            )}
          </span>
          <span dir="auto" className="mt-2 block whitespace-pre-wrap text-base font-medium leading-relaxed text-ink [overflow-wrap:anywhere]">
            {q.body}
          </span>
        </legend>
        <div className="mt-4 space-y-2">
          {q.options.map((text, i) => {
            const chosen = answer.c === i
            return (
              // dir="auto": an option written in Arabic has its mark on the right.
              <label
                key={i}
                dir="auto"
                className={`relative flex min-h-[48px] items-start gap-3 rounded-xl border px-3 py-3 ${
                  locked ? 'opacity-60' : 'cursor-pointer'
                } ${chosen ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line/15 bg-card'}`}
              >
                <input
                  type="radio"
                  name={`answer-${q.id}`}
                  value={i}
                  checked={chosen}
                  disabled={locked}
                  onChange={() => {
                    setCleared(null)
                    onChoose(q.id, i)
                  }}
                  className="peer mt-px h-6 w-6 shrink-0 appearance-none rounded-full border-2 border-soft/60 bg-page checked:border-[7px] checked:border-cta focus:outline-none"
                />
                <span className="min-w-0 flex-1 whitespace-pre-wrap text-base leading-snug text-ink [overflow-wrap:anywhere]">
                  {text}
                </span>
                {/* The focus ring, round the whole row and a gap away from it. A
                    chosen row has a blue edge of its own, and a ring drawn
                    against that edge only made it a hair thicker: with the
                    arrow keys the option in focus is the chosen one. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-px rounded-xl ring-accent ring-offset-page peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2"
                />
              </label>
            )
          })}
        </div>
      </fieldset>
      {/* Always there and always this tall, so "Clear answer" coming and going moves nothing. */}
      <div className="mt-2 flex min-h-[44px] items-center justify-between gap-3">
        {/* These three sit outside the fieldset, and a page has ten of each:
            the name a screen reader hears says which question it belongs to. */}
        <button
          type="button"
          aria-pressed={answer.f}
          aria-label={`Flag to come back, question ${q.n}`}
          disabled={locked}
          onClick={() => onFlag(q.id)}
          // The fill deepens under the thumb, so the press is answered before
          // the flag changes. Nothing moves or changes size. Not while the
          // paper is locked: a flag that cannot be set must not look pressed.
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 text-sm font-semibold disabled:opacity-40 ${focusCls} ${
            answer.f
              ? 'border-warn/50 bg-warn/10 text-warn [&:not(:disabled)]:active:bg-warn/20'
              : 'border-transparent text-soft/80 [&:not(:disabled)]:active:bg-veil/10'
          }`}
        >
          <FlagIcon filled={answer.f} />
          Flag to come back
        </button>
        {answer.c !== null ? (
          <button
            type="button"
            aria-label={`Clear answer, question ${q.n}`}
            disabled={locked}
            onClick={() => {
              setCleared(answer.c)
              onClear(q.id)
            }}
            className={tapLinkCls}
          >
            Clear answer
          </button>
        ) : cleared !== null ? (
          <button
            type="button"
            aria-label={`Undo, question ${q.n}`}
            disabled={locked}
            onClick={() => {
              onChoose(q.id, cleared)
              setCleared(null)
            }}
            className={tapLinkCls}
          >
            Undo
          </button>
        ) : null}
      </div>
    </section>
  )
})

// ---- a page of the paper --------------------------------------------------------

const headingCls = `heading-serif rounded-lg text-2xl text-ink ${focusTargetCls}`

// `tapGuard` is the pair of handlers that turns a stray press away (see
// SittingScreen). It sits round every question, so it covers the options and
// the three buttons under them alike: a slip on "Clear answer" would change
// an answer as surely as one on an option.
function PaperPage({ sitting, place, headingRef, tapGuard }) {
  const { questionsOn, answers, total, pageCount, pages, locked, setAnswer, clearAnswer, toggleFlag } = sitting
  const questions = useMemo(() => questionsOn(place.page), [questionsOn, place.page])
  const row = pages[place.page - 1]
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className={headingCls}>
        <span className="sr-only">
          Page {place.page} of {pageCount}.{' '}
        </span>
        {row && row.from < row.to ? `Questions ${row.from} to ${row.to}` : `Question ${row ? row.from : 1}`}
      </h1>
      <div className="mt-2" {...tapGuard}>
        {questions.map((q) => (
          <Question
            key={q.id}
            q={q}
            total={total}
            answer={answerOf(answers, q.id)}
            locked={locked}
            onChoose={setAnswer}
            onClear={clearAnswer}
            onFlag={toggleFlag}
          />
        ))}
      </div>
    </>
  )
}

// ---- under the page -------------------------------------------------------------

// A step darkens under the thumb (active:bg-sunk), in both themes.
const stepCls = `relative flex min-h-[52px] w-full flex-col items-center justify-center rounded-xl border px-1 py-1 active:bg-sunk ${focusCls}`
const stepTone = (current) => (current ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line/15 bg-card')

// Previous and Next, then every page as a button that says how many of its
// questions have no answer and whether any is flagged. The review is the
// last step.
function PageNav({ place, pages, go }) {
  const last = pages.length
  const onReview = place.view === 'review'
  return (
    <nav aria-label="Pages of the exam" className="mt-8 border-t border-line/10 pt-6">
      <div className="flex gap-3">
        <button
          type="button"
          disabled={!onReview && place.page <= 1}
          onClick={() => go({ view: 'page', page: onReview ? last : place.page - 1 })}
          className={`${tapOutlineCls} shrink-0`}
        >
          {onReview ? 'Back to the questions' : 'Previous'}
        </button>
        {!onReview && place.page < last && (
          <button type="button" onClick={() => go({ view: 'page', page: place.page + 1 })} className={`${tapPrimaryCls} flex-1`}>
            Next
          </button>
        )}
        {!onReview && place.page >= last && (
          <button type="button" onClick={() => go({ view: 'review' })} className={`${tapPrimaryCls} flex-1`}>
            Review and hand in
          </button>
        )}
      </div>

      <ol className="mt-6 grid grid-cols-5 gap-2 sm:grid-cols-10">
        {pages.map((row) => {
          const current = !onReview && row.page === place.page
          return (
            <li key={row.page}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                aria-label={pageLabel(row)}
                onClick={() => go({ view: 'page', page: row.page })}
                className={`${stepCls} ${stepTone(current)}`}
              >
                <span className="text-sm font-semibold text-ink">{row.page}</span>
                <span className={`text-xs ${row.unanswered > 0 ? 'text-soft/70' : 'text-ok'}`}>
                  {row.unanswered > 0 ? `${row.unanswered} left` : 'Done'}
                </span>
                {row.flagged > 0 && <FlagIcon filled className="absolute right-1 top-1 h-3 w-3 text-warn" />}
              </button>
            </li>
          )
        })}
        <li className="col-span-2">
          <button
            type="button"
            aria-current={onReview ? 'page' : undefined}
            onClick={() => go({ view: 'review' })}
            className={`${stepCls} ${stepTone(onReview)} text-sm font-semibold text-ink`}
          >
            Review
          </button>
        </li>
      </ol>
      <p className="mt-3 text-xs text-soft/60">
        Under each page is how many of its questions have no answer yet. A flag marks a page with a flagged question.
      </p>
    </nav>
  )
}

// ---- the screen -----------------------------------------------------------------

// Puts an element at the top of the screen at once. The site scrolls smoothly
// by default, and gliding from the foot of ten questions to the top would be
// motion nobody asked for. The gap the site keeps above a scroll target
// (scroll-padding-top in index.css) is what holds it clear of the bar.
function bringToTop(element) {
  try {
    element.scrollIntoView({ block: 'start', behavior: 'instant' })
  } catch {
    element.scrollIntoView(true)
  }
}

export default function SittingScreen({ sitting, title }) {
  const { hash, pathname, search } = useLocation()
  const navigate = useNavigate()
  const { total, pageCount, pages } = sitting

  const place = useMemo(() => placeFromHash(hash, total), [hash, total])
  // Each move is an entry in the phone's history: its back button goes to the
  // page before, and a refresh opens the same page.
  const go = useCallback((next) => navigate({ pathname, search, hash: hashFor(next) }), [navigate, pathname, search])

  // On a page change the focus goes to the top of the new page (or to the
  // question asked for), so a keyboard or a screen reader starts there and
  // the screen shows the top, not the foot the taker left.
  const headingRef = useRef(null)
  const lastPlace = useRef(null)
  // The paper is a screen like the cards: the one that takes its place
  // ("Time is up.", "Your exam was received.") is a change to be told of.
  useEffect(() => {
    noteScreen()
  }, [])
  useEffect(() => {
    const here = `${place.view} ${place.page} ${place.question}`
    const moved = lastPlace.current !== null && lastPlace.current !== here
    lastPlace.current = here
    const target = (place.question && document.getElementById(`question-${place.question}`)) || headingRef.current
    if (!target) return
    moveFocus(target)
    // Arriving on the paper leaves the screen where it opened; a move, or an
    // address that names a question, brings its target to the top.
    if (moved || place.question) bringToTop(target)
  }, [place.view, place.page, place.question])

  // When the page of questions last changed, on the clock that only runs
  // forwards. It is noted for every way the place can change ("Next",
  // "Previous", a page's number, a question's number in the review, the
  // phone's back button) and when the paper first appears, which a double tap
  // on "Start the exam" can also land on. A layout effect, because it runs as
  // the new page is put on screen and so before the browser can hand over
  // the next press. An ordinary effect may run after that press.
  const changedAt = useRef(0)
  useLayoutEffect(() => {
    changedAt.current = performance.now()
  }, [place.view, place.page, place.question])

  // A press on the questions too soon after that is the second half of a
  // double tap (strayTap in examFlow.js), and it must do nothing at all.
  const tapGuard = useMemo(
    () => ({
      // A press moves the focus to what is under it before any click is sent.
      // A stray one leaves the focus on the heading the page change gave it.
      onMouseDownCapture(event) {
        if (strayTap(changedAt.current, performance.now(), event.detail)) event.preventDefault()
      },
      // Caught on the way down, before the row or the button hears of it.
      // Prevented, a click on an option's row is not passed on to its radio
      // button, and one on the radio button itself is undone by the browser
      // before anything is drawn. Stopped, it reaches no handler under here,
      // so nothing is chosen, cleared, flagged or sent.
      onClickCapture(event) {
        if (!strayTap(changedAt.current, performance.now(), event.detail)) return
        event.preventDefault()
        event.stopPropagation()
      },
    }),
    [],
  )

  return (
    <ExamLayout
      title={title}
      wide
      bar={<StatusBar sitting={sitting} where={place.view === 'review' ? 'Review' : `Page ${place.page} of ${pageCount}`} />}
    >
      {!sitting.onPhone && (
        <p role="alert" className="mb-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          This phone cannot keep a copy of your answers. Do not close or refresh this page until you have handed in.
        </p>
      )}
      {place.view === 'review' ? (
        <ReviewScreen sitting={sitting} go={go} headingRef={headingRef} headingCls={headingCls} />
      ) : (
        <PaperPage sitting={sitting} place={place} headingRef={headingRef} tapGuard={tapGuard} />
      )}
      <PageNav place={place} pages={pages} go={go} />
    </ExamLayout>
  )
}
