import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { pressCls } from '../../../lib/motion.js'
import { useExam } from '../../examQueries.js'
import { readProblem } from '../../examStats.js'
import { ErrorText, PageHeader, PageLoading, Panel } from '../../portalUi.jsx'
import {
  ExamGate,
  StatusChip,
  examStanding,
  examTabId,
  opensWords,
  tapCls,
  tapLinkCls,
  useIsExamOfficer,
} from './ExamsPage.jsx'
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

const tabId = examTabId
const panelId = (key) => `exam-part-${key}`

// The arrow keys walk along the tabs and round the ends, and Home and End go
// to the first and the last, as a row of tabs is expected to answer. They move
// the keyboard only: Enter or the space bar opens the part, so walking past
// Results does not start its reads. Every tab can still be reached with Tab.
function walkTabs(e) {
  // With a key held beside it an arrow is the browser's own (Alt and the left
  // arrow go back a page).
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const from = TABS.findIndex(([key]) => tabId(key) === e.target.id)
  if (from === -1) return
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
  let to = -1
  if (e.key === 'Home') to = 0
  else if (e.key === 'End') to = TABS.length - 1
  else if (step) to = (from + step + TABS.length) % TABS.length
  if (to === -1) return
  e.preventDefault()
  document.getElementById(tabId(TABS[to][0]))?.focus()
}

const backLinkCls = `${tapLinkCls} mt-4 text-sm font-semibold text-accent hover:text-ink`

// `refreshError` is a read of the exam that failed after one that worked (a
// dropped connection in the hall): the page stays as it is, with everything
// typed into it, and says so in one line.
function ExamView({ exam, refreshError }) {
  // The open part is ?tab= in the address. Choosing one replaces the address
  // in place, so the browser's Back leaves the exam and does not walk back
  // through the parts, and the rest of the address stays (the paper open on
  // the Results part is still open on the way back to it).
  const [tab, setTab] = useTabParam(TABS, 'setup')
  const [opened, setOpened] = useState([tab])
  if (!opened.includes(tab)) setOpened([...opened, tab])
  const standing = examStanding(exam)

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/portal/exam" className={`${tapLinkCls} transition-colors hover:text-ink`}>
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
          <ErrorText>{readProblem('refresh the exam', refreshError)}</ErrorText>
          <p className="mt-1 text-xs text-soft/60">What you see is the last read. Nothing you typed is lost.</p>
        </div>
      )}

      {/* Both kinds of tab have a border, so the row does not shift by a
          pixel when another is chosen. */}
      <div role="tablist" aria-label="Exam" onKeyDown={walkTabs} className="mb-8 flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={tabId(key)}
            aria-selected={tab === key}
            aria-controls={panelId(key)}
            onClick={() => setTab(key)}
            className={`inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-semibold ${pressCls} ${tapCls} ${
              tab === key ? 'border-transparent bg-cta text-on-cta' : 'border-line/15 text-soft/70 hover:text-ink'
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
  if (exam.isPending) return <PageLoading />
  // Only a first read that failed takes the page's place. Once the exam is
  // here, a later read that fails (every save ends with one, and the page asks
  // again by itself during a sitting) must not: the page holds unsaved work,
  // and the sentence a save was refused with.
  if (exam.error && !exam.data) {
    return (
      <Panel>
        <ErrorText>{readProblem('load the exam', exam.error)}</ErrorText>
        <Link to="/portal/exam" className={backLinkCls}>
          &larr; All exams
        </Link>
      </Panel>
    )
  }
  if (!exam.data) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">No exam here. It may have been deleted.</p>
        <Link to="/portal/exam" className={backLinkCls}>
          &larr; All exams
        </Link>
      </Panel>
    )
  }
  // A key per exam: nothing typed for one exam can be saved to another.
  return <ExamView key={exam.data.id} exam={exam.data} refreshError={exam.error} />
}
