import { useEffect, useRef } from 'react'
import { ConfirmButton } from '../../portal/portalUi.jsx'
import { DOUBLE_TAP_MS, handInWait, handInWords, leaveOutWords, sectionName } from '../examFlow.js'
import { Problem, focusCls, tapOutlineCls, tapPrimaryCls } from '../examUi.jsx'
import { BLOCKS } from '../sitting.js'

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

// The two optional sections, in an exam that has them: which the taker
// answers, with a button to add the other or to leave one out. Leaving out
// takes two taps and says first what becomes of the answers in it: they are
// kept, and count again if the section is added back. The last section a
// taker answers cannot be left out.
function Sections({ sitting }) {
  const { sections, sits, blockAnswered, locked, setSections, total } = sitting
  // The button that was tapped is gone once the section changes ("Leave out"
  // becomes "Add this section", and the other row loses its own "Leave
  // out"). The keyboard then goes to the row that changed, and a screen
  // reader is told what the paper holds now.
  const changed = useRef(null)
  const rows = useRef({})
  const before = useRef(sits)
  useEffect(() => {
    if (before.current === sits) return
    before.current = sits
    const row = changed.current && rows.current[changed.current]
    changed.current = null
    if (row) row.focus({ preventScroll: true })
  }, [sits])
  const change = (block, on) => {
    changed.current = block
    setSections({ ...sits, [block]: on })
  }
  const both = sits.scope && sits.score
  const said = `You are answering ${both ? 'both sections' : sectionName(sits.scope ? 'scope' : 'score')}: ${total} ${total === 1 ? 'question' : 'questions'} in all.`
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your sections</h2>
      <p role="status" className="sr-only">
        {said}
      </p>
      <p className="mt-3 text-sm text-soft/80">
        Everyone answers the shared questions. You can add or leave out a section until you hand in.
      </p>
      <ul className="mt-3 space-y-2">
        {BLOCKS.map((block) => {
          const on = sits[block]
          const only = on && !sits[block === 'scope' ? 'score' : 'scope']
          const n = Number(sections[block]) || 0
          const answeredHere = blockAnswered[block]
          return (
            <li
              key={block}
              ref={(el) => {
                rows.current[block] = el
              }}
              tabIndex={-1}
              className={`rounded-xl border px-4 py-3 ${focusCls} ${on ? 'border-accent/50 bg-accent/5' : 'border-line/15 bg-card'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-base font-medium text-ink">{sectionName(block)}</p>
                  <p className="mt-0.5 text-sm text-soft/70">
                    {n} {n === 1 ? 'question' : 'questions'}. {on ? 'You are answering this section.' : 'You have left this section out.'}
                  </p>
                </div>
                {!on ? (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => change(block, true)}
                    className={tapOutlineCls}
                  >
                    Add this section
                  </button>
                ) : only ? null : (
                  <ConfirmButton
                    label="Leave out"
                    confirmLabel="Leave it out"
                    disabled={locked}
                    onConfirm={() => change(block, false)}
                    className={tapOutlineCls}
                  />
                )}
              </div>
              {on && !only && answeredHere > 0 && <p className="mt-2 text-sm text-soft/70">{leaveOutWords(block, answeredHere)}</p>}
              {!on && answeredHere > 0 && (
                <p className="mt-2 text-sm text-soft/70">
                  Your {answeredHere === 1 ? 'answer' : `${answeredHere} answers`} in it {answeredHere === 1 ? 'is' : 'are'} kept, and
                  will be marked only if you add the section again.
                </p>
              )}
              {only && <p className="mt-2 text-sm text-soft/70">This is the only section you are answering, so it stays.</p>}
            </li>
          )
        })}
      </ul>
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

      {sitting.sections.choice && <Sections sitting={sitting} />}

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
