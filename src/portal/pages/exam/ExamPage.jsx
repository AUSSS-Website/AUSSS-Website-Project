import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useExam } from '../../examQueries.js'
import { Centered, ErrorText, PageHeader, Panel, Spinner } from '../../portalUi.jsx'
import { ExamGate, StatusChip, examStanding, opensWords, useIsExamOfficer } from './ExamsPage.jsx'
import SetupPanel from './SetupPanel.jsx'
import QuestionsPanel from './QuestionsPanel.jsx'
import RegisteredPanel from './RegisteredPanel.jsx'
import ResultsPanel from './ResultsPanel.jsx'
import OverviewPanel from './OverviewPanel.jsx'

// /portal/exam/:id. One exam in five parts, chosen by ?tab=: setting it up
// (set-up, questions, the registered list) and reading it (results,
// overview). Every part takes the same `exam`: the row of public.exams with
// its term, its counts and `started` (examQueries.js). The database decides
// who may do what; this page asks it for the exam and shows a polite refusal
// when the answer is nothing.

const TABS = [
  ['setup', 'Set-up'],
  ['questions', 'Questions'],
  ['list', 'Registered list'],
  ['results', 'Results'],
  ['overview', 'Overview'],
]

// The three parts with forms stay on the page (hidden) once opened, so a
// half-written question or an unsaved time survives a look at another tab.
// The two that read results are shown only while their tab is open: they ask
// the database again every 30 seconds during a sitting.
const KEPT = [
  ['setup', SetupPanel],
  ['questions', QuestionsPanel],
  ['list', RegisteredPanel],
]

const tabId = (key) => `exam-tab-${key}`
const panelId = (key) => `exam-part-${key}`

// `refreshError` is a read of the exam that failed after one that worked (a
// dropped connection in the hall): the page stays as it is, with everything
// typed into it, and says so in one line.
function ExamView({ exam, refreshError }) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = TABS.some(([key]) => key === requested) ? requested : 'setup'
  const [opened, setOpened] = useState([tab])
  if (!opened.includes(tab)) setOpened([...opened, tab])
  const standing = examStanding(exam)

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/portal/exam" className="hover:text-ink">
            &larr; All exams
          </Link>
        }
        title={exam.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip tone={standing.tone}>{standing.label}</StatusChip>
            {exam.term?.label && <StatusChip>Term {exam.term.label}</StatusChip>}
            {exam.started && <StatusChip tone="accent">Started</StatusChip>}
            <span>{opensWords(exam)}</span>
          </span>
        }
      />

      {refreshError && (
        <div className="mb-6">
          <ErrorText>Couldn’t refresh the exam: {refreshError.message}</ErrorText>
          <p className="mt-1 text-xs text-soft/60">What you see is the last read. Nothing you typed is lost.</p>
        </div>
      )}

      <div role="tablist" aria-label="Exam" className="mb-8 flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={tabId(key)}
            aria-selected={tab === key}
            aria-controls={panelId(key)}
            onClick={() => setParams({ tab: key })}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              tab === key ? 'bg-cta text-on-cta' : 'border border-line/15 text-soft/70 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {KEPT.map(
        ([key, Part]) =>
          (tab === key || opened.includes(key)) && (
            <div key={key} role="tabpanel" id={panelId(key)} aria-labelledby={tabId(key)} className={tab === key ? '' : 'hidden'}>
              <Part exam={exam} />
            </div>
          ),
      )}
      {tab === 'results' && (
        <div role="tabpanel" id={panelId('results')} aria-labelledby={tabId('results')}>
          <ResultsPanel exam={exam} />
        </div>
      )}
      {tab === 'overview' && (
        <div role="tabpanel" id={panelId('overview')} aria-labelledby={tabId('overview')}>
          <OverviewPanel exam={exam} />
        </div>
      )}
    </>
  )
}

export default function ExamPage() {
  const { id } = useParams()
  const allowed = useIsExamOfficer()
  const exam = useExam(id, allowed)
  usePageTitle(exam.data ? exam.data.title : 'Exam')

  if (!allowed) return <ExamGate />
  if (exam.isPending) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  // Only a first read that failed takes the page's place. Once the exam is
  // here, a later read that fails (every save ends with one, and the page asks
  // again by itself during a sitting) must not: the page holds unsaved work,
  // and the sentence a save was refused with.
  if (exam.error && !exam.data) {
    return (
      <Panel>
        <ErrorText>Couldn’t load the exam: {exam.error.message}</ErrorText>
        <Link to="/portal/exam" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
          &larr; All exams
        </Link>
      </Panel>
    )
  }
  if (!exam.data) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">No exam here. It may have been deleted.</p>
        <Link to="/portal/exam" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
          &larr; All exams
        </Link>
      </Panel>
    )
  }
  // A key per exam: nothing typed for one exam can be saved to another.
  return <ExamView key={exam.data.id} exam={exam.data} refreshError={exam.error} />
}
