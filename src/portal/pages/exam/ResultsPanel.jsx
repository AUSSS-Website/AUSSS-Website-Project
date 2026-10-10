import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ExportButtons from '../../ExportButtons.jsx'
import { useExamResults } from '../../examResultQueries.js'
import {
  durationWords,
  examPhase,
  exportName,
  resultColumns,
  resultSummary,
  searchResults,
  sharedRanks,
  tally,
} from '../../examStats.js'
import { ErrorText, Panel, Spinner, inputCls, outlineBtnCls } from '../../portalUi.jsx'
import AttemptSheet, { StateChip } from './AttemptSheet.jsx'

// The Results tab of an exam (/portal/exam/:id?tab=results): the ranking as
// the database returns it (rpc/exam_results: highest grade first, equal grades
// by name), with a search box and the exports. The database marks and ranks;
// this page orders nothing, and a search narrows the list without moving
// anyone. While anyone is still sitting, and while a student can still start,
// the list is read again every 30 seconds.
//
// A row opens that person's paper (AttemptSheet) in place of the list. Which
// paper is open is `?paper=<attempt id>` in the address, so the paper can be
// linked to and the browser's Back returns to the ranking.

const PAGE_SIZE = 50

const rowId = (attemptId) => `paper-${attemptId}`

// The address's query as it is (the tab stays), with the open paper set, or
// taken out when there is none.
function withPaper(params, paper) {
  const next = new URLSearchParams(params)
  if (paper) next.set('paper', paper)
  else next.delete('paper')
  return next
}

// `tied` says the row's rank is shared: it then reads '=3', so a row on its
// own (after a search) still says so.
function Row({ row, questions, to, tied }) {
  const time = durationWords(row.seconds)
  return (
    <li>
      <Link
        id={rowId(row.attempt_id)}
        to={to}
        className="flex items-center gap-x-4 rounded-xl border border-line/10 bg-sunk/40 p-3 transition-colors hover:border-line/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60"
      >
        <span className="w-12 shrink-0 text-center text-lg font-semibold tabular-nums text-ink">
          <span className="sr-only">{tied ? 'Joint rank ' : 'Rank '}</span>
          {tied && <span aria-hidden="true">=</span>}
          {row.rank}
        </span>
        {/* The name and the figures share what is left of the row, so when
            the figures do not fit beside the name they wrap under it, not
            under the rank. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <span className="min-w-0 flex-1 basis-40">
            <span className="block break-words text-sm font-semibold text-ink">{row.full_name || 'No name'}</span>
            <span className="block break-words text-xs text-soft/60">
              {[row.student_id, row.faculty_year].filter(Boolean).join(' · ')}
            </span>
          </span>
          {/* From a tablet up each figure has a width of its own, so they line
              up down the list. */}
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft/70">
            <span className="sm:w-24">
              <span className="text-base font-semibold tabular-nums text-ink">{row.score ?? 0}</span> of {questions}
            </span>
            <span className="tabular-nums sm:w-24">{row.answered ?? 0} answered</span>
            <span className={time ? 'tabular-nums sm:w-24' : 'hidden sm:block sm:w-24'}>{time}</span>
            <span className="sm:w-28">
              <StateChip state={row.state} />
            </span>
          </span>
        </span>
      </Link>
    </li>
  )
}

export default function ResultsPanel({ exam }) {
  const [params, setParams] = useSearchParams()
  const paper = params.get('paper') || ''
  const results = useExamResults(exam.id, exam)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const listRef = useRef(null)
  // The whole ranking is in the browser, so the list follows every letter;
  // useDeferredValue keeps typing smooth if a render ever lags.
  const term = useDeferredValue(q)

  const attempts = results.data?.attempts
  const questions = results.data?.questions ?? 0
  const found = useMemo(() => searchResults(attempts, term), [attempts, term])
  const counts = useMemo(() => tally(attempts), [attempts])
  const shared = useMemo(() => sharedRanks(attempts), [attempts])
  const columns = useMemo(() => resultColumns(questions), [questions])

  // Back from a paper: the row it was opened from, in view and in focus again.
  const lastOpen = useRef('')
  useEffect(() => {
    if (paper) {
      lastOpen.current = paper
      return
    }
    const el = lastOpen.current ? document.getElementById(rowId(lastOpen.current)) : null
    lastOpen.current = ''
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      el.focus({ preventScroll: true })
    }
  }, [paper])

  if (paper) {
    const rank = (attempts || []).find((r) => r.attempt_id === paper)?.rank ?? null
    return (
      <AttemptSheet
        key={paper}
        exam={exam}
        attemptId={paper}
        rank={rank}
        tied={shared.has(rank)}
        backTo={{ search: withPaper(params, '').toString() }}
        onDeleted={() => setParams((prev) => withPaper(prev, ''), { replace: true })}
      />
    )
  }

  const total = found.rows.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const at = Math.min(page, pages - 1)
  const visible = found.rows.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE)
  const typed = term.trim()
  // A student can still start: a new paper can appear with nobody sitting yet.
  const open = examPhase(exam, Date.now()) === 'open'

  // Previous and Next sit at the foot of a long page: the new page starts at
  // its top.
  const turn = (to) => {
    setPage(to)
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }

  return (
    <Panel title="Results">
      <p className="mt-2 text-xs text-soft/55">
        Highest grade first. Students on the same grade share a rank and are listed by name. A grade is counted each
        time this list is read, so a right answer corrected on the Questions tab shows from the next refresh.
        Students never see a grade.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
          placeholder="Search name, ID, email, phone"
          aria-label="Search the results"
          className={`${inputCls} max-w-sm`}
        />
        <button
          type="button"
          onClick={() => results.refetch()}
          disabled={results.isFetching}
          className={outlineBtnCls}
        >
          {results.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
        <span className="ml-auto">
          <ExportButtons
            title={`Results: ${exam.title}`}
            subtitle={`The ranking by grade, out of ${questions} ${questions === 1 ? 'question' : 'questions'}${
              typed ? `, matching “${typed}”` : ''
            }. Grades as counted when this file was made.`}
            filename={exportName(exam.title, 'results')}
            columns={columns}
            rows={found.rows}
            summary={resultSummary(found.rows, questions)}
            landscape
          />
        </span>
      </div>

      {results.isPending ? (
        <div className="mt-6 flex justify-center">
          <Spinner />
        </div>
      ) : !results.data ? (
        <div className="mt-4">
          <ErrorText>Couldn’t load the results: {results.error?.message || 'the database sent nothing back.'}</ErrorText>
        </div>
      ) : (
        <>
          {/* With no paper yet, the sentence under this line says so. */}
          <p className="mt-4 text-xs text-soft/60" aria-live="polite">
            {counts.started === 0
              ? ''
              : `${counts.started.toLocaleString()} ${counts.started === 1 ? 'paper' : 'papers'}: ${counts.handedIn} handed in, ${
                  counts.timedOut
                } ran out of time, ${counts.sitting} still sitting.`}
            {typed && counts.started > 0 ? ` ${total} ${total === 1 ? 'matches' : 'match'} the search.` : ''}
            {counts.sitting > 0
              ? ' The list refreshes every 30 seconds until everyone has finished.'
              : open
                ? ' The list refreshes every 30 seconds while students can still start.'
                : ''}
          </p>
          {results.error && (
            <div className="mt-3">
              <ErrorText>Couldn’t refresh the results: {results.error.message}</ErrorText>
            </div>
          )}

          {counts.started === 0 ? (
            <p className="mt-4 text-sm text-soft/60">
              Nobody has started this exam yet. A paper shows here from the moment a student starts.
            </p>
          ) : total === 0 ? (
            <p className="mt-4 text-sm text-soft/60">Nobody matches that.</p>
          ) : (
            <>
              {found.similar && (
                <p className="mt-4 text-sm text-soft/60">Nobody matches that exactly. These names are close.</p>
              )}
              <ol ref={listRef} className="mt-4 space-y-2">
                {visible.map((row) => (
                  <Row
                    key={row.attempt_id}
                    row={row}
                    questions={questions}
                    tied={shared.has(row.rank)}
                    to={{ search: withPaper(params, row.attempt_id).toString() }}
                  />
                ))}
              </ol>
              {pages > 1 && (
                <div className="flex items-center justify-center gap-4 pt-6 text-xs text-soft/60">
                  <button type="button" disabled={at === 0} onClick={() => turn(at - 1)} className={outlineBtnCls}>
                    Previous
                  </button>
                  <span>
                    Page {at + 1} of {pages}
                  </span>
                  <button
                    type="button"
                    disabled={at + 1 >= pages}
                    onClick={() => turn(at + 1)}
                    className={outlineBtnCls}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  )
}
