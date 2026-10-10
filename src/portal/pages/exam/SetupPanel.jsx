import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cairoLocalToIso, isoToCairoLocal } from '../../../lib/eventTime.js'
import { useExamMutations } from '../../examQueries.js'
import { examPhase } from '../../examStats.js'
import { ConfirmButton, ErrorText, Field, Panel, Toggle, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { countOf, whenInCairo } from './ExamsPage.jsx'

// The Set-up part of /portal/exam/:id. Whether students can reach the exam,
// its title, times and length, the word in its address, the start code, what
// is still missing before anyone can start, what the first start locks, and
// deleting it. `exam` is the row from examQueries.js, with its counts and
// `started`. The database decides what is allowed and its refusals are shown
// as they are; a field is switched off here only where the database would
// refuse every change to it.

// One of this page's forms. It follows the exam's row: it shows the row, keeps
// unsaved edits when the row changes elsewhere (another officer saved), and
// otherwise takes the row's new values. Saving sends only the columns this
// form changed, so a time nobody touched is never written back, and then
// shows what the database stored (it tidies the word and the code).
//   formFrom(row)      the row as the form holds it
//   columnsFrom(form)  the form as columns of public.exams
//   problem(form)      what is wrong with the form, in words, or ''
function useRowForm(exam, { formFrom, columnsFrom, problem }) {
  const { update } = useExamMutations()
  const [form, setForm] = useState(() => formFrom(exam))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const base = JSON.stringify(formFrom(exam))
  const current = JSON.stringify(form)
  const dirty = current !== base
  const lastBase = useRef(base)
  useEffect(() => {
    if (base !== lastBase.current && current === lastBase.current) setForm(formFrom(exam))
    lastBase.current = base
  }, [base, current, exam, formFrom])

  const change = (key, value) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: value }))
  }
  const set = (key) => (e) => change(key, e.target.value)
  const undo = () => {
    setError('')
    setForm(formFrom(exam))
  }

  const issue = problem(form)
  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (issue) {
      setError(issue)
      return
    }
    const was = columnsFrom(formFrom(exam))
    const patch = Object.fromEntries(Object.entries(columnsFrom(form)).filter(([key, value]) => value !== was[key]))
    if (Object.keys(patch).length === 0) {
      // Only spaces changed: nothing to store.
      undo()
      return
    }
    try {
      const row = await update.mutateAsync({ id: exam.id, patch })
      setForm(formFrom(row))
      setSaved(true)
    } catch (err) {
      setError(err.message || 'The exam could not be saved.')
    }
  }

  return { form, set, change, undo, dirty, issue, saved, error, saving: update.isPending, submit }
}

// Save, Undo, and what happened, under each form.
function FormFoot({ f, savedText = 'Saved.' }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryBtnCls} disabled={f.saving || !f.dirty}>
          {f.saving ? 'Saving…' : 'Save'}
        </button>
        {f.dirty && (
          <button type="button" className={outlineBtnCls} onClick={f.undo}>
            Undo changes
          </button>
        )}
        {f.saved && !f.dirty && <span className="text-xs text-ok">{savedText}</span>}
        {f.dirty && f.issue && <span className="text-xs text-warn">{f.issue}</span>}
      </div>
      <ErrorText>{f.error}</ErrorText>
    </>
  )
}

const lockedCls = 'mt-1.5 text-xs text-warn'
// A field the first start has locked looks switched off, as well as saying so.
const offCls = 'disabled:cursor-not-allowed disabled:opacity-60'

// ---- open to students -------------------------------------------------------

function StatusPanel({ exam }) {
  const { update } = useExamMutations()
  const ready = exam.status === 'ready'
  return (
    <Panel>
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-semibold text-ink">Open to students</p>
          <p className="mt-1 text-xs text-soft/55">
            {ready
              ? 'Students who have the address can sign in, fill in their details and check that their ID is on the list. They can start only between the opening and closing times, with the start code.'
              : 'A draft: the address shows students nothing. Open it once the times are set, so students can sign in and check their ID before the day.'}
          </p>
          {ready && exam.started && <p className={lockedCls}>The exam has started, so it cannot go back to a draft.</p>}
        </div>
        <Toggle
          checked={ready}
          onChange={(v) => update.mutate({ id: exam.id, patch: { status: v ? 'ready' : 'draft' } })}
          label="Open to students"
          disabled={update.isPending || (ready && exam.started)}
        />
      </div>
      {update.error && (
        <div className="mt-3">
          <ErrorText>{update.error.message}</ErrorText>
        </div>
      )}
    </Panel>
  )
}

// ---- title, times and length ------------------------------------------------

const details = {
  // Times are Cairo wall clock in the form ('YYYY-MM-DDTHH:mm') and instants
  // in the database; src/lib/eventTime.js converts, as it does for events.
  formFrom: (row) => ({
    title: row.title || '',
    opens: isoToCairoLocal(row.opens_at),
    closes: isoToCairoLocal(row.closes_at),
    minutes: String(row.minutes ?? ''),
  }),
  columnsFrom: (form) => ({
    title: form.title.trim(),
    opens_at: form.opens ? cairoLocalToIso(form.opens) : null,
    closes_at: form.closes ? cairoLocalToIso(form.closes) : null,
    minutes: Number(form.minutes),
  }),
  problem: (form) => {
    if (!form.title.trim()) return 'An exam needs a title.'
    const opens = form.opens ? cairoLocalToIso(form.opens) : null
    const closes = form.closes ? cairoLocalToIso(form.closes) : null
    if ((form.opens && !opens) || (form.closes && !closes)) return 'One of the times is not a time the form understands.'
    if (opens && closes && Date.parse(closes) <= Date.parse(opens)) return 'The exam must close after it opens.'
    const minutes = Number(form.minutes)
    if (form.minutes === '' || !Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
      return 'The exam’s length must be between 5 and 600 minutes.'
    }
    return ''
  },
}

// What the times and the length mean together, for the form as it stands. The
// exam is not sat in step: the closing time is only the last moment to start,
// and no paper is cut short by it. With both times and a length in the form,
// the note also says when the last paper can end.
function windowNote(form) {
  const opens = form.opens ? cairoLocalToIso(form.opens) : null
  const closes = form.closes ? cairoLocalToIso(form.closes) : null
  const minutes = Number(form.minutes)
  const whole =
    opens && closes && Date.parse(closes) > Date.parse(opens) && Number.isInteger(minutes) && minutes >= 5 && minutes <= 600
  if (!whole) {
    return 'Students can start between the opening and the closing time. Every student has the full length from their own start, so one who starts just before closing still gets all of it.'
  }
  const lastEnd = new Date(Date.parse(closes) + minutes * 60000).toISOString()
  return `Students can start between the opening and the closing time. Every student has the full ${minutes} minutes from their own start, so one who starts just before closing still gets all of it and finishes by ${whenInCairo(lastEnd)}.`
}

function ClearButton({ onClick, label }) {
  return (
    <button type="button" className={`${outlineBtnCls} shrink-0`} onClick={onClick} aria-label={label}>
      Clear
    </button>
  )
}

function DetailsForm({ exam }) {
  const f = useRowForm(exam, details)
  const { form } = f
  const note = windowNote(form)
  return (
    <Panel title="The exam">
      <form onSubmit={f.submit} className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" htmlFor="exam-title" hint="Students see it at the top of the exam.">
            <input id="exam-title" className={inputCls} value={form.title} onChange={f.set('title')} maxLength={140} required />
          </Field>
        </div>

        {/* Each time shares its line with Clear where there is room; on a
            narrow phone Clear drops under the field, which keeps its width. */}
        <Field label="Opens" htmlFor="exam-opens" hint="Cairo time. From this moment a student on the list can start, with the start code.">
          <div className="flex flex-wrap gap-2">
            <input
              id="exam-opens"
              className={`${inputCls} ${offCls} min-w-0 flex-1 basis-52`}
              type="datetime-local"
              value={form.opens}
              onChange={f.set('opens')}
              disabled={exam.started}
            />
            {form.opens && !exam.started && <ClearButton label="Clear the opening time" onClick={() => f.change('opens', '')} />}
          </div>
          {exam.started && <p className={lockedCls}>The exam has started: its opening time cannot change.</p>}
        </Field>
        <Field
          label="Closes"
          htmlFor="exam-closes"
          hint="Cairo time. The last moment a student can start. It does not end a paper that is running."
        >
          <div className="flex flex-wrap gap-2">
            <input
              id="exam-closes"
              className={`${inputCls} min-w-0 flex-1 basis-52`}
              type="datetime-local"
              value={form.closes}
              onChange={f.set('closes')}
            />
            {/* A started exam is open to students, and that needs both times. */}
            {form.closes && !exam.started && <ClearButton label="Clear the closing time" onClick={() => f.change('closes', '')} />}
          </div>
          {exam.started && <p className="mt-1.5 text-xs text-soft/55">You can still move it, earlier or later.</p>}
        </Field>

        <div className="sm:max-w-[14rem]">
          <Field label="Length in minutes" htmlFor="exam-minutes" hint="Every student gets this long from their own start.">
            <input
              id="exam-minutes"
              className={inputCls}
              type="number"
              inputMode="numeric"
              min={exam.started ? exam.minutes : 5}
              max={600}
              step={1}
              value={form.minutes}
              onChange={f.set('minutes')}
              required
            />
          </Field>
          {exam.started && <p className={lockedCls}>The exam has started: it can be made longer, not shorter.</p>}
        </div>
        <p className="self-end text-xs text-soft/55 sm:pb-3">{note}</p>

        <div className="space-y-3 sm:col-span-2">
          <FormFoot f={f} />
        </div>
      </form>
    </Panel>
  )
}

// ---- the address ------------------------------------------------------------

// The database's own rule for the word, and its sentences.
const WORD_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const address = {
  formFrom: (row) => ({ word: row.address_word || '' }),
  columnsFrom: (form) => ({ address_word: form.word.trim().toLowerCase() }),
  problem: (form) => {
    const word = form.word.trim().toLowerCase()
    if (word.length < 6 || word.length > 60 || !WORD_SHAPE.test(word)) {
      return 'The word in the address needs 6 to 60 lower-case letters, digits or hyphens.'
    }
    if (word === 'callback') return 'That word is reserved. Choose another.'
    return ''
  },
}

function randomFrom(alphabet, length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

// Twelve characters, as the database makes for a new exam.
const newWord = () => randomFrom('0123456789abcdef', 12)

// Six letters and digits to read out in a hall: no 0, O, 1 or I, which are
// misheard and misread.
const newCode = () => randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6)

// `label` names what is copied ("Copy the address"), for a screen reader that
// lists the page's buttons; what happened is said in a line of its own.
function CopyButton({ text, label }) {
  const [state, setState] = useState('idle')
  useEffect(() => {
    if (state === 'idle') return undefined
    const t = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(t)
  }, [state])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <>
      <button type="button" className={`${outlineBtnCls} shrink-0`} onClick={copy} aria-label={label}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied.' : state === 'failed' ? 'It could not be copied.' : ''}
      </span>
    </>
  )
}

function AddressForm({ exam }) {
  const f = useRowForm(exam, address)
  // The address as it works now; an unsaved word is not in it yet. Shown as
  // text to copy, never as a link: nothing on the site links to an exam.
  const url = `${window.location.origin}/exam/${exam.address_word}`
  return (
    <Panel title="The address">
      <p className="mt-2 text-xs text-soft/55">
        Send this address to the registered students. Nothing on the site links to it, and it shows nothing until the
        exam is open to students.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line/10 bg-sunk/40 p-3">
        <code className="min-w-0 flex-1 break-all text-sm text-ink">{url}</code>
        <CopyButton text={url} label="Copy the address" />
      </div>

      <form onSubmit={f.submit} className="mt-5 space-y-3">
        <Field
          label="The word at the end"
          htmlFor="exam-word"
          hint="6 to 60 lower-case letters, digits or hyphens. A new word makes the old address stop working, so send the new one to everyone."
        >
          <div className="flex flex-wrap gap-2">
            <input
              id="exam-word"
              className={`${inputCls} ${offCls} min-w-0 flex-1 basis-48`}
              value={f.form.word}
              onChange={f.set('word')}
              maxLength={60}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              disabled={exam.started}
              required
            />
            <button type="button" className={`${outlineBtnCls} shrink-0`} onClick={() => f.change('word', newWord())} disabled={exam.started}>
              Make a new word
            </button>
          </div>
          {exam.started && <p className={lockedCls}>The exam has started: the word in its address cannot change.</p>}
        </Field>
        <FormFoot f={f} savedText="Saved. The address above is the one that works now." />
      </form>
    </Panel>
  )
}

// ---- the start code ---------------------------------------------------------

const startCode = {
  formFrom: (row) => ({ code: row.start_code || '' }),
  columnsFrom: (form) => ({ start_code: form.code }),
  // The database stores the code in capitals with its spaces dropped.
  problem: (form) => (form.code.replace(/\s+/g, '').length > 40 ? 'The start code can have at most 40 characters.' : ''),
}

function StartCodeForm({ exam }) {
  const f = useRowForm(exam, startCode)
  return (
    <Panel title="Start code">
      <p className="mt-2 text-xs text-soft/55">
        Read it out in the hall. You can change it at any moment. A student on the list types it to start, so the exam
        cannot be sat from somewhere else. Capitals and spaces do not matter. A student who has already started is not
        asked for it again.
      </p>
      {exam.start_code ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 break-all font-mono text-2xl tracking-[0.3em] text-ink">
            <span className="sr-only">The code now: </span>
            {exam.start_code}
          </p>
          <CopyButton text={exam.start_code} label="Copy the start code" />
        </div>
      ) : (
        <p className="mt-4 text-sm text-warn">No start code yet: nobody can start.</p>
      )}

      <form onSubmit={f.submit} className="mt-5 space-y-3">
        <Field label="Code" htmlFor="exam-code">
          <div className="flex flex-wrap gap-2">
            <input
              id="exam-code"
              className={`${inputCls} min-w-0 flex-1 basis-48 font-mono`}
              value={f.form.code}
              onChange={f.set('code')}
              maxLength={60}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className={`${outlineBtnCls} shrink-0`} onClick={() => f.change('code', newCode())}>
              Make a code
            </button>
          </div>
        </Field>
        <FormFoot f={f} savedText={exam.start_code ? 'Saved. This is the code from now on.' : 'Saved. Without a code nobody can start.'} />
      </form>
    </Panel>
  )
}

// ---- what is still missing --------------------------------------------------

function Mark({ done }) {
  return done ? (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-ok" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-warn" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
    </svg>
  )
}

const tabLinkCls = 'font-semibold text-accent hover:text-ink'

function Checklist({ exam }) {
  const items = [
    {
      done: exam.questions > 0,
      text: exam.questions > 0 ? countOf(exam.questions, 'question') : 'No questions yet',
      tab: 'questions',
      link: 'Questions',
    },
    {
      done: exam.registrations > 0,
      text: exam.registrations > 0 ? `${countOf(exam.registrations, 'student ID')} on the list` : 'No student IDs on the list yet',
      tab: 'list',
      link: 'Registered list',
    },
    {
      done: Boolean(exam.opens_at && exam.closes_at),
      // Said without a tense, so it is as true after the times as before them.
      text:
        exam.opens_at && exam.closes_at
          ? `Opening time ${whenInCairo(exam.opens_at)}, closing time ${whenInCairo(exam.closes_at)}`
          : 'The opening and closing times are not both set',
    },
    {
      done: Boolean(exam.start_code),
      text: exam.start_code ? 'The start code is set' : 'No start code yet',
    },
    {
      done: exam.status === 'ready',
      text: exam.status === 'ready' ? 'Open to students' : 'Still a draft: students cannot reach it',
    },
  ]
  const missing = items.filter((i) => !i.done).length
  // With nothing missing, what that means by the clock. (Nothing missing
  // includes being open to students, so the phase is never 'draft' here.)
  const phase = examPhase(exam, Date.now())
  const ready =
    phase === 'before'
      ? { text: `Nothing is missing. Students on the list can start from ${whenInCairo(exam.opens_at)}.`, cls: 'text-ok' }
      : phase === 'open'
        ? { text: `Nothing is missing. Students on the list can start now, until ${whenInCairo(exam.closes_at)}.`, cls: 'text-ok' }
        : { text: 'The closing time has passed, so nobody else can start.', cls: 'text-soft/60' }
  return (
    <Panel title="Before students can start">
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-2.5 text-sm text-soft/80">
            <Mark done={item.done} />
            <span className="min-w-0">
              <span className="sr-only">{item.done ? 'Done: ' : 'Missing: '}</span>
              {item.text}
              {item.tab && !item.done && (
                <>
                  {'. '}
                  <Link to={`?tab=${item.tab}`} className={tabLinkCls}>
                    {item.link} &rarr;
                  </Link>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-4 text-xs ${missing ? 'text-warn' : ready.cls}`}>
        {missing ? `${missing === 1 ? 'One thing is' : `${missing} things are`} still missing.` : ready.text}
      </p>
    </Panel>
  )
}

// ---- what the first start locks ---------------------------------------------

function LockedNote({ exam }) {
  return (
    <Panel title={exam.started ? 'The exam has started' : 'Once the first student starts'}>
      <p className="mt-3 text-xs text-soft/55">
        {exam.started
          ? `${countOf(exam.attempts, 'student has', 'students have')} started. From the first start on:`
          : 'From the moment the first student starts:'}
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-soft/80">
        <li>The opening time cannot change.</li>
        <li>The exam can be made longer, not shorter.</li>
        <li>The exam cannot go back to a draft.</li>
        <li>The word in its address cannot change.</li>
        <li>Questions can no longer be added, removed or reworded. A right answer can still be corrected.</li>
        <li>The ID of a student who has started stays on the list.</li>
      </ul>
      <p className="mt-3 text-xs text-soft/55">
        The closing time and the start code can change at any moment, before and after. Moving the closing time never
        cuts a running paper short: it only decides who can still start.
      </p>
    </Panel>
  )
}

// ---- deleting ---------------------------------------------------------------

function DeletePanel({ exam }) {
  const navigate = useNavigate()
  const { remove } = useExamMutations()
  const deleteExam = async () => {
    try {
      await remove.mutateAsync(exam.id)
      navigate('/portal/exam', { replace: true })
    } catch {
      // The refusal is shown under the button.
    }
  }
  return (
    <Panel title="Delete this exam">
      <p className="mt-3 text-xs text-soft/55">
        Removes the exam, its questions, the list of IDs and every paper. Download the results first if anyone has sat
        it. This cannot be undone.
      </p>
      <div className="mt-4">
        <ConfirmButton
          label="Delete this exam"
          confirmLabel="Click again to delete everything"
          busyLabel="Deleting…"
          onConfirm={deleteExam}
          busy={remove.isPending}
        />
      </div>
      {remove.error && (
        <div className="mt-3">
          <ErrorText>{remove.error.message}</ErrorText>
        </div>
      )}
    </Panel>
  )
}

export default function SetupPanel({ exam }) {
  return (
    // Two columns on a wide screen: the forms, and beside them what is missing
    // and what the first start locks. On a phone what is missing comes first
    // and what is locked last. What is missing is also first in the page
    // itself, so a keyboard and a screen reader reach it before the forms
    // (and well before "Delete this exam"); the grid alone puts it on the right.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        <Checklist exam={exam} />
      </div>
      <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <StatusPanel exam={exam} />
        <DetailsForm exam={exam} />
        <AddressForm exam={exam} />
        <StartCodeForm exam={exam} />
        <DeletePanel exam={exam} />
      </div>
      <div className="min-w-0 lg:col-start-2 lg:row-start-2">
        <LockedNote exam={exam} />
      </div>
    </div>
  )
}
