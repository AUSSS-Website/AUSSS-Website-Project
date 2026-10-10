import { useMemo, useState } from 'react'
import ExportButtons from '../../ExportButtons.jsx'
import { useExamQuestionStats, useExamResults } from '../../examResultQueries.js'
import {
  anySitting,
  averages,
  durationWords,
  examPhase,
  exportName,
  gradeSpread,
  hardestFirst,
  oneDecimal,
  optionShares,
  percent,
  questionColumns,
  resultSummary,
  shareRight,
  tally,
} from '../../examStats.js'
import { ErrorText, Panel, Spinner, outlineBtnCls } from '../../portalUi.jsx'
import { Figure } from './AttemptSheet.jsx'

// The Overview tab of an exam (/portal/exam/:id?tab=overview). From the
// ranking (rpc/exam_results): how many started, handed in and are still
// sitting, then the average grade, the average time and the spread of grades
// of the finished papers. From rpc/exam_question_stats, which counts every
// paper: the questions most people got wrong, each with how often every
// option was chosen. The arithmetic is in examStats.js; the bars are plain
// elements, with no chart library. Both reads repeat every 30 seconds while
// anyone is still sitting and while a student can still start.

// How many of the hardest questions show before "Show all".
const SHOWN = 10

const smallCapsCls = 'text-xs font-semibold uppercase tracking-[0.2em] text-soft/50'

// One bar a band, the top grades first. Each bar is that band's share of the
// fullest one.
function Spread({ bands }) {
  const most = Math.max(0, ...bands.map((b) => b.count))
  return (
    <ol className="mt-3 space-y-1.5">
      {[...bands].reverse().map((b) => (
        <li key={b.label} className="flex items-center gap-3 text-xs">
          <span className="w-14 shrink-0 text-right tabular-nums text-soft/70">
            <span className="sr-only">
              Grades {b.from} to {b.to}:
            </span>
            <span aria-hidden="true">{b.label}</span>
          </span>
          <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-veil/10" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-medical/70"
              style={{ width: `${most ? (100 * b.count) / most : 0}%` }}
            />
          </span>
          <span className="w-12 shrink-0 tabular-nums text-ink">
            {b.count}
            <span className="sr-only"> {b.count === 1 ? 'paper' : 'papers'}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

// One question: the share that got it right, then a line and a bar for each
// option in the officers' order. `papers` is how many papers there are.
function QuestionFigures({ question, papers }) {
  const { options, blank } = optionShares(question, papers)
  return (
    <li className="rounded-xl border border-line/10 bg-sunk/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-soft/55">Question {question.n}</p>
        <p className="text-sm text-soft/70">
          <span className="font-semibold text-ink">{percent(shareRight(question, papers)) || '–'} right</span> (
          {question.right ?? 0} of {papers})
        </p>
      </div>
      {/* dir="auto", here and on each option: a question written in Arabic
          reads from the right. */}
      <p dir="auto" className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-ink">
        {question.body}
      </p>
      <ol className="mt-3 space-y-2">
        {options.map((o) => (
          <li key={o.index} className="text-xs">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-semibold text-soft/60">{o.letter}</span>
              <span dir="auto" className="min-w-0 flex-1 basis-40 break-words text-soft/85">
                {o.text}
              </span>
              {o.correct && <span className="font-semibold text-ok">Right answer</span>}
              <span className="tabular-nums text-soft/70">
                {o.count} ({percent(o.share) || '–'})
              </span>
            </div>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-veil/10" aria-hidden="true">
              <span
                className={`block h-full rounded-full ${o.correct ? 'bg-emerald-500/70' : 'bg-medical/60'}`}
                style={{ width: `${100 * (o.share || 0)}%` }}
              />
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs tabular-nums text-soft/60">
        Not answered: {blank.count} ({percent(blank.share) || '–'})
      </p>
    </li>
  )
}

export default function OverviewPanel({ exam }) {
  const results = useExamResults(exam.id, exam)
  const attempts = results.data?.attempts
  const total = results.data?.questions ?? 0
  const stats = useExamQuestionStats(exam.id, { live: anySitting(attempts), exam })
  // A student can still start: the figures move with nobody sitting yet.
  const open = examPhase(exam, Date.now()) === 'open'
  const [showAll, setShowAll] = useState(false)

  const counts = useMemo(() => tally(attempts), [attempts])
  const avg = useMemo(() => averages(attempts), [attempts])
  const spread = useMemo(() => gradeSpread(attempts, total), [attempts, total])
  const hardest = useMemo(() => hardestFirst(stats.data?.questions), [stats.data])
  const columns = useMemo(() => questionColumns(stats.data), [stats.data])
  const papers = stats.data?.attempts ?? 0
  const busy = results.isFetching || stats.isFetching

  return (
    <div className="space-y-8">
      <Panel title="Overview">
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-60 text-xs text-soft/55">
            Counted from the papers each time this page is read.
            {counts.sitting > 0
              ? ' It refreshes every 30 seconds until everyone has finished.'
              : open
                ? ' It refreshes every 30 seconds while students can still start.'
                : ''}
          </p>
          <button
            type="button"
            onClick={() => {
              results.refetch()
              stats.refetch()
            }}
            disabled={busy}
            className={outlineBtnCls}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
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
            {results.error && (
              <div className="mt-3">
                <ErrorText>Couldn’t refresh the results: {results.error.message}</ErrorText>
              </div>
            )}
            {/* The figures move by themselves during a sitting: a screen reader
                is told in one line, as on the Results tab. */}
            <p className="sr-only" aria-live="polite">
              {counts.started} started, {counts.handedIn} handed in, {counts.timedOut} ran out of time, {counts.sitting} still
              sitting.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Figure label="Started">{counts.started}</Figure>
              <Figure label="Handed in">{counts.handedIn}</Figure>
              <Figure label="Time ran out">{counts.timedOut}</Figure>
              <Figure label="Still sitting">{counts.sitting}</Figure>
              <Figure label="Average grade">
                {avg.grade == null ? (
                  '–'
                ) : (
                  <>
                    {oneDecimal(avg.grade)} <span className="font-sans text-sm font-normal text-soft/60">of {total}</span>
                  </>
                )}
              </Figure>
              <Figure label="Average time">{avg.seconds == null ? '–' : durationWords(avg.seconds)}</Figure>
            </dl>

            <p className={`mt-6 ${smallCapsCls}`}>Spread of grades</p>
            {counts.finished === 0 ? (
              <p className="mt-3 text-sm text-soft/60">
                {counts.started === 0
                  ? 'Nobody has started this exam yet.'
                  : 'No paper is finished yet. The averages and the spread fill in as students hand in.'}
              </p>
            ) : (
              <>
                <p className="mt-2 text-xs text-soft/55">
                  How many finished papers scored in each range, out of {total}. The averages and the spread count
                  finished papers only: {counts.finished} of {counts.started}.
                </p>
                <Spread bands={spread} />
              </>
            )}
          </>
        )}
      </Panel>

      <Panel title="The questions most people got wrong">
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-60 text-xs text-soft/55">
            The share of papers that got each question right, the lowest first, and how often each option was
            chosen. Every paper counts, finished or not, and a question left unanswered counts as not right.
          </p>
          <ExportButtons
            title={`Question figures: ${exam.title}`}
            subtitle="How each question was answered, the ones most people got wrong first. Every paper counts, finished or not."
            filename={exportName(exam.title, 'question-figures')}
            columns={columns}
            rows={papers > 0 ? hardest : []}
            summary={results.data ? resultSummary(attempts, total) : []}
            landscape
          />
        </div>

        {stats.isPending ? (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        ) : !stats.data ? (
          <div className="mt-4">
            <ErrorText>
              Couldn’t load the question figures: {stats.error?.message || 'the database sent nothing back.'}
            </ErrorText>
          </div>
        ) : (
          <>
            {stats.error && (
              <div className="mt-3">
                <ErrorText>Couldn’t refresh the question figures: {stats.error.message}</ErrorText>
              </div>
            )}
            {hardest.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">This exam has no questions yet.</p>
            ) : papers === 0 ? (
              <p className="mt-4 text-sm text-soft/60">
                Nobody has started this exam yet, so there is nothing to count.
              </p>
            ) : (
              <>
                <ol className="mt-4 space-y-3">
                  {(showAll ? hardest : hardest.slice(0, SHOWN)).map((question) => (
                    <QuestionFigures key={question.question_id ?? question.n} question={question} papers={papers} />
                  ))}
                </ol>
                {hardest.length > SHOWN && (
                  <div className="mt-4">
                    <button
                      type="button"
                      aria-expanded={showAll}
                      onClick={() => setShowAll((v) => !v)}
                      className={outlineBtnCls}
                    >
                      {showAll ? `Show the ${SHOWN} hardest only` : `Show all ${hardest.length} questions`}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
