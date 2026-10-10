import { useState } from 'react'
import { Field, authInputCls } from '../../portal/portalUi.jsx'
import { examSaveDetails } from '../examApi.js'
import { EXAM_YEARS, detailField, detailsProblem, missingDetail, startingYear } from '../examFlow.js'
import { ExamCard, Problem, tapLinkCls, tapPrimaryCls } from '../examUi.jsx'

// The taker's name, year, phone and student ID. Saving checks the ID against
// the list the officers uploaded (rpc/exam_save_details); the database holds
// the rules and its refusals are shown in its own words.
//
//   me        what the profile holds already, to start the form from
//   held      this account already holds an ID on the list: the form then
//             edits the name, year and phone only
//   onSaved   called with the database's answer ({ registration, me })
//   onCancel  set when there is a screen to go back to
const inputId = { full_name: 'exam-name', faculty_year: 'exam-year', phone: 'exam-phone', student_id: 'exam-student-id' }
const PROBLEM_ID = 'exam-details-problem'

export default function DetailsScreen({ word, me, email, held = false, notice = '', onSaved, onCancel, onSignOut }) {
  const [fullName, setFullName] = useState(me?.full_name || '')
  // Only a year the exam offers: a profile that says anything else starts empty.
  const [facultyYear, setFacultyYear] = useState(() => startingYear(me))
  const [phone, setPhone] = useState(me?.phone || '')
  const [studentId, setStudentId] = useState(me?.student_id || '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // The field that problem is about, when it is about one: a screen reader is
  // told which, and hears the sentence on that field only.
  const [fault, setFault] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const missing = missingDetail({ full_name: fullName, faculty_year: facultyYear, phone, student_id: studentId })
    if (missing) {
      setProblem(missing.message)
      setFault(missing.field)
      document.getElementById(inputId[missing.field])?.focus()
      return
    }
    setBusy(true)
    setProblem('')
    setFault(null)
    try {
      const answer = await examSaveDetails(word, { fullName, facultyYear, phone, studentId })
      setProblem(detailsProblem(answer?.registration))
      onSaved(answer)
    } catch (error) {
      setProblem(error?.message || 'Your details could not be saved. Try again.')
      setFault(detailField(error?.message))
    } finally {
      setBusy(false)
    }
  }

  // For the one field at fault. A problem that is about no field (an ID not
  // on the list, no connection) is spoken once by the line itself.
  const about = (field) => (fault === field ? { 'aria-invalid': true, 'aria-describedby': PROBLEM_ID } : {})

  return (
    <ExamCard
      title="Your details"
      // The webmaster's words (2026-10-11), with the grammar checked at their
      // request: what a student gives here is what their contract is assigned by.
      subtitle="Please make sure the information you enter is accurate. It will be used to assign your contract."
    >
      <form onSubmit={submit} noValidate className="mt-6 space-y-5">
        <Field label="Full name" htmlFor={inputId.full_name}>
          <input
            id={inputId.full_name}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            autoCapitalize="words"
            maxLength={120}
            aria-required="true"
            {...about('full_name')}
            className={authInputCls}
          />
        </Field>

        <Field label="Year" htmlFor={inputId.faculty_year}>
          <select
            id={inputId.faculty_year}
            value={facultyYear}
            onChange={(e) => setFacultyYear(e.target.value)}
            aria-required="true"
            {...about('faculty_year')}
            className={authInputCls}
          >
            <option value="">Choose your year</option>
            {EXAM_YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Phone" htmlFor={inputId.phone}>
          <input
            id={inputId.phone}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            maxLength={30}
            aria-required="true"
            {...about('phone')}
            className={authInputCls}
          />
        </Field>

        <Field
          label="Student ID"
          htmlFor={inputId.student_id}
          hint={held ? 'Your student ID is confirmed. Ask an exchange officer if it is wrong.' : undefined}
        >
          <input
            id={inputId.student_id}
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            readOnly={held}
            aria-required="true"
            {...about('student_id')}
            // Locked, and still easy to read: no fading, a dashed edge instead.
            className={`${authInputCls} ${held ? 'cursor-not-allowed border-dashed !bg-transparent !text-soft' : ''}`}
          />
        </Field>

        {email && (
          <p className="text-xs text-soft/60">
            Signed in as <span className="text-ink [overflow-wrap:anywhere]">{email}</span>
          </p>
        )}

        <Problem id={PROBLEM_ID}>{problem || notice}</Problem>

        <button type="submit" disabled={busy} className={`${tapPrimaryCls} w-full`}>
          {busy ? 'Saving…' : held ? 'Save my details' : 'Save and check my ID'}
        </button>
      </form>

      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className={tapLinkCls}>
            Cancel
          </button>
        )}
        <button type="button" onClick={onSignOut} disabled={busy} className={tapLinkCls}>
          Not you? Sign out
        </button>
      </p>
    </ExamCard>
  )
}
