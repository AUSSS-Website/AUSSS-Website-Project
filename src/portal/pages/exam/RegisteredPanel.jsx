import { useDeferredValue, useMemo, useRef, useState } from 'react'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { errorText } from '../../../lib/errorText.js'
import ExportButtons from '../../ExportButtons.jsx'
import { MAX_IDS, addedSentence, doubtSentence, doubtfulIds, idsFromText, parseIdFile, tidyId } from '../../examFile.js'
import { useRegistrationMutations, useRegistrations } from '../../examQueries.js'
import { examPhase, readProblem, typedCell } from '../../examStats.js'
import { ConfirmButton, ErrorText, Field, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { RefreshButton, StatusChip, confirmReachCls, countOf, tapCls, whenInCairo } from './ExamsPage.jsx'

// The Registered list part of /portal/exam/:id. The student IDs that may sit
// the exam: adding them by pasting or from a file (examFile.js reads both),
// the list with who holds each ID and whether they have started, releasing an
// ID from the account that holds it, removing one, and the export. `exam` is
// the row from examQueries.js. Registration itself happens outside the site;
// no student can read this list, and the database tells each one only whether
// their own ID is on it.

const NO_ROWS = []
const PAGE_SIZE = 100

// The holder's name and address are what a student typed, so they go through
// typedCell: a spreadsheet must never read one of them as a formula.
const exportColumns = [
  { label: 'Student ID', value: (r) => r.student_id },
  { label: 'Held by', value: (r) => typedCell(r.holder?.full_name) },
  { label: 'Email', value: (r) => typedCell(r.holder?.email) },
  { label: 'Held since (Cairo time)', value: (r) => (r.holder ? whenInCairo(r.claimed_at) : '') },
  { label: 'Started', value: (r) => (r.started ? 'yes' : '') },
  { label: 'Added (Cairo time)', value: (r) => whenInCairo(r.created_at) },
]

function AddPanel({ exam }) {
  const { add } = useRegistrationMutations(exam.id)
  const fileRef = useRef(null)
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  // A list held back because part of it does not look like student IDs:
  // { ids, odd, pasted }. The database would add every item as an ID, so the
  // officer says first what to do with the doubtful ones.
  const [doubt, setDoubt] = useState(null)
  const boxRef = useRef(null)
  const busy = reading || add.isPending
  // A tab closed while a list is on its way leaves the officer not knowing
  // whether it went in: the browser asks first.
  useLeaveWarning(busy)

  // Sends a list to the database and says what it did with it. Answers true
  // when the list was taken.
  const send = async (ids) => {
    if (ids.length === 0) {
      setError('There are no IDs in that.')
      return false
    }
    if (ids.length > MAX_IDS) {
      // The database's own sentence, with what this list holds.
      setError(`Add at most ${MAX_IDS} IDs at a time. This list has ${ids.length}: add it in parts.`)
      return false
    }
    setNote(addedSentence(await add.mutateAsync(ids)))
    return true
  }

  // Sends a list unless part of it does not look like IDs (a heading or a
  // column of names pasted along, several IDs run together on one line): then
  // it is held back and the page asks. `pasted` says where it came from.
  const offer = async (ids, pasted) => {
    const odd = doubtfulIds(ids)
    if (odd.length === 0) return send(ids)
    setDoubt({ ids, odd, pasted })
    return false
  }

  const run = async (fn) => {
    setNote('')
    setError('')
    setDoubt(null)
    try {
      await fn()
    } catch (err) {
      // examFile.js's own sentences and the database's refusals are shown as
      // written; the spreadsheet reader's and the browser's words are not.
      setError(errorText(err, 'The IDs could not be added.'))
    }
  }

  const submit = (e) => {
    e.preventDefault()
    // An empty box: said under the form, with the box in focus to be filled.
    if (!text.trim()) boxRef.current?.focus()
    run(async () => {
      if (await offer(idsFromText(text), true)) setText('')
    })
  }

  const onFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      setReading(true)
      try {
        await offer(await parseIdFile(file), false)
      } finally {
        setReading(false)
      }
    })
  }

  // The held list after all: whole, or without its doubtful items.
  const sendHeld = (ids) => {
    const { pasted } = doubt
    run(async () => {
      if ((await send(ids)) && pasted) setText('')
    })
  }
  const sure = doubt ? doubt.ids.filter((id) => !doubt.odd.includes(id)) : []

  return (
    <Panel title="Add student IDs">
      <p className="mt-2 text-xs text-soft/55">
        Only a student whose ID is on this list can start the exam. Spaces, hyphens and Arabic numerals inside an ID
        make no difference: 2023-1234, 2023 1234 and ٢٠٢٣١٢٣٤ are the same ID. Adding an ID that is already here
        changes nothing.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <Field
          label="Paste the IDs"
          htmlFor="exam-ids"
          hint="One on each line. Commas, semicolons and tabs also separate them."
        >
          <textarea
            id="exam-ids"
            ref={boxRef}
            className={`${inputCls} min-h-[8rem] font-mono`}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              // "Added 396." was about the last list, not the one being typed,
              // and so was whatever was wrong with it.
              setNote('')
              setError('')
              // A held paste is no longer what the box holds.
              if (doubt?.pasted) setDoubt(null)
            }}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
          />
        </Field>
        {/* "Add to the list" is not switched off for an empty box: pressed, it
            says there are no IDs in it, which a dimmed button cannot. */}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={busy}>
            {add.isPending && !reading ? 'Adding…' : 'Add to the list'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={onFile} className="hidden" />
          <button type="button" className={`${outlineBtnCls} ${tapCls}`} disabled={busy} onClick={() => fileRef.current?.click()}>
            {reading ? 'Adding…' : 'Add from a file'}
          </button>
          <span className="text-xs text-soft/50">
            A file gives its first column (.xlsx or .csv); a first cell with no digit is taken as a heading.
          </span>
        </div>
        {doubt && (
          <div role="alert" className="rounded-xl border border-amber-400/50 p-4">
            <p className="break-words text-sm font-semibold text-warn">Nothing has been added yet. {doubtSentence(doubt.odd)}</p>
            <p className="mt-1 text-xs text-soft/60">
              {doubt.odd.length === 1 ? 'It has' : 'Each has'} no digit in it, is too long to be one ID, or holds a
              character that could not be read. Put the list right and add it again, or choose what to add.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sure.length > 0 && (
                <button type="button" className={`${outlineBtnCls} ${tapCls}`} disabled={busy} onClick={() => sendHeld(sure)}>
                  Add the other {sure.length}
                </button>
              )}
              <button type="button" className={`${outlineBtnCls} ${tapCls}`} disabled={busy} onClick={() => sendHeld(doubt.ids)}>
                Add all {doubt.ids.length} as they are
              </button>
            </div>
          </div>
        )}
        {/* In the page from the start, so a screen reader says it when it comes. */}
        <p role="status" className={note ? 'text-sm text-ok' : 'sr-only'}>
          {note}
        </p>
        <ErrorText>{error}</ErrorText>
      </form>
    </Panel>
  )
}

// `acting` is 'release' or 'remove' while the database is asked about this
// row, and `error` is what it answered when it refused. Both belong to the row
// alone: the other rows of the list stay as they are meanwhile.
function Row({ row, onRelease, onRemove, acting, error }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line/10 bg-sunk/40 p-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-all font-mono text-sm font-semibold text-ink">{row.student_id}</p>
        {row.holder ? (
          // The address stays whole where a line can hold it (the officers
          // read it to tell accounts apart); only one too long for a line is cut.
          <p className="mt-0.5 break-words text-xs text-soft/65">
            {row.holder.full_name || 'No name yet'}
            {row.holder.email && <span className="text-soft/50"> · {row.holder.email}</span>}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-soft/50">No account holds it yet</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {row.started ? <StatusChip tone="ok">Started</StatusChip> : row.holder && <StatusChip tone="accent">Held</StatusChip>}
        {/* Once a student has started, the database refuses both. Each button
            names its ID, for a screen reader that lists the page's buttons. */}
        {row.holder && !row.started && (
          <span className={confirmReachCls}>
            <ConfirmButton
              variant="text"
              label="Release"
              ariaLabel={`Release ${row.student_id}`}
              confirmLabel="Click again to release"
              busyLabel="Releasing…"
              onConfirm={onRelease}
              busy={acting === 'release'}
              disabled={Boolean(acting)}
              title="Frees the ID from this account, so the student can take it with another"
            />
          </span>
        )}
        {!row.started && (
          <span className={confirmReachCls}>
            <ConfirmButton
              variant="text"
              label="Remove"
              ariaLabel={`Remove ${row.student_id}`}
              confirmLabel="Click again to remove"
              busyLabel="Removing…"
              onConfirm={onRemove}
              busy={acting === 'remove'}
              disabled={Boolean(acting)}
            />
          </span>
        )}
      </div>
      {error && (
        <div className="basis-full">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </li>
  )
}

export default function RegisteredPanel({ exam }) {
  const registrations = useRegistrations(exam.id, exam)
  const { release, remove } = useRegistrationMutations(exam.id)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  // What the database refused, and for which row: { id, studentId, text }.
  const [refused, setRefused] = useState(null)
  // The rows the database is being asked about, each with what was asked:
  // { [row id]: 'release' | 'remove' }. Several can be on their way at once.
  const [acting, setActing] = useState({})
  const listRef = useRef(null)
  const term = useDeferredValue(q)

  // A list that was read once stays on the page when a later read fails.
  const known = Array.isArray(registrations.data)
  const rows = known ? registrations.data : NO_ROWS
  const held = rows.filter((r) => r.holder).length
  const started = rows.filter((r) => r.started).length
  // The search compares the way the database compares IDs (tidyId): case,
  // spaces, the marks people put inside an ID and Arabic numerals make no
  // difference, so 20231234 finds ٢٠٢٣-١٢٣٤. Names and emails go the same way.
  const matches = useMemo(() => {
    const needle = tidyId(term)
    if (!needle) return rows
    return rows.filter((r) => [r.student_id, r.holder?.full_name, r.holder?.email].some((v) => tidyId(v).includes(needle)))
  }, [rows, term])
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const at = Math.min(page, pages - 1)
  const visible = matches.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE)
  const live = examPhase(exam, Date.now()) === 'open'

  // Asks the database to release or remove one row. Only that row is busy
  // meanwhile, and a refusal is shown in that row, as the database wrote it.
  const act = async (kind, { id, student_id: studentId }) => {
    setRefused(null)
    setActing((now) => ({ ...now, [id]: kind }))
    try {
      await (kind === 'release' ? release : remove).mutateAsync(id)
    } catch (err) {
      setRefused({ id, studentId, text: errorText(err, 'That did not work.') })
    } finally {
      setActing((now) => {
        const rest = { ...now }
        delete rest[id]
        return rest
      })
    }
  }
  // A refusal whose row has gone from the screen meanwhile (another officer
  // removed it, or the list grew shorter above it) is said above the list, with
  // the ID it was about. A search or another page of the list takes the
  // refusal away instead: it was read in its row, and above the list it would
  // be a sentence about nobody.
  const refusedOffScreen =
    refused && !visible.some((row) => row.id === refused.id) ? `${refused.studentId}: ${refused.text}` : ''

  // Previous and Next sit at the foot of a long page: the new page starts at
  // its top (the site's own scroll padding keeps the search box in view above it).
  const turn = (to) => {
    setRefused(null)
    setPage(to)
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }

  return (
    <div className="space-y-8">
      <AddPanel exam={exam} />

      <Panel title="The list">
        <p className="mt-2 text-xs text-soft/55">
          A student holds their ID from the moment they sign in at the exam’s address and save it, so a clash shows
          before the day. Release frees an ID from the account that holds it, for a student who signed in with the
          wrong account. Once a student has started, their ID stays as it is.
          {live ? ' While students can start, the list is read again every 30 seconds.' : ''}
        </p>

        {/* The label comes first for a screen reader and the number sits on top. */}
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          {[
            ['On the list', rows.length],
            ['Held', held],
            ['Started', started],
          ].map(([label, n]) => (
            // justify-end keeps the three numbers on one line when a label
            // wraps on a narrow phone and the others do not.
            <div key={label} className="flex min-w-0 flex-col-reverse justify-end rounded-xl border border-line/10 bg-sunk/40 px-1 py-3 sm:px-2">
              <dt className="mt-1 text-2xs font-semibold uppercase tracking-[0.04em] text-soft/55 sm:tracking-[0.12em]">
                {label}
              </dt>
              <dd className="heading-serif text-2xl text-ink">{known ? n : '…'}</dd>
            </div>
          ))}
        </dl>
        <p className="sr-only" aria-live="polite">
          {known ? `${rows.length} on the list, ${held} held, ${started} started.` : ''}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
              setRefused(null)
            }}
            placeholder="Search by ID, name or email"
            aria-label="Search the list"
            className={`${inputCls} ${tapCls} max-w-sm`}
          />
          <RefreshButton busy={registrations.isFetching} onClick={() => registrations.refetch()} />
          <span className="text-xs text-soft/50" aria-live="polite">
            {term && known ? `${countOf(matches.length, 'match', 'matches')}` : ''}
          </span>
          <span className="ml-auto">
            <ExportButtons
              title="Registered student IDs"
              subtitle={`${exam.title}${term ? `, matching “${term}”` : ''}. Who holds each ID, and who has started.`}
              filename="exam-registered-ids"
              columns={exportColumns}
              rows={matches}
              className={`${outlineBtnCls} ${tapCls}`}
            />
          </span>
        </div>

        {refusedOffScreen && (
          <div className="mt-3">
            <ErrorText>{refusedOffScreen}</ErrorText>
          </div>
        )}

        {registrations.isPending ? (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        ) : !known ? (
          <div className="mt-4">
            <ErrorText>{readProblem('load the list', registrations.error)}</ErrorText>
          </div>
        ) : (
          <>
            {registrations.error && (
              <div className="mt-3">
                <ErrorText>{readProblem('refresh the list', registrations.error)}</ErrorText>
              </div>
            )}
            {rows.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">No IDs on the list yet. Add them above.</p>
            ) : matches.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">Nothing on the list matches that.</p>
            ) : (
              <>
                <ul ref={listRef} className="mt-4 space-y-2">
                  {visible.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      acting={acting[row.id]}
                      error={refused?.id === row.id ? refused.text : ''}
                      onRelease={() => act('release', row)}
                      onRemove={() => act('remove', row)}
                    />
                  ))}
                </ul>
                {pages > 1 && (
                  <div className="flex items-center justify-center gap-4 pt-6 text-xs text-soft/60">
                    <button
                      type="button"
                      disabled={at === 0}
                      onClick={() => turn(at - 1)}
                      className={`${outlineBtnCls} ${tapCls}`}
                    >
                      Previous
                    </button>
                    <span>
                      Page {at + 1} of {pages}
                    </span>
                    <button
                      type="button"
                      disabled={at + 1 >= pages}
                      onClick={() => turn(at + 1)}
                      className={`${outlineBtnCls} ${tapCls}`}
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
    </div>
  )
}
