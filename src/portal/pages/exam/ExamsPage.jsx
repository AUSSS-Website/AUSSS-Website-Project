import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { eventWhen } from '../../../lib/eventTime.js'
import { useExamMutations, useExams } from '../../examQueries.js'
import { examPhase } from '../../examStats.js'
import { ErrorText, Field, PageHeader, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// /portal/exam. The exchange exams, newest first, and the form that starts a
// new one. The SCOPE and SCORE officers and the Executive Board set an exam up
// here and read its results; the database returns the exams to them and to
// nobody else, so this page only decides what to show. Students never come
// here: they sit the exam at its own hidden address.

// Whether this person is one of the exam's officers.
export function useIsExamOfficer() {
  const { isEB, officerOf } = useAuth()
  return isEB || officerOf('scope') || officerOf('score')
}

export function ExamGate({ children }) {
  if (useIsExamOfficer()) return children
  return (
    <Panel>
      <p className="text-sm text-soft/70">
        The exchange exam is set up by the SCOPE and SCORE officers and the Executive Board. If you think you should
        have access, ask the webmaster to check your assignment for this term.
      </p>
      <Link to="/portal" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
        &larr; Back to your dashboard
      </Link>
    </Panel>
  )
}

export function StatusChip({ children, tone = 'soft' }) {
  const cls = {
    soft: 'border-line/15 text-soft/65',
    ok: 'border-emerald-400/50 text-ok',
    warn: 'border-amber-400/50 text-warn',
    accent: 'border-medical/60 text-accent',
  }[tone]
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  )
}

// An instant in words on Cairo's clock: 'Sat 14 Nov 2026, 6:00 pm'.
export function whenInCairo(iso) {
  return iso ? eventWhen({ startsAt: iso }, { short: true }) : ''
}

// '1 question', '12 questions'.
export function countOf(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

// Where an exam stands, for its chip: a draft students cannot reach, open to
// them, or past its closing time. The closing time only ends starting: the
// papers started before it run their full length, so until the last of them
// can have run out the chip says "Closed to new starts", not "Closed".
export function examStanding(exam, now = Date.now()) {
  const phase = examPhase(exam, now)
  if (phase === 'draft') return { label: 'Draft', tone: 'soft' }
  if (phase === 'finishing') return { label: 'Closed to new starts', tone: 'soft' }
  if (phase === 'over') return { label: 'Closed', tone: 'soft' }
  return { label: 'Open to students', tone: 'ok' }
}

// The opening time in words, by the clock: 'Opens Sat 14 Nov 2026, 6:00 pm'
// until then and 'Opened …' after. A draft never opened, whatever the time.
export function opensWords(exam, now = Date.now()) {
  if (!exam.opens_at) return 'No opening time yet'
  const when = whenInCairo(exam.opens_at)
  if (now < Date.parse(exam.opens_at)) return `Opens ${when}`
  return exam.status === 'ready' ? `Opened ${when}` : `Opening time ${when} has passed`
}

function NewExamForm() {
  const navigate = useNavigate()
  const { create } = useExamMutations()
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('An exam needs a title.')
      return
    }
    try {
      const row = await create.mutateAsync({ title: title.trim() })
      navigate(`/portal/exam/${row.id}`)
    } catch (err) {
      setError(err.message || 'The exam could not be added.')
    }
  }

  return (
    <Panel title="New exam">
      <p className="mt-2 text-xs text-soft/55">
        It starts as a draft that students cannot reach, with a random word in its address. On its own page you add
        the questions, the list of student IDs, the times and the start code.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-5">
        <Field label="Title" htmlFor="exam-new-title" hint="Students see it at the top of the exam.">
          <input
            id="exam-new-title"
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            placeholder="Exchange exam 2026-27"
            required
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryBtnCls} disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Adding…' : 'Add exam'}
          </button>
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </Panel>
  )
}

function ExamRow({ exam }) {
  const standing = examStanding(exam)
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line/10 bg-sunk/40 p-3">
      {/* The basis lets the chips drop under the title on a phone, where the
          two do not fit on one line. */}
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-semibold text-ink">{exam.title}</p>
        <p className="mt-0.5 text-xs text-soft/60">
          {opensWords(exam)}
          {' · '}
          {countOf(exam.questions, 'question')}
          {' · '}
          {countOf(exam.registrations, 'student ID')} on the list
          {' · '}
          {countOf(exam.attempts, 'paper')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {exam.term?.label && <StatusChip>Term {exam.term.label}</StatusChip>}
        <StatusChip tone={standing.tone}>{standing.label}</StatusChip>
        <Link to={`/portal/exam/${exam.id}`} className={outlineBtnCls} aria-label={`Open ${exam.title}`}>
          Open
        </Link>
      </div>
    </li>
  )
}

function ExamList() {
  const list = useExams()
  const exams = list.data || []
  return (
    <div className="space-y-8">
      <NewExamForm />

      <Panel title="Exams">
        <p className="mt-2 text-xs text-soft/55">
          Each exam keeps its questions from term to term. Its list of student IDs and its papers are deleted when
          its term ends, so download the results before the new term is started.
        </p>
        {list.isPending ? (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        ) : !list.data ? (
          <div className="mt-4">
            <ErrorText>Couldn’t load the exams: {list.error?.message || 'the database sent nothing back.'}</ErrorText>
          </div>
        ) : (
          <>
            {/* A read that failed after one that worked: the list stays. */}
            {list.error && (
              <div className="mt-4">
                <ErrorText>Couldn’t refresh the exams: {list.error.message}</ErrorText>
              </div>
            )}
            {exams.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">No exams yet. Add the first one above.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {exams.map((exam) => (
                  <ExamRow key={exam.id} exam={exam} />
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}

export default function ExamsPage() {
  usePageTitle('Exam')
  return (
    <>
      <PageHeader
        eyebrow="Exchange"
        title="Exam"
        subtitle="The exchange exam: its questions, the students who may sit it, and their results."
      />
      <ExamGate>
        <ExamList />
      </ExamGate>
    </>
  )
}
