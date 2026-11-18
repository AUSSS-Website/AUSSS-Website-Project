import { sectionName } from '../examFlow.js'
import { focusCls } from '../examUi.jsx'
import { BLOCKS } from '../sitting.js'

const questionsIn = (n) => `${n} ${n === 1 ? 'question' : 'questions'}`

// The two optional sections, as tick boxes: whole rows, 48px tall, like the
// options of a question. Nothing is ticked to begin with, so the choice is
// the taker's own and never a default they did not see.
//
// Two screens ask it: the start card of an exam with no contracts
// (OnTheListScreen), and the contract preferences of one that has them
// (PreferencesScreen), where the sections ticked are the programmes a taker
// may choose contracts from.
//
//   exam      the door's exam, for how many questions each section has
//   sits      { scope, score }
//   means     the sentence that follows "Everyone answers the N questions
//             that are shared."
export default function SectionChoice({ exam, sits, onChange, disabled = false, means }) {
  return (
    <fieldset className="mb-6 min-w-0">
      <legend className="w-full text-sm font-semibold text-ink">Which sections will you answer?</legend>
      <p id="exam-sections-means" className="mt-1 text-sm text-soft/70">
        Everyone answers the {questionsIn(Number(exam.sections.shared) || 0)} that are shared. {means}
      </p>
      <div className="mt-3 space-y-2">
        {BLOCKS.map((block) => {
          const on = sits[block]
          return (
            <label
              key={block}
              className={`relative flex min-h-[48px] items-start gap-3 rounded-xl border px-3 py-3 ${
                disabled ? 'opacity-60' : 'cursor-pointer'
              } ${on ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line/15 bg-card'}`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                aria-describedby="exam-sections-means"
                onChange={(e) => onChange({ ...sits, [block]: e.target.checked })}
                className={`mt-px h-6 w-6 shrink-0 rounded-md border-2 border-soft/60 accent-cta ${focusCls}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium leading-snug text-ink">{sectionName(block)}</span>
                <span className="mt-0.5 block text-sm text-soft/70">{questionsIn(Number(exam.sections[block]) || 0)}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
