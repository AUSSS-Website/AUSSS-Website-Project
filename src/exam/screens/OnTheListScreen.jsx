import { useState } from 'react'
import { Field, authInputCls } from '../../portal/portalUi.jsx'
import { examStart } from '../examApi.js'
import { hasChoice, opensLine, sectionName, startLine, startProblem } from '../examFlow.js'
import { ExamCard, Problem, tapLinkCls, tapPrimaryCls } from '../examUi.jsx'
import { chosenSections, hasContracts, preferencesLine } from '../preferences.js'
import { BLOCKS } from '../sitting.js'
import SectionChoice from './SectionChoice.jsx'

// The account holds an ID on the exam's list. What comes next depends on the
// exam's phase: before it opens (the door is asked again as the time comes),
// open (the start code read out in the hall starts the paper), or closed
// (nobody else may start).
//
// An exam with two optional sections (hasChoice in examFlow.js) asks which of
// them the taker will answer, above the start code. At least one: the button
// stays off until one is ticked, and says so.
//
// An exam that has contracts (hasContracts in preferences.js) has asked both
// things already, on the screen before this one: the sections were ticked with
// the contract preferences, and the paper sits those. This card then says what
// was chosen, with a way back to change it, and asks for the start code only.
//
//   exam         the door's { title, opens_at, minutes, questions, sections,
//                contracts, phase }
//   preferences  the door's { saved, complete, scope, score, picks }
//   onChoose     opens the contract preferences again
//   onStarted    the database has made the paper; called with the paper's id
//   onBack       the database's answer is one the door explains: ask it again
export default function OnTheListScreen({ word, exam, me, preferences = null, notice = '', onEdit, onChoose, onSignOut, onStarted, onBack }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [ticked, setTicked] = useState({ scope: false, score: false })
  const choosing = hasChoice(exam)
  // With contracts, the sections are the ones saved with the preferences.
  const settled = hasContracts(exam)
  const sits = settled ? chosenSections(preferences) : ticked
  const chosen = !choosing || sits.scope || sits.score

  const start = async (e) => {
    e.preventDefault()
    if (busy || !code.trim() || !chosen) return
    setBusy(true)
    setProblem('')
    try {
      const answer = await examStart(word, code, choosing && !settled ? sits : null)
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

      {settled && exam?.phase !== 'closed' && (
        <div className="mt-4 border-t border-line/10 pt-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your contract preferences</h2>
          {choosing && chosen && (
            <p className="mt-2 text-sm text-ink">
              You will answer {BLOCKS.filter((block) => sits[block]).map(sectionName).join(' and ')}.
            </p>
          )}
          <p className="mt-2 text-sm text-soft/70">{preferencesLine(preferences)}</p>
          <p className="mt-1 text-center">
            <button type="button" onClick={onChoose} disabled={busy} className={tapLinkCls}>
              {choosing ? 'Change my sections and contracts' : 'Change my contracts'}
            </button>
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-line/10 pt-6">
        {exam?.phase === 'open' ? (
          <form onSubmit={start} noValidate>
            {choosing && !settled && (
              <SectionChoice
                exam={exam}
                sits={sits}
                disabled={busy}
                means="Choose one section or both. You can change this during the exam."
                onChange={(next) => {
                  setTicked(next)
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
            <p className="mt-2 text-sm text-soft/70">
              Screenshots and photos of the exam are not allowed. Your student ID and email are printed across every page of your paper. Stay on this page until you hand in. Leaving it is recorded.
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
              {choosing && !settled && ' You will also choose which sections to answer: professional exchange (SCOPE), research exchange (SCORE), or both.'}
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
