import { useRef } from 'react'
import { ConfirmButton } from '../../portal/portalUi.jsx'
import { DOUBLE_TAP_MS, handInWait, handInWords } from '../examFlow.js'
import { Problem, focusCls, tapPrimaryCls } from '../examUi.jsx'

// The last step of the paper, inside the sitting's frame (the clock and the
// save state stay in view): how many questions are answered, the unanswered
// and the flagged ones as buttons that go to the question, and the hand-in.
//
// Handing in ends the exam for good, so it takes two taps on the portal's
// ConfirmButton ("Hand in", then "Hand in for good"), and the second tap
// counts only if it is not the second half of a double tap (DOUBLE_TAP_MS in
// examFlow.js, which the paper's questions go by as well).
//
// The button is off, and says why, for as long as a hand-in is on its way or
// in doubt (handInWait in examFlow.js). While the bar says the page is
// checking whether the exam was handed in, a button that looked ready would
// send a second hand-in on top of the first.

// A number darkens under the thumb (active:bg-sunk), as the paper's page steps do.
const numberCls = `inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-line/15 bg-card px-2 text-sm font-semibold text-ink active:bg-sunk ${focusCls}`

function Numbers({ title, numbers, none, go }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        {title}
        {numbers.length > 0 && <span className="text-soft/70"> ({numbers.length})</span>}
      </h2>
      {numbers.length === 0 ? (
        <p className="mt-3 text-sm text-soft/70">{none}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {numbers.map((n) => (
            <li key={n}>
              <button type="button" aria-label={`Go to question ${n}`} onClick={() => go({ view: 'page', question: n })} className={numberCls}>
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function ReviewScreen({ sitting, go, headingRef, headingCls }) {
  const { total, answered, unanswered, flagged, handingIn, handInNote, onPhone } = sitting
  // When the button was last tapped, and the tap before that, on the clock
  // that only runs forwards.
  const taps = useRef({ last: 0, before: 0 })
  // What the button says while it is off: '' when it can be tapped. It is
  // read from the sitting on every draw and nothing of it is kept here, so
  // the button comes back with the sitting's own word that the wait is over.
  const wait = handInWait(handingIn, handInNote)

  // Handed in, or the exam ended another way: the screen changes by itself.
  // A hand-in that did not go through comes back as the sitting's
  // `handInNote`, and the line above the button says which kind it was.
  const handIn = () => {
    if (taps.current.last - taps.current.before < DOUBLE_TAP_MS) return
    sitting.handIn()
  }

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className={headingCls}>
        Review and hand in
      </h1>
      <p className="mt-3 text-base text-ink">
        You have answered {answered} of {total} {total === 1 ? 'question' : 'questions'}.
      </p>

      <Numbers title="Not answered" numbers={unanswered} none="Every question has an answer." go={go} />
      <Numbers title="Flagged" numbers={flagged} none="No question is flagged." go={go} />

      <section className="mt-8 rounded-2xl border border-line/10 bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Hand in</h2>
        <p className="mt-3 text-sm text-soft/80">
          Handing in ends the exam for you. You cannot change an answer afterwards. You will be asked to tap a second time.
        </p>
        {unanswered.length > 0 && (
          <p className="mt-2 text-sm font-semibold text-warn">
            {unanswered.length === 1 ? '1 question has no answer.' : `${unanswered.length} questions have no answer.`}
          </p>
        )}
        <Problem>{handInWords(handInNote, onPhone)}</Problem>
        <span
          className="mt-5 block"
          onClickCapture={() => {
            taps.current = { last: performance.now(), before: taps.current.last }
          }}
        >
          <ConfirmButton
            label="Hand in"
            confirmLabel="Hand in for good"
            busyLabel={wait}
            busy={wait !== ''}
            onConfirm={handIn}
            className={`${tapPrimaryCls} w-full`}
          />
        </span>
      </section>
    </>
  )
}
