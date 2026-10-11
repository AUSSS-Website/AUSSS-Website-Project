import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { errorText } from '../../../lib/errorText.js'
import { eventWhen } from '../../../lib/eventTime.js'
import { useExamMutations, useExams } from '../../examQueries.js'
import { examPhase, readProblem } from '../../examStats.js'
import { ErrorText, Field, PageHeader, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

// /portal/exam. The exchange exams, newest first, and the form that starts a
// new one. The SCOPE and SCORE officers and the Executive Board set an exam up
// here and read its results; the database returns the exams to them and to
// nobody else, so this page only decides what to show. Students never come
// here: they sit the exam at its own hidden address.
//
// Also here, for every part of the Exam pages: the chip, a few words and
// counts, the Refresh button, the ids of an exam's tabs, and the classes that
// give a finger enough to land on (tapCls and the ones under it).

// On a touch screen a button is at least a thumb tall; with a mouse it keeps
// the portal's small pill. Every pill on the Exam pages carries it, and every
// one-line field, which is 2px short of that by itself: an exam is run from a
// phone in a hall as often as from a desk.
export const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// The same for something that must not grow: an ::after carries the 44px a
// finger needs, centred on it, in px because the root size shrinks on a 320px
// phone. tapReachCls is for a control that has its own box (a round icon
// button); tapLinkCls is for a link that is a few words of small text, which
// stays one line of text and keeps its width.
export const tapReachCls =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-full after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
export const tapLinkCls = `${tapReachCls} inline-block`

// For a span around ConfirmButton's small text link ("Remove", "Release"). The
// link gets that reach, and so does the red "Click again to …" pill it turns
// into, which is the one a slip of the finger must not miss: ConfirmButton
// draws that pill itself and takes no class for it, so the reach is given from
// outside, to whatever button the span holds. The words are no wider for it,
// so a row of a long list is not either.
export const confirmReachCls =
  "inline-flex [&>button]:relative [&>button]:after:absolute [&>button]:after:left-1/2 [&>button]:after:top-1/2 [&>button]:after:h-[44px] [&>button]:after:w-full [&>button]:after:min-w-[44px] [&>button]:after:-translate-x-1/2 [&>button]:after:-translate-y-1/2 [&>button]:after:content-['']"

// The id of a part's tab on an exam's page (ExamPage.jsx), for a link inside
// one part that opens another and hands the keyboard to that part's tab.
export const examTabId = (key) => `exam-tab-${key}`

// "Refresh" on the lists that read the database again by themselves. It is as
// wide as "Refreshing…" from the start (both wordings share one grid cell), and
// it is not dimmed while a read is on its way: during a sitting that is every
// 30 seconds, and a button that grew and faded each time would pull the eye
// from the list. A press while a read is running does nothing, since that read
// is the refresh.
export function RefreshButton({ busy, onClick }) {
  return (
    <button
      type="button"
      onClick={busy ? undefined : onClick}
      aria-disabled={busy || undefined}
      className={`${outlineBtnCls} ${tapCls}`}
    >
      <span className="grid justify-items-center">
        <span aria-hidden={busy || undefined} className={`col-start-1 row-start-1 ${busy ? 'invisible' : ''}`}>
          Refresh
        </span>
        <span aria-hidden={busy ? undefined : true} className={`col-start-1 row-start-1 ${busy ? '' : 'invisible'}`}>
          Refreshing…
        </span>
      </span>
    </button>
  )
}

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
      <Link to="/portal" className={`${tapLinkCls} mt-4 text-sm font-semibold text-accent hover:text-ink`}>
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
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-2xs font-semibold ${cls}`}
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

const NO_TITLE = 'An exam needs a title.'

function NewExamForm() {
  const navigate = useNavigate()
  const { create } = useExamMutations()
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const titleRef = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      // Only spaces: said under the field, with the field in focus again.
      setError(NO_TITLE)
      titleRef.current?.focus()
      return
    }
    try {
      const row = await create.mutateAsync({ title: title.trim() })
      navigate(`/portal/exam/${row.id}`)
    } catch (err) {
      setError(errorText(err, 'The exam could not be added.'))
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
            ref={titleRef}
            className={`${inputCls} ${tapCls}`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              // What was wrong is being put right.
              setError('')
            }}
            maxLength={140}
            placeholder="Exchange exam 2026-27"
            aria-invalid={error === NO_TITLE || undefined}
            aria-describedby={error ? 'exam-new-title-error' : undefined}
            required
          />
        </Field>
        {/* The button is never switched off for an empty title: pressed, it
            says what is missing, which a dimmed button cannot. */}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add exam'}
          </button>
          <ErrorText id="exam-new-title-error">{error}</ErrorText>
        </div>
      </form>
    </Panel>
  )
}

// The whole row opens the exam, so a finger need not find the small pill at
// its end; the pill stays as the sign that the row can be opened.
function ExamRow({ exam }) {
  const standing = examStanding(exam)
  return (
    <li>
      <Link
        to={`/portal/exam/${exam.id}`}
        className="group flex flex-wrap items-center gap-3 rounded-xl border border-line/10 bg-sunk/40 p-3 transition-colors hover:border-line/30 active:bg-veil/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60"
      >
        {/* The basis lets the chips drop under the title on a phone, where the
            two do not fit on one line. */}
        <span className="min-w-0 flex-1 basis-56">
          <span className="block break-words text-sm font-semibold text-ink">{exam.title}</span>
          <span className="mt-0.5 block text-xs text-soft/60">
            {opensWords(exam)}
            {' · '}
            {countOf(exam.questions, 'question')}
            {' · '}
            {countOf(exam.registrations, 'student ID')} on the list
            {' · '}
            {countOf(exam.attempts, 'paper')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {exam.term?.label && <StatusChip>Term {exam.term.label}</StatusChip>}
          <StatusChip tone={standing.tone}>{standing.label}</StatusChip>
          <span aria-hidden="true" className={`${outlineBtnCls} group-hover:bg-veil/10`}>
            Open
          </span>
        </span>
      </Link>
    </li>
  )
}

// What the page this one was reached from had to say ("… was deleted."), said
// once: it is taken out of the address's state as soon as it is read, so a
// reload or a return to this page does not say it again. It is put on the page
// after the first paint, which is what makes a screen reader say it.
function useArrivalNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice, setNotice] = useState('')
  const arrived = location.state?.notice
  useEffect(() => {
    if (!arrived) return
    setNotice(arrived)
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [arrived, location.pathname, location.search, navigate])
  return notice
}

function ExamList() {
  const list = useExams()
  const exams = list.data || []
  const notice = useArrivalNotice()
  return (
    <>
      <p role="status" className={notice ? 'mb-6 text-sm text-ok' : 'sr-only'}>
        {notice}
      </p>
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
              <ErrorText>{readProblem('load the exams', list.error)}</ErrorText>
            </div>
          ) : (
            <>
              {/* A read that failed after one that worked: the list stays. */}
              {list.error && (
                <div className="mt-4">
                  <ErrorText>{readProblem('refresh the exams', list.error)}</ErrorText>
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
    </>
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
