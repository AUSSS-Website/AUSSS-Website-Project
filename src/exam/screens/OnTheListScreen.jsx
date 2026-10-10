import { useState } from 'react'
import { Field, authInputCls } from '../../portal/portalUi.jsx'
import { examStart } from '../examApi.js'
import { opensLine, startLine, startProblem } from '../examFlow.js'
import { ExamCard, Problem, tapLinkCls, tapPrimaryCls } from '../examUi.jsx'

// The account holds an ID on the exam's list. What comes next depends on the
// exam's phase: before it opens (the door is asked again as the time comes),
// open (the start code read out in the hall starts the paper), or closed
// (nobody else may start).
//
//   exam       the door's { title, opens_at, minutes, questions, phase }
//   onStarted  the database has made the paper; called with the paper's id
//   onBack     the database's answer is one the door explains: ask it again
export default function OnTheListScreen({ word, exam, me, notice = '', onEdit, onSignOut, onStarted, onBack }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const start = async (e) => {
    e.preventDefault()
    if (busy || !code.trim()) return
    setBusy(true)
    setProblem('')
    try {
      const answer = await examStart(word, code)
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
              {startLine(exam)}
            </p>
            <Problem>{problem || notice}</Problem>
            <button type="submit" disabled={busy || !code.trim()} className={`${tapPrimaryCls} mt-5 w-full`}>
              {busy ? 'Starting…' : 'Start the exam'}
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
