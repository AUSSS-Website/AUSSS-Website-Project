import { useMemo, useRef, useState } from 'react'
import ExportButtons from '../../ExportButtons.jsx'
import SortableList from '../../SortableList.jsx'
import { dateStamp, downloadText, toCsv } from '../../exportFile.js'
import {
  MAX_OPTIONS,
  OPTION_LETTERS,
  dropOption,
  letterOf,
  parseQuestionFile,
  questionColumns,
  questionProblem,
  questionTemplateCsv,
} from '../../examFile.js'
import { useExamQuestions, useQuestionMutations } from '../../examQueries.js'
import { ConfirmButton, ErrorText, Field, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { StatusChip, countOf } from './ExamsPage.jsx'

// The Questions part of /portal/exam/:id. The questions in the officers' order
// with the right option marked, one form to add or change a question, removing
// and reordering, importing questions from a spreadsheet (examFile.js reads
// it) and exporting them as a PDF or a CSV. `exam` is the row from
// examQueries.js. Each student gets the questions, and each question's
// options, in an order of their own; the order here is only the officers'.
//
// Once the first student has started, the database lets nothing change but a
// question's right answer and its place in this list, so the form then offers
// only the right answer and says why.

const NO_QUESTIONS = []
const BLANK = { body: '', options: ['', '', '', ''], correct: null, keepOrder: false }

function formFrom(question) {
  if (!question) return BLANK
  return {
    body: question.body,
    options: [...question.options],
    correct: question.correct,
    keepOrder: Boolean(question.keep_option_order),
  }
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// The one form for a question: a new one (no `question`; it is added at the
// end and the form empties for the next) or one being changed (`onDone` closes
// it). `number` is the question's place in the list.
function QuestionForm({ exam, question = null, number, onDone }) {
  const { save } = useQuestionMutations(exam.id)
  const [form, setForm] = useState(() => formFrom(question))
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const bodyRef = useRef(null)
  // After the first start only the right answer may differ.
  const keyOnly = Boolean(question) && exam.started
  const prefix = `q-${question?.id || 'new'}`
  // With only the right answer open, everything else is the question as it is
  // stored, whatever was typed into the form before the exam started.
  const work = keyOnly ? { ...formFrom(question), correct: form.correct } : form
  const dirty = JSON.stringify(work) !== JSON.stringify(formFrom(question))

  const patch = (next) => {
    setNote('')
    setForm((f) => ({ ...f, ...next }))
  }
  const setOption = (index, value) => patch({ options: form.options.map((o, i) => (i === index ? value : o)) })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setNote('')
    const issue = questionProblem(work)
    if (issue) {
      setError(issue)
      return
    }
    try {
      await save.mutateAsync({
        id: question?.id ?? null,
        // With only the right answer open, the rest goes back exactly as it is stored.
        body: keyOnly ? question.body : form.body.trim(),
        options: keyOnly ? question.options : form.options.map((o) => o.trim()),
        correct: work.correct,
        keepOrder: keyOnly ? Boolean(question.keep_option_order) : form.keepOrder,
      })
      if (question) {
        onDone?.()
        return
      }
      setForm(BLANK)
      setNote('Added at the end of the list.')
      bodyRef.current?.focus()
    } catch (err) {
      setError(err.message || 'The question could not be saved.')
    }
  }

  const foot = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryBtnCls} disabled={save.isPending || (Boolean(question) && !dirty)}>
          {save.isPending ? 'Saving…' : !question ? 'Add question' : keyOnly ? 'Save the right answer' : 'Save'}
        </button>
        {question && (
          <button type="button" className={outlineBtnCls} onClick={onDone}>
            Cancel
          </button>
        )}
        {note && (
          <span className="text-xs text-ok" role="status">
            {note}
          </span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </>
  )

  // After the first start: the question and its options as text that wraps, so
  // every option can be read whole, with only the choice of the right one to
  // make. Why comes first, before the choice.
  if (keyOnly) {
    return (
      <form onSubmit={submit} className="space-y-5">
        <p className="text-xs text-warn">
          The exam has started, so this question’s text and options are fixed. You can still correct its right answer:
          every paper is marked against it the next time the results are read.
        </p>
        <fieldset className="min-w-0">
          <legend className="block text-xs font-semibold uppercase tracking-[0.2em] text-accent">Question {number}</legend>
          {/* dir="auto", here and on each option: a question written in Arabic
              reads from the right, with its full stop at the right end. */}
          <p dir="auto" className="mt-3 whitespace-pre-wrap break-words text-sm font-semibold text-ink">
            {question.body}
          </p>
          <p className="mb-3 mt-4 text-xs text-soft/50">Choose the right option.</p>
          <ul className="space-y-2">
            {work.options.map((option, i) => {
              const right = work.correct === i
              return (
                <li key={i} className={`rounded-xl border ${right ? 'border-emerald-400/50' : 'border-line/10'}`}>
                  <label className="flex cursor-pointer items-start gap-3 p-3 text-sm">
                    <input
                      type="radio"
                      name={`${prefix}-right`}
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={right}
                      onChange={() => patch({ correct: i })}
                    />
                    <span className="w-4 shrink-0 font-semibold text-ink">{letterOf(i)}</span>
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block whitespace-pre-wrap break-words text-soft/85">
                        {option}
                      </span>
                      {right && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-ok">
                          <Tick />
                          Right answer
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>
        <p className="text-xs text-soft/55">
          {question.keep_option_order
            ? 'Keeps its options in order: every student sees them as written here.'
            : 'Each student gets these options in an order of their own.'}
        </p>
        {foot}
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-5">
      <Field label={question ? `Question ${number}` : 'Question'} htmlFor={`${prefix}-body`}>
        {/* Where the browser can, the box grows with a long question, so all of
            it is in view while it is being changed. */}
        <textarea
          id={`${prefix}-body`}
          ref={bodyRef}
          className={`${inputCls} min-h-[5.5rem] [field-sizing:content]`}
          value={form.body}
          onChange={(e) => patch({ body: e.target.value })}
          maxLength={2000}
          required
        />
      </Field>

      <fieldset className="min-w-0">
        <legend className="block text-xs font-semibold uppercase tracking-[0.2em] text-accent">Options</legend>
        <p className="mb-3 mt-1 text-xs text-soft/50">
          Between two and six. Choose the right one with the button beside its letter.
        </p>
        <ul className="space-y-2">
          {form.options.map((option, i) => {
            const letter = letterOf(i)
            const right = form.correct === i
            return (
              // On a phone the option's text has a line to itself, under its
              // letter: beside the letter and the cross it would show a dozen
              // characters of a sentence. From a tablet up they share one line.
              <li
                key={i}
                className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 ${right ? 'border-emerald-400/50' : 'border-line/10'}`}
              >
                <label className="flex shrink-0 cursor-pointer items-center gap-2 pl-1 text-sm font-semibold text-ink">
                  <input
                    type="radio"
                    name={`${prefix}-right`}
                    className="h-4 w-4"
                    checked={right}
                    onChange={() => patch({ correct: i })}
                  />
                  <span aria-hidden="true">{letter}</span>
                  <span className="sr-only">Option {letter} is the right answer</span>
                </label>
                <input
                  className={`${inputCls} order-last min-w-0 basis-full sm:order-none sm:flex-1`}
                  value={option}
                  onChange={(e) => setOption(i, e.target.value)}
                  maxLength={500}
                  aria-label={`Option ${letter}`}
                />
                {right && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ok">
                    <Tick />
                    Right answer
                  </span>
                )}
                {form.options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => patch(dropOption(form.options, form.correct, i))}
                    className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full text-soft/55 transition-colors hover:bg-veil/10 hover:text-danger"
                    aria-label={`Take option ${letter} out`}
                    title={`Take option ${letter} out`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {form.options.length < MAX_OPTIONS && (
          <button type="button" className={`${outlineBtnCls} mt-3`} onClick={() => patch({ options: [...form.options, ''] })}>
            Add an option
          </button>
        )}
      </fieldset>

      <div>
        <label className="flex items-start gap-2 text-sm text-soft/80">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.keepOrder}
            onChange={(e) => patch({ keepOrder: e.target.checked })}
          />
          <span>Keep the options in this order (for a last option such as ‘All of the above’)</span>
        </label>
        <p className="mt-1 pl-6 text-xs text-soft/50">Otherwise each student gets them in an order of their own.</p>
      </div>

      {foot}
    </form>
  )
}

// One question as the list shows it, or its form while it is being changed.
function QuestionRow({ exam, question, number, handle, editing, onEdit, onDone, onRemove, removing }) {
  if (editing) {
    return (
      <div className="p-4">
        <QuestionForm exam={exam} question={question} number={number} onDone={onDone} />
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 p-3 sm:gap-3">
      {handle}
      <div className="min-w-0 flex-1">
        {/* dir="auto" on the text alone: a question or an option written in
            Arabic keeps its own direction after the number or the letter. */}
        <p className="whitespace-pre-wrap break-words text-sm font-semibold text-ink">
          <span className="mr-1.5 text-soft/55">{number}.</span>
          <span dir="auto">{question.body}</span>
        </p>
        <ol className="mt-2 space-y-1">
          {question.options.map((option, i) => {
            const right = i === question.correct
            return (
              <li key={i} className={`flex items-start gap-2 text-sm ${right ? 'font-semibold text-ok' : 'text-soft/70'}`}>
                <span className="w-4 shrink-0">{letterOf(i)}</span>
                <span className="min-w-0 break-words">
                  <span dir="auto">{option}</span>
                  {right && (
                    <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap text-xs">
                      <Tick />
                      Right answer
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {question.keep_option_order && <StatusChip>Keeps its options in order</StatusChip>}
          {question.correct == null && <StatusChip tone="warn">No right answer set</StatusChip>}
          {/* Each row's buttons say which question they are for, for a screen
              reader that lists the page's buttons. */}
          <button
            type="button"
            className={outlineBtnCls}
            onClick={onEdit}
            aria-label={exam.started ? `Correct the answer to question ${number}` : `Edit question ${number}`}
          >
            {exam.started ? 'Correct the answer' : 'Edit'}
          </button>
          {!exam.started && (
            <ConfirmButton
              variant="text"
              label="Remove"
              ariaLabel={`Remove question ${number}`}
              confirmLabel="Click again to remove"
              busyLabel="Removing…"
              onConfirm={onRemove}
              busy={removing}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// How many refused rows are listed before "and N more".
const PROBLEMS_SHOWN = 15

function ImportPanel({ exam }) {
  const { importRows } = useQuestionMutations(exam.id)
  const fileRef = useRef(null)
  const [reading, setReading] = useState(false)
  const [problems, setProblems] = useState([])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const busy = reading || importRows.isPending

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setProblems([])
    setNote('')
    setError('')
    setReading(true)
    try {
      const read = await parseQuestionFile(file)
      if (read.problems.length > 0) {
        setProblems(read.problems)
        return
      }
      const added = await importRows.mutateAsync(read.rows)
      setNote(`Added ${countOf(added, 'question')} from ${file.name}.`)
    } catch (err) {
      setError(err?.message || 'That file could not be imported.')
    } finally {
      setReading(false)
    }
  }

  return (
    <Panel title="From a spreadsheet">
      <p className="mt-2 text-xs text-soft/55">
        An .xlsx or .csv file with one question on each row, in these columns: Question, Option A to Option F, Answer,
        Keep order. Answer is the right option’s letter (A to F), its number (1 to 6) or its exact text. Keep order is
        “yes” for a question whose options must stay as written, and blank otherwise. Leave the options a question
        does not use empty. The questions are added after the ones already here, and nothing is imported unless
        every row is good.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={onFile} className="hidden" />
        <button type="button" className={outlineBtnCls} disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Importing…' : 'Import from a spreadsheet'}
        </button>
        <button
          type="button"
          className={outlineBtnCls}
          onClick={() => downloadText('exam-questions-template.csv', questionTemplateCsv())}
        >
          Download a template
        </button>
      </div>
      {note && (
        <p className="mt-3 text-sm text-ok" role="status">
          {note}
        </p>
      )}
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {problems.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-red-400/40 p-4">
          <p className="text-sm font-semibold text-danger">
            Nothing was imported. Put {problems.length === 1 ? 'this' : 'these'} right in the file and choose it again.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-soft/80">
            {problems.slice(0, PROBLEMS_SHOWN).map((problem) => (
              <li key={problem} className="break-words">
                {problem}
              </li>
            ))}
          </ul>
          {problems.length > PROBLEMS_SHOWN && (
            <p className="mt-2 text-xs text-soft/60">And {problems.length - PROBLEMS_SHOWN} more.</p>
          )}
        </div>
      )}
    </Panel>
  )
}

// The PDF, for reading: each question numbered, its options, the right one.
const pdfColumns = [
  { label: 'Question', value: (q) => `${q.n}. ${q.body}` },
  ...OPTION_LETTERS.map((letter, i) => ({ label: `Option ${letter}`, value: (q) => q.options[i] ?? '' })),
  {
    label: 'Right answer',
    value: (q) => (q.correct == null ? 'Not set' : `${letterOf(q.correct)}. ${q.options[q.correct] ?? ''}`),
  },
  { label: 'Order of options', value: (q) => (q.keep_option_order ? 'Kept as written' : '') },
]

export default function QuestionsPanel({ exam }) {
  const questions = useExamQuestions(exam.id)
  const { remove, reorder } = useQuestionMutations(exam.id)
  const [editing, setEditing] = useState(null) // the id of the question whose form is open
  // The same array from one render to the next, so the list keeps a row where
  // it was dropped until the new order arrives.
  const list = questions.data ?? NO_QUESTIONS
  const numberOf = useMemo(() => new Map(list.map((q, i) => [q.id, i + 1])), [list])

  return (
    <div className="space-y-8">
      {exam.started ? (
        <Panel>
          <p className="text-sm text-warn">
            The exam has started: questions can no longer be added, removed or reworded. You can still correct a right
            answer.
          </p>
          <p className="mt-2 text-xs text-soft/55">
            A corrected answer counts at once: every paper, handed in or not, is marked against it the next time the
            results are read. The questions can still be dragged into another order here; each student keeps the order
            they were given.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="New question">
            <QuestionForm exam={exam} />
          </Panel>
          <ImportPanel exam={exam} />
        </>
      )}

      <Panel title={list.length > 0 ? `Questions (${list.length})` : 'Questions'}>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 basis-full text-xs text-soft/55 sm:flex-1 sm:basis-64">
            In your order: drag a question by its handle to move it. Each student gets the questions, and the options
            of each, in an order of their own.
          </p>
          {/* The PDF numbers the questions for reading. The CSV has the columns
              the import reads, so it can be imported into another exam as it is. */}
          <span className="inline-flex flex-wrap items-center gap-2">
            <ExportButtons
              title="Exam questions and right answers"
              subtitle={`${exam.title}. This file holds the right answers: keep it away from students.`}
              filename="exam-questions"
              columns={pdfColumns}
              rows={list.map((q) => ({ ...q, n: numberOf.get(q.id) }))}
              layout="records"
              csv={false}
            />
            <button
              type="button"
              className={outlineBtnCls}
              disabled={list.length === 0}
              onClick={() => downloadText(`exam-questions-${dateStamp()}.csv`, toCsv(questionColumns, list))}
            >
              Export CSV
            </button>
          </span>
        </div>

        {(reorder.error || remove.error) && (
          <div className="mt-3">
            <ErrorText>{(reorder.error || remove.error).message}</ErrorText>
          </div>
        )}

        {/* A read that failed after one that worked: the list stays, and with
            it a question's open form and what was typed into it. */}
        {questions.error && questions.data && (
          <div className="mt-3">
            <ErrorText>Couldn’t refresh the questions: {questions.error.message}</ErrorText>
          </div>
        )}

        {questions.isPending ? (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        ) : !questions.data ? (
          <div className="mt-4">
            <ErrorText>Couldn’t load the questions: {questions.error?.message || 'the database sent nothing back.'}</ErrorText>
          </div>
        ) : list.length === 0 ? (
          <p className="mt-4 text-sm text-soft/60">No questions yet. Add one above, or import them from a spreadsheet.</p>
        ) : (
          <SortableList
            items={list}
            getId={(q) => q.id}
            getLabel={(q) => `question ${numberOf.get(q.id)}`}
            onReorder={(ids) => reorder.mutate({ questions: list, ids })}
            className="mt-4 grid gap-3"
            itemClassName="min-w-0 rounded-2xl border border-line/10 bg-sunk/40"
            renderItem={(q, handle) => (
              <QuestionRow
                exam={exam}
                question={q}
                number={numberOf.get(q.id)}
                handle={handle}
                editing={editing === q.id}
                onEdit={() => setEditing(q.id)}
                onDone={() => setEditing(null)}
                onRemove={() => remove.mutate(q.id)}
                removing={remove.isPending && remove.variables === q.id}
              />
            )}
          />
        )}
      </Panel>
    </div>
  )
}
