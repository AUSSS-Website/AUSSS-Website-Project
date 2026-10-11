import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { eventWhen } from '../../../lib/eventTime.js'
import ExportButtons from '../../ExportButtons.jsx'
import { useDeleteAttempt, useExamSheet } from '../../examResultQueries.js'
import {
  OUTCOME_LABEL,
  durationWords,
  exportName,
  optionLetter,
  rowOutcome,
  sheetColumns,
  sheetCounts,
  sheetSummary,
  stateLabel,
} from '../../examStats.js'
import { ConfirmButton, ErrorText, Panel, Spinner } from '../../portalUi.jsx'
import { chipBtnCls } from '../../workUi.jsx'
import { StatusChip } from './ExamsPage.jsx'

// One person's paper, opened from a row of the ranking (ResultsPanel): who
// they are, the grade and the time, then every question in the officers'
// order with the right option and the one they chose (rpc/exam_sheet). A
// taker's own order of questions and options is never shown here.
// It has its own PDF, and the paper can be deleted so the student may start
// again; the database refuses anyone who is not an exam officer.

const STATE_TONE = { handed_in: 'ok', timed_out: 'warn', sitting: 'accent' }

// A paper's state as a chip: the Exam page's one chip (StatusChip), in the
// state's colour. The ranking uses it too.
export function StateChip({ state }) {
  return <StatusChip tone={STATE_TONE[state]}>{stateLabel(state)}</StatusChip>
}

// One figure in a row of figures (inside a <dl>). The overview uses it too.
// A size smaller on the narrowest phones, where two share a line and
// '1 h 58 min' would otherwise break in two.
export function Figure({ label, children }) {
  return (
    <div className="min-w-0 rounded-xl border border-line/10 bg-page p-3">
      <dt className="text-3xs font-semibold uppercase tracking-[0.2em] text-soft/50">{label}</dt>
      <dd className="heading-serif mt-1 break-words text-xl text-ink min-[360px]:text-2xl">{children}</dd>
    </div>
  )
}

const FILTERS = [
  ['all', 'All'],
  ['right', 'Right'],
  ['wrong', 'Wrong'],
  ['blank', 'Not answered'],
  ['flagged', 'Flagged'],
]
const FILTER_NOTE = {
  right: 'The questions answered right only.',
  wrong: 'The questions answered wrong only.',
  blank: 'The questions not answered only.',
  flagged: 'The flagged questions only.',
}

const OUTCOME_CLS = { right: 'text-ok', wrong: 'text-danger', blank: 'text-soft/65' }

function QuestionRow({ row }) {
  const outcome = rowOutcome(row)
  const options = Array.isArray(row.options) ? row.options : []
  return (
    <li className="rounded-xl border border-line/10 bg-sunk/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-soft/55">Question {row.n}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
          <span className={OUTCOME_CLS[outcome]}>{OUTCOME_LABEL[outcome]}</span>
          {row.flagged && <span className="text-warn">Flagged</span>}
        </p>
      </div>
      {/* dir="auto", here and on each option: a question written in Arabic
          reads from the right. */}
      <p dir="auto" className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-ink">
        {row.body}
      </p>
      <ol className="mt-3 space-y-1.5">
        {options.map((text, i) => {
          const right = i === row.correct
          const chosen = i === row.chosen
          return (
            <li
              key={i}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2 text-sm ${
                right ? 'border-emerald-400/50' : chosen ? 'border-red-400/50' : 'border-line/10'
              }`}
            >
              <span className="font-semibold text-soft/60">{optionLetter(i)}</span>
              <span dir="auto" className="min-w-0 flex-1 basis-40 break-words text-soft/85">
                {text}
              </span>
              {(right || chosen) && (
                <span className={`text-xs font-semibold ${right ? 'text-ok' : 'text-danger'}`}>
                  {right && chosen ? 'Chosen, and right' : right ? 'Right answer' : 'Chosen'}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </li>
  )
}

// `rank` is the person's place in the ranking when the ranking is loaded (the
// sheet itself does not carry it), and `tied` says another paper shares it.
// `backTo` is the ranking's address; `onDeleted` runs once the paper is gone.
export default function AttemptSheet({ exam, attemptId, rank = null, tied = false, backTo, onDeleted }) {
  const remove = useDeleteAttempt()
  // From the moment the delete is sent the sheet stops asking for a paper
  // that is about to be gone.
  const sheet = useExamSheet(exam.id, attemptId, !(remove.isPending || remove.isSuccess))
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')

  // Opened from far down the ranking, the sheet would start off the top of the
  // screen: bring its first line into view.
  const top = useRef(null)
  useEffect(() => {
    const el = top.current
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [])

  const back = (
    <Link replace to={backTo} className="text-xs font-semibold text-soft/60 transition-colors hover:text-ink">
      &larr; Back to the ranking
    </Link>
  )

  if (sheet.isPending || !sheet.data?.attempt) {
    return (
      <div ref={top}>
        <Panel>
          {back}
          {sheet.isPending ? (
            <div className="mt-6 flex justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="mt-4">
              <ErrorText>
                Couldn’t load this paper: {sheet.error?.message || 'the database sent nothing back.'}
              </ErrorText>
            </div>
          )}
        </Panel>
      </div>
    )
  }

  const a = sheet.data.attempt
  const rows = Array.isArray(sheet.data.rows) ? sheet.data.rows : []
  const counts = sheetCounts(rows)
  const shown = rows.filter((row) => (filter === 'all' ? true : filter === 'flagged' ? row.flagged : rowOutcome(row) === filter))
  const when = eventWhen({ startsAt: a.started_at, endsAt: a.finished_at })

  const deletePaper = async () => {
    setError('')
    try {
      await remove.mutateAsync(attemptId)
      onDeleted()
    } catch (e) {
      setError(e?.message || 'The paper could not be deleted.')
    }
  }

  return (
    <div ref={top} className="space-y-8">
      <Panel>
        {back}
        {sheet.error && (
          <div className="mt-3">
            <ErrorText>Couldn’t refresh this paper: {sheet.error.message}</ErrorText>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="heading-serif break-words text-2xl text-ink">{a.full_name || 'No name'}</h2>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-soft/60">
              {a.student_id && <span className="break-all">Student ID {a.student_id}</span>}
              {a.faculty_year && <span>{a.faculty_year}</span>}
              {a.email && (
                <a href={`mailto:${a.email}`} className="break-all text-accent hover:text-ink">
                  {a.email}
                </a>
              )}
              {a.phone && (
                <a href={`tel:${a.phone}`} className="hover:text-ink">
                  {a.phone}
                </a>
              )}
            </p>
          </div>
          <ExportButtons
            title={a.full_name || 'Paper'}
            subtitle={`${exam.title}. Each question in the officers’ order, with the right answer and the one chosen. ${
              FILTER_NOTE[filter] || ''
            }`.trim()}
            filename={exportName(exam.title, 'paper', a.student_id)}
            columns={sheetColumns()}
            rows={shown}
            summary={sheetSummary(a, rows.length)}
            csv={false}
          />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Grade">
            {a.score ?? 0} <span className="font-sans text-sm font-normal text-soft/60">of {rows.length}</span>
          </Figure>
          <Figure label="Answered">
            {a.answered ?? 0} <span className="font-sans text-sm font-normal text-soft/60">of {rows.length}</span>
          </Figure>
          <Figure label="Time taken">{durationWords(a.seconds) || '–'}</Figure>
          <Figure label={tied && rank != null ? 'Joint rank' : 'Rank'}>{rank ?? '–'}</Figure>
        </dl>

        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-soft/55">
          <StateChip state={a.state} />
          {when && <span>{when} (Cairo time)</span>}
        </p>
      </Panel>

      <Panel title="Answers">
        <p className="mt-2 text-xs text-soft/55">
          The questions and their options are in the order you wrote them, not the order this student saw.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={chipBtnCls(filter === value)}
            >
              {label} · {counts[value]}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-soft/60">
            {rows.length === 0 ? 'This exam has no questions.' : 'No question of this kind on this paper.'}
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {shown.map((row) => (
              <QuestionRow key={row.question_id ?? row.n} row={row} />
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Delete this paper">
        <p className="mt-3 text-xs text-soft/55">
          Removes this paper and every answer on it. The student can then start again. This cannot be undone.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ConfirmButton
            label="Delete this paper"
            busyLabel="Deleting…"
            busy={remove.isPending}
            disabled={remove.isSuccess}
            onConfirm={deletePaper}
          />
          <ErrorText>{error}</ErrorText>
        </div>
      </Panel>
    </div>
  )
}
