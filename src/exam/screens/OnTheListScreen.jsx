import { useState } from 'react'
import { Field, authInputCls } from '../../portal/portalUi.jsx'
import { examStart } from '../examApi.js'
import { hasChoice, opensLine, sectionName, startLine, startProblem } from '../examFlow.js'
import { ExamCard, Problem, focusCls, tapLinkCls, tapPrimaryCls } from '../examUi.jsx'
import { BLOCKS } from '../sitting.js'

const questionsIn = (n) => `${n} ${n === 1 ? 'question' : 'questions'}`

// The two optional sections, as tick boxes: whole rows, 48px tall, like the
// options of a question. Nothing is ticked to begin with, so the choice is
// the taker's own and never a default they did not see.
function Sections({ exam, sits, onChange, disabled }) {
  return (
    <fieldset className="mb-6 min-w-0">
      <legend className="w-full text-sm font-semibold text-ink">Which sections will you answer?</legend>
      <p id="exam-sections-means" className="mt-1 text-sm text-soft/70">
        Everyone answers the {questionsIn(Number(exam.sections.shared) || 0)} that are shared. Choose one section or both. You can change
        this during the exam.
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

// The account holds an ID on the exam's list. What comes next depends on the
// exam's phase: before it opens (the door is asked again as the time comes),
// open (the start code read out in the hall starts the paper), or closed
// (nobody else may start).
//
// An exam with two optional sections (hasChoice in examFlow.js) asks which of
// them the taker will answer, above the start code. At least one: the button
// stays off until one is ticked, and says so.
//
//   exam       the door's { title, opens_at, minutes, questions, sections, phase }
//   onStarted  the database has made the paper; called with the paper's id
//   onBack     the database's answer is one the door explains: ask it again
export default function OnTheListScreen({ word, exam, me, notice = '', onEdit, onSignOut, onStarted, onBack }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [sits, setSits] = useState({ scope: false, score: false })
  const choosing = hasChoice(exam)
  const chosen = !choosing || sits.scope || sits.score

  const start = async (e) => {
    e.preventDefault()
    if (busy || !code.trim() || !chosen) return
    setBusy(true)
    setProblem('')
    try {
      const answer = await examStart(word, code, choosing ? sits : null)
      if (answer?.ok) {
        onStarted(answer.attempt_id)
        return
      }
      const words = startProblem(answer)
      if (words) setProblem(words)
      else onBack()
    } catch (error) {
      setProblem(error?.message || 'The exam could not be started. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ExamCard title="You are on the list.">
      <dl className="mt-6 space-y-3 rounded-2xl border border-line/10 bg-page p-4 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Name</dt>
          <dd className="mt-1 text-ink [overflow-wrap:anywhere]">{me?.full_name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Student ID</dt>
          <dd className="mt-1 text-ink [overflow-wrap:anywhere]">{me?.student_id}</dd>
        </div>
      </dl>
      <p className="mt-1 text-center">
        <button type="button" onClick={onEdit} disabled={busy} className={tapLinkCls}>
          Edit my details
        </button>
      </p>

      <div className="mt-4 border-t border-line/10 pt-6">
        {exam?.phase === 'open' ? (
          <form onSubmit={start} noValidate>
            {choosing && (
              <Sections
                exam={exam}
                sits={sits}
                disabled={busy}
                onChange={(next) => {
                  setSits(next)
                  setProblem('')
                }}
              />
            )}
            <Field label="Start code" htmlFor="exam-start-code" hint="It is read out in the hall.">
              <input
                id="exam-start-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={60}
                aria-describedby="exam-start-means"
                className={`${authInputCls} text-center font-semibold uppercase tracking-[0.2em] placeholder:normal-case`}
              />
            </Field>
            <p id="exam-start-means" className="mt-3 text-sm text-soft/70">
              {chosen ? startLine(exam, choosing ? sits : null) : 'Choose at least one section to see how many questions you will have.'}
            </p>
            <Problem>{problem || notice}</Problem>
            <button type="submit" disabled={busy || !code.trim() || !chosen} className={`${tapPrimaryCls} mt-5 w-full`}>
              {busy ? 'Starting…' : chosen ? 'Start the exam' : 'Choose a section first'}
            </button>
          </form>
        ) : exam?.phase === 'closed' ? (
          <>
            <p className="text-center text-sm font-semibold text-ink">This exam has closed.</p>
            <Problem>{notice}</Problem>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-ink">{opensLine(exam)}</p>
            <p className="mt-2 text-sm text-soft/70">
              Come back to this page then. You will need the start code that is read out in the hall.
              {choosing && ' You will also choose which sections to answer: professional exchange (SCOPE), research exchange (SCORE), or both.'}
            </p>
            <Problem>{notice}</Problem>
          </>
        )}
      </div>

      <p className="mt-4 text-center">
        <button type="button" onClick={onSignOut} disabled={busy} className={tapLinkCls}>
          Not you? Sign out
        </button>
      </p>
    </ExamCard>
  )
}
