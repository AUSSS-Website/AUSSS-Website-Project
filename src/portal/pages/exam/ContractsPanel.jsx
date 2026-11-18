import { useMemo, useRef, useState } from 'react'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { errorText } from '../../../lib/errorText.js'
import ExportButtons from '../../ExportButtons.jsx'
import {
  CONTRACT_CLASSES,
  CONTRACT_PROGRAMMES,
  COUNTRY_MAX,
  NOTE_MAX,
  PLACES_MAX,
  addedContracts,
  checkContractList,
  contractFault,
  contractGroups,
  contractsFromGrid,
  contractsFromText,
  demandOf,
  demandWords,
  placesIn,
  preferenceColumns,
  preferenceRows,
  preferenceTally,
  tidyContract,
} from '../../examContracts.js'
import { fileGrid } from '../../examFile.js'
import { useContractMutations, useExamContracts, usePreferenceList } from '../../examQueries.js'
import { useExamRanking } from '../../examResultQueries.js'
import { exportName, readProblem } from '../../examStats.js'
import { ConfirmButton, ErrorText, Field, Panel, Spinner, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { RefreshButton, confirmReachCls, countOf, tapCls } from './ExamsPage.jsx'

// The Contracts part of /portal/exam/:id. The exchange contracts a student
// chooses among before they start: adding them one at a time, by pasting or
// from a file (examContracts.js reads both), the list by programme and class
// with how many students chose each, correcting or removing one, and the
// export of every student's preferences beside their mark and rank. `exam` is
// the row from examQueries.js.
//
// The database holds the rules and its refusals are shown as it wrote them:
// once the first student has started, contracts are neither added nor removed,
// and a contract somebody has chosen keeps its programme and class.

const NO_ROWS = []
const STARTED = 'The exam has started: contracts can no longer be added or removed. You can still correct a country or a note.'

const selectCls = `${inputCls} ${tapCls}`

// The five fields of a contract, for the form that adds one and the form that
// changes one. `fixed` switches the programme and the class off.
function ContractFields({ idPrefix, value, onChange, fixed = false, disabled = false }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })
  return (
    <div className="grid gap-3 sm:grid-cols-[10rem_7rem_1fr_9rem]">
      <Field label="Programme" htmlFor={`${idPrefix}-programme`}>
        <select id={`${idPrefix}-programme`} className={selectCls} value={value.programme} onChange={set('programme')} disabled={disabled || fixed}>
          {CONTRACT_PROGRAMMES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.short}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Class" htmlFor={`${idPrefix}-class`}>
        <select id={`${idPrefix}-class`} className={selectCls} value={value.class} onChange={set('class')} disabled={disabled || fixed}>
          {CONTRACT_CLASSES.map((cls) => (
            <option key={cls} value={cls}>
              Class {cls}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Country" htmlFor={`${idPrefix}-country`}>
        <input
          id={`${idPrefix}-country`}
          className={`${inputCls} ${tapCls}`}
          value={value.country}
          onChange={set('country')}
          maxLength={COUNTRY_MAX}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>
      <Field label="Number of contracts" htmlFor={`${idPrefix}-places`}>
        <input
          id={`${idPrefix}-places`}
          type="number"
          inputMode="numeric"
          min={1}
          max={PLACES_MAX}
          step={1}
          className={`${inputCls} ${tapCls}`}
          value={value.places}
          onChange={set('places')}
          disabled={disabled}
        />
      </Field>
      <div className="sm:col-span-4">
        <Field label="Note (optional)" htmlFor={`${idPrefix}-note`} hint="Anything a student should know: the city, the months, a condition.">
          <input
            id={`${idPrefix}-note`}
            className={`${inputCls} ${tapCls}`}
            value={value.note}
            onChange={set('note')}
            maxLength={NOTE_MAX}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
      </div>
    </div>
  )
}

const BLANK = { programme: 'scope', class: 'A', country: '', places: '1', note: '' }

function AddPanel({ exam }) {
  const { add } = useContractMutations(exam.id)
  const fileRef = useRef(null)
  const boxRef = useRef(null)
  const [one, setOne] = useState(BLANK)
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const busy = reading || add.isPending
  // A tab closed while a list is on its way leaves the officer not knowing
  // whether it went in: the browser asks first.
  useLeaveWarning(busy)

  // Runs one of the three ways of adding. examContracts.js's own sentences
  // and the database's refusals are shown as written; the spreadsheet
  // reader's and the browser's words are not.
  const run = async (fn) => {
    setNote('')
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errorText(err, 'The contracts could not be added.'))
    }
  }
  // Lines that are the same contract were counted together when the list was
  // read; the note says so when that made the list shorter.
  const send = async (list) => setNote(addedContracts(await add.mutateAsync(checkContractList(list)), list.lines))

  const addOne = (e) => {
    e.preventDefault()
    run(async () => {
      const fault = contractFault(one)
      if (fault) throw Object.assign(new Error(fault), { rejected: true })
      await send({ rows: [tidyContract(one)], problems: [] })
      // The next one is usually of the same programme and class.
      setOne({ ...one, country: '', places: '1', note: '' })
    })
  }

  const addPasted = (e) => {
    e.preventDefault()
    if (!text.trim()) boxRef.current?.focus()
    run(async () => {
      await send(contractsFromText(text))
      setText('')
    })
  }

  const onFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      setReading(true)
      try {
        await send(contractsFromGrid(await fileGrid(file)))
      } finally {
        setReading(false)
      }
    })
  }

  if (exam.started) {
    return (
      <Panel title="Add contracts">
        <p className="mt-2 text-sm text-soft/70">{STARTED}</p>
      </Panel>
    )
  }

  return (
    <Panel title="Add contracts">
      <p className="mt-2 text-xs text-soft/55">
        Each student chooses among these before they start: in each programme up to two of Class A, up to two of Class
        B and as many of Class C as they like, in their own order. In an exam with two optional sections a student
        sees the contracts of the sections they will answer.
      </p>

      <form onSubmit={addOne} className="mt-4 space-y-3">
        <ContractFields idPrefix="exam-contract-new" value={one} onChange={setOne} disabled={busy} />
        <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={busy}>
          {add.isPending && !reading ? 'Adding…' : 'Add contract'}
        </button>
      </form>

      <form onSubmit={addPasted} className="mt-8 space-y-3 border-t border-line/10 pt-6">
        <Field
          label="Or paste several"
          htmlFor="exam-contracts-paste"
          hint="One on each line: programme, class, country, then how many contracts there are of it and a note. The number and the note can be left out. Rows copied from a spreadsheet work as they are, with those five columns. Lines that are the same contract (the same programme, class, country and note) are counted together as one contract with that many of it."
        >
          <textarea
            id="exam-contracts-paste"
            ref={boxRef}
            className={`${inputCls} min-h-[8rem] font-mono`}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setNote('')
              setError('')
            }}
            placeholder={'SCOPE, A, Spain, 3, Madrid in July\nSCORE, C, Japan'}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={`${outlineBtnCls} ${tapCls}`} disabled={busy}>
            Add the pasted contracts
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={onFile} className="hidden" />
          <button type="button" className={`${outlineBtnCls} ${tapCls}`} disabled={busy} onClick={() => fileRef.current?.click()}>
            {reading ? 'Adding…' : 'Add from a file'}
          </button>
          <span className="text-xs text-soft/50">
            A file (.xlsx or .csv) gives its first five columns. A list is added whole or not at all.
          </span>
        </div>
      </form>

      {/* In the page from the start, so a screen reader says it when it comes. */}
      <p role="status" className={note ? 'mt-4 text-sm text-ok' : 'sr-only'}>
        {note}
      </p>
      {error && (
        <div className="mt-4">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Panel>
  )
}

// One contract of the list: as it reads, or the form that changes it.
//   demand   { chosen, first } when students chose it
//   started  the exam has a paper: nothing is removed, and the programme and
//            the class stay
function Row({ contract, demand, started }) {
  const { update, remove } = useContractMutations(contract.exam_id)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const chosen = (demand?.chosen || 0) > 0
  const busy = update.isPending || remove.isPending

  const save = async (e) => {
    e.preventDefault()
    setError('')
    const fault = contractFault(draft)
    if (fault) {
      setError(fault)
      return
    }
    try {
      await update.mutateAsync({ id: contract.id, patch: tidyContract(draft) })
      setDraft(null)
    } catch (err) {
      setError(errorText(err, 'The contract could not be saved.'))
    }
  }
  const drop = async () => {
    setError('')
    try {
      await remove.mutateAsync(contract.id)
    } catch (err) {
      setError(errorText(err, 'The contract could not be removed.'))
    }
  }

  if (draft) {
    return (
      <li className="rounded-xl border border-line/20 bg-sunk/40 p-3">
        <form onSubmit={save} className="space-y-3">
          <ContractFields
            idPrefix={`exam-contract-${contract.id}`}
            value={draft}
            onChange={setDraft}
            fixed={started || chosen}
            disabled={busy}
          />
          {(started || chosen) && (
            <p className="text-xs text-soft/55">
              {started
                ? 'The exam has started, so the programme and the class stay.'
                : 'Students have chosen this contract, so its programme and class stay. To change them, remove it and add it again.'}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={busy}>
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className={`${outlineBtnCls} ${tapCls}`}
              disabled={busy}
              onClick={() => {
                setDraft(null)
                setError('')
              }}
            >
              Cancel
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </form>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line/10 bg-sunk/40 p-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-semibold text-ink">{contract.country}</p>
        <p className="mt-0.5 break-words text-xs text-soft/65">
          {countOf(contract.places || 1, 'contract')}
          {contract.note && ` · ${contract.note}`}
        </p>
        {chosen && <p className="mt-0.5 text-xs text-soft/55">{demandWords(demand)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          className={`${outlineBtnCls} ${tapCls}`}
          disabled={busy}
          aria-label={`Change ${contract.country}`}
          onClick={() => {
            setError('')
            setDraft({
              programme: contract.programme,
              class: contract.class,
              country: contract.country,
              places: String(contract.places || 1),
              note: contract.note,
            })
          }}
        >
          Change
        </button>
        {!started && (
          <span className={confirmReachCls}>
            <ConfirmButton
              variant="text"
              label="Remove"
              ariaLabel={`Remove ${contract.country}`}
              confirmLabel="Click again to remove"
              busyLabel="Removing…"
              onConfirm={drop}
              busy={remove.isPending}
              disabled={busy}
              title={chosen ? 'Also takes it off the lists of the students who chose it' : undefined}
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

export default function ContractsPanel({ exam }) {
  const contracts = useExamContracts(exam.id)
  const preferences = usePreferenceList(exam.id, exam)
  const ranking = useExamRanking(exam.id)

  // A list that was read once stays on the page when a later read fails.
  const known = Array.isArray(contracts.data)
  const rows = known ? contracts.data : NO_ROWS
  const students = Array.isArray(preferences.data) ? preferences.data : NO_ROWS
  const groups = useMemo(() => contractGroups(rows), [rows])
  const demand = useMemo(() => demandOf(rows, students), [rows, students])
  const tally = useMemo(() => preferenceTally(students), [students])
  const choice = ranking.data?.sections?.choice === true
  const exportRows = useMemo(() => preferenceRows(students, ranking.data?.attempts), [students, ranking.data])
  const columns = useMemo(() => preferenceColumns(rows, choice), [rows, choice])

  return (
    <div className="space-y-8">
      <AddPanel exam={exam} />

      <Panel title="The contracts">
        <p className="mt-2 text-xs text-soft/55">
          By programme and class, in the order you added them, which is the order a student sees.
          {exam.started
            ? ' The exam has started: a country, a number of contracts or a note can still be corrected, and nothing else.'
            : ' Removing a contract also takes it off the lists of the students who chose it.'}
        </p>

        {contracts.isPending ? (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        ) : !known ? (
          <div className="mt-4">
            <ErrorText>{readProblem('load the contracts', contracts.error)}</ErrorText>
          </div>
        ) : (
          <>
            {contracts.error && (
              <div className="mt-3">
                <ErrorText>{readProblem('refresh the contracts', contracts.error)}</ErrorText>
              </div>
            )}
            {rows.length === 0 ? (
              <p className="mt-4 text-sm text-soft/60">
                No contracts yet. An exam with no contracts asks its students for no preferences.
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.programme.id} className="mt-6">
                  <h3 className="text-sm font-semibold text-ink">
                    {group.programme.name}{' '}
                    <span className="font-normal text-soft/60">
                      · {countOf(group.classes.reduce((n, k) => n + placesIn(k.contracts), 0), 'contract')}
                    </span>
                  </h3>
                  {group.classes.map((cls) => (
                    <div key={cls.class} className="mt-3">
                      <h4 className="text-2xs font-semibold uppercase tracking-[0.12em] text-soft/55">
                        Class {cls.class} · {placesIn(cls.contracts)}
                      </h4>
                      <ul className="mt-2 space-y-2">
                        {cls.contracts.map((contract) => (
                          <Row key={contract.id} contract={contract} demand={demand.get(contract.id)} started={exam.started} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))
            )}
          </>
        )}
      </Panel>

      <Panel title="Students’ preferences">
        <p className="mt-2 text-xs text-soft/55">
          A student gives their preferences at the exam’s address, after their details and before the start code, and
          can change them until they start. The file has one row for each student who has saved them or has a paper:
          their mark and rank, then their first and second choice in Class A and in Class B and their Class C choices
          in order, for each programme. A student who added a section during the exam has no choices in it.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink" aria-live="polite">
            {preferences.isPending
              ? 'Reading…'
              : `${countOf(tally.saved, 'student has', 'students have')} saved preferences${
                  tally.saved > 0 ? `, and ${tally.started} of them ${tally.started === 1 ? 'has' : 'have'} started` : ''
                }.`}
          </p>
          <RefreshButton
            busy={preferences.isFetching || ranking.isFetching}
            onClick={() => {
              preferences.refetch()
              ranking.refetch()
            }}
          />
          <span className="ml-auto">
            <ExportButtons
              title={`Contract preferences: ${exam.title}`}
              subtitle="Each student’s mark and rank, and the contracts they chose, in their order. Marks as counted when this file was made."
              filename={exportName(exam.title, 'contract-preferences')}
              columns={columns}
              rows={exportRows}
              landscape
              className={`${outlineBtnCls} ${tapCls}`}
            />
          </span>
        </div>
        {(preferences.error || ranking.error) && (
          <div className="mt-3">
            <ErrorText>{readProblem('read the preferences', preferences.error || ranking.error)}</ErrorText>
          </div>
        )}
      </Panel>
    </div>
  )
}
